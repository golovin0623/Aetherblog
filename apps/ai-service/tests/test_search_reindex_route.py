from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi.testclient import TestClient

from app.api.deps import (
    get_metrics,
    get_pg_pool,
    get_usage_logger,
    get_vector_store,
    require_admin_or_internal,
)
from app.core.jwt import UserClaims
from app.main import app
from app.services.vector_store import SearchProfile

client = TestClient(app)


class FakeMetrics:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def record(self, **kwargs) -> None:
        self.calls.append(kwargs)


class FakeUsageLogger:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def record(self, **kwargs) -> None:
        self.calls.append(kwargs)


class FakeConn:
    async def fetch(self, _sql, *_args):
        return [
            {
                "id": 1,
                "title": "Docker 使用",
                "slug": "docker-usage",
                "content_markdown": "content",
            }
        ]

    async def fetchrow(self, _sql, *_args):
        return {"id": 1, "deleted": False}


class FakePool:
    @asynccontextmanager
    async def acquire(self):
        yield FakeConn()


class FakeVectorStore:
    def __init__(self, profile: SearchProfile, *, allow_active_profile: bool = False) -> None:
        self.profile = profile
        self.allow_active_profile = allow_active_profile
        self.upsert_calls: list[dict] = []
        self.active_profile_calls = 0

    async def get_active_profile(self) -> SearchProfile:
        self.active_profile_calls += 1
        if self.allow_active_profile:
            return self.profile
        raise AssertionError("profileCode reindex must not require active profile")

    async def _fetch_profile_by_code(self, code: str) -> SearchProfile | None:
        if code == self.profile.code:
            return self.profile
        return None

    async def upsert_post_embedding(self, **kwargs):
        self.upsert_calls.append(kwargs)
        return {"status": "indexed", "chunks": 1}


def _profile() -> SearchProfile:
    return SearchProfile(
        id=9,
        code="new-v2",
        name="New v2",
        description=None,
        model_id="embedding-v2",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status="shadow",
    )


def test_reindex_profile_code_uses_target_profile_model_without_active_profile():
    metrics = FakeMetrics()
    usage_logger = FakeUsageLogger()
    vector_store = FakeVectorStore(_profile())

    async def mock_admin():
        return UserClaims(user_id="1", role="admin", scopes=[])

    async def mock_vector_store():
        return vector_store

    async def mock_pool():
        return FakePool()

    def mock_metrics():
        return metrics

    async def mock_usage_logger():
        return usage_logger

    app.dependency_overrides[require_admin_or_internal] = mock_admin
    app.dependency_overrides[get_vector_store] = mock_vector_store
    app.dependency_overrides[get_pg_pool] = mock_pool
    app.dependency_overrides[get_metrics] = mock_metrics
    app.dependency_overrides[get_usage_logger] = mock_usage_logger

    try:
        response = client.post(
            "/api/v1/admin/search/reindex",
            params={"profileCode": "new-v2"},
            json={"mode": "full"},
        )
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    assert response.json()["data"] == {
        "status": "completed",
        "indexed": 1,
        "failed": 0,
        "profile": "new-v2",
        "model_id": "embedding-v2",
        "target_status": "shadow",
    }
    assert vector_store.active_profile_calls == 0
    assert vector_store.upsert_calls[0]["profile"].code == "new-v2"
    assert metrics.calls[0]["model"] == "embedding-v2"
    assert usage_logger.calls[0]["model"] == "embedding-v2"


def test_index_post_passes_active_profile_model_without_wrapper_usage_log():
    metrics = FakeMetrics()
    usage_logger = FakeUsageLogger()
    vector_store = FakeVectorStore(_profile(), allow_active_profile=True)

    async def mock_admin():
        return UserClaims(user_id="1", role="admin", scopes=[])

    async def mock_vector_store():
        return vector_store

    async def mock_pool():
        return FakePool()

    def mock_metrics():
        return metrics

    async def mock_usage_logger():
        return usage_logger

    app.dependency_overrides[require_admin_or_internal] = mock_admin
    app.dependency_overrides[get_vector_store] = mock_vector_store
    app.dependency_overrides[get_pg_pool] = mock_pool
    app.dependency_overrides[get_metrics] = mock_metrics
    app.dependency_overrides[get_usage_logger] = mock_usage_logger

    try:
        response = client.post(
            "/api/v1/admin/search/index",
            json={
                "action": "upsert",
                "postId": 1,
                "title": "Docker 使用",
                "slug": "docker-usage",
                "content": "content",
            },
        )
    finally:
        app.dependency_overrides = {}

    assert response.status_code == 200
    assert vector_store.active_profile_calls == 1
    call = vector_store.upsert_calls[0]
    assert call["profile"].model_id == "embedding-v2"
    assert call["user_id"] == "1"
    assert call["usage_endpoint"] == "/api/v1/admin/search/index"
    assert metrics.calls == []
    assert usage_logger.calls == []
