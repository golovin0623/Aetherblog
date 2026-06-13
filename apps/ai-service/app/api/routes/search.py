from __future__ import annotations

import logging
import time
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, Query, Request, HTTPException, status

from app.api.deps import (
    get_llm_router,
    get_metrics,
    get_pg_pool,
    get_usage_logger,
    get_vector_store,
    rate_limit,
    require_admin,
    require_admin_or_internal,
)
from app.core.config import get_settings
from app.schemas.common import ApiResponse
from app.schemas.search import IndexRequest, ReindexRequest, SemanticSearchData
from app.services.metrics import MetricsStore
from app.services.usage_logger import UsageLogger, estimate_tokens

logger = logging.getLogger(__name__)


# ref: §5.4
router = APIRouter(tags=["search"])
settings = get_settings()


_QA_SEMANTIC_LIMIT = 3
_QA_FALLBACK_POST_LIMIT = 6
_QA_FALLBACK_TAXONOMY_LIMIT = 10
_QA_EXCERPT_MAX_CHARS = 700
_QA_CONTEXT_MAX_CHARS = 12000
_QA_LOGIN_AUTH_URL = "/agent/login?next=/agent/workspace"
_QA_AUTH_FALLBACK_ANSWER = (
    "公开内容里暂时没有找到可回答的文章。登录并进入 Agent 工作台后，"
    "可以授权 AI 读取你账号可见的共享文章和知识库，再继续提问。"
)
_QA_AUTH_HINT = {
    "message": "登录后可在 Agent 工作台授权读取你可见的文章和知识库。",
    "loginUrl": _QA_LOGIN_AUTH_URL,
    "workspaceUrl": "/agent/workspace",
    "label": "登录授权",
}


def _enforce_content_limit(content: str) -> None:
    size = len(content)
    if size > settings.max_input_chars:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Content too large: {size} chars exceeds {settings.max_input_chars} limit",
        )


