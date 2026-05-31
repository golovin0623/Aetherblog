"""Internal Intelligent Notes embedding endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_llm_router, get_pg_pool, require_admin_or_internal
from app.services.note_indexer import NoteIndexerService

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


__all__ = ["router", "IndexNoteRequest", "IndexNoteResponse"]
