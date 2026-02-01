from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps import (
    get_cache,
    get_llm_router,
    get_metrics,
    get_usage_logger,
    rate_limit,
)
from app.core.config import get_settings
from app.schemas.ai import (
    OutlineData,
    OutlineRequest,
    PolishData,
    PolishRequest,
    SummaryData,
    SummaryRequest,
    TagsData,
    TagsRequest,
    TitlesData,
    TitlesRequest,
)
from app.schemas.common import ApiResponse
from app.services.cache import hash_content
from app.services.metrics import MetricsStore
from app.services.usage_logger import UsageLogger, estimate_tokens
from app.utils.ndjson import ndjson_line


# ref: §5.4
router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

SUMMARY_TTL = 60 * 60 * 24
TAGS_TTL = 60 * 60 * 24
TITLES_TTL = 60 * 60

settings = get_settings()


def _prompt_version(version: str | None) -> str:
    return version or "v1"


def _split_list(text: str) -> list[str]:
    parts = [p.strip() for p in text.replace("\n", ",").split(",") if p.strip()]
    return parts or [text]


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


@router.post("/summary", response_model=ApiResponse[SummaryData])
async def summary(
    req: SummaryRequest,
    request: Request,
    user=Depends(rate_limit),
    cache=Depends(get_cache),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[SummaryData]:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    cached = False
    response_text = ""
    error_code = None
    model = llm.resolve_model("summary")

    try:
        cache_key = (
            f"ai:summary:{hash_content(req.content)}:{model}:"
            f"{_prompt_version(req.promptVersion)}:{req.maxLength}"
        )
        cached_data = await cache.get_json(cache_key)
        if cached_data:
            cached = True
            response_text = cached_data.get("summary", "")
            return ApiResponse(data=SummaryData(**cached_data))

        prompt_variables = {
            "content": req.content,
            "max_length": req.maxLength
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="summary",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate
        )
        data = SummaryData(summary=response_text, characterCount=len(response_text))
        await cache.set_json(cache_key, data.model_dump(), SUMMARY_TTL)
        return ApiResponse(data=data)
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
            request_text=req.content,
            response_text=response_text,
            start_time=start_time,
            success=error_code is None,
            cached=cached,
            error_code=error_code,
        )


@router.post("/summary/stream")
async def summary_stream(
    req: SummaryRequest,
    request: Request,
    user=Depends(rate_limit),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> StreamingResponse:
    _enforce_content_limit(req.content)
    prompt = f"请为以下内容生成摘要（{req.maxLength}字以内）：\n{req.content}"
    start_time = time.perf_counter()
    response_chars = 0
    error_code = None
    model = llm.resolve_model("summary")

    async def event_stream():
        nonlocal response_chars, error_code
        prompt_variables = {
            "content": req.content,
            "max_length": req.maxLength
        }
        try:
            async for chunk in llm.stream_chat(
                prompt_variables=prompt_variables,
                model_alias="summary",
                user_id=user.user_id,
                custom_prompt=req.promptTemplate
            ):
                response_chars += len(chunk)
                yield ndjson_line({"type": "delta", "content": chunk})
            yield ndjson_line({"type": "done"})
        except Exception as exc:
            error_code = str(exc)
            yield ndjson_line({"type": "error", "code": "AI_STREAM_ERROR"})
        finally:
            response_text = "a" * response_chars
            await _log_usage(
                request=request,
                metrics=metrics,
                usage_logger=usage_logger,
                user_id=user.user_id,
                model=model,
                request_text=req.content,
                response_text=response_text,
                start_time=start_time,
                success=error_code is None,
                cached=False,
                error_code=error_code,
            )

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/tags", response_model=ApiResponse[TagsData])
async def tags(
    req: TagsRequest,
    request: Request,
    user=Depends(rate_limit),
    cache=Depends(get_cache),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[TagsData]:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    cached = False
    response_text = ""
    error_code = None
    model = llm.resolve_model("tags")

    try:
        cache_key = (
            f"ai:tags:{hash_content(req.content)}:{model}:"
            f"{_prompt_version(req.promptVersion)}:{req.maxTags}"
        )
        cached_data = await cache.get_json(cache_key)
        if cached_data:
            cached = True
            response_text = ",".join(cached_data.get("tags", []))
            return ApiResponse(data=TagsData(**cached_data))

        prompt_variables = {
            "content": req.content,
            "max_tags": req.maxTags
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="tags",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate
        )
        data = TagsData(tags=_split_list(response_text)[: req.maxTags])
        await cache.set_json(cache_key, data.model_dump(), TAGS_TTL)
        return ApiResponse(data=data)
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
            request_text=req.content,
            response_text=response_text,
            start_time=start_time,
            success=error_code is None,
            cached=cached,
            error_code=error_code,
        )


@router.post("/titles", response_model=ApiResponse[TitlesData])
async def titles(
    req: TitlesRequest,
    request: Request,
    user=Depends(rate_limit),
    cache=Depends(get_cache),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[TitlesData]:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    cached = False
    response_text = ""
    error_code = None
    model = llm.resolve_model("titles")

    try:
        cache_key = (
            f"ai:titles:{hash_content(req.content)}:{model}:"
            f"{_prompt_version(req.promptVersion)}:{req.maxTitles}"
        )
        cached_data = await cache.get_json(cache_key)
        if cached_data:
            cached = True
            response_text = ",".join(cached_data.get("titles", []))
            return ApiResponse(data=TitlesData(**cached_data))

        prompt_variables = {
            "content": req.content,
            "max_titles": req.maxTitles
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="titles",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate
        )
        data = TitlesData(titles=_split_list(response_text)[: req.maxTitles])
        await cache.set_json(cache_key, data.model_dump(), TITLES_TTL)
        return ApiResponse(data=data)
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
            request_text=req.content,
            response_text=response_text,
            start_time=start_time,
            success=error_code is None,
            cached=cached,
            error_code=error_code,
        )


@router.post("/polish", response_model=ApiResponse[PolishData])
async def polish(
    req: PolishRequest,
    request: Request,
    user=Depends(rate_limit),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[PolishData]:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    error_code = None
    model = llm.resolve_model("polish")
    response_text = ""

    try:
        prompt_variables = {
            "content": req.content,
            "tone": req.tone or "专业"
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="polish",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate
        )
        return ApiResponse(data=PolishData(content=response_text))
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
            request_text=req.content,
            response_text=response_text,
            start_time=start_time,
            success=error_code is None,
            cached=False,
            error_code=error_code,
        )


@router.post("/outline", response_model=ApiResponse[OutlineData])
async def outline(
    req: OutlineRequest,
    request: Request,
    user=Depends(rate_limit),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[OutlineData]:
    start_time = time.perf_counter()
    error_code = None
    model = llm.resolve_model("outline")
    response_text = ""
    topic = req.topic or req.content or ""

    try:
        prompt_variables = {
            "topic": topic,
            "depth": req.depth,
            "style": req.style,
            "context": f"\n现有内容参考：\n{req.existingContent}" if req.existingContent else ""
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="outline",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate
        )
        return ApiResponse(data=OutlineData(outline=response_text))
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
            request_text=topic,
            response_text=response_text,
            start_time=start_time,
            success=error_code is None,
            cached=False,
            error_code=error_code,
        )
