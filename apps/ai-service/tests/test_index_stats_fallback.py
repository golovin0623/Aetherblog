"""fix/search-status-column-2026-04-19 的回归测试。

历史上 /api/v1/admin/search/stats 会在以下情况返回 500：版本化的
post_embeddings schema（migration 000034）被标记为已应用，但实际表
仍保留 000001 chunk 形态的列 —— 子查询
``SELECT COUNT(*) FROM post_embeddings WHERE status = 'active'`` 会
抛出 UndefinedColumnError，让管理后台搜索面板炸开，并把 React Query
拖入快速重试循环。修复后的 handler 现在会捕获 UndefinedColumnError /
UndefinedTableError，返回 ``vector_count = 0`` 与
``schema_ready: false``，从而让面板在等待 000036 下一波迁移时仍然可用。
"""
from __future__ import annotations

import asyncpg
from fastapi.testclient import TestClient

from app.api.deps import get_pg_pool, require_admin
from app.core.jwt import UserClaims
from app.main import app


class _FakeConn:
    def __init__(self, post_counts, vector_error=None, vector_count=0):
        self._post_counts = post_counts
        self._vector_error = vector_error
        self._vector_count = vector_count

    async def fetchrow(self, query, *args):
        if "post_embeddings" in query:
            if self._vector_error is not None:
                raise self._vector_error
            return {"c": self._vector_count}
        return dict(self._post_counts)


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return pool._conn

            async def __aexit__(self, *a):
                return None

        return _Ctx()


def _override_deps(conn):
    async def mock_admin():
        return UserClaims(user_id="admin", role="admin", scopes=[])

    async def mock_pool():
        return _FakePool(conn)

    app.dependency_overrides[require_admin] = mock_admin
    app.dependency_overrides[get_pg_pool] = mock_pool


def test_index_stats_schema_ready_happy_path():
    conn = _FakeConn(
        post_counts={
            "total_posts": 100,
            "indexed_posts": 90,
            "failed_posts": 5,
            "pending_posts": 5,
        },
        vector_count=90,
    )
    _override_deps(conn)
    try:
        client = TestClient(app)
        res = client.get("/api/v1/admin/search/stats")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["vector_count"] == 90
        assert data["schema_ready"] is True
        assert data["total_posts"] == 100
    finally:
        app.dependency_overrides = {}


def test_index_stats_missing_status_column_falls_back():
    conn = _FakeConn(
        post_counts={
            "total_posts": 100,
            "indexed_posts": 0,
            "failed_posts": 0,
            "pending_posts": 100,
        },
        vector_error=asyncpg.UndefinedColumnError('column "status" does not exist'),
    )
    _override_deps(conn)
    try:
        client = TestClient(app)
        res = client.get("/api/v1/admin/search/stats")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["vector_count"] == 0
        assert data["schema_ready"] is False
        # 文章级计数仍能正常返回，保证面板其他部分可用
        assert data["total_posts"] == 100
        assert data["pending_posts"] == 100
    finally:
        app.dependency_overrides = {}


def test_index_stats_missing_table_falls_back():
    conn = _FakeConn(
        post_counts={
            "total_posts": 0,
            "indexed_posts": 0,
            "failed_posts": 0,
            "pending_posts": 0,
        },
        vector_error=asyncpg.UndefinedTableError('relation "post_embeddings" does not exist'),
    )
    _override_deps(conn)
    try:
        client = TestClient(app)
        res = client.get("/api/v1/admin/search/stats")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["schema_ready"] is False
        assert data["vector_count"] == 0
    finally:
        app.dependency_overrides = {}


def test_index_stats_null_post_counts_does_not_500():
    """防御性：纯聚合 SELECT 理论上必返一行，但万一 fetchrow 返回 None
    （连接池中途断开等极端情况），dict(None) 会 TypeError 把整个面板
    带成 500。这里兜底到全零计数 + schema_ready=True
    （后者由 post_embeddings 查询本身决定）。
    """
    class _NullCountsConn(_FakeConn):
        async def fetchrow(self, query, *args):
            if "post_embeddings" in query:
                return {"c": 0}
            return None  # 模拟极端断流

    conn = _NullCountsConn(post_counts={})
    _override_deps(conn)
    try:
        client = TestClient(app)
        res = client.get("/api/v1/admin/search/stats")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["total_posts"] == 0
        assert data["indexed_posts"] == 0
        assert data["vector_count"] == 0
    finally:
        app.dependency_overrides = {}
