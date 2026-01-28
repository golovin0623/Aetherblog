from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Query, Request, HTTPException, status

from app.api.deps import (
    get_metrics,
    get_usage_logger,
    get_vector_store,
    rate_limit,
    require_admin,
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
    user=Depends(require_admin),
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
    user=Depends(require_admin),
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