def _escape_like(value: str) -> str:
    return (
        value
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


def _trim_text(value: Any, max_chars: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "..."


def _row_get(row: Any, key: str, default: Any = None) -> Any:
    try:
        return row[key]
    except (KeyError, TypeError):
        if isinstance(row, dict):
            return row.get(key, default)
        return getattr(row, key, default)


async def _fetch_public_qa_keyword_rows(pool, query: str, limit: int = _QA_FALLBACK_POST_LIMIT) -> list[Any]:
    pattern = f"%{_escape_like(query.strip())}%"
    async with pool.acquire() as conn:
        return list(await conn.fetch(
            """
            SELECT
                p.id,
                p.title,
                p.slug,
                p.summary,
                LEFT(COALESCE(p.content_markdown, ''), $2) AS excerpt,
                c.name AS category
            FROM posts p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.deleted = FALSE
              AND p.status = 'PUBLISHED'
              AND p.is_hidden = FALSE
              AND p.password IS NULL
              AND (
                p.title ILIKE $1 ESCAPE '\\'
                OR COALESCE(p.summary, '') ILIKE $1 ESCAPE '\\'
                OR COALESCE(p.content_markdown, '') ILIKE $1 ESCAPE '\\'
                OR COALESCE(c.name, '') ILIKE $1 ESCAPE '\\'
                OR EXISTS (
                    SELECT 1
                    FROM post_tags pt
                    JOIN tags t ON t.id = pt.tag_id
                    WHERE pt.post_id = p.id
                      AND (t.name ILIKE $1 ESCAPE '\\' OR t.slug ILIKE $1 ESCAPE '\\')
                )
              )
            ORDER BY p.published_at DESC NULLS LAST, p.id DESC
            LIMIT $3
            """,
            pattern,
            _QA_EXCERPT_MAX_CHARS,
            limit,
        ))


async def _fetch_public_qa_overview(pool, limit: int = _QA_FALLBACK_POST_LIMIT) -> tuple[list[Any], list[Any], list[Any]]:
    async with pool.acquire() as conn:
        recent_posts = list(await conn.fetch(
            """
            SELECT
                p.id,
                p.title,
                p.slug,
                p.summary,
                LEFT(COALESCE(p.content_markdown, ''), $1) AS excerpt,
                c.name AS category
            FROM posts p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.deleted = FALSE
              AND p.status = 'PUBLISHED'
              AND p.is_hidden = FALSE
              AND p.password IS NULL
            ORDER BY p.published_at DESC NULLS LAST, p.id DESC
            LIMIT $2
            """,
            _QA_EXCERPT_MAX_CHARS,
            limit,
        ))
        categories = list(await conn.fetch(
            """
            SELECT c.name, COUNT(*)::int AS post_count
            FROM categories c
            JOIN posts p ON p.category_id = c.id
            WHERE p.deleted = FALSE
              AND p.status = 'PUBLISHED'
              AND p.is_hidden = FALSE
              AND p.password IS NULL
            GROUP BY c.id, c.name
            ORDER BY post_count DESC, c.name ASC
            LIMIT $1
            """,
            _QA_FALLBACK_TAXONOMY_LIMIT,
        ))
        tags = list(await conn.fetch(
            """
            SELECT t.name, COUNT(*)::int AS post_count
            FROM tags t
            JOIN post_tags pt ON pt.tag_id = t.id
            JOIN posts p ON p.id = pt.post_id
            WHERE p.deleted = FALSE
              AND p.status = 'PUBLISHED'
              AND p.is_hidden = FALSE
              AND p.password IS NULL
            GROUP BY t.id, t.name
            ORDER BY post_count DESC, t.name ASC
            LIMIT $1
            """,
            _QA_FALLBACK_TAXONOMY_LIMIT,
        ))
    return recent_posts, categories, tags


def _render_public_qa_rows(title: str, rows: list[Any]) -> tuple[list[str], list[dict[str, str]]]:
    parts = [title]
    sources: list[dict[str, str]] = []
    for row in rows:
        post_title = str(_row_get(row, "title", "") or "").strip()
        slug = str(_row_get(row, "slug", "") or "").strip()
        summary = _trim_text(_row_get(row, "summary"), 220)
        excerpt = _trim_text(_row_get(row, "excerpt"), _QA_EXCERPT_MAX_CHARS)
        category = str(_row_get(row, "category", "") or "").strip()
        if not post_title:
            continue
        header = f"## {post_title}"
        if slug:
            header += f"\nURL: /posts/{slug}"
            sources.append({"title": post_title, "slug": slug})
        if category:
            header += f"\nCategory: {category}"
        body_parts = [header]
        if summary:
            body_parts.append(f"Summary: {summary}")
        if excerpt:
            body_parts.append(excerpt)
        parts.append("\n".join(body_parts))
    return parts, sources


def _render_taxonomy_section(title: str, rows: list[Any]) -> list[str]:
    items: list[str] = []
    for row in rows:
        name = str(_row_get(row, "name", "") or "").strip()
        if not name:
            continue
        count = _row_get(row, "post_count", 0)
        items.append(f"- {name} ({count} 篇)")
    if not items:
        return []
    return [title, *items]


async def _build_public_qa_fallback_context(pool, query: str) -> tuple[str | None, list[dict[str, str]]]:
    """Build public-only fallback context for the blog search QA panel.

    This endpoint is public, so fallback data must stay within public,
    published, non-hidden, non-password posts.
    """
    query = query.strip()
    if not query:
        return None, []

    try:
        keyword_rows = await _fetch_public_qa_keyword_rows(pool, query)
        if keyword_rows:
            parts, sources = _render_public_qa_rows("## 关键词回退命中的公开文章", keyword_rows)
            prefix = (
                "# 公开文章检索回退\n"
                "语义检索没有返回可用片段，以下内容来自公开、未隐藏、无密码文章。"
                "若它们只能部分回答问题，请说明依据范围。"
            )
            context = prefix + "\n\n" + "\n\n".join(parts)
            return _trim_text(context, _QA_CONTEXT_MAX_CHARS), sources

        recent_posts, categories, tags = await _fetch_public_qa_overview(pool)
    except Exception as exc:  # noqa: BLE001 - fallback failure must not break QA streaming
        logger.warning("search.qa_fallback_failed", extra={"data": {"error": str(exc)[:240]}})
        return None, []

    if not recent_posts and not categories and not tags:
        return None, []

    parts: list[str] = [
        "# 公开文章概览回退",
        (
            "语义检索与关键词检索未找到精确片段。以下是博客当前公开、未隐藏、无密码内容的概览。"
            "用户询问博客覆盖领域时，请基于分类、标签和近期文章回答；不要声称博客没有内容。"
        ),
    ]
    taxonomy = _render_taxonomy_section("## 高频分类", categories)
    if taxonomy:
        parts.extend(taxonomy)
    tag_section = _render_taxonomy_section("## 高频标签", tags)
    if tag_section:
        parts.extend(tag_section)
    post_parts, sources = _render_public_qa_rows("## 最近公开文章", recent_posts)
    parts.extend(post_parts)
    context = "\n\n".join(parts)
    return _trim_text(context, _QA_CONTEXT_MAX_CHARS), sources


async def _log_usage(
    *,
    request: Request,
    metrics: MetricsStore,
    usage_logger: UsageLogger,
    user_id: str,
    model: str,
    request_text: str,
    response_text: str,
    start_time: float,
    success: bool,
    cached: bool,
    error_code: str | None,
) -> None:
    duration_ms = (time.perf_counter() - start_time) * 1000
    tokens_in = estimate_tokens(request_text)
    tokens_out = estimate_tokens(response_text)
    metrics.record(
        endpoint=request.url.path,
        duration_ms=duration_ms,
        success=success,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        model=model,
        cached=cached,
    )
    await usage_logger.record(
        user_id=user_id,
        endpoint=request.url.path,
        model=model,
        request_chars=len(request_text),
        response_chars=len(response_text),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=int(duration_ms),
        success=success,
        cached=cached,
        error_code=error_code,
        request_id=getattr(request.state, "request_id", None),
    )


@router.get("/api/v1/search/semantic", response_model=ApiResponse[SemanticSearchData])
async def semantic_search(
    request: Request,
    q: str = Query(min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
    user=Depends(rate_limit),
    vector_store=Depends(get_vector_store),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[SemanticSearchData]:
    _enforce_content_limit(q)
    start_time = time.perf_counter()
    error_code = None
    model = "unknown"
    try:
        # 语义搜索必须使用 active search profile 的模型；否则查询向量和索引向量
        # 可能来自不同 embedding 模型，召回会稳定返回空。
        profile = await vector_store.get_active_profile()
        model = profile.model_id
        results = await vector_store.semantic_search(q, limit, profile=profile)
        return ApiResponse(data=SemanticSearchData(results=results))
    except Exception as exc:
        error_code = str(exc)
        raise
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user.user_id,
            model=model,
            request_text=q,
            response_text="",
            start_time=start_time,
            success=error_code is None,
            cached=False,
            error_code=error_code,
        )


@router.post("/api/v1/admin/search/reindex")
async def reindex(
    request: Request,
    req: ReindexRequest,
    profileCode: str | None = Query(default=None, description="目标 profile code；不传则用当前 active profile"),
    user=Depends(require_admin_or_internal),
    vector_store=Depends(get_vector_store),
    pool=Depends(get_pg_pool),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[dict]:
    """全量 reindex。

    profileCode=None: 使用当前 active profile（同 chunker / 同 model 的纯刷新）。
    profileCode=<code>: 指向 shadow profile，用于蓝绿切换；写入 status='shadow' 行，
        全部成功后调用方需另行 POST /v1/admin/search/profiles/{code}/activate 翻转指针。
    """
    start_time = time.perf_counter()
    error_code = None
    model = "unknown"
    try:
        if profileCode:
            # 蓝绿模式：把目标 profile 当成 shadow 写
            profile = await vector_store._fetch_profile_by_code(profileCode)
            if not profile:
                raise HTTPException(
                    status_code=404,
                    detail=f"Profile '{profileCode}' 不存在",
                )
            model = profile.model_id
            target_status = "active" if profile.status == "active" else "shadow"
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT id, title, slug, content_markdown FROM posts "
                    "WHERE deleted = FALSE AND status = 'PUBLISHED' "
                    "ORDER BY id ASC"
                )
            indexed = 0
            failed = 0
            for row in rows:
                try:
                    await vector_store.upsert_post_embedding(
                        post_id=row["id"],
                        title=row["title"],
                        slug=row["slug"],
                        content=row["content_markdown"] or "",
                        metadata={"status": "PUBLISHED"},
                        profile=profile,
                        target_status=target_status,
                    )
                    indexed += 1
                except Exception as exc:
                    failed += 1
                    import logging as _lg
                    _lg.getLogger("ai-service").warning(
                        "reindex.profile_post_failed",
                        extra={"data": {
                            "post_id": row["id"],
                            "profile": profile.code,
                            "target_status": target_status,
                            "error": str(exc)[:200],
                        }},
                    )
            result = {
                "status": "completed" if failed == 0 else "partial",
                "indexed": indexed,
                "failed": failed,
                "profile": profile.code,
                "model_id": profile.model_id,
                "target_status": target_status,
            }
        else:
            profile = await vector_store.get_active_profile()
            model = profile.model_id
            result = await vector_store.reindex()
        return ApiResponse(data=result)
    except Exception as exc:
        error_code = str(exc)
        raise
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user.user_id,
            model=model,
            request_text=req.mode,
            response_text="",
            start_time=start_time,
            success=error_code is None,
            cached=False,
            error_code=error_code,
        )


@router.post("/api/v1/admin/search/index")
async def index_post(
    request: Request,
    req: IndexRequest,
    user=Depends(require_admin_or_internal),
    vector_store=Depends(get_vector_store),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
    pool=Depends(get_pg_pool),
) -> ApiResponse[dict]:
    """
    为单篇文章建索引（Go 后端在批处理中按篇调用）。

    重要：LiteLLM 异常（provider 5xx、auth、rate limit）必须在这里捕获并
    转换为结构化的 ApiResponse。如果直接抛出会触发 FastAPI 的
    unhandled_exception 路径，向日志吐出完整 ASGI traceback 并向 Go 后端
    返回 500 —— 这比干净的 502/503/401 + 简短错误消息更难看也更难排查。
    """
    import logging as _logging

    _logger = _logging.getLogger("ai-service")
    start_time = time.perf_counter()
    error_code: str | None = None
    model = "unknown"
    skip_wrapper_usage = False
    try:
        if req.action == "delete":
            result = await vector_store.delete_post_embedding(req.postId)
            request_text = str(req.postId)
        else:
            # 仅阻止已删除文章建索引。隐藏/草稿/加密文章允许进入向量库，
            # 但检索结果是否可见由查询侧按权限再过滤（前台公开检索继续
            # 受 status/is_hidden/password 约束，管理端可在登录态检索）。
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT id, deleted FROM posts WHERE id = $1",
                    req.postId,
                )
            if not row or row["deleted"]:
                raise HTTPException(
                    status_code=404,
                    detail="Post is not indexable (must exist and not deleted)",
                )
            _enforce_content_limit(req.content or "")
            profile = await vector_store.get_active_profile()
            model = profile.model_id
            index_usage_endpoint = request.url.path
            result = await vector_store.upsert_post_embedding(
                post_id=req.postId,
                title=req.title or "",
                slug=req.slug or "",
                content=req.content or "",
                metadata=req.metadata or {},
                timeout_sec=req.timeoutSec,
                profile=profile,
                user_id=user.user_id,
                usage_endpoint=index_usage_endpoint,
                request_id=getattr(request.state, "request_id", None),
            )
            model = str(result.get("model_id") or model)
            request_text = req.content or ""
            skip_wrapper_usage = True
        return ApiResponse(data=result)
    except HTTPException as exc:
        # 保留原始的 FastAPI 异常（如输入校验 4xx 等）
        error_code = str(exc.detail)[:120]
        raise
    except Exception as exc:
        # 把 LiteLLM / 网络 / DB 失败映射为稳定的 HTTPException。
        # 用 HTTPException 而不是 return ApiResponse —— FastAPI 会自动序列化为
        # 干净的 {detail: "..."} JSON，**HTTP 状态码就是真正的非 200**，Go backend
        # 的 statusCode != http.StatusOK 检查直接对得上，也不会再触发
        # unhandled_exception 那套满屏 traceback。
        exc_name = type(exc).__name__
        error_msg = str(exc)
        error_code = f"{exc_name}: {error_msg}"[:120]

        if "ServiceUnavailableError" in exc_name or "503" in error_msg:
            http_code = 503
            user_msg = "Embedding 提供商不可用（503），请检查 oneapi/中转的 channel 配置或稍后重试"
        elif "RateLimitError" in exc_name or "429" in error_msg:
            http_code = 429
            user_msg = "Embedding 提供商触发限流（429）"
        elif "AuthenticationError" in exc_name or "401" in error_msg or "403" in error_msg:
            http_code = 401
            user_msg = "Embedding 提供商认证失败，请检查 API Key"
        elif "Timeout" in exc_name or "TimeoutError" in error_msg:
            http_code = 504
            user_msg = "Embedding 请求超时，可在搜索配置中增大单篇超时"
        elif "NotFoundError" in exc_name or "model_not_found" in error_msg or "404" in error_msg:
            http_code = 404
            user_msg = "Embedding 模型不存在或中转未配置该 channel"
        elif (
            "DataError" in exc_name
            or "dimensions" in error_msg.lower()
            or "expected" in error_msg.lower() and "dim" in error_msg.lower()
        ):
            # V3: 在版本化 post_embeddings 下这一类基本不再发生（dim 不锁列），
            # 但仍保留分支覆盖老部署/回滚场景——避免撞到这里时再被归到
            # "Embedding 调用失败"，误导用户以为是 provider 问题。
            http_code = 422
            user_msg = (
                "向量维度与存储不匹配（检测到 pgvector DataError）。"
                "通常是换了 embedding 模型但未触发全量 reindex 的残留，"
                "请在搜索配置里点击 '全量重建索引'"
            )
        else:
            http_code = 502
            user_msg = "Embedding 调用失败"

        _logger.warning(
            "index_post.failed",
            extra={"data": {
                "post_id": req.postId,
                "exception": exc_name,
                "http_code": http_code,
                "error": error_msg[:200],
            }},
        )
        raise HTTPException(status_code=http_code, detail=f"{user_msg}: {error_msg[:200]}")
    finally:
        if not skip_wrapper_usage:
            await _log_usage(
                request=request,
                metrics=metrics,
                usage_logger=usage_logger,
                user_id=user.user_id,
                model=model,
                request_text=request_text if "request_text" in locals() else "",
                response_text="",
                start_time=start_time,
                success=error_code is None,
                cached=False,
                error_code=error_code,
            )


@router.get("/api/v1/search/semantic/internal", response_model=ApiResponse[SemanticSearchData])
async def semantic_search_internal(
    request: Request,
    q: str = Query(min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
    user=Depends(require_admin_or_internal),
    vector_store=Depends(get_vector_store),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[SemanticSearchData]:
    """供 Go 后端代理调用的内部语义搜索端点（需要管理员或内部服务 token）。"""
    _enforce_content_limit(q)
    start_time = time.perf_counter()
    error_code = None
    model = "unknown"
    user_id = "system"
    if hasattr(user, "user_id"):
        user_id = user.user_id
    elif isinstance(user, dict) and user.get("sub"):
        user_id = str(user["sub"])
    try:
        profile = await vector_store.get_active_profile()
        model = profile.model_id
        results = await vector_store.semantic_search(q, limit, profile=profile)
        return ApiResponse(data=SemanticSearchData(results=results))
    except Exception as exc:
        error_code = str(exc)
        raise
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user_id,
            model=model,
            request_text=q,
            response_text="",
            start_time=start_time,
            success=error_code is None,
            cached=False,
            error_code=error_code,
        )


@router.get("/api/v1/search/qa")
async def qa_search(
    request: Request,
    q: str = Query(min_length=1),
    user=Depends(require_admin_or_internal),
    vector_store=Depends(get_vector_store),
    llm_router=Depends(get_llm_router),
    pool=Depends(get_pg_pool),
):
    """RAG 问答端点 —— 先做检索拿到上下文，再通过 LLM 流式生成回答。
    由 Go 后端代理调用，需要管理员或内部服务 token。"""
    import json as _json
    from fastapi.responses import StreamingResponse

    _enforce_content_limit(q)

    async def generate_error(code: str, message: str):
        error_data = _json.dumps(
            {"type": "error", "code": code, "message": message},
            ensure_ascii=False,
        )
        yield f"data: {error_data}\n\n"

    if not await llm_router.has_task_routing("qa", user_id=None):
        return StreamingResponse(
            generate_error(
                "qa_routing_missing",
                "AI 问答模型未配置，请在搜索配置中选择对话模型并确认凭证可用",
            ),
            media_type="text/event-stream",
        )

    # 第 1 步：语义检索得到上下文。公开 QA 不能因为 embedding/profile 抖动
    # 直接退化成"没有内容"，必须继续走公开文章关键词/概览回退。
    try:
        context_results = await vector_store.semantic_search(q, limit=_QA_SEMANTIC_LIMIT)
    except Exception as exc:  # noqa: BLE001 - public QA has a read-only fallback path
        logger.warning("search.qa_semantic_failed", extra={"data": {"error": str(exc)[:240]}})
        context_results = []

    # 第 2 步：拼装 RAG 所需的 context
    context_parts = []
    sources = []
    for r in context_results:
        post = r.get("post", {})
        title = post.get("title", "")
        highlight = r.get("highlight", "")
        slug = post.get("slug", "")
        context_parts.append(f"[{title}]\n{highlight}")
        sources.append({"title": title, "slug": slug})

    context_text = "\n\n---\n\n".join(context_parts) if context_parts else ""
    if not context_text:
        fallback_context, fallback_sources = await _build_public_qa_fallback_context(pool, q)
        if fallback_context:
            context_text = fallback_context
            sources = fallback_sources

    # 第 3 步：使用 qa task type 流式生成 LLM 回答
    async def generate():
        accumulated_answer = ""
        try:
            if not context_text:
                accumulated_answer = _QA_AUTH_FALLBACK_ANSWER
                data = _json.dumps({"type": "delta", "content": accumulated_answer}, ensure_ascii=False)
                yield f"data: {data}\n\n"
                hint_data = _json.dumps({"type": "auth_hint", **_QA_AUTH_HINT}, ensure_ascii=False)
                yield f"data: {hint_data}\n\n"
                sources_data = _json.dumps({"type": "sources", "sources": []}, ensure_ascii=False)
                yield f"data: {sources_data}\n\n"
                result_data = _json.dumps(
                    {
                        "type": "result",
                        "data": {
                            "answer": accumulated_answer,
                            "sources": [],
                            "authHint": _QA_AUTH_HINT,
                        },
                    },
                    ensure_ascii=False,
                )
                yield f"data: {result_data}\n\n"
                yield 'data: {"type": "done"}\n\n'
                return

            async for chunk in llm_router.stream_chat(
                prompt_variables={"context": context_text, "query": q},
                model_alias="qa",
            ):
                accumulated_answer += chunk
                data = _json.dumps({"type": "delta", "content": chunk}, ensure_ascii=False)
                yield f"data: {data}\n\n"

            # 下发引用来源 (向后兼容: blog SearchPanel 旧消费者识别此自定义事件)
            sources_data = _json.dumps({"type": "sources", "sources": sources}, ensure_ascii=False)
            yield f"data: {sources_data}\n\n"

            # 标准 result event (与 ai.py 其他任务对齐, 让通用 useStreamResponse 消费者能直接接入)
            result_data = _json.dumps(
                {"type": "result", "data": {"answer": accumulated_answer, "sources": sources}},
                ensure_ascii=False,
            )
            yield f"data: {result_data}\n\n"

            yield 'data: {"type": "done"}\n\n'
        except Exception as exc:
            error_data = _json.dumps(
                {"type": "error", "code": "qa_error", "message": str(exc)},
                ensure_ascii=False,
            )
            yield f"data: {error_data}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/api/v1/admin/search/stats")
async def index_stats(
    user=Depends(require_admin),
    pool=Depends(get_pg_pool),
) -> ApiResponse[dict]:
    """返回管理后台仪表盘所需的索引统计。

    韧性说明：在历史部署中，若 migration 000034 已被标记应用、但版本化的
    ``post_embeddings`` schema 从未真正建出来（``CREATE TABLE IF NOT EXISTS``
    与 000001 的 chunk 表发生过期冲撞），则 ``WHERE status = 'active'``
    子查询会抛出 ``UndefinedColumnError``，让整个管理面板陷入 500 循环。
    这里把文章级计数与向量计数拆开，schema 缺失时只会让 ``vector_count``
    退化为 ``0`` 并附带 ``schema_ready: false``，从而保证仪表盘其它部分
    在 migration 000036 跑完前仍然可用。
    """
    async with pool.acquire() as conn:
        post_counts = await conn.fetchrow("""
            SELECT
                (SELECT COUNT(*) FROM posts WHERE deleted = false) AS total_posts,
                (SELECT COUNT(*) FROM posts WHERE deleted = false AND embedding_status = 'INDEXED') AS indexed_posts,
                (SELECT COUNT(*) FROM posts WHERE deleted = false AND embedding_status = 'FAILED') AS failed_posts,
                (SELECT COUNT(*) FROM posts WHERE deleted = false AND embedding_status = 'PENDING') AS pending_posts
        """)

        # vector_count = active profile 下的 chunk 总数（旧 UI 字段保留兼容）
        # vector_post_count = active profile 下覆盖到的文档数（新 UI 文案用）
        vector_count = 0
        vector_post_count = 0
        active_profile: dict | None = None
        schema_ready = True
        try:
            profile_row = await conn.fetchrow(
                """
                SELECT id, code, name, model_id, chunker_kind,
                       chunk_size_tokens, chunk_overlap_tokens
                FROM search_profiles WHERE status = 'active' LIMIT 1
                """
            )
            if profile_row:
                active_profile = {
                    "id": profile_row["id"],
                    "code": profile_row["code"],
                    "name": profile_row["name"],
                    "modelId": profile_row["model_id"],
                    "chunkerKind": profile_row["chunker_kind"],
                    "chunkSizeTokens": profile_row["chunk_size_tokens"],
                    "chunkOverlapTokens": profile_row["chunk_overlap_tokens"],
                }
                row = await conn.fetchrow(
                    """
                    SELECT
                        COUNT(*) AS chunk_count,
                        COUNT(DISTINCT post_id) AS post_count
                    FROM post_embeddings
                    WHERE profile_id = $1 AND status = 'active'
                    """,
                    profile_row["id"],
                )
                if row:
                    vector_count = int(row["chunk_count"] or 0)
                    vector_post_count = int(row["post_count"] or 0)
        except (asyncpg.UndefinedColumnError, asyncpg.UndefinedTableError) as exc:
            # 旧的 chunk 表 / schema 缺失（migration 000041 未跑） —— 不要让整个面板 500。
            schema_ready = False
            logger.warning(
                "post_embeddings or search_profiles schema missing (%s). "
                "Returning zero counts until migration 000041 applies.",
                exc.__class__.__name__,
            )

    # 纯聚合 SELECT 在语义上必返一行, 但 dict(None) 会 TypeError, 管理面板被
    # 连带 500. 兜一下 None —— 成本为零, 在连接池中途断开等极端条件下避免
    # 错误被放大.
    payload = dict(post_counts) if post_counts else {
        "total_posts": 0,
        "indexed_posts": 0,
        "failed_posts": 0,
        "pending_posts": 0,
    }
    payload["vector_count"] = vector_count
    payload["vector_post_count"] = vector_post_count
    payload["active_profile"] = active_profile
    payload["schema_ready"] = schema_ready
    return ApiResponse(data=payload)


@router.post("/api/v1/admin/search/retry-failed")
async def retry_failed_indexes(
    profileCode: str | None = Query(
        default=None,
        description=(
            "可选 profile code。不传走 active profile + embedding_status='FAILED' 旧逻辑；"
            "传则补齐 'shadow / active 行缺失' 的文章（用于 profile 蓝绿切换前的覆盖修复）。"
        ),
    ),
    user=Depends(require_admin),
    vector_store=Depends(get_vector_store),
    pool=Depends(get_pg_pool),
) -> ApiResponse[dict]:
    """以受控并发重试索引失败 / 覆盖缺失的文章。

    两种模式：

    - **profileCode=None**（兼容旧客户端）：
      用 active profile 重试 ``embedding_status='FAILED'`` 的文章。
    - **profileCode=<code>**（profile 蓝绿切换前的覆盖修复）：
      列出该 profile 下没有 active 或 shadow 行的 post，按目标 profile 的
      ``status``（active → 'active'，否则 'shadow'）补写。补完才能 activate。
    """
    import asyncio

    if profileCode:
        # Profile-scoped 模式：补齐覆盖缺口
        profile = await vector_store._fetch_profile_by_code(profileCode)
        if not profile:
            raise HTTPException(404, f"Profile '{profileCode}' 不存在")
        target_status = "active" if profile.status == "active" else "shadow"
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT p.id, p.title, p.slug, p.content_markdown
                FROM posts p
                WHERE p.deleted = FALSE
                  AND p.status = 'PUBLISHED'
                  AND NOT EXISTS (
                      SELECT 1 FROM post_embeddings pe
                      WHERE pe.post_id = p.id
                        AND pe.profile_id = $1
                        AND pe.status IN ('active', 'shadow', 'deprecated')
                      GROUP BY pe.post_id
                      HAVING COUNT(*) > 0
                         AND COUNT(*) = MAX(COALESCE(pe.chunk_count, 1))
                         AND MIN(COALESCE(pe.chunk_count, 1)) = MAX(COALESCE(pe.chunk_count, 1))
                  )
                ORDER BY p.id
                LIMIT 100
                """,
                profile.id,
            )
        sem = asyncio.Semaphore(5)

        async def process_one_scoped(row):
            async with sem:
                try:
                    await vector_store.upsert_post_embedding(
                        post_id=row["id"],
                        title=row["title"],
                        slug=row["slug"],
                        content=row["content_markdown"] or "",
                        metadata={},
                        profile=profile,
                        target_status=target_status,
                    )
                    return True
                except Exception:
                    return False

        results = await asyncio.gather(*[process_one_scoped(r) for r in rows])
        retried = sum(1 for r in results if r)
        return ApiResponse(data={
            "retried": retried,
            "total_missing": len(rows),
            "profile": profile.code,
            "target_status": target_status,
        })

    # 旧逻辑：active profile + embedding_status='FAILED'
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, title, slug, content_markdown FROM posts "
            "WHERE deleted = false AND status = 'PUBLISHED' AND embedding_status = 'FAILED' "
            "ORDER BY id LIMIT 100"
        )

    sem = asyncio.Semaphore(5)  # 最多 5 个重试任务并发

    async def process_one(row):
        async with sem:
            try:
                await vector_store.upsert_post_embedding(
                    post_id=row["id"],
                    title=row["title"],
                    slug=row["slug"],
                    content=row["content_markdown"] or "",
                    metadata={},
                )
                return True
            except Exception:
                return False  # upsert_post_embedding 内部已更新 embedding_status

    results = await asyncio.gather(*[process_one(row) for row in rows])
    retried = sum(1 for r in results if r)
    return ApiResponse(data={"retried": retried, "total_failed": len(rows)})
