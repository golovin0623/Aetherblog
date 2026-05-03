"""SSE-streaming reindex endpoint 回归测试。

验证 ``POST /v1/admin/search/profiles/{code}/reindex/stream`` 的帧序列：
- start → progress* → result → done
- per-post 失败仍 yield progress(status=failed) 而非中断 stream
- profile 不存在 / deprecated 的 4xx
- DB 异常时 yield error 帧（不是 silent 502）
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager

from fastapi.testclient import TestClient

from app.api.deps import get_pg_pool, get_vector_store, require_admin
from app.core.jwt import UserClaims
from app.main import app
from app.services.vector_store import SearchProfile


client = TestClient(app)


def _admin_user():
    return UserClaims(user_id="1", role="admin", scopes=[])


def _parse_sse(body_bytes: bytes) -> list[dict]:
    """SSE body → list of decoded JSON events."""
    events = []
    for line in body_bytes.decode("utf-8").splitlines():
        if line.startswith("data: "):
            payload = line[len("data: "):]
            if payload:
                events.append(json.loads(payload))
    return events


class FakeConn:
    def __init__(self, posts):
        self.posts = posts

    async def fetch(self, _sql, *_args):
        return self.posts


class FakePool:
    def __init__(self, posts):
        self._posts = posts

    @asynccontextmanager
    async def acquire(self):
        yield FakeConn(self._posts)


class _SimplePool:
    """raise on acquire() —— 模拟 DB 不可用，让 gen() 走 fatal 分支。"""

    @asynccontextmanager
    async def acquire(self):
        raise RuntimeError("simulated DB outage")
        yield  # pragma: no cover


class FakeVectorStore:
    def __init__(self, *, profile: SearchProfile | None, upsert_results: list):
        self._profile = profile
        # upsert_results：每个元素或为 dict（成功）或为 Exception 实例（失败）
        self.upsert_results = list(upsert_results)
        self.calls: list[dict] = []

    async def _fetch_profile_by_code(self, code: str):
        if self._profile and self._profile.code == code:
            return self._profile
        return None

    async def upsert_post_embedding(self, **kw):
        self.calls.append(kw)
        if not self.upsert_results:
            return {"status": "indexed", "chunks": 1}
        nxt = self.upsert_results.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def _install(*, pool, vector_store):
    async def mock_pool():
        return pool

    async def mock_vs():
        return vector_store

    app.dependency_overrides[require_admin] = _admin_user
    app.dependency_overrides[get_pg_pool] = mock_pool
    app.dependency_overrides[get_vector_store] = mock_vs


def teardown_function(_):
    app.dependency_overrides = {}


def _profile(status="shadow"):
    return SearchProfile(
        id=1,
        code="new-v2",
        name="new",
        description=None,
        model_id="m",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status=status,
    )


def test_reindex_stream_success_yields_full_frame_sequence():
    pool = FakePool([
        {"id": 1, "title": "A", "slug": "a", "content_markdown": "alpha"},
        {"id": 2, "title": "B", "slug": "b", "content_markdown": "beta"},
    ])
    vs = FakeVectorStore(
        profile=_profile(),
        upsert_results=[
            {"status": "indexed", "chunks": 3},
            {"status": "indexed", "chunks": 5},
        ],
    )
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200
    assert res.headers.get("content-type", "").startswith("text/event-stream")
    assert res.headers.get("x-accel-buffering") == "no"

    events = _parse_sse(res.content)
    assert len(events) == 5  # start + 2 progress + result + done
    assert events[0] == {"type": "start", "total": 2, "profile": "new-v2"}
    assert events[1]["type"] == "progress"
    assert events[1]["postId"] == 1
    assert events[1]["chunks"] == 3
    assert events[1]["status"] == "ok"
    assert events[2]["postId"] == 2
    assert events[2]["chunks"] == 5
    assert events[3] == {
        "type": "result",
        "data": {
            "profile": "new-v2",
            "indexed": 2,
            "failed": 0,
            "target_status": "shadow",
        },
    }
    assert events[4] == {"type": "done"}


def test_reindex_stream_per_post_failure_continues_emitting_progress():
    pool = FakePool([
        {"id": 1, "title": "A", "slug": "a", "content_markdown": "x"},
        {"id": 2, "title": "B", "slug": "b", "content_markdown": "y"},
        {"id": 3, "title": "C", "slug": "c", "content_markdown": "z"},
    ])
    vs = FakeVectorStore(
        profile=_profile(),
        upsert_results=[
            {"status": "indexed", "chunks": 1},
            RuntimeError("upstream 503 cascaded"),
            {"status": "indexed", "chunks": 2},
        ],
    )
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200
    events = _parse_sse(res.content)
    progress = [e for e in events if e["type"] == "progress"]
    assert len(progress) == 3
    assert progress[0]["status"] == "ok"
    assert progress[1]["status"] == "failed"
    assert "503" in progress[1]["error"]
    assert progress[2]["status"] == "ok"

    result = next(e for e in events if e["type"] == "result")
    assert result["data"]["indexed"] == 2
    assert result["data"]["failed"] == 1


def test_reindex_stream_active_profile_writes_to_active_status():
    pool = FakePool([
        {"id": 1, "title": "A", "slug": "a", "content_markdown": "x"},
    ])
    vs = FakeVectorStore(
        profile=_profile(status="active"),
        upsert_results=[{"status": "indexed", "chunks": 1}],
    )
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200
    events = _parse_sse(res.content)
    result = next(e for e in events if e["type"] == "result")
    assert result["data"]["target_status"] == "active"
    # vector_store.upsert_post_embedding 应被调一次，target_status='active'
    assert vs.calls[0]["target_status"] == "active"


def test_reindex_stream_unknown_profile_returns_404():
    pool = FakePool([])
    vs = FakeVectorStore(profile=None, upsert_results=[])
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/nonexistent/reindex/stream")
    assert res.status_code == 404


def test_reindex_stream_deprecated_profile_returns_400():
    pool = FakePool([])
    vs = FakeVectorStore(profile=_profile(status="deprecated"), upsert_results=[])
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 400


def test_reindex_stream_db_outage_yields_error_frame():
    """gen() 内 try/except：DB 在 acquire() 阶段失败也要能优雅 emit error 帧。"""
    vs = FakeVectorStore(profile=_profile(), upsert_results=[])
    _install(pool=_SimplePool(), vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200  # 因为 fail 在 stream 已开始之后
    events = _parse_sse(res.content)
    assert any(e.get("type") == "error" for e in events), events
    err = next(e for e in events if e.get("type") == "error")
    assert "DB outage" in err["message"]
