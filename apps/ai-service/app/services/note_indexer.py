"""Intelligent Notes embedding worker.

The notes table has carried ``embedding_status`` and ``note_embeddings`` since
migration 000054. This worker closes that loop by reusing the active search
profile, the shared chunker, and the same strict embedding-model routing used
by posts, KB files, and Atlas Knowledge Points.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from app.services.chunker import Chunk, split as chunk_split
from app.services.llm_router import LlmRouter
from app.services.vector_store import SearchProfile, VectorStoreService

logger = logging.getLogger("ai-service")


@dataclass
class NoteIndexOutcome:
    note_id: int
    profile_id: int
    model_id: str
    embedding_dim: int
    chunk_count: int
    doc_chars: int
    doc_tokens: int
    status: str
    error: str = ""


def _row_to_dict(row: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return row
    return dict(row)


def _build_note_embedding_text(row: dict[str, Any]) -> str:
    title = str(row.get("title") or "").strip()
    summary = str(row.get("summary") or "").strip()
    content = str(row.get("content_markdown") or "").strip()

    parts: list[str] = []
    if title:
        parts.append(f"Title: {title}")
    if summary:
        parts.append(f"Summary:\n{summary}")
    if content:
        parts.append(f"Content:\n{content}")
    return "\n\n".join(parts).strip()


class NoteIndexerService:
    def __init__(self, pool, llm: LlmRouter, chunk_concurrency: int = 5) -> None:
        self.pool = pool
        self.llm = llm
        self._chunk_concurrency = chunk_concurrency

    async def index_note(
        self,
        *,
        note_id: int,
        user_id: int | None = None,
        profile: SearchProfile | None = None,
    ) -> NoteIndexOutcome | None:
        if note_id <= 0:
            raise ValueError("note_id must be positive")

        profile = profile or await VectorStoreService(self.pool, self.llm).get_active_profile()
        row = await self._fetch_note(note_id, user_id)
        if not row:
            return None

        text = _build_note_embedding_text(_row_to_dict(row))
        doc_chars = len(text)
        if doc_chars == 0:
            return await self._write_empty(note_id, profile)

        chunks: list[Chunk] = chunk_split(
            text,
            chunker_kind=profile.chunker_kind,
            chunk_size_tokens=profile.chunk_size_tokens,
            chunk_overlap_tokens=profile.chunk_overlap_tokens,
        )
        if not chunks:
            return await self._write_empty(note_id, profile)

        embed_start = time.perf_counter()
        semaphore = asyncio.Semaphore(self._chunk_concurrency)

        async def embed_chunk(chunk: Chunk) -> tuple[Chunk, list[float]]:
            async with semaphore:
                vec = await self.llm.embed(
                    chunk.text,
                    user_id=user_id,
                    embedding_model_id=profile.model_id,
                    strict_embedding_model_id=True,
                )
                return chunk, vec

        try:
            embed_results = await asyncio.gather(*(embed_chunk(chunk) for chunk in chunks))
        except Exception as exc:
            await self._mark_note_status(note_id, "FAILED")
            return NoteIndexOutcome(
                note_id=note_id,
                profile_id=profile.id,
                model_id=profile.model_id,
                embedding_dim=0,
                chunk_count=0,
                doc_chars=doc_chars,
                doc_tokens=0,
                status="FAILED",
                error=f"embedding failed: {type(exc).__name__}: {str(exc)[:300]}",
            )

        embedding_dim = len(embed_results[0][1]) if embed_results else 0
        if embedding_dim <= 0:
            await self._mark_note_status(note_id, "FAILED")
            return NoteIndexOutcome(
                note_id,
                profile.id,
                profile.model_id,
                0,
                0,
                doc_chars,
                0,
                "FAILED",
                "embedding returned an empty vector",
            )
        for chunk, vec in embed_results:
            if len(vec) != embedding_dim:
                await self._mark_note_status(note_id, "FAILED")
                return NoteIndexOutcome(
                    note_id,
                    profile.id,
                    profile.model_id,
                    embedding_dim,
                    0,
                    doc_chars,
                    0,
                    "FAILED",
                    f"chunk #{chunk.index} dim={len(vec)} differs from first dim={embedding_dim}",
                )

        doc_tokens = sum(chunk.tokens for chunk, _ in embed_results)
        db_start = time.perf_counter()
        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    locked_note_id = await conn.fetchval(
                        "SELECT id FROM notes WHERE id = $1 AND deleted = FALSE FOR UPDATE",
                        note_id,
                    )
                    if locked_note_id is None:
                        raise RuntimeError("note disappeared before embedding write")
                    await conn.execute(
                        "DELETE FROM note_embeddings WHERE note_id = $1 AND profile_id = $2",
                        note_id,
                        profile.id,
                    )
                    rows_to_insert = [
                        (
                            note_id,
                            profile.id,
                            chunk.index,
                            chunk.text,
                            chunk.parent_text,
                            vec,
                            embedding_dim,
                            profile.model_id,
                            "INDEXED",
                            chunk.tokens,
                        )
                        for chunk, vec in embed_results
                    ]
                    await conn.executemany(
                        """
                        INSERT INTO note_embeddings
                            (note_id, profile_id, chunk_index, chunk_text, parent_text,
                             embedding, embedding_dim, model_id, status, token_count)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                        """,
                        rows_to_insert,
                    )
                    await conn.execute(
                        "UPDATE notes SET embedding_status = 'INDEXED' WHERE id = $1 AND deleted = FALSE",
                        note_id,
                    )
        except Exception as exc:
            await self._mark_note_status(note_id, "FAILED")
            return NoteIndexOutcome(
                note_id,
                profile.id,
                profile.model_id,
                embedding_dim,
                0,
                doc_chars,
                doc_tokens,
                "FAILED",
                f"write failed: {type(exc).__name__}: {str(exc)[:300]}",
            )

        logger.info(
            "note_indexer.ok",
            extra={
                "data": {
                    "note_id": note_id,
                    "profile_id": profile.id,
                    "chunks": len(embed_results),
                    "dim": embedding_dim,
                    "embed_ms": round((time.perf_counter() - embed_start) * 1000, 2),
                    "db_ms": round((time.perf_counter() - db_start) * 1000, 2),
                }
            },
        )
        return NoteIndexOutcome(
            note_id=note_id,
            profile_id=profile.id,
            model_id=profile.model_id,
            embedding_dim=embedding_dim,
            chunk_count=len(embed_results),
            doc_chars=doc_chars,
            doc_tokens=doc_tokens,
            status="INDEXED",
        )

    async def _fetch_note(self, note_id: int, user_id: int | None) -> Any | None:
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(
                """
                SELECT id, title, summary, content_markdown, author_id
                FROM notes
                WHERE id = $1
                  AND deleted = FALSE
                  AND ($2::bigint IS NULL OR author_id = $2 OR author_id IS NULL)
                """,
                note_id,
                user_id,
            )

    async def _write_empty(self, note_id: int, profile: SearchProfile) -> NoteIndexOutcome:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                locked_note_id = await conn.fetchval(
                    "SELECT id FROM notes WHERE id = $1 AND deleted = FALSE FOR UPDATE",
                    note_id,
                )
                if locked_note_id is None:
                    return NoteIndexOutcome(
                        note_id=note_id,
                        profile_id=profile.id,
                        model_id=profile.model_id,
                        embedding_dim=0,
                        chunk_count=0,
                        doc_chars=0,
                        doc_tokens=0,
                        status="FAILED",
                        error="note disappeared before empty write",
                    )
                await conn.execute(
                    "DELETE FROM note_embeddings WHERE note_id = $1 AND profile_id = $2",
                    note_id,
                    profile.id,
                )
                await conn.execute(
                    "UPDATE notes SET embedding_status = 'SKIPPED' WHERE id = $1 AND deleted = FALSE",
                    note_id,
                )
        return NoteIndexOutcome(
            note_id=note_id,
            profile_id=profile.id,
            model_id=profile.model_id,
            embedding_dim=0,
            chunk_count=0,
            doc_chars=0,
            doc_tokens=0,
            status="SKIPPED",
        )

    async def _mark_note_status(self, note_id: int, status: str) -> None:
        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    "UPDATE notes SET embedding_status = $1 WHERE id = $2 AND deleted = FALSE",
                    status,
                    note_id,
                )
        except Exception as exc:
            logger.warning(
                "note_indexer.mark_status_failed",
                extra={"data": {"note_id": note_id, "status": status, "error": str(exc)[:200]}},
            )
