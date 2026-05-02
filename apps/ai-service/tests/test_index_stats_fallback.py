"""fix/search-status-column-2026-04-19 + migration 000041 的回归测试。

历史上 /api/v1/admin/search/stats 会在以下情况返回 500：版本化的
post_embeddings schema（migration 000034）被标记为已应用，但实际表
仍保留 000001 chunk 形态的列 —— 子查询会抛出 UndefinedColumnError，
让管理后台搜索面板炸开。

migration 000041 把 schema 升级为 profile 化（多 chunk per post），
stats handler 现在查 search_profiles + post_embeddings(profile_id)
两层；任一层缺列/缺表都应 fall back 到 schema_ready=False，让面板在
等待迁移时仍然可用。
"""
from __future__ import annotations

import asyncpg
from fastapi.testclient import TestClient

from app.api.deps import get_pg_pool, require_admin
from app.core.jwt import UserClaims
from app.main import app


class _FakeConn:
    """三种 query 路径的统一 mock：
       - "FROM posts"           → 文章级统计行
       - "FROM search_profiles" → 当前 active profile 行
       - "FROM post_embeddings" → chunk + post 计数（或抛 schema 异常）
    """

    def __init__(
        self,
        post_counts,
        active_profile=None,
        vector_chunk_count=0,
        vector_post_count=0,
        profile_lookup_error=None,
        vector_error=None,
    ):
        self._post_counts = post_counts
        self._active_profile = active_profile
        self._vector_chunk_count = vector_chunk_count
        self._vector_post_count = vector_post_count
        self._profile_lookup_error = profile_lookup_error
        self._vector_error = vector_error

    async def fetchrow(self, query, *args):
        # 关键：先识别更具体的表（search_profiles / post_embeddings）再回退到 posts
        if "search_profiles" in query:
            if self._profile_lookup_error is not None:
                raise self._profile_lookup_error
            return self._active_profile
        if "post_embeddings" in query:
            if self._vector_error is not None:
                raise self._vector_error
            return {
                "chunk_count": self._vector_chunk_count,
                "post_count": self._vector_post_count,
            }
        return dict(self._post_counts) if self._post_counts is not None else None


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


_DEFAULT_PROFILE_ROW = {
    "id": 1,
    "code": "default",
    "name": "默认 · 递归 Markdown 切片",
    "model_id": "openai/text-embedding-3-large",
    "chunker_kind": "recursive",
    "chunk_size_tokens": 512,
    "chunk_overlap_tokens": 64,
}


def test_index_stats_schema_ready_happy_path():
    conn = _FakeConn(
        post_counts={
            "total_posts": 100,
            "indexed_posts": 90,
            "failed_posts": 5,
            "pending_posts": 5,
        },
        active_profile=_DEFAULT_PROFILE_ROW,
        vector_chunk_count=453,   # 多 chunk 后总 chunk 数 ≫ 文档数
        vector_post_count=90,
    )
    _override_deps(conn)
    try:
        client = TestClient(app)
        res = client.get("/api/v1/admin/search/stats")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["vector_count"] == 453
        assert data["vector_post_count"] == 90
        assert data["schema_ready"] is True
        assert data["total_posts"] == 100
        assert data["active_profile"]["code"] == "default"
        assert data["active_profile"]["chunkerKind"] == "recursive"
        assert data["active_profile"]["chunkSizeTokens"] == 512
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
        active_profile=_DEFAULT_PROFILE_ROW,
        vector_error=asyncpg.UndefinedColumnError('column "status" does not exist'),
    )
    _override_deps(conn)
    try:
        client = TestClient(app)
        res = client.get("/api/v1/admin/search/stats")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["vector_count"] == 0
        assert data["vector_post_count"] == 0
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
        # search_profiles 表也不存在 → 抛 UndefinedTableError
        profile_lookup_error=asyncpg.UndefinedTableError(
            'relation "search_profiles" does not exist'
        ),
    )
    _override_deps(conn)
    try:
        client = TestClient(app)
        res = client.get("/api/v1/admin/search/stats")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["schema_ready"] is False
        assert data["vector_count"] == 0
        assert data["vector_post_count"] == 0
        # 没有 active profile 时该字段为 None
        assert data["active_profile"] is None
    finally:
        app.dependency_overrides = {}


def test_index_stats_no_active_profile_returns_zero_vectors():
    """search_profiles 表存在但还没创建 active profile 时（极少见），
    stats 不应崩，而是把 vector 相关计数全 0、active_profile=None 返回。
    """
    conn = _FakeConn(
        post_counts={
            "total_posts": 50,
            "indexed_posts": 0,
            "failed_posts": 0,
            "pending_posts": 50,
        },
        active_profile=None,  # 没有 active 行
    )
    _override_deps(conn)
    try:
        client = TestClient(app)
        res = client.get("/api/v1/admin/search/stats")
        assert res.status_code == 200
        data = res.json()["data"]
        assert data["schema_ready"] is True
        assert data["vector_count"] == 0
        assert data["vector_post_count"] == 0
        assert data["active_profile"] is None
    finally:
        app.dependency_overrides = {}


def test_index_stats_null_post_counts_does_not_500():
    """防御性：纯聚合 SELECT 理论上必返一行，但万一 fetchrow 返回 None
    （连接池中途断开等极端情况），dict(None) 会 TypeError 把整个面板
    带成 500。这里兜底到全零计数 + schema_ready=True。
    """
    conn = _FakeConn(
        post_counts=None,  # FakeConn 会把 posts 路径返回 None
        active_profile=_DEFAULT_PROFILE_ROW,
        vector_chunk_count=0,
        vector_post_count=0,
    )
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
