from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import HTTPException

from app.core.config import get_settings
from app.services.llm_router import LlmRouter

logger = logging.getLogger("ai-service")


# ref: §2.4.2.5, §4.4 · Plan V3 (migration 000034)
#
# Storage model (versioned, blue-green switch):
#   - post_embeddings 表按 (post_id, model_id) 唯一，多模型可共存
#   - embedding 列不锁 dim，HNSW 通过 partial expression 索引按 dim 分桶
#   - site_settings.search.active_embedding_model 指向当前活跃模型
#   - 换模型 reindex = 先把新 embeddings 以 status='shadow' 写进新列，全部
#     完成后用一条事务同时做三件事：shadow→active / 旧 active→deprecated /
#     翻转 site_settings 指针。搜索流量在翻转前永远落在旧模型上，翻转后
#     原子落到新模型上——任何时刻都有一组完整的 active 行可查。
class VectorStoreService:
    def __init__(self, pool, llm: LlmRouter) -> None:
        self.pool = pool
        self.llm = llm
        self.settings = get_settings()

    async def _read_active_model_setting(self) -> str | None:
        """从 site_settings 读活跃模型指针，未设置时返回 None。"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT setting_value FROM site_settings "
                "WHERE setting_key = 'search.active_embedding_model'"
            )
        if row and row["setting_value"]:
            return row["setting_value"].strip()
        return None

    async def _get_active_embedding_model(self) -> str:
        """读 site_settings.search.active_embedding_model；缺省回退到 llm 路由。

        来源优先级：
          1) site_settings 里 admin 明确写入的活跃模型（蓝绿切换的权威指针）
          2) llm_router 解析的 embedding 路由（仅首次部署时 site_settings 未
             写入的 bootstrap 场景使用）
        """
        value = await self._read_active_model_setting()
        if value:
            return value
        return await self.llm.resolve_embedding_model_id()

    async def _upsert_active_model_setting(self, model: str) -> None:
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
                model,
            )

    async def semantic_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        embedding = await self.llm.embed(query)
        dim = len(embedding) if embedding else 0
        # Defensive: `llm.embed()` 理论上不应返回空向量，但 provider 异常
        # (上游 500/empty body 被 LiteLLM 吞掉) 或模型路由配错都会让我们
        # 拿到 []。不拦住的话 f"::vector({dim})" 会拼出 ::vector(0)，
        # pgvector 把它当语法错误抛 InvalidTextRepresentation，上层只看到
        # 500 没有可执行错误信息。
        if dim <= 0:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Embedding 生成失败（返回空向量），语义搜索不可用。"
                    "请检查搜索配置里的活跃 embedding 模型与上游供应商连通性。"
                ),
            )
        active_model = await self._get_active_embedding_model()
        # pgvector 的 hnsw 对 `vector` 类型限 2000 维 —— text-embedding-3-large
        # 的 3072 维超过这个阈值, migration 000036 对 dim > 2000 的分区用 halfvec
        # (float16, hnsw 最大 4000 维). planner 只有在 ORDER BY / WHERE 的 cast
        # 精确匹配索引表达式时才会选中 partial HNSW, 所以 3072 查询要同步 cast
        # 成 halfvec; 1536 / 768 等小维仍走 vector.
        cast_type = "halfvec" if dim > 2000 else "vector"
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
                    1 - (pe.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})) AS similarity
                FROM post_embeddings pe
                JOIN posts p ON p.id = pe.post_id
                WHERE pe.model_id = $2
                  AND pe.status = 'active'
                  AND pe.dim = $3
                  AND p.deleted = FALSE
                  AND p.status = 'PUBLISHED'
                  AND p.password IS NULL
                  AND p.is_hidden = FALSE
                  AND 1 - (pe.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})) >= $4
                ORDER BY pe.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})
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
        """Full reindex with true blue-green model switch.

        历史方案（被替换）：reindex 一开始就 UPSERT site_settings 指针到新模型，
        导致 semantic_search 的过滤器立刻改看新 model_id——但此时新向量还没
        写入，搜索返回空，整个 reindex 窗口（数分钟~数小时）期间语义搜索全挂。

        蓝绿方案（当前）：
          1) 读 site_settings 里"上一次活跃模型"作为 previous_active
          2) 若 previous_active 与 router_model 相同 → 同模型 refresh，走旧
             的 active 路径（仅重算 embedding，无切换窗口）
          3) 若不同 → 真·蓝绿切换：
             a. 把所有文章新 embedding 以 status='shadow' 写入 (post_id,
                router_model) 新行。过程中搜索继续命中旧 model 的 active 行，
                零空窗
             b. 全部成功 → 一条事务内同时 (i) shadow→active (ii) 旧 active→
                deprecated (iii) 翻转 site_settings 指针 (iv) 成功文章的
                posts.embedding_status = INDEXED。搜索流量原子切换到新模型
             c. 任一文章失败 → 不翻转。旧模型继续服务搜索，shadow 行保留，
                admin 修完上游再触发 reindex 即可完成切换
        """
        router_model = await self.llm.resolve_embedding_model_id()
        previous_active = await self._read_active_model_setting()

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, title, slug, content_markdown "
                "FROM posts "
                "WHERE deleted = FALSE AND status = 'PUBLISHED' "
                "ORDER BY id ASC"
            )

        # Bootstrap / 同模型路径：不需要蓝绿切换，直接走 active upsert。
        # previous_active is None: 从未配置过指针（首次部署 / 数据迁移后），
        # 写入指针并用标准 upsert 走一遍即可。
        is_model_switch = (
            previous_active is not None and previous_active != router_model
        )
        if not is_model_switch:
            if previous_active is None:
                await self._upsert_active_model_setting(router_model)
            return await self._reindex_in_place(rows, router_model)

        # 真·蓝绿切换
        return await self._reindex_blue_green(rows, router_model, previous_active)

    async def _reindex_in_place(
        self,
        rows: list[Any],
        active_model: str,
    ) -> dict[str, Any]:
        """同模型 reindex——直接走 upsert_post_embedding，无切换窗口。"""
        total = 0
        failed = 0
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
                    "reindex.in_place.post_failed",
                    extra={"data": {"post_id": row["id"], "error": str(exc)[:200]}},
                )
        return {
            "status": "completed",
            "indexed": total,
            "failed": failed,
            "active_model": active_model,
        }

    async def _reindex_blue_green(
        self,
        rows: list[Any],
        router_model: str,
        previous_active: str,
    ) -> dict[str, Any]:
        """蓝绿切换：shadow 写入全部成功后一次事务翻转指针。"""
        logger.info(
            "reindex.blue_green.start",
            extra={"data": {
                "previous_active": previous_active,
                "router_model": router_model,
                "total_posts": len(rows),
            }},
        )

        succeeded_ids: list[int] = []
        failed_ids: list[int] = []

        for row in rows:
            post_id = row["id"]
            content = row["content_markdown"] or ""
            embed_start = time.perf_counter()
            try:
                embedding = await self.llm.embed(content)
                dim = len(embedding) if embedding else 0
                if dim <= 0:
                    raise ValueError(
                        f"embedding returned empty vector for post {post_id}"
                    )
                async with self.pool.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO post_embeddings
                            (post_id, model_id, dim, embedding, status, indexed_at)
                        VALUES ($1, $2, $3, $4, 'shadow', NOW())
                        ON CONFLICT (post_id, model_id) DO UPDATE
                        SET embedding = EXCLUDED.embedding,
                            dim = EXCLUDED.dim,
                            status = 'shadow',
                            indexed_at = NOW()
                        """,
                        post_id,
                        router_model,
                        dim,
                        embedding,
                    )
                succeeded_ids.append(post_id)
                logger.debug(
                    "reindex.blue_green.post_shadow_ok",
                    extra={"data": {
                        "post_id": post_id,
                        "dim": dim,
                        "embed_ms": round((time.perf_counter() - embed_start) * 1000, 2),
                    }},
                )
            except Exception as exc:
                failed_ids.append(post_id)
                logger.warning(
                    "reindex.blue_green.post_failed",
                    extra={"data": {
                        "post_id": post_id,
                        "error": str(exc)[:200],
                        "embed_ms": round((time.perf_counter() - embed_start) * 1000, 2),
                    }},
                )

        # 任一失败：保留 shadow 行，不翻转指针。旧模型继续服务搜索。
        if failed_ids:
            logger.warning(
                "reindex.blue_green.flip_aborted",
                extra={"data": {
                    "succeeded": len(succeeded_ids),
                    "failed": len(failed_ids),
                    "first_failed_ids": failed_ids[:10],
                }},
            )
            return {
                "status": "partial",
                "indexed": len(succeeded_ids),
                "failed": len(failed_ids),
                "active_model": previous_active,
                "pending_model": router_model,
                "pending_flip": True,
                "message": (
                    f"{len(failed_ids)} 篇文章在新模型 {router_model} 下 embedding 失败。"
                    f"搜索仍由旧模型 {previous_active} 提供服务，修复上游后再次触发"
                    "'全量重建索引'即可完成切换。"
                ),
            }

        # 全部成功 → 原子翻转
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """
                    UPDATE post_embeddings
                    SET status = 'active'
                    WHERE model_id = $1 AND status = 'shadow'
                    """,
                    router_model,
                )
                await conn.execute(
                    """
                    UPDATE post_embeddings
                    SET status = 'deprecated'
                    WHERE model_id <> $1 AND status = 'active'
                    """,
                    router_model,
                )
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
                await conn.execute(
                    """
                    UPDATE posts
                    SET embedding_status = 'INDEXED'
                    WHERE deleted = FALSE
                      AND status = 'PUBLISHED'
                      AND embedding_status <> 'INDEXED'
                    """,
                )

        logger.info(
            "reindex.blue_green.flipped",
            extra={"data": {
                "previous_active": previous_active,
                "router_model": router_model,
                "indexed": len(succeeded_ids),
            }},
        )
        # GC：deprecated 行由外部 cron 在 30 天回滚窗口后清理
        return {
            "status": "completed",
            "indexed": len(succeeded_ids),
            "failed": 0,
            "active_model": router_model,
            "previous_model": previous_active,
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
