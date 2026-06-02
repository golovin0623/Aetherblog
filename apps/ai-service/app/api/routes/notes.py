"""Internal Intelligent Notes embedding endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_llm_router, get_pg_pool, require_admin_or_internal
from app.services.note_indexer import NoteIndexerService
from app.services.vector_store import SearchProfile, VectorStoreService

router = APIRouter(
    tags=["notes"],
    prefix="/v1/notes",
    dependencies=[Depends(require_admin_or_internal)],
)


class IndexNoteRequest(BaseModel):
    user_id: int | None = Field(default=None, ge=1)


class IndexNoteResponse(BaseModel):
    note_id: int
    profile_id: int
    model_id: str
    embedding_dim: int
    chunk_count: int
    doc_chars: int
    doc_tokens: int
    status: str
    error: str = ""


class ReindexNotesRequest(BaseModel):
    user_id: int | None = Field(default=None, ge=1)
    limit: int = Field(default=100, ge=1, le=500)
    stale_only: bool = True


class ReindexNoteError(BaseModel):
    id: int
    error: str


class ReindexNotesResponse(BaseModel):
    profile_id: int
    model_id: str
    selected_count: int
    succeeded: int
    failed: int
    not_found: int
    errors: list[ReindexNoteError] = Field(default_factory=list)


@router.post("/index-batch")
async def reindex_notes(
    req: ReindexNotesRequest,
    llm=Depends(get_llm_router),
    pool=Depends(get_pg_pool),
) -> ReindexNotesResponse:
    """Backfill historical note embeddings for the active search profile."""
    profile = await VectorStoreService(pool, llm).get_active_profile()
    note_ids = await _fetch_note_reindex_ids(
        pool,
        profile=profile,
        user_id=req.user_id,
        limit=req.limit,
        stale_only=req.stale_only,
    )

    service = NoteIndexerService(pool, llm)
    succeeded = 0
    failed = 0
    not_found = 0
    errors: list[ReindexNoteError] = []
    for note_id in note_ids:
        try:
            outcome = await service.index_note(
                note_id=note_id,
                user_id=req.user_id,
                profile=profile,
            )
            if outcome is None:
                not_found += 1
            elif outcome.status == "FAILED":
                failed += 1
                errors.append(ReindexNoteError(id=note_id, error=outcome.error or "index failed"))
            else:
                succeeded += 1
        except Exception as exc:
            failed += 1
            errors.append(ReindexNoteError(id=note_id, error=f"{type(exc).__name__}: {str(exc)[:300]}"))

    return ReindexNotesResponse(
        profile_id=profile.id,
        model_id=profile.model_id,
        selected_count=len(note_ids),
        succeeded=succeeded,
        failed=failed,
        not_found=not_found,
        errors=errors,
    )


async def _fetch_note_reindex_ids(
    pool,
    *,
    profile: SearchProfile,
    user_id: int | None,
    limit: int,
    stale_only: bool,
) -> list[int]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT n.id
            FROM notes n
            WHERE n.deleted = FALSE
              AND ($1::bigint IS NULL OR n.author_id = $1 OR n.author_id IS NULL)
              AND (
                $4::boolean = FALSE
                OR n.embedding_status IN ('PENDING', 'FAILED')
                OR (
                  n.embedding_status IS DISTINCT FROM 'SKIPPED'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM note_embeddings ne
                    WHERE ne.note_id = n.id
                      AND ne.profile_id = $2
                      AND ne.status = 'INDEXED'
                      AND ne.model_id = $3
                  )
                )
              )
            ORDER BY n.updated_at DESC, n.id DESC
            LIMIT $5
            """,
            user_id,
            profile.id,
            profile.model_id,
            stale_only,
            limit,
        )
    return [int(row["id"]) for row in rows]


@router.post("/{note_id}/index")
async def index_note(
    note_id: int,
    req: IndexNoteRequest,
    llm=Depends(get_llm_router),
    pool=Depends(get_pg_pool),
) -> IndexNoteResponse:
    if note_id <= 0:
        raise HTTPException(status_code=400, detail="note_id 必须为正整数")
    outcome = await NoteIndexerService(pool, llm).index_note(
        note_id=note_id,
        user_id=req.user_id,
    )
    if outcome is None:
        raise HTTPException(status_code=404, detail="笔记不存在或无权索引")
    return IndexNoteResponse(
        note_id=outcome.note_id,
        profile_id=outcome.profile_id,
        model_id=outcome.model_id,
        embedding_dim=outcome.embedding_dim,
        chunk_count=outcome.chunk_count,
        doc_chars=outcome.doc_chars,
        doc_tokens=outcome.doc_tokens,
        status=outcome.status,
        error=outcome.error,
    )


__all__ = [
    "router",
    "IndexNoteRequest",
    "IndexNoteResponse",
    "ReindexNotesRequest",
    "ReindexNotesResponse",
]
