from __future__ import annotations

from typing import Any

import pytest

from app.api.routes import notes
from app.services.note_indexer import NoteIndexOutcome, NoteReadinessOutcome
from app.services.vector_store import SearchProfile
from tests.support import FakeConn, FakePool


@pytest.mark.asyncio
async def test_index_note_route_forwards_attempt_token(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeNoteIndexerService:
        def __init__(self, pool: Any, llm: Any) -> None:
            pass

        async def index_note(self, **kwargs: Any) -> NoteIndexOutcome:
            assert kwargs == {"note_id": 11, "user_id": 9, "attempt_id": "attempt-a"}
            return NoteIndexOutcome(
                note_id=11,
                profile_id=42,
                model_id="text-embedding-3-small",
                embedding_dim=1536,
                chunk_count=2,
                doc_chars=120,
                doc_tokens=36,
                status="INDEXED",
            )

    monkeypatch.setattr(notes, "NoteIndexerService", FakeNoteIndexerService)

    result = await notes.index_note(
        note_id=11,
        req=notes.IndexNoteRequest(user_id=9, attempt_id="attempt-a"),
        llm=object(),
        pool=object(),
    )

    assert result.status == "INDEXED"


@pytest.mark.asyncio
async def test_index_note_route_claims_attempt_for_legacy_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeNoteIndexerService:
        def __init__(self, pool: Any, llm: Any) -> None:
            pass

        async def begin_attempt(self, **kwargs: Any) -> str:
            assert kwargs == {"note_id": 11, "user_id": 9}
            return "attempt-a"

        async def index_note(self, **kwargs: Any) -> NoteIndexOutcome:
            assert kwargs == {"note_id": 11, "user_id": 9, "attempt_id": "attempt-a"}
            return NoteIndexOutcome(
                note_id=11,
                profile_id=42,
                model_id="text-embedding-3-small",
                embedding_dim=1536,
                chunk_count=2,
                doc_chars=120,
                doc_tokens=36,
                status="INDEXED",
            )

    monkeypatch.setattr(notes, "NoteIndexerService", FakeNoteIndexerService)

    result = await notes.index_note(
        note_id=11,
        req=notes.IndexNoteRequest(user_id=9),
        llm=object(),
        pool=object(),
    )

    assert result.status == "INDEXED"


@pytest.mark.asyncio
async def test_index_note_route_closes_claimed_attempt_on_unhandled_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed_attempts: list[dict[str, Any]] = []

    class FakeNoteIndexerService:
        def __init__(self, pool: Any, llm: Any) -> None:
            pass

        async def begin_attempt(self, **_kwargs: Any) -> str:
            return "attempt-a"

        async def index_note(self, **_kwargs: Any) -> NoteIndexOutcome:
            raise RuntimeError("database unavailable")

        async def fail_attempt(self, **kwargs: Any) -> None:
            failed_attempts.append(kwargs)

    monkeypatch.setattr(notes, "NoteIndexerService", FakeNoteIndexerService)

    with pytest.raises(RuntimeError, match="database unavailable"):
        await notes.index_note(
            note_id=11,
            req=notes.IndexNoteRequest(user_id=9),
            llm=object(),
            pool=object(),
        )

    assert failed_attempts == [
        {
            "note_id": 11,
            "attempt_id": "attempt-a",
            "error": "note indexing request failed",
        }
    ]


@pytest.mark.asyncio
async def test_index_note_route_repairs_failed_result_not_persisted_by_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed_attempts: list[dict[str, Any]] = []

    class FakeNoteIndexerService:
        def __init__(self, pool: Any, llm: Any) -> None:
            pass

        async def begin_attempt(self, **_kwargs: Any) -> str:
            return "attempt-a"

        async def index_note(self, **_kwargs: Any) -> NoteIndexOutcome:
            return NoteIndexOutcome(
                note_id=11,
                profile_id=42,
                model_id="text-embedding-3-small",
                embedding_dim=0,
                chunk_count=0,
                doc_chars=120,
                doc_tokens=0,
                status="FAILED",
                error="embedding failed",
            )

        async def fail_attempt(self, **kwargs: Any) -> None:
            failed_attempts.append(kwargs)

    monkeypatch.setattr(notes, "NoteIndexerService", FakeNoteIndexerService)

    result = await notes.index_note(
        note_id=11,
        req=notes.IndexNoteRequest(user_id=9),
        llm=object(),
        pool=object(),
    )

    assert result.status == "FAILED"
    assert failed_attempts == [
        {
            "note_id": 11,
            "attempt_id": "attempt-a",
            "error": "note indexing failed",
        }
    ]


@pytest.mark.asyncio
async def test_reindex_notes_indexes_missing_active_profile_chunks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = SearchProfile(
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

    class FakeVectorStoreService:
        def __init__(self, pool: Any, llm: Any) -> None:
            self.pool = pool
            self.llm = llm

        async def get_active_profile(self) -> SearchProfile:
            return profile

    class FakeNoteIndexerService:
        calls: list[dict[str, Any]] = []

        def __init__(self, pool: Any, llm: Any) -> None:
            self.pool = pool
            self.llm = llm

        async def begin_attempt(self, **kwargs: Any) -> str:
            return f"attempt-{kwargs['note_id']}"

        async def index_note(self, **kwargs: Any) -> NoteIndexOutcome | None:
            self.calls.append({"pool": self.pool, "llm": self.llm, **kwargs})
            if kwargs["note_id"] == 12:
                return None
            return NoteIndexOutcome(
                note_id=kwargs["note_id"],
                profile_id=profile.id,
                model_id=profile.model_id,
                embedding_dim=1536,
                chunk_count=1,
                doc_chars=80,
                doc_tokens=20,
                status="INDEXED",
            )

    def fetch(sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
        assert "FROM notes n" in sql
        assert "NOT EXISTS" in sql
        assert "embedding_status IS DISTINCT FROM 'SKIPPED'" in sql
        assert args == (9, 42, "text-embedding-3-small", True, 3)
        return [{"id": 11}, {"id": 12}]

    monkeypatch.setattr(notes, "VectorStoreService", FakeVectorStoreService)
    monkeypatch.setattr(notes, "NoteIndexerService", FakeNoteIndexerService)
    pool = FakePool(FakeConn(fetch=fetch))
    llm = object()

    result = await notes.reindex_notes(
        notes.ReindexNotesRequest(user_id=9, limit=3, stale_only=True),
        llm=llm,
        pool=pool,
    )

    assert result.profile_id == 42
    assert result.model_id == "text-embedding-3-small"
    assert result.selected_count == 2
    assert result.succeeded == 1
    assert result.not_found == 1
    assert result.failed == 0
    assert [call["note_id"] for call in FakeNoteIndexerService.calls] == [11, 12]
    assert FakeNoteIndexerService.calls[0]["profile"] == profile
    assert FakeNoteIndexerService.calls[0]["attempt_id"] == "attempt-11"


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome_status", ["STALE", "FAILED"])
async def test_reindex_notes_counts_superseded_attempt_as_failed(
    monkeypatch: pytest.MonkeyPatch,
    outcome_status: str,
) -> None:
    profile = SearchProfile(
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

    class FakeVectorStoreService:
        def __init__(self, pool: Any, llm: Any) -> None:
            pass

        async def get_active_profile(self) -> SearchProfile:
            return profile

    failed_attempts: list[dict[str, Any]] = []

    class FakeNoteIndexerService:
        def __init__(self, pool: Any, llm: Any) -> None:
            pass

        async def begin_attempt(self, **_kwargs: Any) -> str:
            return "attempt-a"

        async def index_note(self, **_kwargs: Any) -> NoteIndexOutcome:
            return NoteIndexOutcome(
                note_id=11,
                profile_id=42,
                model_id=profile.model_id,
                embedding_dim=0,
                chunk_count=0,
                doc_chars=120,
                doc_tokens=0,
                status=outcome_status,
                error=(
                    "newer indexing attempt superseded this request"
                    if outcome_status == "STALE"
                    else "embedding failed"
                ),
            )

        async def fail_attempt(self, **kwargs: Any) -> None:
            failed_attempts.append(kwargs)

    monkeypatch.setattr(notes, "VectorStoreService", FakeVectorStoreService)
    monkeypatch.setattr(notes, "NoteIndexerService", FakeNoteIndexerService)
    pool = FakePool(FakeConn(fetch=lambda _sql, _args: [{"id": 11}]))

    result = await notes.reindex_notes(
        notes.ReindexNotesRequest(user_id=9, limit=1, stale_only=True),
        llm=object(),
        pool=pool,
    )

    assert result.succeeded == 0
    assert result.failed == 1
    assert result.errors[0].id == 11
    if outcome_status == "STALE":
        assert "superseded" in result.errors[0].error
        assert failed_attempts == []
    else:
        assert "embedding failed" in result.errors[0].error
        assert failed_attempts == [
            {
                "note_id": 11,
                "attempt_id": "attempt-a",
                "error": "note batch indexing failed",
            }
        ]


@pytest.mark.asyncio
async def test_note_readiness_route_returns_product_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeNoteIndexerService:
        def __init__(self, pool: Any, llm: Any) -> None:
            self.pool = pool
            self.llm = llm

        async def get_readiness(self, **kwargs: Any) -> NoteReadinessOutcome | None:
            assert kwargs == {"note_id": 11, "user_id": 9}
            return NoteReadinessOutcome(
                note_id=11,
                status="ready",
                queryable=True,
                profile_id=42,
                profile_name="Active search",
                model_id="text-embedding-3-small",
                chunk_count=2,
                carrier_id=77,
                source_fingerprint="current",
                indexed_fingerprint="current",
                indexed_at=None,
                message="已准备 2 个可检索分块，可用于提问。",
            )

    monkeypatch.setattr(notes, "NoteIndexerService", FakeNoteIndexerService)

    result = await notes.note_readiness(
        note_id=11,
        user_id=9,
        llm=object(),
        pool=object(),
    )

    assert result.note_id == 11
    assert result.status == "ready"
    assert result.queryable is True
    assert result.profile_id == 42
    assert result.chunk_count == 2
    assert result.carrier_id == 77


@pytest.mark.asyncio
async def test_note_readiness_route_hides_note_existence_when_scope_does_not_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeNoteIndexerService:
        def __init__(self, pool: Any, llm: Any) -> None:
            pass

        async def get_readiness(self, **_kwargs: Any) -> None:
            return None

    monkeypatch.setattr(notes, "NoteIndexerService", FakeNoteIndexerService)

    with pytest.raises(notes.HTTPException) as exc:
        await notes.note_readiness(
            note_id=11,
            user_id=9,
            llm=object(),
            pool=object(),
        )

    assert exc.value.status_code == 404
