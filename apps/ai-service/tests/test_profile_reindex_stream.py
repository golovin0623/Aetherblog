"""SSE-streaming reindex endpoint 回归测试。

验证 ``POST /v1/admin/search/profiles/{code}/reindex/stream`` 的帧序列：
- start → progress* → result → done
- per-post 失败仍 yield progress(status=failed) 而非中断 stream
- profile 不存在的 4xx
- DB 异常时 yield error 帧（不是 silent 502）
"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.api.routes.profiles as profiles_routes
from app.api.deps import get_pg_pool, get_vector_store, require_admin
from app.api.routes.profiles import reindex_profile_stream
from app.core.jwt import UserClaims
from app.main import app
from app.services.vector_store import SearchProfile


client = TestClient(app)


def _admin_user():
    return UserClaims(user_id="1", role="admin", scopes=[])


def _request():
    return SimpleNamespace(
        url=SimpleNamespace(path="/api/v1/admin/search/profiles/new-v2/reindex/stream"),
        state=SimpleNamespace(request_id="req-reindex-stream"),
    )


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
    """模拟 asyncpg.Connection：``fetch`` 返回 id 列表（来自 SELECT id 阶段），
    ``fetchrow`` 按 id 查找单行 post。"""

    def __init__(self, posts):
        self.posts = posts
        self._by_id = {p["id"]: p for p in posts}

    async def fetch(self, _sql, *_args):
        # 新实现只 SELECT id 列；返回所有 post 的 dict 也能兼容（routes 只读 row["id"]）
        return self.posts

    async def fetchrow(self, _sql, *args):
        # routes 调用形如 fetchrow("... WHERE id = $1 ...", post_id)
        if not args:
            return None
        return self._by_id.get(args[0])


class FakePool:
    def __init__(self, posts):
        self._posts = posts

    @asynccontextmanager
    async def acquire(self):
        yield FakeConn(self._posts)


class ResumeAwareFakeConn(FakeConn):
    """模拟 shadow profile 断点续跑查询。

    旧实现只查询所有已发布文章 id，导致失败后重进向导会从第一篇重跑。
    这个 fake 在看到 profile-aware 的 post_embeddings 查询时才返回缺失
    的文章；否则返回全量，让回归测试能先红。
    """

    def __init__(self, posts, resume_ids):
        super().__init__(posts)
        self.resume_ids = set(resume_ids)
        self.fetch_sqls: list[str] = []

    async def fetch(self, sql, *args):
        self.fetch_sqls.append(sql)
        if "post_embeddings" in sql and "NOT EXISTS" in sql and args:
            return [p for p in self.posts if p["id"] in self.resume_ids]
        return self.posts


class ResumeAwareFakePool(FakePool):
    def __init__(self, posts, resume_ids):
        super().__init__(posts)
        self.conn = ResumeAwareFakeConn(posts, resume_ids)

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class _SimplePool:
    """raise on acquire() —— 模拟 DB 不可用，让 gen() 走 fatal 分支。"""

    @asynccontextmanager
    async def acquire(self):
        raise RuntimeError("simulated DB outage")
        yield  # pragma: no cover


class FakeVectorStore:
    def __init__(self, *, profile: SearchProfile | None, upsert_results):
        self._profile = profile
        # upsert_results：每个元素或为 dict（成功）或为 Exception 实例（失败）
        self.upsert_results = (
            dict(upsert_results)
            if isinstance(upsert_results, dict)
            else list(upsert_results)
        )
        self.calls: list[dict] = []

    async def _fetch_profile_by_code(self, code: str):
        if self._profile and self._profile.code == code:
            return self._profile
        return None

    async def upsert_post_embedding(self, **kw):
        self.calls.append(kw)
        if not self.upsert_results:
            return {"status": "indexed", "chunks": 1}
        if isinstance(self.upsert_results, dict):
            nxt = self.upsert_results.get(
                kw["post_id"],
                {"status": "indexed", "chunks": 1},
            )
        else:
            nxt = self.upsert_results.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


class BlockingVectorStore(FakeVectorStore):
    def __init__(self, *, profile: SearchProfile | None, expected_started: int):
        super().__init__(profile=profile, upsert_results=[])
        self.expected_started = expected_started
        self.started = 0
        self.cancelled = 0
        self.started_event = asyncio.Event()

    async def upsert_post_embedding(self, **kw):
        self.calls.append(kw)
        self.started += 1
        if self.started >= self.expected_started:
            self.started_event.set()
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            self.cancelled += 1
            raise
        return {"status": "indexed", "chunks": 1}


class ChunkEventThenBlockingVectorStore(FakeVectorStore):
    def __init__(self, *, profile: SearchProfile | None):
        super().__init__(profile=profile, upsert_results=[])
        self.cancelled = 0

    async def upsert_post_embedding(self, **kw):
        self.calls.append(kw)
        await kw["progress_cb"]({
            "type": "chunk_progress",
            "postId": kw["post_id"],
            "profile": kw["profile"].code,
            "chunkIndex": 0,
            "doneChunks": 1,
            "totalChunks": 2,
            "status": "ok",
        })
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            self.cancelled += 1
            raise
        return {"status": "indexed", "chunks": 2}


class StreamSettings:
    reindex_stream_post_concurrency = 3


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
        upsert_results={
            1: {"status": "indexed", "chunks": 3},
            2: {"status": "indexed", "chunks": 5},
        },
    )
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200
    assert res.headers.get("content-type", "").startswith("text/event-stream")
    assert res.headers.get("x-accel-buffering") == "no"

    events = _parse_sse(res.content)
    assert len(events) == 7  # start + 2 chunk_progress + 2 progress + result + done
    assert events[0] == {"type": "start", "total": 2, "profile": "new-v2"}
    started_by_post = {
        event["postId"]: event for event in events if event["type"] == "chunk_progress"
    }
    assert started_by_post[1]["status"] == "started"
    assert started_by_post[1]["totalChunks"] == 0
    assert started_by_post[2]["status"] == "started"
    progress_by_post = {
        event["postId"]: event for event in events if event["type"] == "progress"
    }
    assert progress_by_post[1]["chunks"] == 3
    assert progress_by_post[1]["status"] == "ok"
    assert progress_by_post[2]["chunks"] == 5
    assert progress_by_post[2]["status"] == "ok"
    assert events[-2] == {
        "type": "result",
        "data": {
            "profile": "new-v2",
            "indexed": 2,
            "failed": 0,
            "target_status": "shadow",
        },
    }
    assert events[-1] == {"type": "done"}
    assert vs.calls[0]["embed_semaphore"] is vs.calls[1]["embed_semaphore"]


def test_reindex_stream_per_post_failure_continues_emitting_progress():
    pool = FakePool([
        {"id": 1, "title": "A", "slug": "a", "content_markdown": "x"},
        {"id": 2, "title": "B", "slug": "b", "content_markdown": "y"},
        {"id": 3, "title": "C", "slug": "c", "content_markdown": "z"},
    ])
    vs = FakeVectorStore(
        profile=_profile(),
        upsert_results={
            1: {"status": "indexed", "chunks": 1},
            2: RuntimeError("upstream 503 cascaded"),
            3: {"status": "indexed", "chunks": 2},
        },
    )
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200
    events = _parse_sse(res.content)
    progress = [e for e in events if e["type"] == "progress"]
    assert len(progress) == 3
    progress_by_post = {event["postId"]: event for event in progress}
    assert progress_by_post[1]["status"] == "ok"
    assert progress_by_post[2]["status"] == "failed"
    assert "503" in progress_by_post[2]["error"]
    assert progress_by_post[3]["status"] == "ok"

    result = next(e for e in events if e["type"] == "result")
    assert result["data"]["indexed"] == 2
    assert result["data"]["failed"] == 1


def test_reindex_stream_shadow_profile_resumes_only_missing_posts():
    pool = ResumeAwareFakePool(
        [
            {"id": 1, "title": "A", "slug": "a", "content_markdown": "already indexed"},
            {"id": 2, "title": "B", "slug": "b", "content_markdown": "metadata changed"},
            {"id": 3, "title": "C", "slug": "c", "content_markdown": "missing"},
        ],
        resume_ids={3},
    )
    vs = FakeVectorStore(
        profile=_profile(status="shadow"),
        upsert_results={
            3: {"status": "indexed", "chunks": 1},
        },
    )
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200
    events = _parse_sse(res.content)

    assert events[0] == {"type": "start", "total": 1, "profile": "new-v2"}
    assert [call["post_id"] for call in vs.calls] == [3]
    assert any("post_embeddings" in sql for sql in pool.conn.fetch_sqls)
    assert any("NOT EXISTS" in sql for sql in pool.conn.fetch_sqls)
    assert not any("p.updated_at" in sql for sql in pool.conn.fetch_sqls)
    result = next(e for e in events if e["type"] == "result")
    assert result["data"]["indexed"] == 1
    assert result["data"]["failed"] == 0


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


def test_reindex_stream_deprecated_profile_can_be_revalidated_for_switchback():
    pool = FakePool([])
    vs = FakeVectorStore(profile=_profile(status="deprecated"), upsert_results=[])
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200
    events = _parse_sse(res.content)
    result = next(e for e in events if e["type"] == "result")
    assert result["data"]["target_status"] == "shadow"
    assert result["data"]["indexed"] == 0
    assert result["data"]["failed"] == 0


def test_reindex_stream_post_deleted_midway_yields_failed_progress():
    """SELECT id 阶段拿到 post_id，但处理时 fetchrow 返回 None
    （文章被删 / 改状态）—— 应 emit progress(failed) 而非崩溃。"""

    class FakeConnDropped(FakeConn):
        async def fetchrow(self, _sql, *_args):
            return None  # 模拟所有 post 在 fetch 之后都被删了

    class FakePoolDropped(FakePool):
        @asynccontextmanager
        async def acquire(self):
            yield FakeConnDropped(self._posts)

    pool = FakePoolDropped([{"id": 7, "title": "X", "slug": "x", "content_markdown": "x"}])
    vs = FakeVectorStore(profile=_profile(), upsert_results=[])
    _install(pool=pool, vector_store=vs)

    res = client.post("/api/v1/admin/search/profiles/new-v2/reindex/stream")
    assert res.status_code == 200
    events = _parse_sse(res.content)
    progress = [e for e in events if e["type"] == "progress"]
    assert len(progress) == 1
    assert progress[0]["status"] == "failed"
    assert "no longer PUBLISHED" in progress[0]["error"]
    # vector_store.upsert_post_embedding 不应被调用
    assert vs.calls == []


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


@pytest.mark.asyncio
async def test_reindex_stream_emits_heartbeat_while_post_is_in_flight(monkeypatch):
    monkeypatch.setattr(profiles_routes, "REINDEX_STREAM_HEARTBEAT_SEC", 0.01)
    pool = FakePool([
        {"id": 1, "title": "A", "slug": "a", "content_markdown": "alpha"},
    ])
    vs = BlockingVectorStore(profile=_profile(), expected_started=1)

    response = await reindex_profile_stream(
        "new-v2",
        request=_request(),
        user=_admin_user(),
        pool=pool,
        vector_store=vs,
        settings=StreamSettings(),
    )
    iterator = response.body_iterator.__aiter__()

    try:
        first_frame = await iterator.__anext__()
        assert '"type": "start"' in first_frame

        started = await asyncio.wait_for(iterator.__anext__(), timeout=1)
        assert '"type": "chunk_progress"' in started
        assert '"status": "started"' in started

        heartbeat = await asyncio.wait_for(iterator.__anext__(), timeout=1)
        assert '"type": "heartbeat"' in heartbeat
        assert '"inFlight": 1' in heartbeat
    finally:
        await iterator.aclose()


@pytest.mark.asyncio
async def test_reindex_stream_does_not_drop_chunk_event_on_heartbeat_race(monkeypatch):
    monkeypatch.setattr(profiles_routes, "REINDEX_STREAM_HEARTBEAT_SEC", 0.01)
    original_wait = asyncio.wait
    wait_calls = 0

    async def race_wait(wait_set, *, timeout=None, return_when=asyncio.ALL_COMPLETED):
        nonlocal wait_calls
        wait_calls += 1
        if wait_calls == 1:
            for _ in range(5):
                await asyncio.sleep(0)
            return set(), set(wait_set)
        return await original_wait(wait_set, timeout=timeout, return_when=return_when)

    monkeypatch.setattr(profiles_routes.asyncio, "wait", race_wait)
    pool = FakePool([
        {"id": 1, "title": "A", "slug": "a", "content_markdown": "alpha"},
    ])
    vs = ChunkEventThenBlockingVectorStore(profile=_profile())

    response = await reindex_profile_stream(
        "new-v2",
        request=_request(),
        user=_admin_user(),
        pool=pool,
        vector_store=vs,
        settings=StreamSettings(),
    )
    iterator = response.body_iterator.__aiter__()

    try:
        first_frame = await iterator.__anext__()
        assert '"type": "start"' in first_frame

        started_frame = await asyncio.wait_for(iterator.__anext__(), timeout=1)
        assert '"type": "chunk_progress"' in started_frame
        assert '"status": "started"' in started_frame

        progress_frame = await asyncio.wait_for(iterator.__anext__(), timeout=1)
        assert '"type": "chunk_progress"' in progress_frame
        assert '"doneChunks": 1' in progress_frame
    finally:
        await iterator.aclose()

    assert vs.cancelled == 1


@pytest.mark.asyncio
async def test_reindex_stream_cancel_cleans_up_pending_workers(monkeypatch):
    created_tasks: list[asyncio.Task] = []
    original_create_task = asyncio.create_task

    def track_create_task(coro, *args, **kwargs):
        task = original_create_task(coro, *args, **kwargs)
        created_tasks.append(task)
        return task

    monkeypatch.setattr(profiles_routes.asyncio, "create_task", track_create_task)
    pool = FakePool([
        {"id": 1, "title": "A", "slug": "a", "content_markdown": "alpha"},
        {"id": 2, "title": "B", "slug": "b", "content_markdown": "beta"},
        {"id": 3, "title": "C", "slug": "c", "content_markdown": "gamma"},
    ])
    vs = BlockingVectorStore(profile=_profile(), expected_started=3)

    response = await reindex_profile_stream(
        "new-v2",
        request=_request(),
        user=_admin_user(),
        pool=pool,
        vector_store=vs,
        settings=StreamSettings(),
    )
    iterator = response.body_iterator.__aiter__()

    first_frame = await iterator.__anext__()
    assert '"type": "start"' in first_frame

    next_frame = asyncio.create_task(iterator.__anext__())
    await asyncio.wait_for(vs.started_event.wait(), timeout=1)

    next_frame.cancel()
    with pytest.raises(asyncio.CancelledError):
        await next_frame

    assert vs.cancelled == 3
    assert vs.calls[0]["embed_semaphore"] is vs.calls[1]["embed_semaphore"]
    assert vs.calls[0]["embed_semaphore"] is vs.calls[2]["embed_semaphore"]
    assert vs.calls[0]["user_id"] == "1"
    assert vs.calls[0]["usage_endpoint"] == "/api/v1/admin/search/profiles/new-v2/reindex/stream"
    assert vs.calls[0]["request_id"] == "req-reindex-stream"
    assert all(task.done() for task in created_tasks)
