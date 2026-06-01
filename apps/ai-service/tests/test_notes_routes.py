from __future__ import annotations

from typing import Any

import pytest

from app.api.routes import notes
from app.services.note_indexer import NoteIndexOutcome
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
