"""Intelligent Notes embedding worker.

The notes table has carried ``embedding_status`` and ``note_embeddings`` since
migration 000054. This worker closes that loop by reusing the active search
profile, the shared chunker, and the same strict embedding-model routing used
by posts, KB files, and Atlas Knowledge Points.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import time
from dataclasses import dataclass
from datetime import datetime
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


@dataclass
class NoteReadinessOutcome:
    note_id: int
    status: str
    queryable: bool
    profile_id: int | None
    profile_name: str | None
    model_id: str | None
    chunk_count: int
    carrier_id: int | None
    source_fingerprint: str
    indexed_fingerprint: str | None
    indexed_at: datetime | None
    message: str


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


def _note_fingerprint(text: str) -> str:
    """Return the stable identity used by both indexing and readiness."""

    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


class NoteIndexerService:
    def __init__(self, pool, llm: LlmRouter, chunk_concurrency: int = 5) -> None:
        self.pool = pool
        self.llm = llm
        self._chunk_concurrency = chunk_concurrency

    async def begin_attempt(self, *, note_id: int, user_id: int | None = None) -> str | None:
        """Atomically claim a fresh token for callers that do not bring one."""

        if note_id <= 0:
            raise ValueError("note_id must be positive")
        attempt_id = secrets.token_hex(16)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE notes
                SET embedding_status = 'PENDING',
                    embedding_error = NULL,
                    embedding_attempt_id = $1
                WHERE id = $2
                  AND deleted = FALSE
                  AND ($3::bigint IS NULL OR author_id = $3 OR author_id IS NULL)
                RETURNING id
                """,
                attempt_id,
                note_id,
                user_id,
            )
        return attempt_id if row is not None else None

    async def fail_attempt(self, *, note_id: int, attempt_id: str, error: str) -> None:
        """Close an unhandled request only if its token is still current."""

        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE notes
                    SET embedding_status = 'FAILED',
                        embedding_error = $1,
                        embedding_attempt_id = NULL
                    WHERE id = $2
                      AND deleted = FALSE
                      AND embedding_status = 'PENDING'
                      AND embedding_attempt_id = $3
                    """,
                    error[:1000],
                    note_id,
                    attempt_id,
                )
        except Exception as exc:
            logger.warning(
                "note_indexer.fail_attempt",
                extra={"data": {"note_id": note_id, "error": str(exc)[:200]}},
            )

    async def index_note(
        self,
        *,
        note_id: int,
        user_id: int | None = None,
        profile: SearchProfile | None = None,
        attempt_id: str | None = None,
    ) -> NoteIndexOutcome | None:
        if note_id <= 0:
            raise ValueError("note_id must be positive")

        profile = profile or await VectorStoreService(self.pool, self.llm).get_active_profile()
        row = await self._fetch_note(note_id, user_id)
        if not row:
            return None

        note = _row_to_dict(row)
        text = _build_note_embedding_text(note)
        source_fingerprint = _note_fingerprint(text)
        doc_chars = len(text)
        if note.get("embedding_attempt_id") != attempt_id:
            return NoteIndexOutcome(
                note_id=note_id,
                profile_id=profile.id,
                model_id=profile.model_id,
                embedding_dim=0,
                chunk_count=0,
                doc_chars=doc_chars,
                doc_tokens=0,
                status="STALE",
                error="newer indexing attempt superseded this request",
            )
        if doc_chars == 0:
            return await self._write_empty(note_id, profile, source_fingerprint, attempt_id)

        chunks: list[Chunk] = chunk_split(
            text,
            chunker_kind=profile.chunker_kind,
            chunk_size_tokens=profile.chunk_size_tokens,
            chunk_overlap_tokens=profile.chunk_overlap_tokens,
        )
        if not chunks:
            return await self._write_empty(note_id, profile, source_fingerprint, attempt_id)

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
            error = f"embedding failed: {type(exc).__name__}: {str(exc)[:300]}"
            await self._mark_failed_if_current(note_id, source_fingerprint, attempt_id, error)
            return NoteIndexOutcome(
                note_id=note_id,
                profile_id=profile.id,
                model_id=profile.model_id,
                embedding_dim=0,
                chunk_count=0,
                doc_chars=doc_chars,
                doc_tokens=0,
                status="FAILED",
                error=error,
            )

        embedding_dim = len(embed_results[0][1]) if embed_results else 0
        if embedding_dim <= 0:
            error = "embedding returned an empty vector"
            await self._mark_failed_if_current(note_id, source_fingerprint, attempt_id, error)
            return NoteIndexOutcome(
                note_id,
                profile.id,
                profile.model_id,
                0,
                0,
                doc_chars,
                0,
                "FAILED",
                error,
            )
        for chunk, vec in embed_results:
            if len(vec) != embedding_dim:
                error = f"chunk #{chunk.index} dim={len(vec)} differs from first dim={embedding_dim}"
                await self._mark_failed_if_current(note_id, source_fingerprint, attempt_id, error)
                return NoteIndexOutcome(
                    note_id,
                    profile.id,
                    profile.model_id,
                    embedding_dim,
                    0,
                    doc_chars,
                    0,
                    "FAILED",
                    error,
                )

        doc_tokens = sum(chunk.tokens for chunk, _ in embed_results)
        db_start = time.perf_counter()
        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    locked_row = await conn.fetchrow(
                        """
                        SELECT id, title, summary, content_markdown, author_id,
                               embedding_attempt_id
                        FROM notes
                        WHERE id = $1 AND deleted = FALSE
                        FOR UPDATE
                        """,
                        note_id,
                    )
                    if locked_row is None:
                        raise RuntimeError("note disappeared before embedding write")
                    current_text = _build_note_embedding_text(_row_to_dict(locked_row))
                    if _note_fingerprint(current_text) != source_fingerprint:
                        return NoteIndexOutcome(
                            note_id=note_id,
                            profile_id=profile.id,
                            model_id=profile.model_id,
                            embedding_dim=embedding_dim,
                            chunk_count=0,
                            doc_chars=doc_chars,
                            doc_tokens=doc_tokens,
                            status="STALE",
                            error="note changed while indexing; stale result discarded",
                        )
                    if locked_row.get("embedding_attempt_id") != attempt_id:
                        return NoteIndexOutcome(
                            note_id=note_id,
                            profile_id=profile.id,
                            model_id=profile.model_id,
                            embedding_dim=embedding_dim,
                            chunk_count=0,
                            doc_chars=doc_chars,
                            doc_tokens=doc_tokens,
                            status="STALE",
                            error="newer indexing attempt superseded this request",
                        )
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
                        """
                        UPDATE notes
                        SET embedding_status = 'INDEXED',
                            embedding_fingerprint = $1,
                            embedding_profile_id = $2,
                            embedding_indexed_at = CURRENT_TIMESTAMP,
                            embedding_error = NULL,
                            embedding_attempt_id = NULL
                        WHERE id = $3 AND deleted = FALSE
                        """,
                        source_fingerprint,
                        profile.id,
                        note_id,
                    )
        except Exception as exc:
            error = f"write failed: {type(exc).__name__}: {str(exc)[:300]}"
            await self._mark_failed_if_current(note_id, source_fingerprint, attempt_id, error)
            return NoteIndexOutcome(
                note_id,
                profile.id,
                profile.model_id,
                embedding_dim,
                0,
                doc_chars,
                doc_tokens,
                "FAILED",
                error,
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

    async def get_readiness(
        self,
        *,
        note_id: int,
        user_id: int | None = None,
        profile: SearchProfile | None = None,
    ) -> NoteReadinessOutcome | None:
        if note_id <= 0:
            raise ValueError("note_id must be positive")

        row = await self._fetch_note(note_id, user_id, include_index_metadata=True)
        if not row:
            return None
        note = _row_to_dict(row)
        source_fingerprint = _note_fingerprint(_build_note_embedding_text(note))

        try:
            profile = profile or await VectorStoreService(self.pool, self.llm).get_active_profile()
        except Exception:
            return NoteReadinessOutcome(
                note_id=note_id,
                status="unavailable",
                queryable=False,
                profile_id=None,
                profile_name=None,
                model_id=None,
                chunk_count=0,
                carrier_id=None,
                source_fingerprint=source_fingerprint,
                indexed_fingerprint=note.get("embedding_fingerprint"),
                indexed_at=note.get("embedding_indexed_at"),
                message="当前没有可用的检索配置，请先在搜索配置中启用一个配置。",
            )

        async with self.pool.acquire() as conn:
            count_row = await conn.fetchrow(
                """
                SELECT
                    COUNT(*)::int AS chunk_count,
                    (
                        SELECT c.id
                        FROM atlas_carriers c
                        WHERE c.source_uri = 'notes://' || ($1::bigint)::text
                          AND c.type = 'markdown'
                          AND c.deleted = FALSE
                          AND c.status = 'ready'
                          AND ($3::bigint IS NULL OR c.owner_id = $3)
                        LIMIT 1
                    ) AS carrier_id
                FROM note_embeddings
                WHERE note_id = $1
                  AND profile_id = $2
                  AND status = 'INDEXED'
                  AND embedding IS NOT NULL
                """,
                note_id,
                profile.id,
                user_id,
            )
        chunk_count = int((count_row or {}).get("chunk_count") or 0)
        carrier_id = (count_row or {}).get("carrier_id")
        if carrier_id is not None:
            carrier_id = int(carrier_id)
        indexed_fingerprint = note.get("embedding_fingerprint")
        indexed_profile_id = note.get("embedding_profile_id")
        embedding_status = str(note.get("embedding_status") or "PENDING").upper()
        fingerprint_matches = indexed_fingerprint == source_fingerprint
        profile_matches = indexed_profile_id == profile.id

        if (
            embedding_status == "INDEXED"
            and fingerprint_matches
            and profile_matches
            and chunk_count > 0
            and carrier_id is not None
        ):
            status = "ready"
            queryable = True
            message = f"已准备 {chunk_count} 个可检索分块，可用于提问。"
        elif embedding_status == "FAILED" and indexed_fingerprint in (None, source_fingerprint):
            status = "failed"
            queryable = False
            message = "知识来源准备失败，请重试。"
        elif indexed_fingerprint and (not fingerprint_matches or not profile_matches):
            status = "needs_update"
            queryable = False
            message = (
                "笔记内容已变化，需要更新知识来源后才能用于提问。"
                if not fingerprint_matches
                else "检索配置已变化，需要更新知识来源后才能用于提问。"
            )
        elif embedding_status == "PENDING":
            status = "processing"
            queryable = False
            message = "正在为这条笔记准备可检索内容。"
        elif embedding_status == "INDEXED":
            status = "not_ready" if chunk_count > 0 and carrier_id is None else "failed"
            queryable = False
            message = (
                "内容已索引，但尚未注册为可提问来源。"
                if carrier_id is None and chunk_count > 0
                else "索引记录不完整，当前不能用于提问，请重新准备。"
            )
        else:
            status = "not_ready"
            queryable = False
            message = "这条笔记尚未准备为可提问来源。"

        return NoteReadinessOutcome(
            note_id=note_id,
            status=status,
            queryable=queryable,
            profile_id=profile.id,
            profile_name=profile.name,
            model_id=profile.model_id,
            chunk_count=chunk_count,
            carrier_id=carrier_id,
            source_fingerprint=source_fingerprint,
            indexed_fingerprint=indexed_fingerprint,
            indexed_at=note.get("embedding_indexed_at"),
            message=message,
        )

    async def _fetch_note(
        self,
        note_id: int,
        user_id: int | None,
        *,
        include_index_metadata: bool = False,
    ) -> Any | None:
        metadata_columns = ", embedding_attempt_id"
        if include_index_metadata:
            metadata_columns += """
                , embedding_status, embedding_fingerprint, embedding_profile_id,
                  embedding_indexed_at, embedding_error
            """
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(
                f"""
                SELECT id, title, summary, content_markdown, author_id
                       {metadata_columns}
                FROM notes
                WHERE id = $1
                  AND deleted = FALSE
                  AND ($2::bigint IS NULL OR author_id = $2 OR author_id IS NULL)
                """,
                note_id,
                user_id,
            )

    async def _write_empty(
        self,
        note_id: int,
        profile: SearchProfile,
        source_fingerprint: str,
        attempt_id: str | None,
    ) -> NoteIndexOutcome:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                locked_row = await conn.fetchrow(
                    """
                    SELECT id, title, summary, content_markdown, author_id,
                           embedding_attempt_id
                    FROM notes
                    WHERE id = $1 AND deleted = FALSE
                    FOR UPDATE
                    """,
                    note_id,
                )
                if locked_row is None:
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
                current_text = _build_note_embedding_text(_row_to_dict(locked_row))
                if _note_fingerprint(current_text) != source_fingerprint:
                    return NoteIndexOutcome(
                        note_id=note_id,
                        profile_id=profile.id,
                        model_id=profile.model_id,
                        embedding_dim=0,
                        chunk_count=0,
                        doc_chars=0,
                        doc_tokens=0,
                        status="STALE",
                        error="note changed while indexing; stale result discarded",
                    )
                if locked_row.get("embedding_attempt_id") != attempt_id:
                    return NoteIndexOutcome(
                        note_id=note_id,
                        profile_id=profile.id,
                        model_id=profile.model_id,
                        embedding_dim=0,
                        chunk_count=0,
                        doc_chars=0,
                        doc_tokens=0,
                        status="STALE",
                        error="newer indexing attempt superseded this request",
                    )
                await conn.execute(
                    "DELETE FROM note_embeddings WHERE note_id = $1 AND profile_id = $2",
                    note_id,
                    profile.id,
                )
                await conn.execute(
                    """
                    UPDATE notes
                    SET embedding_status = 'SKIPPED',
                        embedding_fingerprint = $1,
                        embedding_profile_id = $2,
                        embedding_indexed_at = CURRENT_TIMESTAMP,
                        embedding_error = NULL,
                        embedding_attempt_id = NULL
                    WHERE id = $3 AND deleted = FALSE
                    """,
                    source_fingerprint,
                    profile.id,
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

    async def _mark_failed_if_current(
        self,
        note_id: int,
        expected_fingerprint: str,
        attempt_id: str | None,
        error: str,
    ) -> None:
        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    locked_row = await conn.fetchrow(
                        """
                        SELECT id, title, summary, content_markdown, author_id,
                               embedding_attempt_id
                        FROM notes
                        WHERE id = $1 AND deleted = FALSE
                        FOR UPDATE
                        """,
                        note_id,
                    )
                    if locked_row is None:
                        return
                    current_text = _build_note_embedding_text(_row_to_dict(locked_row))
                    if _note_fingerprint(current_text) != expected_fingerprint:
                        return
                    if locked_row.get("embedding_attempt_id") != attempt_id:
                        return
                    await conn.execute(
                        """
                        UPDATE notes
                        SET embedding_status = 'FAILED',
                            embedding_error = $1,
                            embedding_attempt_id = NULL
                        WHERE id = $2 AND deleted = FALSE
                        """,
                        error[:1000],
                        note_id,
                    )
        except Exception as exc:
            logger.warning(
                "note_indexer.mark_status_failed",
                extra={"data": {"note_id": note_id, "status": "FAILED", "error": str(exc)[:200]}},
            )
