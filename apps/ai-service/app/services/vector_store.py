from __future__ import annotations

import logging
import time
from typing import Any

from app.core.config import get_settings
from app.services.llm_router import LlmRouter

logger = logging.getLogger("ai-service")


# ref: §2.4.2.5, §4.4 · Plan V3 (migration 000034)
#
# Storage model (versioned):
#   - post_embeddings 表按 (post_id, model_id) 唯一，多模型可共存
#   - embedding 列不锁 dim，HNSW 通过 partial expression 索引按 dim 分桶
#   - site_settings.search.active_embedding_model 指向当前活跃模型
#   - 换模型 = 新行以 active 写入 + 旧 model_id 的 active 行降级为 deprecated
#
# 这里的 VectorStoreService 只和表交互，"当前活跃模型是什么"由 llm_router
# 的 embedding 路由 + site_settings 共同决定。
class VectorStoreService:
    def __init__(self, pool, llm: LlmRouter) -> None:
        self.pool = pool
        self.llm = llm
        self.settings = get_settings()

    async def _get_active_embedding_model(self) -> str:
        """读 site_settings.search.active_embedding_model；缺省回退到 llm 路由。

        来源优先级：
          1) site_settings 里 admin 明确写入的活跃模型
          2) llm_router 解析的 embedding 路由（即 aembedding 实际会调用的模型）
        这两者应该保持一致；不一致时 upsert 会以 (2) 为准写入 model_id，
        但 semantic_search 过滤器以 (1) 为准——所以 admin 切换时
        必须同步更新 site_settings 再触发 reindex。
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT setting_value FROM site_settings "
                "WHERE setting_key = 'search.active_embedding_model'"
            )
        if row and row["setting_value"]:
            return row["setting_value"].strip()
        return await self.llm.resolve_embedding_model_id()

    async def semantic_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        embedding = await self.llm.embed(query)
        active_model = await self._get_active_embedding_model()
        dim = len(embedding)
        # 直接查 post_embeddings 替代旧的 search_similar_posts SQL 函数——
        # 函数签名和调用点已经漂移过一次，改表后一并清掉。
        # SECURITY (VULN-060): 仍然显式过滤 deleted/status/password/is_hidden，
        # 保证公共语义搜索不会泄漏草稿/隐藏/密码保护的内容（snippet 可能暴露
        # 120+ 字符敏感文本）。
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT
                    pe.post_id,
                    p.title,
                    p.slug,
                    COALESCE(p.content_markdown, '') AS content,
                    1 - (pe.embedding::vector({dim}) <=> $1::vector({dim})) AS similarity
                FROM post_embeddings pe
                JOIN posts p ON p.id = pe.post_id
                WHERE pe.model_id = $2
                  AND pe.status = 'active'
                  AND pe.dim = $3
                  AND p.deleted = FALSE
                  AND p.status = 'PUBLISHED'
                  AND p.password IS NULL
                  AND p.is_hidden = FALSE
                  AND 1 - (pe.embedding::vector({dim}) <=> $1::vector({dim})) >= $4
                ORDER BY pe.embedding::vector({dim}) <=> $1::vector({dim})
                LIMIT $5
                """,
                embedding,
                active_model,
                dim,
                self.settings.search_threshold,
                limit,
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
            await self._mark_post_failed(post_id)
            raise
        embed_ms = (time.perf_counter() - embed_start) * 1000

        db_start = time.perf_counter()
        # 记录 embed() 实际路由到的模型——reindex 的 "model changed → deprecate"
        # 判断依赖这里写对，不能用 env 默认。
        model_id = await self.llm.resolve_embedding_model_id()
        dim = len(embedding) if embedding else 0
        if dim <= 0:
            await self._mark_post_failed(post_id)
            raise ValueError(f"embedding returned empty vector for post {post_id}")

        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    # 新活跃行：upsert 到 (post_id, model_id)
                    await conn.execute(
                        """
                        INSERT INTO post_embeddings
                            (post_id, model_id, dim, embedding, status, indexed_at)
                        VALUES ($1, $2, $3, $4, 'active', NOW())
                        ON CONFLICT (post_id, model_id) DO UPDATE
                        SET embedding = EXCLUDED.embedding,
                            dim = EXCLUDED.dim,
                            status = 'active',
                            indexed_at = NOW()
                        """,
                        post_id,
                        model_id,
                        dim,
                        embedding,
                    )
                    # 把同一 post 下其他 model_id 的 active 降级为 deprecated，
                    # 保证每 post 在任一时刻只有一个 active 向量——语义搜索
                    # 的过滤器 (model_id = active_model AND status='active')
                    # 不会撞到多行。
                    await conn.execute(
                        """
                        UPDATE post_embeddings
                        SET status = 'deprecated'
                        WHERE post_id = $1 AND model_id <> $2 AND status = 'active'
                        """,
                        post_id,
                        model_id,
                    )
                    await conn.execute(
                        "UPDATE posts SET embedding_status = 'INDEXED' WHERE id = $1",
                        post_id,
                    )
        except Exception:
            # SILENT-FAILURE FIX：DB 写入失败（例如 dim 校验失败、连接抖动、
            # 唯一约束冲突）也必须把 post 标 FAILED，否则前端 stats 只看到
            # pending_posts > 0 就永远显示"索引进行中"。
            db_ms = (time.perf_counter() - db_start) * 1000
            logger.warning(
                "upsert.db_write_failed",
                extra={"data": {
                    "post_id": post_id,
                    "model_id": model_id,
                    "dim": dim,
                    "db_ms": round(db_ms, 2),
                    "embed_ms": round(embed_ms, 2),
                }},
            )
            await self._mark_post_failed(post_id)
            raise
        db_ms = (time.perf_counter() - db_start) * 1000

        logger.info(
            "upsert.ok",
            extra={"data": {
                "post_id": post_id,
                "content_len": content_len,
                "embed_ms": round(embed_ms, 2),
                "db_ms": round(db_ms, 2),
                "vector_dim": dim,
                "model_id": model_id,
            }},
        )
        return {"status": "indexed", "model_id": model_id, "dim": dim}

    async def _mark_post_failed(self, post_id: int) -> None:
        """尽力把 post 标 FAILED；此方法本身再挂也吞掉（只打 warning）。"""
        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    "UPDATE posts SET embedding_status = 'FAILED' WHERE id = $1",
                    post_id,
                )
        except Exception as mark_exc:
            logger.warning(
                "mark_failed_failed",
                extra={"data": {"post_id": post_id, "error": str(mark_exc)}},
            )

    async def delete_post_embedding(self, post_id: int) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM post_embeddings WHERE post_id = $1", post_id)
                await conn.execute(
                    "UPDATE posts SET embedding_status = 'PENDING' WHERE id = $1",
                    post_id,
                )
        return {"status": "deleted"}

    async def reindex(self) -> dict[str, Any]:
        """Full reindex against the currently active embedding model.

        Flow:
          1) 以 llm_router 当前 embedding 路由作为权威来源，写入
             site_settings.search.active_embedding_model（等于在这一刻
             提交"换模型"决定，为原子切换留存指针）
          2) 把非 active model 的 active 行全部降级为 deprecated，并把
             所有已发布文章标 PENDING——旧向量保留 30 天作 rollback
          3) 按 batch 重新 upsert 所有已发布文章到新 model_id
        """
        # 路由 = 下一步 embed() 真正会调用的模型，是"将来"；
        # site_settings = 当前 semantic_search 过滤器认定的模型，是"现在"。
        # reindex 的语义就是把"将来"提交为"现在"。
        router_model = await self.llm.resolve_embedding_model_id()
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO site_settings
                    (setting_key, setting_value, setting_type, group_name, description)
                VALUES ('search.active_embedding_model', $1, 'STRING', 'search',
                    '当前活跃的 embedding 模型 ID')
                ON CONFLICT (setting_key) DO UPDATE
                SET setting_value = EXCLUDED.setting_value,
                    updated_at = NOW()
                """,
                router_model,
            )
        active_model = router_model

        async with self.pool.acquire() as conn:
            stale = await conn.fetchval(
                """
                SELECT count(*) FROM post_embeddings
                WHERE model_id IS DISTINCT FROM $1 AND status = 'active'
                """,
                active_model,
            )
            if stale:
                logger.info(
                    "reindex.model_changed",
                    extra={"data": {
                        "active_model": active_model,
                        "stale_active_rows": stale,
                    }},
                )
                await conn.execute(
                    """
                    UPDATE post_embeddings
                    SET status = 'deprecated'
                    WHERE model_id IS DISTINCT FROM $1 AND status = 'active'
                    """,
                    active_model,
                )
                await conn.execute(
                    """
                    UPDATE posts SET embedding_status = 'PENDING'
                    WHERE deleted = FALSE AND status = 'PUBLISHED'
                    """,
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
                        extra={"data": {
                            "post_id": row["id"],
                            "error": str(exc),
                        }},
                    )
                    # upsert_post_embedding 内部已经标 FAILED 了，这里不再重复
            offset += batch_size

        # GC：deprecated 行可选清理（保留 30 天可回滚窗口由外部 cron 处理，
        # 这里不主动 DELETE）
        return {
            "status": "completed",
            "indexed": total,
            "failed": failed,
            "active_model": active_model,
        }

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
