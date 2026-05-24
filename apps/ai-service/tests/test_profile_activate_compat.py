"""Search profile activation compatibility regressions."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi.testclient import TestClient

from app.api.deps import get_pg_pool, get_vector_store, require_admin
from app.core.jwt import UserClaims
from app.main import app


client = TestClient(app)


def _admin_user():
    return UserClaims(user_id="1", role="admin", scopes=[])


class _Tx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeActivateConn:
    def __init__(
        self,
        *,
        indexed_total: int | None,
        target_status: str = "shadow",
    ) -> None:
        self.indexed_total = indexed_total
        self.target_status = target_status
        self.coverage_sql: str | None = None
        self.executed: list[str] = []

    async def fetchrow(self, sql: str, *args):
        if "FROM search_profiles WHERE code" in sql:
            return {"id": 42, "code": args[0], "status": self.target_status}

        if "WITH current_posts" in sql:
            self.coverage_sql = sql
            if self.indexed_total is not None:
                return {"published_total": 1, "indexed_total": self.indexed_total}

            # Simulate the production hazard this test guards against:
            # stale historical embeddings exist, but the current published post
            # has no complete embedding for this profile. A query that joins the
            # current post set returns 0/1; the old count-only query would return
            # 1/1 and allow an unsafe activation.
            if "JOIN post_embeddings pe" in sql and "FROM current_posts p" in sql:
                return {"published_total": 1, "indexed_total": 0}
            return {"published_total": 1, "indexed_total": 1}

        if "FROM search_profiles WHERE status = 'active'" in sql:
            return {"id": 1, "code": "default"}

        return None

    async def fetchval(self, _sql: str, *_args):
        return "text-embedding-3-small"

    async def execute(self, sql: str, *_args):
        self.executed.append(sql)
        return "OK"

    def transaction(self):
        return _Tx()


class FakeActivatePool:
    def __init__(self, conn: FakeActivateConn) -> None:
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def _install(pool: FakeActivatePool) -> None:
    async def mock_pool():
        return pool

    async def mock_vector_store():
        return object()

    app.dependency_overrides[require_admin] = _admin_user
    app.dependency_overrides[get_pg_pool] = mock_pool
    app.dependency_overrides[get_vector_store] = mock_vector_store


def teardown_function(_):
    app.dependency_overrides = {}


def test_activate_coverage_ignores_stale_historical_embeddings():
    conn = FakeActivateConn(indexed_total=None)
    _install(FakeActivatePool(conn))

    res = client.post("/api/v1/admin/search/profiles/new-v2/activate")

    assert res.status_code == 409
    assert "0/1" in res.json()["message"]
    assert conn.coverage_sql is not None
    assert "WITH current_posts" in conn.coverage_sql
    assert "JOIN post_embeddings pe" in conn.coverage_sql
    assert not conn.executed


def test_activate_allows_legacy_rows_without_chunk_hash():
    conn = FakeActivateConn(indexed_total=1)
    _install(FakeActivatePool(conn))

    res = client.post("/api/v1/admin/search/profiles/new-v2/activate")

    assert res.status_code == 200, res.text
    assert conn.coverage_sql is not None
    assert "COALESCE(pe.chunk_count, 1)" in conn.coverage_sql
    assert "chunk_hash" not in conn.coverage_sql.lower()
    assert any("UPDATE search_profiles SET status = 'active'" in sql for sql in conn.executed)


def test_activate_can_switch_back_to_deprecated_profile():
    conn = FakeActivateConn(indexed_total=1, target_status="deprecated")
    _install(FakeActivatePool(conn))

    res = client.post("/api/v1/admin/search/profiles/old-v1/activate")

    assert res.status_code == 200, res.text
    assert conn.coverage_sql is not None
    assert "pe.status IN ('active', 'shadow', 'deprecated')" in conn.coverage_sql
    assert any(
        "WHERE profile_id = $1 AND status IN ('shadow', 'deprecated')" in sql
        for sql in conn.executed
    )
