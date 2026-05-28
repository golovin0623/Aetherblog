"""KB 召回：根据 kb_ids + 查询文本检索 top-k chunk，供灵境对话 RAG 注入上下文。

设计：
    * 并行处理每个 KB（asyncio.gather）
    * 每个 KB 用其 active profile 解析 model_id / chunker（默认 top_k=6 / threshold=0.20）
    * 对每个 KB embed 查询一次（profile.model_id 相同时复用，但 Phase1 简化不去重 ——
      召回 RT 已经走 ANN 不构成瓶颈）
    * pgvector ANN 找候选；按 (chunk_text, parent_text) 合成 snippet
    * 汇总后按 similarity 全局降序，返回 top_k 命中
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from app.services.llm_router import LlmRouter
from app.services.kb_indexer import fetch_kb_active_profile

logger = logging.getLogger("ai-service")


@dataclass
class KBHit:
    kb_id: int
    kb_slug: str
    kb_name: str
    kb_file_id: int
    file_title: str | None
    chunk_index: int
    snippet: str
    similarity: float


async def recall_kbs(
    pool,
    llm: LlmRouter,
    *,
    kb_ids: list[int],
    query: str,
    top_k_total: int = 12,
) -> list[KBHit]:
    """对若干 KB 做语义召回，返回合并后的 top_k。

    每个 KB 内部按其 active profile 的 top_k 拉候选；
    全局按 similarity 降序取 top_k_total。
    """
    if not kb_ids or not query.strip():
        return []

    # 去重 + 限上限
    kb_ids = list(dict.fromkeys(kb_ids))[:10]
    results: list[KBHit] = []

    async def recall_one(kb_id: int) -> list[KBHit]:
        # 先查 KB 元数据决定走哪条数据源（review chatgpt-codex P1 修复）：
        #   * SYSTEM_POSTS：博客文章索引库 —— 数据在 post_embeddings + search_profiles
        #   * CUSTOM：用户自建库 —— 数据在 kb_embeddings + kb_profiles
        async with pool.acquire() as conn:
            kb_row = await conn.fetchrow(
                "SELECT slug, name, kind FROM knowledge_bases WHERE id = $1",
                kb_id,
            )
        if not kb_row:
            return []
        if kb_row["kind"] == "SYSTEM_POSTS":
            return await _recall_system_posts(pool, llm, kb_id, kb_row, query)
        return await _recall_custom_kb(pool, llm, kb_id, kb_row, query)

    # review gemini medium：单个 KB 召回失败（DB 抖动 / profile 缺失）不应让整个
    # RAG 流程崩；用 return_exceptions=True 收集，过滤掉异常分支。
    chunks_of_hits = await asyncio.gather(
        *(recall_one(k) for k in kb_ids),
        return_exceptions=True,
    )
    for kb_id, item in zip(kb_ids, chunks_of_hits):
        if isinstance(item, BaseException):
            logger.warning(
                "kb_recall.partial_failure",
                extra={"data": {"kb_id": kb_id, "error": f"{type(item).__name__}: {item}"[:240]}},
            )
            continue
        results.extend(item)
    results.sort(key=lambda h: h.similarity, reverse=True)
    return results[:top_k_total]


def _cast_type_for_dim(dim: int) -> str:
    """按维度选择 pgvector cast type（halfvec 上限 4000，超限 fallback vector）。"""
    if dim > 4000:
        return "vector"
    if dim > 2000:
        return "halfvec"
    return "vector"


async def _recall_custom_kb(pool, llm: LlmRouter, kb_id: int, kb_row, query: str) -> list[KBHit]:
    """CUSTOM 库召回：走 kb_embeddings + kb_profiles。"""
    try:
        profile = await fetch_kb_active_profile(pool, kb_id)
    except Exception as exc:
        logger.warning("kb_recall.profile_missing", extra={"data": {"kb_id": kb_id, "error": str(exc)[:200]}})
        return []
    try:
        embedding = await llm.embed(
            query,
            embedding_model_id=profile.model_id,
            strict_embedding_model_id=True,
        )
    except Exception as exc:
        logger.warning("kb_recall.embed_failed", extra={"data": {"kb_id": kb_id, "error": str(exc)[:200]}})
        return []
    dim = len(embedding) if embedding else 0
    if dim <= 0:
        return []
    cast_type = _cast_type_for_dim(dim)
    candidate_limit = min(max(profile.top_k * 3, 20), 100)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            WITH cands AS (
                SELECT
                    ke.kb_file_id,
                    ke.chunk_index,
                    ke.chunk_text,
                    ke.parent_text,
                    1 - (ke.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})) AS similarity
                FROM kb_embeddings ke
                WHERE ke.kb_id = $2
                  AND ke.profile_id = $3
                  AND ke.status = 'active'
                  AND ke.embedding_dim = $4
                ORDER BY ke.embedding::{cast_type}({dim}) <=> $1::{cast_type}({dim})
                LIMIT $5
            )
            SELECT
                c.kb_file_id, c.chunk_index, c.similarity,
                COALESCE(c.parent_text, c.chunk_text) AS snippet,
                f.title AS file_title
            FROM cands c
            JOIN kb_files f ON f.id = c.kb_file_id
            WHERE c.similarity >= $6
            ORDER BY c.similarity DESC
            LIMIT $7
            """,
            embedding, kb_id, profile.id, dim,
            candidate_limit, profile.score_threshold, profile.top_k,
        )
    return [
        KBHit(
            kb_id=kb_id, kb_slug=kb_row["slug"], kb_name=kb_row["name"],
            kb_file_id=r["kb_file_id"], file_title=r["file_title"],
            chunk_index=r["chunk_index"],
            snippet=r["snippet"] or "",
            similarity=float(r["similarity"]),
        )
        for r in rows
    ]


