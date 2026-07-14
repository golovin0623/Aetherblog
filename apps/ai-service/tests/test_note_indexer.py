from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from app.services import note_indexer as note_indexer_module
from app.services.note_indexer import NoteIndexerService, _note_fingerprint
from app.services.vector_store import SearchProfile
from tests.support import FakeConn, FakePool


class FakeEmbedLLM:
    def __init__(self, embedding: list[float] | None = None) -> None:
        self.embedding = embedding or [0.1, 0.2, 0.3]
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def embed(self, text: str, **kwargs: Any) -> list[float]:
        self.calls.append((text, kwargs))
        return self.embedding


class FailingEmbedLLM:
    async def embed(self, _text: str, **_kwargs: Any) -> list[float]:
        raise RuntimeError("provider unavailable")


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
async def test_note_indexer_begin_attempt_claims_fenced_pending_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(note_indexer_module.secrets, "token_hex", lambda _size: "attempt-a")

    def fetchrow(sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        assert "UPDATE notes" in sql
        assert "embedding_status = 'PENDING'" in sql
        assert "embedding_attempt_id = $1" in sql
        assert "RETURNING id" in sql
        assert args == ("attempt-a", 11, 9)
        return {"id": 11}

    attempt_id = await NoteIndexerService(
        FakePool(FakeConn(fetchrow=fetchrow)),
        FakeEmbedLLM(),
    ).begin_attempt(note_id=11, user_id=9)

    assert attempt_id == "attempt-a"


@pytest.mark.asyncio
async def test_note_indexer_fail_attempt_closes_only_matching_pending_token() -> None:
    def execute(sql: str, args: tuple[Any, ...]) -> str:
        assert "embedding_status = 'FAILED'" in sql
        assert "embedding_attempt_id = NULL" in sql
        assert "embedding_status = 'PENDING'" in sql
        assert "embedding_attempt_id = $3" in sql
        assert args == ("safe failure", 11, "attempt-a")
        return "UPDATE 1"

    await NoteIndexerService(
        FakePool(FakeConn(execute=execute)),
        FakeEmbedLLM(),
    ).fail_attempt(
        note_id=11,
        attempt_id="attempt-a",
        error="safe failure",
    )


@pytest.mark.asyncio
async def test_matching_late_success_commits_profile_bound_note_chunks() -> None:
    profile = _profile()

    def fetchrow(sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "search.active_profile_code" in sql:
            return {"setting_value": profile.code}
        if "FROM search_profiles WHERE code" in sql:
            return profile.__dict__
        if "FROM notes" in sql:
            assert args == ((11,) if "FOR UPDATE" in sql else (11, 9))
            return {
                "id": 11,
                "title": "Evidence note",
                "summary": "Short summary",
                "content_markdown": "Body paragraph with [[links]]",
                "author_id": 9,
                "embedding_status": "FAILED",
                "embedding_attempt_id": "attempt-a",
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    llm = FakeEmbedLLM([0.4, 0.5, 0.6])

    outcome = await NoteIndexerService(FakePool(conn), llm).index_note(
        note_id=11,
        user_id=9,
        attempt_id="attempt-a",
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
    assert any("FOR UPDATE" in sql for sql, _ in conn.fetchrow_calls)
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
    indexed_updates = [
        (sql, args)
        for sql, args in conn.execute_calls
        if "embedding_status = 'INDEXED'" in sql
    ]
    assert len(indexed_updates) == 1
    indexed_sql, indexed_args = indexed_updates[0]
    assert "embedding_fingerprint" in indexed_sql
    assert "embedding_profile_id" in indexed_sql
    assert "embedding_attempt_id = NULL" in indexed_sql
    assert indexed_args[0] == _note_fingerprint(
        "Title: Evidence note\n\nSummary:\nShort summary\n\nContent:\nBody paragraph with [[links]]"
    )
    assert indexed_args[1:] == (42, 11)


@pytest.mark.asyncio
@pytest.mark.parametrize("stored_attempt_id", ["attempt-b", None])
async def test_note_indexer_rejects_replaced_or_cleared_attempt_before_embedding(
    stored_attempt_id: str | None,
) -> None:
    profile = _profile()

    def fetchrow(sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "FROM notes" in sql:
            assert "FOR UPDATE" not in sql
            assert args == (11, 9)
            return {
                "id": 11,
                "title": "Evidence note",
                "summary": None,
                "content_markdown": "Same revision",
                "author_id": 9,
                "embedding_attempt_id": stored_attempt_id,
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    llm = FakeEmbedLLM()

    outcome = await NoteIndexerService(FakePool(conn), llm).index_note(
        note_id=11,
        user_id=9,
        profile=profile,
        attempt_id="attempt-a",
    )

    assert outcome is not None
    assert outcome.status == "STALE"
    assert "newer indexing attempt" in outcome.error
    assert llm.calls == []
    assert conn.execute_calls == []


@pytest.mark.asyncio
async def test_successful_embedding_cannot_commit_after_attempt_is_replaced() -> None:
    profile = _profile()

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "FROM notes" not in sql:
            raise AssertionError(f"unexpected fetchrow SQL: {sql}")
        return {
            "id": 11,
            "title": "Same revision",
            "summary": None,
            "content_markdown": "Grounded material",
            "author_id": 9,
            "embedding_attempt_id": "attempt-b" if "FOR UPDATE" in sql else "attempt-a",
        }

    conn = FakeConn(fetchrow=fetchrow)
    outcome = await NoteIndexerService(FakePool(conn), FakeEmbedLLM()).index_note(
        note_id=11,
        user_id=9,
        profile=profile,
        attempt_id="attempt-a",
    )

    assert outcome is not None
    assert outcome.status == "STALE"
    assert conn.executemany_calls == []
    assert not any("DELETE FROM note_embeddings" in sql for sql, _ in conn.execute_calls)
    assert not any("embedding_status = 'INDEXED'" in sql for sql, _ in conn.execute_calls)


@pytest.mark.asyncio
async def test_failed_attempt_cannot_overwrite_new_attempt_for_same_revision() -> None:
    profile = _profile()
    locked = False

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        nonlocal locked
        if "FROM notes" not in sql:
            raise AssertionError(f"unexpected fetchrow SQL: {sql}")
        if "FOR UPDATE" in sql:
            locked = True
        return {
            "id": 11,
            "title": "Same revision",
            "summary": None,
            "content_markdown": "Grounded material",
            "author_id": 9,
            "embedding_attempt_id": "attempt-b" if locked else "attempt-a",
        }

    conn = FakeConn(fetchrow=fetchrow)
    outcome = await NoteIndexerService(FakePool(conn), FailingEmbedLLM()).index_note(
        note_id=11,
        user_id=9,
        profile=profile,
        attempt_id="attempt-a",
    )

    assert outcome is not None
    assert outcome.status == "FAILED"
    assert not any("embedding_status = 'FAILED'" in sql for sql, _ in conn.execute_calls)


@pytest.mark.asyncio
async def test_matching_attempt_failure_clears_attempt_token() -> None:
    profile = _profile()

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "FROM notes" in sql:
            return {
                "id": 11,
                "title": "Same revision",
                "summary": None,
                "content_markdown": "Grounded material",
                "author_id": 9,
                "embedding_attempt_id": "attempt-a",
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    outcome = await NoteIndexerService(FakePool(conn), FailingEmbedLLM()).index_note(
        note_id=11,
        user_id=9,
        profile=profile,
        attempt_id="attempt-a",
    )

    assert outcome is not None
    assert outcome.status == "FAILED"
    failed_updates = [
        (sql, args)
        for sql, args in conn.execute_calls
        if "embedding_status = 'FAILED'" in sql
    ]
    assert len(failed_updates) == 1
    assert "embedding_attempt_id = NULL" in failed_updates[0][0]


@pytest.mark.asyncio
async def test_note_indexer_discards_stale_job_before_replacing_newer_chunks() -> None:
    """A slow job for old content must never overwrite a newer note revision."""

    profile = _profile()
    unlocked_reads = 0

    def fetchrow(sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        nonlocal unlocked_reads
        if "FROM notes" not in sql:
            raise AssertionError(f"unexpected fetchrow SQL: {sql}")
        if "FOR UPDATE" in sql:
            assert args == (11,)
            return {
                "id": 11,
                "title": "New revision",
                "summary": None,
                "content_markdown": "The user saved this after the job started.",
                "author_id": 9,
            }
        unlocked_reads += 1
        assert args == (11, 9)
        return {
            "id": 11,
            "title": "Old revision",
            "summary": None,
            "content_markdown": "This is the stale payload.",
            "author_id": 9,
        }

    conn = FakeConn(fetchrow=fetchrow)
    llm = FakeEmbedLLM([0.4, 0.5, 0.6])

    outcome = await NoteIndexerService(FakePool(conn), llm).index_note(
        note_id=11,
        user_id=9,
        profile=profile,
    )

    assert outcome is not None
    assert outcome.status == "STALE"
    assert outcome.chunk_count == 0
    assert unlocked_reads == 1
    assert conn.executemany_calls == []
    assert not any("DELETE FROM note_embeddings" in sql for sql, _ in conn.execute_calls)
    assert not any("embedding_status" in sql for sql, _ in conn.execute_calls)


@pytest.mark.asyncio
async def test_stale_failed_job_cannot_mark_newer_revision_failed() -> None:
    profile = _profile()

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "FOR UPDATE" in sql:
            return {
                "id": 11,
                "title": "New revision",
                "summary": None,
                "content_markdown": "New content",
                "author_id": 9,
            }
        if "FROM notes" in sql:
            return {
                "id": 11,
                "title": "Old revision",
                "summary": None,
                "content_markdown": "Old content",
                "author_id": 9,
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    outcome = await NoteIndexerService(FakePool(conn), FailingEmbedLLM()).index_note(
        note_id=11,
        user_id=9,
        profile=profile,
    )

    assert outcome is not None
    assert outcome.status == "FAILED"
    assert not any("embedding_status = 'FAILED'" in sql for sql, _ in conn.execute_calls)


@pytest.mark.asyncio
async def test_note_readiness_requires_current_fingerprint_active_profile_and_real_chunks() -> None:
    profile = _profile()
    note_text = "Title: Ready note\n\nContent:\nGrounded material"
    fingerprint = _note_fingerprint(note_text)

    def fetchrow(sql: str, args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "FROM notes" in sql and "note_embeddings" not in sql:
            assert args == (11, 9)
            return {
                "id": 11,
                "title": "Ready note",
                "summary": None,
                "content_markdown": "Grounded material",
                "author_id": 9,
                "embedding_status": "INDEXED",
                "embedding_fingerprint": fingerprint,
                "embedding_profile_id": 42,
                "embedding_indexed_at": None,
                "embedding_error": None,
            }
        if "COUNT(*)" in sql and "note_embeddings" in sql:
            assert args == (11, 42, 9)
            return {"chunk_count": 2, "carrier_id": 77}
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    outcome = await NoteIndexerService(FakePool(FakeConn(fetchrow=fetchrow)), FakeEmbedLLM()).get_readiness(
        note_id=11,
        user_id=9,
        profile=profile,
    )

    assert outcome is not None
    assert outcome.status == "ready"
    assert outcome.queryable is True
    assert outcome.profile_id == 42
    assert outcome.profile_name == "Active search"
    assert outcome.chunk_count == 2
    assert outcome.carrier_id == 77
    assert outcome.source_fingerprint == fingerprint
    assert outcome.indexed_fingerprint == fingerprint


@pytest.mark.asyncio
async def test_note_readiness_marks_changed_content_needs_update_even_when_old_chunks_exist() -> None:
    profile = _profile()

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "FROM notes" in sql and "note_embeddings" not in sql:
            return {
                "id": 11,
                "title": "Changed note",
                "summary": None,
                "content_markdown": "New content",
                "author_id": 9,
                "embedding_status": "INDEXED",
                "embedding_fingerprint": "old-fingerprint",
                "embedding_profile_id": 42,
                "embedding_indexed_at": None,
                "embedding_error": None,
            }
        if "COUNT(*)" in sql and "note_embeddings" in sql:
            return {"chunk_count": 3, "carrier_id": 77}
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    outcome = await NoteIndexerService(FakePool(FakeConn(fetchrow=fetchrow)), FakeEmbedLLM()).get_readiness(
        note_id=11,
        user_id=9,
        profile=profile,
    )

    assert outcome is not None
    assert outcome.status == "needs_update"
    assert outcome.queryable is False
    assert outcome.chunk_count == 3
    assert outcome.message == "笔记内容已变化，需要更新知识来源后才能用于提问。"


@pytest.mark.asyncio
async def test_note_readiness_never_treats_chunks_without_atlas_carrier_as_queryable() -> None:
    profile = _profile()
    text = "Title: Indexed only\n\nContent:\nGrounded material"
    fingerprint = _note_fingerprint(text)

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "FROM notes" in sql and "note_embeddings" not in sql:
            return {
                "id": 11,
                "title": "Indexed only",
                "summary": None,
                "content_markdown": "Grounded material",
                "author_id": 9,
                "embedding_status": "INDEXED",
                "embedding_fingerprint": fingerprint,
                "embedding_profile_id": 42,
                "embedding_indexed_at": None,
                "embedding_error": None,
            }
        if "COUNT(*)" in sql and "note_embeddings" in sql:
            return {"chunk_count": 2, "carrier_id": None}
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    outcome = await NoteIndexerService(FakePool(FakeConn(fetchrow=fetchrow)), FakeEmbedLLM()).get_readiness(
        note_id=11,
        user_id=9,
        profile=profile,
    )

    assert outcome is not None
    assert outcome.status == "not_ready"
    assert outcome.queryable is False
    assert outcome.chunk_count == 2
    assert outcome.carrier_id is None
    assert outcome.message == "内容已索引，但尚未注册为可提问来源。"


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
    assert any("FOR UPDATE" in sql for sql, _ in conn.fetchrow_calls)
    assert any("DELETE FROM note_embeddings" in sql for sql, _ in conn.execute_calls)
    assert any("embedding_status = 'SKIPPED'" in sql for sql, _ in conn.execute_calls)


@pytest.mark.asyncio
async def test_blank_note_cannot_commit_after_attempt_is_replaced() -> None:
    profile = _profile()

    def fetchrow(sql: str, _args: tuple[Any, ...]) -> dict[str, Any] | None:
        if "FROM notes" in sql:
            return {
                "id": 12,
                "title": "",
                "summary": None,
                "content_markdown": "",
                "author_id": 9,
                "embedding_attempt_id": "attempt-b" if "FOR UPDATE" in sql else "attempt-a",
            }
        raise AssertionError(f"unexpected fetchrow SQL: {sql}")

    conn = FakeConn(fetchrow=fetchrow)
    outcome = await NoteIndexerService(FakePool(conn), FakeEmbedLLM()).index_note(
        note_id=12,
        user_id=9,
        profile=profile,
        attempt_id="attempt-a",
    )

    assert outcome is not None
    assert outcome.status == "STALE"
    assert conn.executemany_calls == []
    assert not any("DELETE FROM note_embeddings" in sql for sql, _ in conn.execute_calls)
    assert not any("embedding_status = 'SKIPPED'" in sql for sql, _ in conn.execute_calls)
