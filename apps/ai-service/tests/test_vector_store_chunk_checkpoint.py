from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.services.chunker import Chunk
from app.services.vector_store import SearchProfile, VectorStoreService, _chunk_hash


class FakeCheckpointConn:
    def __init__(self):
        self.rows: list[dict] = []

    async def fetch(self, _sql: str, post_id: int, profile_id: int):
        return [
            row
            for row in self.rows
            if row["post_id"] == post_id
            and row["profile_id"] == profile_id
            and row["status"] in {"shadow", "deprecated"}
        ]

    async def execute(self, sql: str, *args):
        if sql.lstrip().startswith("DELETE"):
            post_id, profile_id, chunk_indices = args
            to_delete = set(chunk_indices)
            self.rows = [
                row
                for row in self.rows
                if not (
                    row["post_id"] == post_id
                    and row["profile_id"] == profile_id
                    and row["chunk_index"] in to_delete
                )
            ]
            return "DELETE"

        if sql.lstrip().startswith("INSERT INTO post_embeddings"):
            (
                post_id,
                profile_id,
                model_id,
                dim,
                embedding,
                chunk_index,
                chunk_text,
                parent_text,
                chunk_hash,
                chunk_count,
            ) = args
            self.rows = [
                row
                for row in self.rows
                if not (
                    row["post_id"] == post_id
                    and row["profile_id"] == profile_id
                    and row["chunk_index"] == chunk_index
                )
            ]
            self.rows.append({
                "post_id": post_id,
                "profile_id": profile_id,
                "model_id": model_id,
                "dim": dim,
                "embedding": embedding,
                "status": "shadow",
                "chunk_index": chunk_index,
                "chunk_text": chunk_text,
                "parent_text": parent_text,
                "chunk_hash": chunk_hash,
                "chunk_count": chunk_count,
            })
            return "INSERT"

        raise AssertionError(f"unexpected SQL: {sql}")


class FakeCheckpointPool:
    def __init__(self):
        self.conn = FakeCheckpointConn()

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class FakeLLM:
    def __init__(self, *, fail_texts: set[str] | None = None):
        self.fail_texts = fail_texts or set()
        self.calls: list[str] = []
        self.kwargs: list[dict] = []

    async def embed(self, text: str, timeout_sec=None, **_kwargs):
        self.calls.append(text)
        self.kwargs.append(dict(_kwargs, timeout_sec=timeout_sec))
        if text in self.fail_texts:
            raise RuntimeError(f"embed failed for {text}")
        return [float(len(text)), 1.0]


class FailingOverrideLLM:
    async def embed(self, *_args, **_kwargs):
        raise ValueError(
            "embedding model override failed for text-embedding-3-large: model not found or disabled"
        )


def _profile() -> SearchProfile:
    return SearchProfile(
        id=42,
        code="shadow-v2",
        name="shadow",
        description=None,
        model_id="m",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status="shadow",
    )


def _chunks() -> list[Chunk]:
    return [
        Chunk(index=0, text="alpha", tokens=1),
        Chunk(index=1, text="beta", tokens=1),
        Chunk(index=2, text="gamma", tokens=1),
    ]


@pytest.mark.asyncio
async def test_shadow_checkpoint_reuses_finished_chunks_after_chunk_failure():
    pool = FakeCheckpointPool()
    llm = FakeLLM(fail_texts={"gamma"})
    store = VectorStoreService(pool, llm)
    events: list[dict] = []

    async def collect(event: dict):
        events.append(event)

    with pytest.raises(RuntimeError, match="gamma"):
        await store._upsert_shadow_chunks_with_checkpoint(
            post_id=7,
            profile=_profile(),
            chunks=_chunks(),
            timeout_sec=None,
            embed_semaphore=None,
            progress_cb=collect,
            content_len=100,
        )

    assert {row["chunk_index"] for row in pool.conn.rows} == {0, 1}
    assert any(event["type"] == "chunk_progress" for event in events)

    llm.fail_texts = set()
    llm.calls.clear()
    result = await store._upsert_shadow_chunks_with_checkpoint(
        post_id=7,
        profile=_profile(),
        chunks=_chunks(),
        timeout_sec=None,
        embed_semaphore=None,
        progress_cb=collect,
        content_len=100,
    )

    assert llm.calls == ["gamma"]
    assert result["reused_chunks"] == 2
    assert result["embedded_chunks"] == 1
    assert result["chunks"] == 3
    assert {row["chunk_index"] for row in pool.conn.rows} == {0, 1, 2}
    assert {row["chunk_count"] for row in pool.conn.rows} == {3}


