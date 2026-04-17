from __future__ import annotations

import logging
import time
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
        # Match the filter against the model actually used by embed() above.
        # search_similar_posts() filters post_vectors by model, so using the
        # stale env default here would silently return zero results whenever
        # the admin switched the embedding model in Search Config.
        model = await self.llm.resolve_embedding_model_id()
        async with self.pool.acquire() as conn:
            # SECURITY (VULN-060): the raw SQL function search_similar_posts()
            # only compares vectors — it does NOT filter by post status,
            # deleted flag, is_hidden, or password. Joining to `posts` here and
            # adding explicit predicates ensures public semantic search never
            # leaks draft / hidden / password-protected content (the returned
            # snippet could reveal 120+ chars that should not be public).
            rows = await conn.fetch(
                """
                SELECT s.post_id, s.title, s.slug, s.content, s.similarity
                FROM search_similar_posts($1, $2, $3, $4) s
                JOIN posts p ON p.id = s.post_id
                WHERE p.deleted = false
                  AND p.status = 'PUBLISHED'
                  AND p.password IS NULL
                  AND p.is_hidden = false
                """,
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
        timeout_sec: int | None = None,
    ) -> dict[str, Any]:
        # 观测点：把一次索引切成 embed / db_write 两段计时，
        # 出问题时能从日志直接判断瓶颈在向量生成还是 pgvector 写入。
        # 注意：项目的 JSONFormatter 只识别 extra={"data": {...}}，裸字段会被丢弃。
        content_len = len(content or "")
        embed_start = time.perf_counter()
        try:
            embedding = await self.llm.embed(content, timeout_sec=timeout_sec)
        except Exception:
            embed_ms = (time.perf_counter() - embed_start) * 1000
            logger.warning(
                "upsert.embed_failed",
                extra={"data": {
                    "post_id": post_id,
                    "content_len": content_len,
                    "embed_ms": round(embed_ms, 2),
                }},
            )
            # 把 post 标记为 FAILED，让前端 stats / "重试失败"按钮能感知；
            # 之前只有 reindex() 路径做了这件事，单篇 upsert 失败时状态会卡在
            # PENDING，导致用户重试机制失效。最佳努力：标记失败本身再失败也吞掉。
            try:
                async with self.pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE posts SET embedding_status = 'FAILED' WHERE id = $1",
                        post_id,
                    )
            except Exception as mark_exc:
                logger.warning(
                    "upsert.mark_failed_failed",
                    extra={"data": {"post_id": post_id, "error": str(mark_exc)}},
                )
            raise
        embed_ms = (time.perf_counter() - embed_start) * 1000

        db_start = time.perf_counter()
        # Record the model that embed() actually routed to, not the env default.
        # Reindex()'s "model changed" detection compares against this column to
        # decide which vectors are stale; storing the env default would leave
        # old vectors undetectable after a routing change.
        model = await self.llm.resolve_embedding_model_id()
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
        db_ms = (time.perf_counter() - db_start) * 1000

        logger.info(
            "upsert.ok",
            extra={"data": {
                "post_id": post_id,
                "content_len": content_len,
                "embed_ms": round(embed_ms, 2),
                "db_ms": round(db_ms, 2),
                "vector_dim": len(embedding) if embedding else 0,
                "model": model,
            }},
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
        # Use the model routing actually resolves to — same source of truth as
        # upsert_post_embedding — so "model changed → drop stale vectors"
        # triggers correctly when the admin switches embedding provider.
        current_model = await self.llm.resolve_embedding_model_id()

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
