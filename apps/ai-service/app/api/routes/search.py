from __future__ import annotations

import time

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


# ref: §5.4
router = APIRouter(tags=["search"])
settings = get_settings()


def _enforce_content_limit(content: str) -> None:
    if len(content) > settings.max_input_chars:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Content too large",
        )


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
    model = settings.model_embedding
    try:
        results = await vector_store.semantic_search(q, limit)
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
    user=Depends(require_admin_or_internal),
    vector_store=Depends(get_vector_store),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[dict]:
    start_time = time.perf_counter()
    error_code = None
    model = settings.model_embedding
    try:
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
) -> ApiResponse[dict]:
    start_time = time.perf_counter()
    error_code = None
    model = settings.model_embedding
    try:
        if req.action == "delete":
            result = await vector_store.delete_post_embedding(req.postId)
            request_text = str(req.postId)
        else:
            _enforce_content_limit(req.content or "")
            result = await vector_store.upsert_post_embedding(
                post_id=req.postId,
                title=req.title or "",
                slug=req.slug or "",
                content=req.content or "",
                metadata=req.metadata or {},
            )
            request_text = req.content or ""
        return ApiResponse(data=result)
    except HTTPException as exc:
        error_code = str(exc.detail)
        raise
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
    """Internal semantic search endpoint for Go backend proxy (requires admin or internal service token)."""
    _enforce_content_limit(q)
    start_time = time.perf_counter()
    error_code = None
    model = settings.model_embedding
    user_id = "system"
    if hasattr(user, "user_id"):
        user_id = user.user_id
    elif isinstance(user, dict) and user.get("sub"):
        user_id = str(user["sub"])
    try:
        results = await vector_store.semantic_search(q, limit)
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
):
    """RAG QA endpoint - searches for context then generates an answer via LLM streaming.
    Requires admin or internal service token since it is proxied from Go backend."""
    import json as _json
    from fastapi.responses import StreamingResponse

    _enforce_content_limit(q)

    # Step 1: Semantic search for context
    context_results = await vector_store.semantic_search(q, limit=3)

    # Step 2: Build context for RAG
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

    # Step 3: Stream LLM response using qa task type
    async def generate():
        try:
            async for chunk in llm_router.stream_chat(
                prompt_variables={"context": context_text, "query": q},
                model_alias="qa",
            ):
                data = _json.dumps({"type": "delta", "content": chunk}, ensure_ascii=False)
                yield f"data: {data}\n\n"

            # Send sources
            sources_data = _json.dumps({"type": "sources", "sources": sources}, ensure_ascii=False)
            yield f"data: {sources_data}\n\n"

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
    """Return indexing statistics for the admin dashboard."""
    async with pool.acquire() as conn:
        stats = await conn.fetchrow("""
            SELECT
                (SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED') AS total_posts,
                (SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED' AND embedding_status = 'INDEXED') AS indexed_posts,
                (SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED' AND embedding_status = 'FAILED') AS failed_posts,
                (SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED' AND embedding_status = 'PENDING') AS pending_posts,
                (SELECT COUNT(*) FROM post_vectors) AS vector_count
        """)
    return ApiResponse(data=dict(stats))


@router.post("/api/v1/admin/search/retry-failed")
async def retry_failed_indexes(
    user=Depends(require_admin),
    vector_store=Depends(get_vector_store),
    pool=Depends(get_pg_pool),
) -> ApiResponse[dict]:
    """Retry embedding for posts with FAILED status using limited concurrency."""
    import asyncio

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, title, slug, content_markdown FROM posts "
            "WHERE deleted = false AND status = 'PUBLISHED' AND embedding_status = 'FAILED' "
            "ORDER BY id LIMIT 100"
        )

    sem = asyncio.Semaphore(5)  # max 5 concurrent retry operations

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
                return False  # upsert_post_embedding already updates embedding_status

    results = await asyncio.gather(*[process_one(row) for row in rows])
    retried = sum(1 for r in results if r)
    return ApiResponse(data={"retried": retried, "total_failed": len(rows)})