@pytest.mark.asyncio
async def test_shadow_checkpoint_reuses_deprecated_chunks_when_switching_back():
    pool = FakeCheckpointPool()
    chunks = _chunks()
    pool.conn.rows = [
        {
            "post_id": 7,
            "profile_id": 42,
            "model_id": "m",
            "dim": 2,
            "embedding": [1.0, 1.0],
            "status": "deprecated",
            "chunk_index": chunk.index,
            "chunk_text": chunk.text,
            "parent_text": chunk.parent_text,
            "chunk_hash": _chunk_hash(chunk),
            "chunk_count": len(chunks),
        }
        for chunk in chunks[:2]
    ]
    llm = FakeLLM()
    store = VectorStoreService(pool, llm)
    events: list[dict] = []

    async def collect(event: dict):
        events.append(event)

    result = await store._upsert_shadow_chunks_with_checkpoint(
        post_id=7,
        profile=_profile(),
        chunks=chunks,
        timeout_sec=None,
        embed_semaphore=None,
        progress_cb=collect,
        content_len=100,
    )

    assert llm.calls == ["gamma"]
    assert result["reused_chunks"] == 2
    assert result["embedded_chunks"] == 1
    assert result["chunks"] == 3
    assert events[0]["status"] == "resumed"
    assert events[0]["doneChunks"] == 2
    assert {row["chunk_index"] for row in pool.conn.rows} == {0, 1, 2}


class FakeSemanticConn:
    def __init__(self):
        self.fetch_args = None

    async def fetch(self, _sql: str, *args):
        self.fetch_args = args
        return []


class FakeSemanticPool:
    def __init__(self):
        self.conn = FakeSemanticConn()

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


@pytest.mark.asyncio
async def test_semantic_search_embeds_query_with_active_profile_model(monkeypatch):
    pool = FakeSemanticPool()
    llm = FakeLLM()
    store = VectorStoreService(pool, llm)
    profile = _profile()
    monkeypatch.setattr(store, "get_active_profile", AsyncMock(return_value=profile))

    await store.semantic_search("Docker怎么使用?", limit=5)

    assert llm.calls == ["Docker怎么使用?"]
    assert llm.kwargs[0]["embedding_model_id"] == profile.model_id
    assert llm.kwargs[0]["strict_embedding_model_id"] is True
    assert pool.conn.fetch_args[1] == profile.id


@pytest.mark.asyncio
async def test_semantic_search_reports_unavailable_profile_model(monkeypatch):
    pool = FakeSemanticPool()
    store = VectorStoreService(pool, FailingOverrideLLM())
    profile = _profile()
    monkeypatch.setattr(store, "get_active_profile", AsyncMock(return_value=profile))

    with pytest.raises(HTTPException) as exc:
        await store.semantic_search("Docker", limit=5)

    assert exc.value.status_code == 503
    assert "active search profile" in exc.value.detail
    assert pool.conn.fetch_args is None


@pytest.mark.asyncio
async def test_shadow_checkpoint_embeds_chunks_with_profile_model():
    pool = FakeCheckpointPool()
    llm = FakeLLM()
    store = VectorStoreService(pool, llm)
    profile = _profile()

    await store._upsert_shadow_chunks_with_checkpoint(
        post_id=7,
        profile=profile,
        chunks=_chunks()[:1],
        timeout_sec=None,
        embed_semaphore=None,
        progress_cb=None,
        content_len=100,
    )

    assert llm.kwargs[0]["embedding_model_id"] == profile.model_id
    assert llm.kwargs[0]["strict_embedding_model_id"] is True
