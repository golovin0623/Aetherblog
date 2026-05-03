"""Search Profile 管理路由（migration 000041）。

路由前缀：``/api/v1/admin/search/profiles``

提供给 admin（直接调）以及 Go backend（代理透传）：
  - GET    /            列出所有 profile
  - POST   /            创建 profile（status='shadow'）
  - POST   /{code}/activate    把 profile 翻成 active 并触发指针翻转
  - POST   /{code}/deprecate   把 profile 标 deprecated
  - DELETE /{code}             删除 profile（仅当 deprecated 且无关联向量行）

切换流程：
  1. POST /  创建新 profile  → status='shadow'
  2. POST /v1/admin/search/reindex?profileCode=<new>  按新 profile 全站建 shadow 行
  3. POST /{new}/activate  原子翻转 active 指针 + 旧 profile→deprecated
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_pg_pool, get_vector_store, require_admin
from app.schemas.common import ApiResponse
from app.schemas.search import CreateSearchProfileRequest, SearchProfileResponse

logger = logging.getLogger("ai-service")

router = APIRouter(prefix="/api/v1/admin/search/profiles", tags=["search-profiles"])


def _row_to_profile(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "description": row["description"],
        "modelId": row["model_id"],
        "chunkerKind": row["chunker_kind"],
        "chunkSizeTokens": row["chunk_size_tokens"],
        "chunkOverlapTokens": row["chunk_overlap_tokens"],
        "status": row["status"],
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
        "updatedAt": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


@router.get("", response_model=ApiResponse[list[SearchProfileResponse]])
async def list_profiles(
    user=Depends(require_admin),
    pool=Depends(get_pg_pool),
) -> ApiResponse[list[SearchProfileResponse]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, code, name, description, model_id, chunker_kind,
                   chunk_size_tokens, chunk_overlap_tokens, status,
                   created_at, updated_at
            FROM search_profiles
            ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'shadow' THEN 1 ELSE 2 END,
                created_at DESC
            """
        )
    return ApiResponse(data=[_row_to_profile(r) for r in rows])


