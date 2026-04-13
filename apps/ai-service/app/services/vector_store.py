from __future__ import annotations

import logging
from typing import Any

from app.core.config import get_settings
from app.services.llm_router import LlmRouter

logger = logging.getLogger("ai-service")


# ref: §2.4.2.5, §4.4
class VectorStoreService:
    def __init__(self, pool, llm: LlmRouter) -> None:
        self.pool = pool
        self.llm = llm
        self.settings = get_settings()

    async def semantic_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        embedding = await self.llm.embed(query)
        model = self.settings.model_embedding
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT post_id, title, slug, content, similarity "
                "FROM search_similar_posts($1, $2, $3, $4)",
                embedding,
                self.settings.search_threshold,
                limit,
                model,
            )
        return [self._row_to_result(row, query) for row in rows]

    async def upsert_post_embedding(
        self,
        post_id: int,
        title: str,
        slug: str,
        content: str,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        embedding = await self.llm.embed(content)
        model = self.settings.model_embedding
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO post_vectors (post_id, embedding, model) "
                    "VALUES ($1, $2, $3) "
                    "ON CONFLICT (post_id) DO UPDATE "
                    "SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, updated_at = NOW()",
                    post_id,
                    embedding,
                    model,
                )
                await conn.execute(
                    "UPDATE posts SET embedding_status = 'INDEXED' WHERE id = $1",
                    post_id,
                )
        return {"status": "indexed"}

    async def delete_post_embedding(self, post_id: int) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM post_vectors WHERE post_id = $1", post_id)
                await conn.execute(
                    "UPDATE posts SET embedding_status = 'PENDING' WHERE id = $1",
                    post_id,
                )
        return {"status": "deleted"}

    async def reindex(self) -> dict[str, Any]:
        current_model = self.settings.model_embedding

        # Invalidate vectors from a different model — they are incompatible
        async with self.pool.acquire() as conn:
            stale = await conn.fetchval(
                "SELECT count(*) FROM post_vectors WHERE model IS DISTINCT FROM $1",
                current_model,
            )
            if stale:
                logger.info(
                    "reindex.model_changed",
                    extra={"current_model": current_model, "stale_vectors": stale},
                )
                await conn.execute(
                    "DELETE FROM post_vectors WHERE model IS DISTINCT FROM $1",
                    current_model,
                )
                await conn.execute(
                    "UPDATE posts SET embedding_status = 'PENDING' "
                    "WHERE deleted = FALSE AND status = 'PUBLISHED' "
                    "AND embedding_status = 'INDEXED'",
                )

        batch_size = self.settings.reindex_batch_size
        total = 0
        failed = 0
        offset = 0
        while True:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT id, title, slug, content_markdown "
                    "FROM posts "
                    "WHERE deleted = FALSE AND status = 'PUBLISHED' "
                    "ORDER BY id ASC "
                    "LIMIT $1 OFFSET $2",
                    batch_size,
                    offset,
                )
            if not rows:
                break
            for row in rows:
                try:
                    await self.upsert_post_embedding(
                        post_id=row["id"],
                        title=row["title"],
                        slug=row["slug"],
                        content=row["content_markdown"] or "",
                        metadata={"status": "PUBLISHED"},
                    )
                    total += 1
                except Exception as exc:
                    failed += 1
                    logger.warning(
                        "reindex.post_failed",
                        extra={"post_id": row["id"], "error": str(exc)},
                    )
                    # Mark the post as FAILED so it shows in stats and can be retried
                    try:
                        async with self.pool.acquire() as conn:
                            await conn.execute(
                                "UPDATE posts SET embedding_status = 'FAILED' WHERE id = $1",
                                row["id"],
                            )
                    except Exception:
                        pass
            offset += batch_size
        return {"status": "completed", "indexed": total, "failed": failed}

    def _row_to_result(self, row: Any, query: str) -> dict[str, Any]:
        content = row["content"] or ""
        highlight = self._build_highlight(content, query)
        return {
            "post": {
                "id": str(row["post_id"]),
                "title": row["title"],
                "slug": row["slug"],
            },
            "similarity": float(row["similarity"]),
            "highlight": highlight,
        }

    def _build_highlight(self, content: str, query: str, window: int = 120) -> str:
        if not content:
            return ""
        lower_content = content.lower()
        lower_query = query.lower()
        idx = lower_content.find(lower_query)
        if idx == -1:
            return content[:window]
        start = max(idx - 20, 0)
        end = min(idx + len(query) + 20, len(content))
        return content[start:end]
