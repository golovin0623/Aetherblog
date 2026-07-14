from __future__ import annotations

from typing import Any

import pytest

from app.api.routes import notes
from app.services.note_indexer import NoteIndexOutcome, NoteReadinessOutcome
from app.services.vector_store import SearchProfile
from tests.support import FakeConn, FakePool


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
