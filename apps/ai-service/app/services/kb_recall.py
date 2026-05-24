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
from typing import Any

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
        try:
            profile = await fetch_kb_active_profile(pool, kb_id)
        except Exception as exc:
            logger.warning("kb_recall.profile_missing", extra={"data": {"kb_id": kb_id, "error": str(exc)[:200]}})
            return []
        try:
            embedding = await llm.embed(query)
        except Exception as exc:
            logger.warning("kb_recall.embed_failed", extra={"data": {"kb_id": kb_id, "error": str(exc)[:200]}})
            return []
        dim = len(embedding) if embedding else 0
        if dim <= 0:
            return []
        cast_type = "halfvec" if dim > 2000 else "vector"
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
                    c.kb_file_id,
                    c.chunk_index,
                    c.similarity,
                    COALESCE(c.parent_text, c.chunk_text) AS snippet,
                    f.title AS file_title,
                    kb.slug AS kb_slug,
                    kb.name AS kb_name
                FROM cands c
                JOIN kb_files f ON f.id = c.kb_file_id
                JOIN knowledge_bases kb ON kb.id = f.kb_id
                WHERE c.similarity >= $6
                ORDER BY c.similarity DESC
                LIMIT $7
                """,
                embedding, kb_id, profile.id, dim,
                candidate_limit, profile.score_threshold, profile.top_k,
            )
        return [
            KBHit(
                kb_id=kb_id,
                kb_slug=r["kb_slug"],
                kb_name=r["kb_name"],
                kb_file_id=r["kb_file_id"],
                file_title=r["file_title"],
                chunk_index=r["chunk_index"],
                snippet=r["snippet"] or "",
                similarity=float(r["similarity"]),
            )
            for r in rows
        ]

    chunks_of_hits = await asyncio.gather(*(recall_one(k) for k in kb_ids), return_exceptions=False)
    for hits in chunks_of_hits:
        results.extend(hits)
    results.sort(key=lambda h: h.similarity, reverse=True)
    return results[:top_k_total]


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
