"""retry-failed 端点的 profile-scoped 模式回归测试。

验证：
- profileCode=None：调用旧 SQL 路径（embedding_status='FAILED'）
- profileCode=<code>：调用新 SQL 路径（NOT EXISTS active/shadow 行）
- profile 不存在 → 404
- profile 已 deprecated → 400
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.api.deps import get_pg_pool, get_vector_store, require_admin
from app.core.jwt import UserClaims
from app.main import app
from app.services.vector_store import SearchProfile


client = TestClient(app)


def _admin_user():
    return UserClaims(user_id="1", role="admin", scopes=[])


class FakeConn:
    """asyncpg.Connection mock。fetch 按 SQL 关键字判断走哪条路径。"""

    def __init__(self, rows_returned: list[dict]) -> None:
        self.rows_returned = rows_returned
        self.last_sql: str | None = None
        self.last_args: tuple = ()

    async def fetch(self, sql: str, *args):
        self.last_sql = sql
        self.last_args = args
        return self.rows_returned


class FakePool:
    def __init__(self, rows_returned: list[dict]) -> None:
        self.conn = FakeConn(rows_returned)

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class FakeVectorStore:
    """只对 retry-failed 关心的两个方法做 stub。"""

    def __init__(
        self,
        *,
        upsert_results: list[bool] | None = None,
        profile: SearchProfile | None = None,
    ) -> None:
        self.upsert_results = upsert_results or []
        self.upsert_calls: list[dict] = []
        self._profile = profile

    async def _fetch_profile_by_code(self, code: str) -> SearchProfile | None:
        if self._profile and self._profile.code == code:
            return self._profile
        return None

    async def upsert_post_embedding(self, **kwargs):
        self.upsert_calls.append(kwargs)
        if self.upsert_results:
            ok = self.upsert_results.pop(0)
            if not ok:
                raise RuntimeError("simulated embed fail")
        return {"status": "indexed", "chunks": 1}


def _install_overrides(*, pool: FakePool, vector_store: FakeVectorStore):
    async def mock_pool():
        return pool

    async def mock_vector():
        return vector_store

    app.dependency_overrides[require_admin] = lambda: _admin_user()
    app.dependency_overrides[get_pg_pool] = mock_pool
    app.dependency_overrides[get_vector_store] = mock_vector


def teardown_function(_):
    app.dependency_overrides = {}


def test_retry_failed_no_profile_uses_legacy_failed_path():
    pool = FakePool(rows_returned=[
        {"id": 1, "title": "A", "slug": "a", "content_markdown": "body A"},
    ])
    vs = FakeVectorStore(upsert_results=[True])
    _install_overrides(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/retry-failed")
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["success"] is True
    assert payload["data"]["retried"] == 1
    assert payload["data"]["total_failed"] == 1
    assert "embedding_status = 'FAILED'" in (pool.conn.last_sql or "")
    assert vs.upsert_calls[0]["post_id"] == 1


def test_retry_failed_with_profile_uses_not_exists_path():
    profile = SearchProfile(
        id=42,
        code="new-v2",
        name="new",
        description=None,
        model_id="text-embedding-3-small",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status="shadow",
    )
    pool = FakePool(rows_returned=[
        {"id": 11, "title": "X", "slug": "x", "content_markdown": "body X"},
        {"id": 12, "title": "Y", "slug": "y", "content_markdown": "body Y"},
    ])
    vs = FakeVectorStore(upsert_results=[True, True], profile=profile)
    _install_overrides(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/retry-failed?profileCode=new-v2")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["profile"] == "new-v2"
    assert data["target_status"] == "shadow"  # status='shadow' → 写 shadow
    assert data["retried"] == 2
    assert data["total_missing"] == 2
    # SQL 应包含 NOT EXISTS 子查询而非 embedding_status='FAILED'
    assert "NOT EXISTS" in (pool.conn.last_sql or "")
    assert pool.conn.last_args[0] == 42  # profile.id
    # 两次 upsert 都应携带 profile + target_status
    for call in vs.upsert_calls:
        assert call["profile"] is profile
        assert call["target_status"] == "shadow"


def test_retry_failed_unknown_profile_returns_404():
    pool = FakePool(rows_returned=[])
    vs = FakeVectorStore(profile=None)  # _fetch_profile_by_code 总返回 None
    _install_overrides(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/retry-failed?profileCode=nonexistent")
    assert res.status_code == 404
    # Global handler 把 HTTPException.detail 写到 message 字段
    assert "不存在" in res.json()["message"]


def test_retry_failed_deprecated_profile_returns_400():
    profile = SearchProfile(
        id=99,
        code="old-v1",
        name="old",
        description=None,
        model_id="m",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status="deprecated",
    )
    pool = FakePool(rows_returned=[])
    vs = FakeVectorStore(profile=profile)
    _install_overrides(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/retry-failed?profileCode=old-v1")
    assert res.status_code == 400
    assert "弃用" in res.json()["message"]


def test_retry_failed_active_profile_writes_to_active_status():
    profile = SearchProfile(
        id=7,
        code="default",
        name="default",
        description=None,
        model_id="m",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status="active",
    )
    pool = FakePool(rows_returned=[
        {"id": 5, "title": "Z", "slug": "z", "content_markdown": "body Z"},
    ])
    vs = FakeVectorStore(upsert_results=[True], profile=profile)
    _install_overrides(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/retry-failed?profileCode=default")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["target_status"] == "active"