async def _recall_system_posts(pool, llm: LlmRouter, kb_id: int, kb_row, query: str) -> list[KBHit]:
    """SYSTEM_POSTS 库召回：走 post_embeddings + search_profiles。

    与博客文章语义搜索同源（migration 000034 / 000041）。这里只取召回结果而不
    走 vector_store.semantic_search 是为了：
      1. 复用本模块的 KBHit 结构 → 与 CUSTOM 召回结果同形态合并
      2. 不强制 vector_store 全套权限/usage_logging 流程（agent chat 已自己管）
    """
    async with pool.acquire() as conn:
        prof = await conn.fetchrow(
            """
            SELECT id, model_id, chunker_kind, chunk_size_tokens, chunk_overlap_tokens
            FROM search_profiles WHERE status = 'active' LIMIT 1
            """,
        )
    if not prof:
        logger.warning("kb_recall.system_posts.no_search_profile", extra={"data": {"kb_id": kb_id}})
        return []
    try:
        embedding = await llm.embed(
            query,
            embedding_model_id=prof["model_id"],
            strict_embedding_model_id=True,
        )
    except Exception as exc:
        logger.warning("kb_recall.system_posts.embed_failed", extra={"data": {"kb_id": kb_id, "error": str(exc)[:200]}})
        return []
    dim = len(embedding) if embedding else 0
    if dim <= 0:
        return []
    cast_type = _cast_type_for_dim(dim)
    # SYSTEM_POSTS 召回沿用 search 模块的全局配置默认值：top_k=6, threshold=0.20。
    # 这与 vector_store.semantic_search 默认值一致；UI 可在 Phase 3 暴露到 admin
    # 让用户调整（同 CUSTOM 库的 kb_profiles.top_k / score_threshold）。
    top_k = 6
    threshold = 0.20
    candidate_limit = min(max(top_k * 3, 20), 100)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            WITH cands AS (
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
            )
            SELECT
                c.post_id, c.chunk_index, c.similarity,
                COALESCE(c.parent_text, c.chunk_text) AS snippet,
                p.title AS file_title
            FROM cands c
            JOIN posts p ON p.id = c.post_id
            WHERE p.deleted = FALSE
              AND p.status = 'PUBLISHED'
              AND p.password IS NULL
              AND p.is_hidden = FALSE
              AND c.similarity >= $5
            ORDER BY c.similarity DESC
            LIMIT $6
            """,
            embedding, prof["id"], dim, candidate_limit, threshold, top_k,
        )
    return [
        KBHit(
            kb_id=kb_id, kb_slug=kb_row["slug"], kb_name=kb_row["name"],
            # 用 post_id 作为 kb_file_id（仅前端展示用，不参与 join），
            # render_kb_context 不区分；UI 后续可按 file_title 跳到文章。
            kb_file_id=r["post_id"], file_title=r["file_title"],
            chunk_index=r["chunk_index"],
            snippet=r["snippet"] or "",
            similarity=float(r["similarity"]),
        )
        for r in rows
    ]


def render_kb_context(hits: list[KBHit], max_chars: int = 12000) -> str | None:
    """把召回结果渲染为 system message 文本块。

    格式：
        # 知识库召回（top-N 片段）
        ## [KB名称] · 文件: <title> · chunk #<idx> · score=0.83
        <snippet>

    超过 max_chars 后停止追加，避免吃光 LLM context window。
    """
    if not hits:
        return None
    parts = ["# 知识库召回（按相关度排序，请优先基于以下片段作答；引用时附上知识库与文件名）"]
    total = len(parts[0])
    for h in hits:
        header = f"## [{h.kb_name}] · 文件: {h.file_title or '(未命名)'} · chunk #{h.chunk_index} · score={h.similarity:.2f}"
        snippet = h.snippet.strip()
        block = header + "\n" + snippet
        if total + len(block) > max_chars:
            parts.append("…（剩余片段超出上下文上限，已截断）")
            break
        parts.append(block)
        total += len(block) + 2
    return "\n\n".join(parts)