@router.post("", response_model=ApiResponse[SearchProfileResponse])
async def create_profile(
    req: CreateSearchProfileRequest,
    user=Depends(require_admin),
    pool=Depends(get_pg_pool),
) -> ApiResponse[SearchProfileResponse]:
    """创建 profile，初始 status='shadow'。

    创建后 admin 需要：
      1. POST /v1/admin/search/reindex?profileCode=<code>  填充 shadow 行
      2. POST /v1/admin/search/profiles/<code>/activate    完成翻转
    """
    if req.chunkOverlapTokens >= req.chunkSizeTokens:
        raise HTTPException(
            status_code=400,
            detail="chunkOverlapTokens 必须小于 chunkSizeTokens",
        )
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO search_profiles
                    (code, name, description, model_id, chunker_kind,
                     chunk_size_tokens, chunk_overlap_tokens, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'shadow')
                RETURNING id, code, name, description, model_id, chunker_kind,
                          chunk_size_tokens, chunk_overlap_tokens, status,
                          created_at, updated_at
                """,
                req.code,
                req.name,
                req.description,
                req.modelId,
                req.chunkerKind,
                req.chunkSizeTokens,
                req.chunkOverlapTokens,
            )
        except Exception as exc:  # asyncpg.UniqueViolationError 等
            exc_name = type(exc).__name__
            if "UniqueViolation" in exc_name:
                raise HTTPException(
                    status_code=409,
                    detail=f"Profile code '{req.code}' 已存在",
                )
            if "CheckViolation" in exc_name:
                raise HTTPException(
                    status_code=400,
                    detail=f"参数违反 search_profiles 表约束：{exc}",
                )
            raise
    logger.info(
        "search_profile.created",
        extra={"data": {
            "code": req.code,
            "model_id": req.modelId,
            "chunker_kind": req.chunkerKind,
            "chunk_size_tokens": req.chunkSizeTokens,
            "chunk_overlap_tokens": req.chunkOverlapTokens,
        }},
    )
    return ApiResponse(data=_row_to_profile(row))


@router.post("/{code}/activate", response_model=ApiResponse[dict])
async def activate_profile(
    code: str,
    user=Depends(require_admin),
    pool=Depends(get_pg_pool),
    vector_store=Depends(get_vector_store),
) -> ApiResponse[dict]:
    """原子翻转 profile 为 active，旧 active→deprecated。

    前置条件：所有 PUBLISHED 文章必须在该 profile 下有 active|shadow 行。
    实施 "用户 ack 方案 A：严格阻塞，全部 reindex 完才生效"。
    """
    async with pool.acquire() as conn:
        target = await conn.fetchrow(
            "SELECT id, code, status FROM search_profiles WHERE code = $1", code
        )
        if not target:
            raise HTTPException(status_code=404, detail=f"Profile '{code}' 不存在")
        if target["status"] == "active":
            return ApiResponse(data={
                "status": "noop",
                "message": f"Profile '{code}' 已经是 active",
            })
        if target["status"] == "deprecated":
            raise HTTPException(
                status_code=400,
                detail=f"Profile '{code}' 已被弃用，无法直接激活；请先创建新 profile。",
            )

        # 检查 shadow 行覆盖：所有 PUBLISHED 文章是否都有该 profile 下的向量
        coverage = await conn.fetchrow(
            """
            SELECT
                (SELECT COUNT(*) FROM posts
                 WHERE deleted = FALSE AND status = 'PUBLISHED') AS published_total,
                (SELECT COUNT(DISTINCT post_id) FROM post_embeddings
                 WHERE profile_id = $1 AND status IN ('active', 'shadow')) AS indexed_total
            """,
            target["id"],
        )
        published_total = coverage["published_total"] or 0
        indexed_total = coverage["indexed_total"] or 0
        if indexed_total < published_total:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Profile '{code}' 仅覆盖 {indexed_total}/{published_total} 篇文章，"
                    "无法激活。请先 POST /v1/admin/search/reindex 全量 reindex 当前 profile。"
                ),
            )

        # 原子翻转：四步在单事务内
        async with conn.transaction():
            # (1) 旧 active profile → deprecated（包括表行 + 该 profile 的所有 post_embeddings 行）
            old_active = await conn.fetchrow(
                "SELECT id, code FROM search_profiles WHERE status = 'active'"
            )
            if old_active and old_active["id"] != target["id"]:
                await conn.execute(
                    "UPDATE search_profiles SET status = 'deprecated', updated_at = NOW() "
                    "WHERE id = $1",
                    old_active["id"],
                )
                await conn.execute(
                    "UPDATE post_embeddings SET status = 'deprecated' "
                    "WHERE profile_id = $1 AND status = 'active'",
                    old_active["id"],
                )

            # (2) 新 profile shadow → active（表行 + 该 profile 的所有 post_embeddings 行）
            await conn.execute(
                "UPDATE search_profiles SET status = 'active', updated_at = NOW() "
                "WHERE id = $1",
                target["id"],
            )
            await conn.execute(
                "UPDATE post_embeddings SET status = 'active' "
                "WHERE profile_id = $1 AND status = 'shadow'",
                target["id"],
            )

            # (3) 翻转 active_profile_code 指针
            await conn.execute(
                """
                INSERT INTO site_settings
                    (setting_key, setting_value, setting_type, group_name, description)
                VALUES ('search.active_profile_code', $1, 'STRING', 'search',
                    '当前活跃的 search profile 代码')
                ON CONFLICT (setting_key) DO UPDATE
                SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
                """,
                code,
            )
            # 同步更新旧 active_embedding_model 指针（90 天兼容）
            new_model_id = await conn.fetchval(
                "SELECT model_id FROM search_profiles WHERE id = $1", target["id"]
            )
            await conn.execute(
                """
                INSERT INTO site_settings
                    (setting_key, setting_value, setting_type, group_name, description)
                VALUES ('search.active_embedding_model', $1, 'STRING', 'search',
                    '当前活跃的 embedding 模型 ID')
                ON CONFLICT (setting_key) DO UPDATE
                SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
                """,
                new_model_id,
            )

            # (4) 把所有文章的 embedding_status 翻成 INDEXED
            await conn.execute(
                """
                UPDATE posts SET embedding_status = 'INDEXED'
                WHERE deleted = FALSE AND status = 'PUBLISHED' AND embedding_status <> 'INDEXED'
                """
            )

    logger.info(
        "search_profile.activated",
        extra={"data": {
            "code": code,
            "previous_active": old_active["code"] if old_active else None,
        }},
    )
    return ApiResponse(data={
        "status": "activated",
        "code": code,
        "previousActive": old_active["code"] if old_active else None,
    })


@router.post("/{code}/deprecate", response_model=ApiResponse[dict])
async def deprecate_profile(
    code: str,
    user=Depends(require_admin),
    pool=Depends(get_pg_pool),
) -> ApiResponse[dict]:
    """把 profile 标 deprecated（活跃 profile 不能直接弃用）。"""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, status FROM search_profiles WHERE code = $1", code
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Profile '{code}' 不存在")
        if row["status"] == "active":
            raise HTTPException(
                status_code=409,
                detail=f"Profile '{code}' 当前是 active，请先激活其他 profile 再弃用。",
            )
        async with conn.transaction():
            await conn.execute(
                "UPDATE search_profiles SET status = 'deprecated', updated_at = NOW() "
                "WHERE id = $1",
                row["id"],
            )
            # 同步把该 profile 的 post_embeddings 也标 deprecated
            await conn.execute(
                "UPDATE post_embeddings SET status = 'deprecated' "
                "WHERE profile_id = $1 AND status IN ('active', 'shadow')",
                row["id"],
            )
    logger.info("search_profile.deprecated", extra={"data": {"code": code}})
    return ApiResponse(data={"status": "deprecated", "code": code})


@router.delete("/{code}", response_model=ApiResponse[dict])
async def delete_profile(
    code: str,
    user=Depends(require_admin),
    pool=Depends(get_pg_pool),
) -> ApiResponse[dict]:
    """硬删除 profile。仅当 status='deprecated' 且无关联 post_embeddings 行。"""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, status FROM search_profiles WHERE code = $1", code
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Profile '{code}' 不存在")
        if row["status"] != "deprecated":
            raise HTTPException(
                status_code=409,
                detail=f"Profile '{code}' 必须先 deprecate 才能删除（当前 status={row['status']})。",
            )
        cnt = await conn.fetchval(
            "SELECT COUNT(*) FROM post_embeddings WHERE profile_id = $1", row["id"]
        )
        if cnt and cnt > 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Profile '{code}' 仍有 {cnt} 个向量行，删除会丢失回滚能力。"
                    "如确认要清理，请先 DELETE FROM post_embeddings WHERE profile_id=...。"
                ),
            )
        await conn.execute("DELETE FROM search_profiles WHERE id = $1", row["id"])
    logger.info("search_profile.deleted", extra={"data": {"code": code}})
    return ApiResponse(data={"status": "deleted", "code": code})
