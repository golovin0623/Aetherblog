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

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api.deps import get_pg_pool, get_vector_store, require_admin
from app.schemas.common import ApiResponse
from app.schemas.search import CreateSearchProfileRequest, SearchProfileResponse

logger = logging.getLogger("ai-service")

router = APIRouter(prefix="/api/v1/admin/search/profiles", tags=["search-profiles"])


def _sse_pack(obj: dict) -> str:
    """SSE 帧序列化。``json.dumps`` 不要 escape 中文，让 admin UI 直接渲染。"""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


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


@router.post("/{code}/reindex/stream")
async def reindex_profile_stream(
    code: str,
    user=Depends(require_admin),
    pool=Depends(get_pg_pool),
    vector_store=Depends(get_vector_store),
):
    """以 SSE 流式发送针对指定 profile 的全量 reindex 进度。

    端点强绑定单个 profile（蓝绿切换专用），URL 命名空间放在 ``/profiles/{code}``
    之下。旧的非流式 ``POST /v1/admin/search/reindex?profileCode=`` 保留兼容老调用。

    SSE 帧格式（与 admin ``useReindexStream`` 协商）：
        data: {"type":"start","total":N,"profile":<code>}
        data: {"type":"progress","postId":<id>,"index":i,"chunks":<n>,
               "status":"ok"|"failed","error"?:..,"elapsedMs":..}
        data: {"type":"result","data":{...}}
        data: {"type":"done"}
        data: {"type":"error","message":...}

    注意 ``X-Accel-Buffering: no``：必须显式发，否则 nginx 会按默认 8KB
    缓冲攒够才推一次，admin UI 进度条会出现"卡住—瀑布"现象。
    """
    profile = await vector_store._fetch_profile_by_code(code)
    if not profile:
        raise HTTPException(404, f"Profile '{code}' 不存在")
    if profile.status == "deprecated":
        raise HTTPException(400, f"Profile '{code}' 已弃用，无法重建索引")
    target_status = "active" if profile.status == "active" else "shadow"

    async def gen():
        # 整个生成器包一层 try/except：StreamingResponse 一旦开始返回就是
        # 200 OK，期间任何未捕获异常会让 SSE 连接被截断，前端只能感知
        # "连接关闭"而不知道发生了什么。显式 yield 一个 error 事件让
        # useReindexStream 能优雅处理（写 error state、停 isRunning）。
        try:
            async with pool.acquire() as conn:
                posts = await conn.fetch(
                    "SELECT id, title, slug, content_markdown FROM posts "
                    "WHERE deleted = FALSE AND status = 'PUBLISHED' "
                    "ORDER BY id ASC"
                )
            total = len(posts)
            yield _sse_pack({"type": "start", "total": total, "profile": code})

            indexed = 0
            failed = 0
            for i, p in enumerate(posts, 1):
                t0 = time.perf_counter()
                try:
                    result = await vector_store.upsert_post_embedding(
                        post_id=p["id"],
                        title=p["title"],
                        slug=p["slug"],
                        content=p["content_markdown"] or "",
                        metadata={"status": "PUBLISHED"},
                        profile=profile,
                        target_status=target_status,
                    )
                    indexed += 1
                    yield _sse_pack({
                        "type": "progress",
                        "postId": p["id"],
                        "index": i,
                        "chunks": result.get("chunks", 0),
                        "status": "ok",
                        "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
                    })
                except Exception as exc:
                    failed += 1
                    # 错误消息截断 200 字符避免把堆栈泄露到前端 UI
                    yield _sse_pack({
                        "type": "progress",
                        "postId": p["id"],
                        "index": i,
                        "chunks": 0,
                        "status": "failed",
                        "error": str(exc)[:200],
                        "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
                    })

            yield _sse_pack({"type": "result", "data": {
                "profile": code,
                "indexed": indexed,
                "failed": failed,
                "target_status": target_status,
            }})
            yield _sse_pack({"type": "done"})
        except Exception as exc:
            # DB 连接 / 池获取 / 任何 per-post try 之外的异常都落到这里。
            # message 截断 200 字符避免把堆栈泄露到前端 UI。
            logger.warning(
                "reindex_stream.fatal",
                extra={"data": {"profile": code, "error": str(exc)[:200]}},
            )
            yield _sse_pack({"type": "error", "message": str(exc)[:200]})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )
