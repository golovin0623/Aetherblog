from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from app.services.note_indexer import NoteIndexerService
from app.services.vector_store import SearchProfile
from tests.support import FakeConn, FakePool


class FakeEmbedLLM:
    def __init__(self, embedding: list[float] | None = None) -> None:
        self.embedding = embedding or [0.1, 0.2, 0.3]
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def embed(self, text: str, **kwargs: Any) -> list[float]:
        self.calls.append((text, kwargs))
        return self.embedding


def _profile(**overrides: Any) -> SearchProfile:
    base = SearchProfile(
        id=42,
        code="active-search",
        name="Active search",
        description=None,
        model_id="text-embedding-3-small",
        chunker_kind="recursive",
        chunk_size_tokens=512,
        chunk_overlap_tokens=64,
        status="active",
    )
    return replace(base, **overrides)


@pytest.mark.asyncio
async def test_note_indexer_writes_profile_bound_note_chunks() -> None:
    profile = _profile()

    def fetchrow(sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        if "FROM notes" in sql:
            assert args == (11, 9)
            return {
                "id": 11,
                "title": "Evidence note",
                "summary": "Short summary",
                "content_markdown": "Body paragraph with [[links]]",
                "author_id": 9,
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    llm = FakeEmbedLLM([0.4, 0.5, 0.6])

    outcome = await NoteIndexerService(FakePool(conn), llm).index_note(
        note_id=11,
        user_id=9,
    )

    assert outcome is not None
    assert outcome.note_id == 11
    assert outcome.profile_id == 42
    assert outcome.model_id == "text-embedding-3-small"
    assert outcome.embedding_dim == 3
    assert outcome.chunk_count == 1
    assert outcome.status == "INDEXED"
    assert llm.calls == [
        (
            "Title: Evidence note\n\nSummary:\nShort summary\n\nContent:\nBody paragraph with [[links]]",
            {
                "user_id": 9,
                "embedding_model_id": "text-embedding-3-small",
                "strict_embedding_model_id": True,
            },
        )
    ]

    assert len(conn.executemany_calls) == 1
    assert any("FOR UPDATE" in sql for sql, _ in conn.fetchval_calls)
    insert_sql, rows = conn.executemany_calls[0]
    assert "INSERT INTO note_embeddings" in insert_sql
    assert "embedding_dim" in insert_sql
    assert "model_id" in insert_sql
    assert rows == [
        (
            11,
            42,
            0,
            "Title: Evidence note\n\nSummary:\nShort summary\n\nContent:\nBody paragraph with [[links]]",
            None,
            [0.4, 0.5, 0.6],
            3,
            "text-embedding-3-small",
            "INDEXED",
            pytest.approx(rows[0][9]),
        )
    ]
    assert any("DELETE FROM note_embeddings" in sql for sql, _ in conn.execute_calls)
    assert any("embedding_status = 'INDEXED'" in sql for sql, _ in conn.execute_calls)


@pytest.mark.asyncio
async def test_note_indexer_marks_blank_note_skipped_without_embedding() -> None:
    profile = _profile()

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        if "FROM notes" in sql:
            return {
                "id": 12,
                "title": "",
                "summary": None,
                "content_markdown": "",
                "author_id": 9,
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    llm = FakeEmbedLLM()

    outcome = await NoteIndexerService(FakePool(conn), llm).index_note(
        note_id=12,
        user_id=9,
    )

    assert outcome is not None
    assert outcome.status == "SKIPPED"
    assert outcome.chunk_count == 0
    assert llm.calls == []
    assert conn.executemany_calls == []
    assert any("FOR UPDATE" in sql for sql, _ in conn.fetchval_calls)
    assert any("DELETE FROM note_embeddings" in sql for sql, _ in conn.execute_calls)
    assert any("embedding_status = 'SKIPPED'" in sql for sql, _ in conn.execute_calls)
