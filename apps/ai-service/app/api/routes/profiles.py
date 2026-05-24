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

import asyncio
import json
import logging
import time
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api.deps import get_pg_pool, get_vector_store, require_admin
from app.core.config import get_settings
from app.schemas.common import ApiResponse
from app.schemas.search import CreateSearchProfileRequest, SearchProfileResponse

logger = logging.getLogger("ai-service")

router = APIRouter(prefix="/api/v1/admin/search/profiles", tags=["search-profiles"])

REINDEX_STREAM_HEARTBEAT_SEC = 15.0


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
    # chunker_kind 在 DB CHECK 约束里已硬定枚举,但 CHECK 抛错形态是 asyncpg.CheckViolationError,
    # 给用户的提示远不如这里就地拒绝来得清楚。
    allowed_chunkers = {"recursive", "fixed", "markdown", "qa", "parent_child"}
    if req.chunkerKind not in allowed_chunkers:
        raise HTTPException(
            status_code=400,
            detail=(
                f"chunkerKind '{req.chunkerKind}' 不支持,合法值: "
                f"{sorted(allowed_chunkers)}"
            ),
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
            # asyncpg 不是必装依赖,用名字而不是 isinstance 判断,避免 import 时机
            # 与可选依赖冲突。
            if "UniqueViolation" in exc_name:
                raise HTTPException(
                    status_code=409,
                    detail=f"Profile code '{req.code}' 已存在",
                )
            if "CheckViolation" in exc_name:
                raise HTTPException(
                    status_code=400,
                    detail=f"参数违反 search_profiles 表约束:{exc}",
                )
            if "ForeignKeyViolation" in exc_name:
                # 当前表无 FK,留作未来防御 —— 万一以后加 model_id REFERENCES ai_models
                raise HTTPException(
                    status_code=400,
                    detail=f"外键约束失败:{exc}",
                )
            if "UndefinedTable" in exc_name:
                # 极少触发(GET 已能确认表存在),但若 ai-service 与 Go backend 走两套 DB
                # 时这里能给出明确的迁移指引,而不是甩个 500。
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "search_profiles 表不存在 —— ai-service 连到的 Postgres "
                        "未跑 migration 000041。请到 server-go 容器执行 ./migrate up 或确认 "
                        "AETHERBLOG_POSTGRES_DSN 与 backend 一致。"
                    ),
                )
            if "DataError" in exc_name or "InvalidTextRepresentation" in exc_name:
                raise HTTPException(
                    status_code=400,
                    detail=f"字段格式不合法:{exc}",
                )
            # 兜底:把异常类型 + 截断 message 透出去给前端,避免变成不可调试的 500。
            logger.exception(
                "search_profile.create_failed",
                extra={"data": {
                    "exc_type": exc_name,
                    "code": req.code,
                    "model_id": req.modelId,
                    "chunker": req.chunkerKind,
                }},
            )
            raw = str(exc).strip()
            safe = raw[:200] + "…" if len(raw) > 200 else raw
            raise HTTPException(
                status_code=500,
                detail=f"创建 profile 失败({exc_name}):{safe}" if safe else f"创建 profile 失败({exc_name})",
            )
        if row is None:  # 理论上不会发生(INSERT...RETURNING 至少一行),保险
            raise HTTPException(
                status_code=500,
                detail="search_profiles INSERT...RETURNING 未返回结果",
            )
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

        # 检查 shadow 行覆盖：所有 PUBLISHED 文章都必须有完整 chunk 集合。
        # chunk_count 由写入端按当前切分结果记录；部分 chunk checkpoint
        # 不能被误判为可激活的完整文章。
        coverage = await conn.fetchrow(
            """
            WITH current_posts AS (
                SELECT id
                FROM posts
                WHERE deleted = FALSE
                  AND status = 'PUBLISHED'
            ),
            complete_posts AS (
                SELECT p.id AS post_id
                FROM current_posts p
                JOIN post_embeddings pe
                  ON pe.post_id = p.id
                 AND pe.profile_id = $1
                 AND pe.status IN ('active', 'shadow')
                GROUP BY p.id
                HAVING COUNT(*) > 0
                   AND COUNT(*) = MAX(COALESCE(pe.chunk_count, 1))
                   AND MIN(COALESCE(pe.chunk_count, 1)) = MAX(COALESCE(pe.chunk_count, 1))
            )
            SELECT
                (SELECT COUNT(*) FROM current_posts) AS published_total,
                (SELECT COUNT(*) FROM complete_posts) AS indexed_total
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
    settings=Depends(get_settings),
):
    """以 SSE 流式发送针对指定 profile 的全量 reindex 进度。

    端点强绑定单个 profile（蓝绿切换专用），URL 命名空间放在 ``/profiles/{code}``
    之下。旧的非流式 ``POST /v1/admin/search/reindex?profileCode=`` 保留兼容老调用。

    SSE 帧格式（与 admin ``useReindexStream`` 协商）：
        data: {"type":"start","total":N,"profile":<code>}
        data: {"type":"heartbeat","indexed":n,"failed":n,"total":N}
        data: {"type":"chunk_progress","postId":<id>,"doneChunks":n,"totalChunks":N}
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
        pending: set[asyncio.Task[dict]] = set()
        event_queue: asyncio.Queue[dict] = asyncio.Queue()

        async def enqueue_event(event: dict) -> None:
            await event_queue.put(event)

        async def cancel_pending_tasks() -> int:
            if not pending:
                return 0
            tasks = tuple(pending)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            pending.clear()
            return len(tasks)

        try:
            # 内存优化：不要一次把所有 PUBLISHED 文章的 content_markdown 拉进
            # 内存（数万篇 × 平均 20KB 正文 = 数百 MB，会让 ai-service OOM）。
            # 分两步走：
            #   1. 先 SELECT id（每行 8 byte）拿到 id 列表，用于 total + 顺序
            #   2. 处理每篇时单独 SELECT 一行 content_markdown（DB 仍是单连接，
            #      asyncpg 内部会复用 prepared statement，开销可控）
            # 这样即使 1 万篇博客也只会让 id 列表占 80KB 内存。
            async with pool.acquire() as conn:
                if profile.status == "shadow":
                    # 断点续跑：shadow profile 激活前若中途失败，已成功写入的
                    # shadow rows 保留。posts.updated_at 会被浏览量、embedding_status
                    # 等非内容更新刷新；在没有内容稳定时间戳/哈希前，只补齐缺失行，
                    # 避免最后 1 篇失败时从第 1 篇重新消耗 embedding。
                    id_rows = await conn.fetch(
                        """
                        SELECT p.id
                        FROM posts p
                        WHERE p.deleted = FALSE
                          AND p.status = 'PUBLISHED'
                          AND NOT EXISTS (
                              SELECT 1
                              FROM post_embeddings pe
                              WHERE pe.post_id = p.id
                                AND pe.profile_id = $1
                                AND pe.status IN ('active', 'shadow')
                              GROUP BY pe.post_id
                              HAVING COUNT(*) > 0
                                 AND COUNT(*) = MAX(COALESCE(pe.chunk_count, 1))
                                 AND MIN(COALESCE(pe.chunk_count, 1)) = MAX(COALESCE(pe.chunk_count, 1))
                          )
                        ORDER BY p.id ASC
                        """,
                        profile.id,
                    )
                else:
                    id_rows = await conn.fetch(
                        "SELECT id FROM posts "
                        "WHERE deleted = FALSE AND status = 'PUBLISHED' "
                        "ORDER BY id ASC"
                    )
            total = len(id_rows)
            yield _sse_pack({"type": "start", "total": total, "profile": code})

            indexed = 0
            failed = 0
            # 每篇文章内部仍由 vector_store 按 chunk 并发嵌入；这里再给“篇级”加并发，
            # 避免全量 reindex 被单线程串行拖慢。默认 5，可用环境变量调优：
            # AI_REINDEX_STREAM_POST_CONCURRENCY=...
            post_concurrency = max(1, int(settings.reindex_stream_post_concurrency or 5))
            embed_concurrency = max(1, int(getattr(vector_store, "chunk_concurrency", 5) or 5))
            # 所有 post 共享同一个 embedding semaphore，避免 post_concurrency *
            # chunk_concurrency 把上游 LLM 网关的实际并发放大。
            embed_semaphore = asyncio.Semaphore(embed_concurrency)

            async def process_one(i: int, post_id: int) -> dict:
                t0 = time.perf_counter()
                try:
                    # Per-post 取 content。中途若文章被删 / 改状态，fetchrow
                    # 返回 None，跳过并标 failed（避免 KeyError）。
                    async with pool.acquire() as conn:
                        post = await conn.fetchrow(
                            "SELECT id, title, slug, content_markdown FROM posts "
                            "WHERE id = $1 AND deleted = FALSE AND status = 'PUBLISHED'",
                            post_id,
                        )
                    if not post:
                        return {
                            "type": "progress",
                            "postId": post_id,
                            "index": i,
                            "chunks": 0,
                            "status": "failed",
                            "error": "post no longer PUBLISHED",
                            "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
                        }

                    result = await vector_store.upsert_post_embedding(
                        post_id=post["id"],
                        title=post["title"],
                        slug=post["slug"],
                        content=post["content_markdown"] or "",
                        metadata={"status": "PUBLISHED"},
                        profile=profile,
                        target_status=target_status,
                        embed_semaphore=embed_semaphore,
                        progress_cb=enqueue_event,
                    )
                    return {
                        "type": "progress",
                        "postId": post["id"],
                        "index": i,
                        "chunks": result.get("chunks", 0),
                        "status": "ok",
                        "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
                    }
                except Exception as exc:
                    # 错误消息截断 200 字符避免把堆栈泄露到前端 UI
                    return {
                        "type": "progress",
                        "postId": post_id,
                        "index": i,
                        "chunks": 0,
                        "status": "failed",
                        "error": str(exc)[:200],
                        "elapsedMs": round((time.perf_counter() - t0) * 1000, 2),
                    }

            next_idx = 1
            while next_idx <= total or pending or not event_queue.empty():
                while next_idx <= total and len(pending) < post_concurrency:
                    post_id = id_rows[next_idx - 1]["id"]
                    pending.add(asyncio.create_task(process_one(next_idx, post_id)))
                    next_idx += 1

                if not pending and event_queue.empty():
                    continue

                queue_task = asyncio.create_task(event_queue.get())
                wait_set: set[asyncio.Task] = set(pending)
                wait_set.add(queue_task)
                done, _ = await asyncio.wait(
                    wait_set,
                    timeout=REINDEX_STREAM_HEARTBEAT_SEC,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    if queue_task.done():
                        yield _sse_pack(queue_task.result())
                        continue
                    queue_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await queue_task
                    yield _sse_pack({
                        "type": "heartbeat",
                        "profile": code,
                        "indexed": indexed,
                        "failed": failed,
                        "total": total,
                        "inFlight": len(pending),
                    })
                    continue
                if queue_task in done:
                    yield _sse_pack(queue_task.result())
                    done.remove(queue_task)
                else:
                    if queue_task.done():
                        yield _sse_pack(queue_task.result())
                    else:
                        queue_task.cancel()
                        with suppress(asyncio.CancelledError):
                            await queue_task
                for task in done:
                    pending.discard(task)
                    try:
                        event = task.result()
                    except Exception as exc:
                        failed += 1
                        yield _sse_pack({
                            "type": "progress",
                            "postId": 0,
                            "index": 0,
                            "chunks": 0,
                            "status": "failed",
                            "error": f"worker error: {str(exc)[:160]}",
                            "elapsedMs": 0,
                        })
                        continue
                    if event.get("status") == "ok":
                        indexed += 1
                    else:
                        failed += 1
                    yield _sse_pack(event)

            yield _sse_pack({"type": "result", "data": {
                "profile": code,
                "indexed": indexed,
                "failed": failed,
                "target_status": target_status,
            }})
            yield _sse_pack({"type": "done"})
        except asyncio.CancelledError:
            # 客户端中断连接（比如手动点击“中止”）时，确保后台 task 被回收。
            cancelled = await cancel_pending_tasks()
            logger.info(
                "reindex_stream.client_cancelled",
                extra={"data": {"profile": code, "cancelled_tasks": cancelled}},
            )
            raise
        except Exception as exc:
            await cancel_pending_tasks()
            # DB 连接 / 池获取 / 任何 per-post try 之外的异常都落到这里。
            # message 截断 200 字符避免把堆栈泄露到前端 UI。
            logger.warning(
                "reindex_stream.fatal",
                extra={"data": {"profile": code, "error": str(exc)[:200]}},
            )
            yield _sse_pack({"type": "error", "message": str(exc)[:200]})
        finally:
            await cancel_pending_tasks()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )
