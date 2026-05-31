from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from fastapi import HTTPException

from app.core.config import get_settings
from app.services.chunker import Chunk, split as chunk_split
from app.services.llm_router import LlmRouter

logger = logging.getLogger("ai-service")

ChunkProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


# 引用: §2.4.2.5, §4.4 · 计划 V3 (数据迁移 000034 + 000041)
#
# 存储模型（profile 化，多 chunk，蓝绿切换）：
#   - search_profiles 表存"完整索引配置单元"：(model + chunker + chunk_size + overlap)
#   - post_embeddings 按 (post_id, profile_id, chunk_index) 唯一，多 chunk × 多 profile 共存
#   - embedding 列不锁 dim，HNSW 通过 partial expression 索引按 dim 分桶
#   - site_settings.search.active_profile_code 指向当前活跃 profile
#   - 换 profile reindex = 新 profile 以 status='shadow' 写新行，全部完成后用一条
#     事务同时做四件事：
#       (a) 新 profile shadow→active
#       (b) 同一 profile 下 post_embeddings 行 shadow→active
#       (c) 旧 profile→deprecated（含表 + 旧 post_embeddings 行）
#       (d) 翻转 site_settings.search.active_profile_code
#     搜索流量在翻转前永远落在旧 profile，翻转后原子落到新 profile。


@dataclass
class SearchProfile:
    """从 search_profiles 表读出来的活跃配置快照。"""

    id: int
    code: str
    name: str
    description: str | None
    model_id: str
    chunker_kind: str
    chunk_size_tokens: int
    chunk_overlap_tokens: int
    status: str


def _chunk_hash(chunk: Chunk) -> str:
    """稳定标识当前 chunk 内容；parent_child 还要纳入 parent_text。"""
    payload = "\x00".join((chunk.text or "", chunk.parent_text or ""))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class VectorStoreService:
    def __init__(self, pool, llm: LlmRouter) -> None:
        self.pool = pool
        self.llm = llm
        self.settings = get_settings()
        # 单文档 reindex 内的 chunk 并发上限。embedding API 通常容量充足，
        # 但限制在 5 是为了不打爆中转网关（OneAPI / LiteLLM proxy 的并发账户）。
        self._chunk_concurrency = 5

    @property
    def chunk_concurrency(self) -> int:
        return self._chunk_concurrency

    # ============================================================
    # Profile resolution
    # ============================================================

    async def _read_active_profile_code(self) -> str | None:
        """从 site_settings 读 active_profile_code，未配返回 None。"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT setting_value FROM site_settings "
                "WHERE setting_key = 'search.active_profile_code'"
            )
        if row and row["setting_value"]:
            return row["setting_value"].strip()
        return None

    async def _fetch_profile_by_code(self, code: str) -> SearchProfile | None:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, code, name, description, model_id, chunker_kind,
                       chunk_size_tokens, chunk_overlap_tokens, status
                FROM search_profiles WHERE code = $1
                """,
                code,
            )
        if not row:
            return None
        return SearchProfile(**dict(row))

    async def _fetch_profile_by_status_active(self) -> SearchProfile | None:
        """Fallback：当 active_profile_code 未配时，按 status='active' 取 profile。"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, code, name, description, model_id, chunker_kind,
                       chunk_size_tokens, chunk_overlap_tokens, status
                FROM search_profiles WHERE status = 'active' LIMIT 1
                """
            )
        if not row:
            return None
        return SearchProfile(**dict(row))

    async def get_active_profile(self) -> SearchProfile:
        """读当前活跃 profile。

        来源优先级：
          1) site_settings.search.active_profile_code 指针
          2) search_profiles 表里 status='active' 的行（兜底）
          3) 抛 503 让上游知道还没有可用 profile
        """
        code = await self._read_active_profile_code()
        if code:
            profile = await self._fetch_profile_by_code(code)
            if profile and profile.status == "active":
                return profile
            # 指针指向了不存在 / 非 active 的 profile —— 按 status 兜底
            logger.warning(
                "active_profile.code_dangling",
                extra={"data": {"code": code, "found": profile is not None}},
            )
        profile = await self._fetch_profile_by_status_active()
        if profile:
            return profile
        raise HTTPException(
            status_code=503,
            detail=(
                "Search Profile 未配置：search_profiles 表里没有 status='active' 的 profile，"
                "且 site_settings.search.active_profile_code 未指向有效 profile。"
                "请在搜索配置中创建 profile 或检查 migration 000041 是否成功。"
            ),
        )

    # ============================================================
    # Search (read path) —— 多 chunk 召回 + 文档级聚合
    # ============================================================

    async def semantic_search(
        self,
        query: str,
        limit: int,
        user_id: int | str | None = None,
        usage_endpoint: str | None = None,
        request_id: str | None = None,
        profile: SearchProfile | None = None,
    ) -> list[dict[str, Any]]:
        profile = profile or await self.get_active_profile()
        try:
            embedding = await self.llm.embed(
                query,
                user_id=user_id,
                embedding_model_id=profile.model_id,
                strict_embedding_model_id=True,
                usage_endpoint=usage_endpoint,
                request_id=request_id,
            )
        except ValueError as exc:
            msg = str(exc)
            if "embedding model override" in msg:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "语义搜索配置不可用：当前 active search profile 指向的 "
                        f"embedding 模型不可用（profile={profile.code}, model={profile.model_id}）。"
                        "请在搜索配置中切换到可用模型并重建索引。"
                    ),
                ) from exc
            raise
        dim = len(embedding) if embedding else 0
        # Defensive: `llm.embed()` 理论上不应返回空向量，但 provider 异常
        # (上游 500/empty body 被 LiteLLM 吞掉) 或模型路由配错都会让我们
        # 拿到 []。不拦住的话 f"::vector({dim})" 会拼出 ::vector(0)，
        # pgvector 把它当语法错误抛 InvalidTextRepresentation。
        if dim <= 0:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Embedding 生成失败（返回空向量），语义搜索不可用。"
                    "请检查搜索配置里的活跃 embedding 模型与上游供应商连通性。"
                ),
            )
        # pgvector 的 hnsw 对 ``vector`` 类型限 2000 维 —— text-embedding-3-large
        # 的 3072 维超过这个阈值, 走 halfvec (float16, hnsw 最大 4000 维)。
        # planner 只有在 ORDER BY / WHERE 的 cast 精确匹配索引表达式时才会
        # 选中 partial HNSW，所以 3072 查询要同步 cast 成 halfvec; 1536 / 768 等
        # 小维仍走 vector。
        cast_type = "halfvec" if dim > 2000 else "vector"
        # 候选窗口：先取 top-N chunks，再聚合到文档级。窗口太小会漏召回（同
        # 一篇文章的多个相关 chunks 互相竞争），太大会增加 ranker 延迟。
        # 经验值：limit*5 上限 200，足够覆盖博客检索场景。
        candidate_limit = min(max(limit * 5, 50), 200)
        # SECURITY (VULN-060): 仍然显式过滤 deleted/status/password/is_hidden，
        # 保证公共语义搜索不会泄漏草稿/隐藏/密码保护的内容。
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                WITH candidate_chunks AS (
                    SELECT
                        pe.post_id,
                        pe.chunk_index,
                        pe.chunk_text,
                        pe.parent_text,
                        1 - (pe.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})) AS similarity
                    FROM post_embeddings pe
                    WHERE pe.profile_id = $2
                      AND pe.status = 'active'
                      AND pe.dim = $3
                    ORDER BY pe.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})
                    LIMIT $4
                ),
                ranked AS (
                    SELECT
                        cc.post_id,
                        MAX(cc.similarity) AS similarity,
                        -- 优先返回 parent_text 提供完整上下文（parent_child 策略下）；
                        -- parent_text 为 NULL（其他策略）时自然退化到 chunk_text。
                        (array_agg(COALESCE(cc.parent_text, cc.chunk_text)
                                   ORDER BY cc.similarity DESC NULLS LAST))[1] AS top_chunk_text
                    FROM candidate_chunks cc
                    GROUP BY cc.post_id
                )
                SELECT
                    r.post_id,
                    p.title,
                    p.slug,
                    COALESCE(r.top_chunk_text, p.content_markdown, '') AS content,
                    r.similarity
                FROM ranked r
                JOIN posts p ON p.id = r.post_id
                WHERE p.deleted = FALSE
                  AND p.status = 'PUBLISHED'
                  AND p.password IS NULL
                  AND p.is_hidden = FALSE
                  AND r.similarity >= $5
                ORDER BY r.similarity DESC
                LIMIT $6
                """,
                embedding,
                profile.id,
                dim,
                candidate_limit,
                self.settings.search_threshold,
                limit,
            )
        return [self._row_to_result(row, query) for row in rows]

    # ============================================================
    # Index (write path) —— chunk + 多向量写入
    # ============================================================

    async def upsert_post_embedding(
        self,
        post_id: int,
        title: str,
        slug: str,
        content: str,
        metadata: dict[str, Any],
        timeout_sec: int | None = None,
        profile: SearchProfile | None = None,
        target_status: str = "active",
        embed_semaphore: asyncio.Semaphore | None = None,
        progress_cb: ChunkProgressCallback | None = None,
        user_id: int | str | None = None,
        usage_endpoint: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        """对单篇文章按 profile 配置切片 + embed + upsert。

        ``profile=None``：使用 active profile（普通同模型 reindex / 单篇 retry）。
        ``profile=<shadow_profile>``：用于蓝绿切换的 shadow 写入；调用方负责
        在所有文章成功后翻转 status / 指针。

        ``target_status``：写入新行时的 status 列值。普通索引走 'active'，
        蓝绿写 shadow 时走 'shadow'。

        ``embed_semaphore``：批量重建时可传入跨文章共享的 semaphore，避免调用方
        的文章并发和这里的 chunk 并发相乘后打穿上游网关。

        ``progress_cb``：profile shadow reindex 可传入 chunk 级进度回调，用于
        SSE 展示单篇文章内部进度；普通 active 写入不依赖它。
        """
        profile = profile or await self.get_active_profile()
        used_model_id = profile.model_id
        content_len = len(content or "")

        # ---- 切片
        chunks: list[Chunk] = chunk_split(
            content or "",
            chunker_kind=profile.chunker_kind,
            chunk_size_tokens=profile.chunk_size_tokens,
            chunk_overlap_tokens=profile.chunk_overlap_tokens,
        )
        # 空文档（极少见，比如标题文章）：不调用 embedding API，直接标 INDEXED。
        # 历史 bug：旧实现把空内容也送给 embedding，部分 provider 会拒绝。
        if not chunks:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        "DELETE FROM post_embeddings WHERE post_id = $1 AND profile_id = $2",
                        post_id,
                        profile.id,
                    )
                    await conn.execute(
                        "UPDATE posts SET embedding_status = 'INDEXED' WHERE id = $1",
                        post_id,
                    )
            logger.info(
                "upsert.empty_content",
                extra={"data": {"post_id": post_id, "profile": profile.code}},
            )
            return {
                "status": "indexed",
                "profile": profile.code,
                "model_id": profile.model_id,
                "chunks": 0,
            }

        if target_status == "shadow":
            return await self._upsert_shadow_chunks_with_checkpoint(
                post_id=post_id,
                profile=profile,
                chunks=chunks,
                timeout_sec=timeout_sec,
                embed_semaphore=embed_semaphore,
                progress_cb=progress_cb,
                content_len=content_len,
                user_id=user_id,
                usage_endpoint=usage_endpoint,
                request_id=request_id,
            )

        # ---- 并发 embed 每个 chunk
        embed_start = time.perf_counter()
        semaphore = embed_semaphore or asyncio.Semaphore(self._chunk_concurrency)

        async def embed_chunk(c: Chunk) -> tuple[Chunk, list[float]]:
            async with semaphore:
                vec = await self.llm.embed(
                    c.text,
                    user_id=user_id,
                    embedding_model_id=used_model_id,
                    strict_embedding_model_id=True,
                    timeout_sec=timeout_sec,
                    usage_endpoint=usage_endpoint,
                    request_id=request_id,
                )
                return c, vec

        try:
            embed_results = await asyncio.gather(*(embed_chunk(c) for c in chunks))
        except Exception:
            embed_ms = (time.perf_counter() - embed_start) * 1000
            logger.warning(
                "upsert.embed_failed",
                extra={"data": {
                    "post_id": post_id,
                    "profile": profile.code,
                    "content_len": content_len,
                    "chunks": len(chunks),
                    "embed_ms": round(embed_ms, 2),
                }},
            )
            await self._mark_post_failed(post_id)
            raise
        embed_ms = (time.perf_counter() - embed_start) * 1000

        # ---- 校验维度统一
        first_dim = len(embed_results[0][1]) if embed_results else 0
        if first_dim <= 0:
            await self._mark_post_failed(post_id)
            raise ValueError(f"embedding returned empty vector for post {post_id}")
        for c, vec in embed_results:
            if len(vec) != first_dim:
                await self._mark_post_failed(post_id)
                raise ValueError(
                    f"chunk #{c.index} dim={len(vec)} differs from chunk #0 dim={first_dim}; "
                    "embedding model returned mixed-dim vectors"
                )

        # ---- 单事务：DELETE 旧行 + INSERT 全部新 chunks
        db_start = time.perf_counter()
        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    # 删旧行（同 profile 下，不论新 chunk 数比旧多还是少都干净）
                    await conn.execute(
                        "DELETE FROM post_embeddings WHERE post_id = $1 AND profile_id = $2",
                        post_id,
                        profile.id,
                    )
                    # 批量 INSERT 新 chunks
                    # parent_text 仅在 parent_child 策略下非 NULL；其他策略下 chunker
                    # 生成 Chunk.parent_text=None，asyncpg 自动写为 SQL NULL，召回侧
                    # COALESCE(parent_text, chunk_text) 自然退化，对其他策略零侵入。
                    rows_to_insert = [
                        (
                            post_id,
                            profile.id,
                            used_model_id,
                            first_dim,
                            vec,
                            target_status,
                            c.index,
                            c.text,
                            c.parent_text,
                            _chunk_hash(c),
                            len(chunks),
                        )
                        for c, vec in embed_results
                    ]
                    await conn.executemany(
                        """
                        INSERT INTO post_embeddings
                            (post_id, profile_id, model_id, dim, embedding, status,
                             chunk_index, chunk_text, parent_text, chunk_hash,
                             chunk_count, indexed_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
                        """,
                        rows_to_insert,
                    )
                    # 蓝绿写 shadow 时，posts.embedding_status 不变（仍按 active profile 视角）。
                    # 普通 active 写入 → 标 INDEXED。
                    if target_status == "active":
                        await conn.execute(
                            "UPDATE posts SET embedding_status = 'INDEXED' WHERE id = $1",
                            post_id,
                        )
        except Exception:
            # SILENT-FAILURE FIX：DB 写入失败也必须把 post 标 FAILED，否则前端
            # stats 看到 pending_posts > 0 永远卡在"索引进行中"。
            db_ms = (time.perf_counter() - db_start) * 1000
            logger.warning(
                "upsert.db_write_failed",
                extra={"data": {
                    "post_id": post_id,
                    "profile": profile.code,
                    "model_id": used_model_id,
                    "dim": first_dim,
                    "chunks": len(chunks),
                    "db_ms": round(db_ms, 2),
                    "embed_ms": round(embed_ms, 2),
                }},
            )
            if target_status == "active":
                await self._mark_post_failed(post_id)
            raise
        db_ms = (time.perf_counter() - db_start) * 1000

        logger.info(
            "upsert.ok",
            extra={"data": {
                "post_id": post_id,
                "profile": profile.code,
                "content_len": content_len,
                "chunks": len(chunks),
                "embed_ms": round(embed_ms, 2),
                "db_ms": round(db_ms, 2),
                "vector_dim": first_dim,
                "model_id": used_model_id,
                "target_status": target_status,
            }},
        )
        return {
            "status": "indexed",
            "profile": profile.code,
            "model_id": used_model_id,
            "dim": first_dim,
            "chunks": len(chunks),
        }

    async def _upsert_shadow_chunks_with_checkpoint(
        self,
        *,
        post_id: int,
        profile: SearchProfile,
        chunks: list[Chunk],
        timeout_sec: int | None,
        embed_semaphore: asyncio.Semaphore | None,
        progress_cb: ChunkProgressCallback | None,
        content_len: int,
        user_id: int | str | None = None,
        usage_endpoint: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        """Inactive profile 专用：按 chunk 持久化，允许单篇文章内部断点续跑。

        新建 profile 预热时已有行通常是 ``shadow``；旧 profile 切回时已有行
        可能是 ``deprecated``。两者都属于同一 profile 的可复用 checkpoint。
        """

        used_model_id = profile.model_id
        chunk_count = len(chunks)
        expected_hashes = {c.index: _chunk_hash(c) for c in chunks}
        expected_indices = set(expected_hashes)

        async with self.pool.acquire() as conn:
            existing_rows = await conn.fetch(
                """
                SELECT chunk_index, chunk_hash, COALESCE(chunk_count, 1) AS chunk_count, dim, model_id
                FROM post_embeddings
                WHERE post_id = $1
                  AND profile_id = $2
                  AND status IN ('shadow', 'deprecated')
                """,
                post_id,
                profile.id,
            )

        valid_indices: set[int] = set()
        stale_indices: set[int] = set()
        expected_dim: int | None = None
        for row in existing_rows:
            idx = int(row["chunk_index"])
            is_valid = (
                idx in expected_indices
                and row["chunk_hash"] == expected_hashes[idx]
                and int(row["chunk_count"] or 1) == chunk_count
                and row["model_id"] == used_model_id
            )
            if is_valid:
                row_dim = int(row["dim"])
                if expected_dim is None:
                    expected_dim = row_dim
                if row_dim == expected_dim:
                    valid_indices.add(idx)
                else:
                    stale_indices.add(idx)
            else:
                stale_indices.add(idx)

        if stale_indices:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    DELETE FROM post_embeddings
                    WHERE post_id = $1
                      AND profile_id = $2
                      AND chunk_index = ANY($3::int[])
                    """,
                    post_id,
                    profile.id,
                    sorted(stale_indices),
                )

        completed_chunks = len(valid_indices)
        if progress_cb:
            await progress_cb({
                "type": "chunk_progress",
                "postId": post_id,
                "profile": profile.code,
                "doneChunks": completed_chunks,
                "totalChunks": chunk_count,
                "status": "resumed",
            })

        missing_chunks = [c for c in chunks if c.index not in valid_indices]
        if not missing_chunks:
            return {
                "status": "indexed",
                "profile": profile.code,
                "model_id": used_model_id,
                "dim": expected_dim or 0,
                "chunks": chunk_count,
                "reused_chunks": completed_chunks,
                "embedded_chunks": 0,
            }

        embed_start = time.perf_counter()
        semaphore = embed_semaphore or asyncio.Semaphore(self._chunk_concurrency)
        dim_lock = asyncio.Lock()
        progress_lock = asyncio.Lock()

        async def embed_and_store(c: Chunk) -> None:
            nonlocal completed_chunks, expected_dim
            chunk_start = time.perf_counter()
            async with semaphore:
                vec = await self.llm.embed(
                    c.text,
                    user_id=user_id,
                    embedding_model_id=used_model_id,
                    strict_embedding_model_id=True,
                    timeout_sec=timeout_sec,
                    usage_endpoint=usage_endpoint,
                    request_id=request_id,
                )

            dim = len(vec) if vec else 0
            if dim <= 0:
                raise ValueError(
                    f"embedding returned empty vector for post {post_id} chunk {c.index}"
                )

            async with dim_lock:
                if expected_dim is None:
                    expected_dim = dim
                elif dim != expected_dim:
                    raise ValueError(
                        f"chunk #{c.index} dim={dim} differs from expected dim "
                        f"{expected_dim}; embedding model returned mixed-dim vectors"
                    )

            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO post_embeddings
                        (post_id, profile_id, model_id, dim, embedding, status,
                         chunk_index, chunk_text, parent_text, chunk_hash,
                         chunk_count, indexed_at)
                    VALUES ($1, $2, $3, $4, $5, 'shadow',
                            $6, $7, $8, $9, $10, NOW())
                    ON CONFLICT (post_id, profile_id, chunk_index) DO UPDATE
                    SET model_id = EXCLUDED.model_id,
                        dim = EXCLUDED.dim,
                        embedding = EXCLUDED.embedding,
                        status = EXCLUDED.status,
                        chunk_text = EXCLUDED.chunk_text,
                        parent_text = EXCLUDED.parent_text,
                        chunk_hash = EXCLUDED.chunk_hash,
                        chunk_count = EXCLUDED.chunk_count,
                        indexed_at = EXCLUDED.indexed_at
                    """,
                    post_id,
                    profile.id,
                    used_model_id,
                    dim,
                    vec,
                    c.index,
                    c.text,
                    c.parent_text,
                    expected_hashes[c.index],
                    chunk_count,
                )

            async with progress_lock:
                completed_chunks += 1
                done_chunks = completed_chunks
            if progress_cb:
                await progress_cb({
                    "type": "chunk_progress",
                    "postId": post_id,
                    "profile": profile.code,
                    "chunkIndex": c.index,
                    "doneChunks": done_chunks,
                    "totalChunks": chunk_count,
                    "status": "ok",
                    "elapsedMs": round((time.perf_counter() - chunk_start) * 1000, 2),
                })

        results = await asyncio.gather(
            *(embed_and_store(c) for c in missing_chunks),
            return_exceptions=True,
        )
        errors = [r for r in results if isinstance(r, Exception)]
        embed_ms = (time.perf_counter() - embed_start) * 1000
        if errors:
            logger.warning(
                "upsert.shadow_checkpoint_partial_failed",
                extra={"data": {
                    "post_id": post_id,
                    "profile": profile.code,
                    "content_len": content_len,
                    "chunks": chunk_count,
                    "completed_chunks": completed_chunks,
                    "embed_ms": round(embed_ms, 2),
                    "error": str(errors[0])[:200],
                }},
            )
            raise errors[0]

        logger.info(
            "upsert.shadow_checkpoint_ok",
            extra={"data": {
                "post_id": post_id,
                "profile": profile.code,
                "content_len": content_len,
                "chunks": chunk_count,
                "reused_chunks": len(valid_indices),
                "embedded_chunks": len(missing_chunks),
                "embed_ms": round(embed_ms, 2),
                "vector_dim": expected_dim or 0,
                "model_id": used_model_id,
            }},
        )
        return {
            "status": "indexed",
            "profile": profile.code,
            "model_id": used_model_id,
            "dim": expected_dim or 0,
            "chunks": chunk_count,
            "reused_chunks": len(valid_indices),
            "embedded_chunks": len(missing_chunks),
        }

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
                # 删所有 profile 下的 chunks（删文章了，没必要保留蓝绿 shadow）
                await conn.execute(
                    "DELETE FROM post_embeddings WHERE post_id = $1", post_id
                )
                await conn.execute(
                    "UPDATE posts SET embedding_status = 'PENDING' WHERE id = $1",
                    post_id,
                )
        return {"status": "deleted"}

    # ============================================================
    # Reindex —— 在当前 active profile 下重建所有文章
    # ============================================================
    #
    # profile 切换的真·蓝绿编排在 profiles.py 路由的 activate 流程里，
    # 见 activate_profile()。这里的 reindex() 仅负责"用当前 active profile
    # 重建所有文章"——同模型 / 同 chunker 配置下的纯刷新。

    async def reindex(self) -> dict[str, Any]:
        profile = await self.get_active_profile()
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, title, slug, content_markdown "
                "FROM posts "
                "WHERE deleted = FALSE AND status = 'PUBLISHED' "
                "ORDER BY id ASC"
            )

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
                    profile=profile,
                    target_status="active",
                )
                total += 1
            except Exception as exc:
                failed += 1
                logger.warning(
                    "reindex.post_failed",
                    extra={"data": {
                        "post_id": row["id"],
                        "profile": profile.code,
                        "error": str(exc)[:200],
                    }},
                )
        return {
            "status": "completed" if failed == 0 else "partial",
            "indexed": total,
            "failed": failed,
            "active_profile": profile.code,
            "model_id": profile.model_id,
        }

    # ============================================================
    # 结果格式化
    # ============================================================

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
