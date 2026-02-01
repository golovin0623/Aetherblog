from __future__ import annotations

import asyncio
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
    TranslateData,
    TranslateRequest,
)
from app.schemas.common import ApiResponse
from app.services.cache import hash_content
from app.services.metrics import MetricsStore
from app.services.usage_logger import UsageLogger, estimate_tokens


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
    try:
        model = await llm.resolve_effective_model(
            "summary",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        cache_key = (
            f"ai:summary:{hash_content(req.content)}:{model}:{req.providerCode or 'default'}:"
            f"{_prompt_version(req.promptVersion)}:{req.maxLength}"
        )
        cached_data = await cache.get_json(cache_key)
        if cached_data:
            cached = True
            response_text = cached_data.get("summary", "")
            # Prefer cached metadata, fallback to current context
            latency_ms = cached_data.get("latencyMs") or int((time.perf_counter() - start_time) * 1000)
            tokens_used = cached_data.get("tokensUsed") or (estimate_tokens(req.content) + estimate_tokens(response_text))
            cached_model = cached_data.get("model") or model
            
            return ApiResponse(
                data=SummaryData(
                    summary=response_text,
                    characterCount=len(response_text),
                    model=cached_model,
                    tokensUsed=tokens_used,
                    latencyMs=latency_ms,
                )
            )

        prompt_variables = {
            "content": req.content,
            "max_length": req.maxLength
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="summary",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        tokens_used = estimate_tokens(req.content) + estimate_tokens(response_text)
        data = SummaryData(
            summary=response_text,
            characterCount=len(response_text),
            model=model,
            tokensUsed=tokens_used,
            latencyMs=latency_ms,
        )
        await cache.set_json(
            cache_key,
            data.model_dump(),
            SUMMARY_TTL,
        )
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
    start_time = time.perf_counter()
    try:
        model = await llm.resolve_effective_model(
            "summary", user_id=user.user_id, model_id=req.modelId, provider_code=req.providerCode
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    prompt_variables = {
        "content": req.content,
        "max_length": req.maxLength
    }
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "summary", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, metrics, usage_logger, start_time, req.content
        ),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


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
    try:
        model = await llm.resolve_effective_model(
            "tags",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        cache_key = (
            f"ai:tags:{hash_content(req.content)}:{model}:"
            f"{_prompt_version(req.promptVersion)}:{req.maxTags}"
        )
        cached_data = await cache.get_json(cache_key)
        if cached_data:
            cached = True
            # Backfill missing metadata for old cache entries
            data = TagsData(**cached_data)
            if not data.model:
                data.model = model
            if data.tokensUsed is None:
                data.tokensUsed = estimate_tokens(req.content) + estimate_tokens(",".join(data.tags))
            if data.latencyMs is None:
                data.latencyMs = int((time.perf_counter() - start_time) * 1000)
            return ApiResponse(data=data)

        prompt_variables = {
            "content": req.content,
            "max_tags": req.maxTags
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="tags",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        tokens_used = estimate_tokens(req.content) + estimate_tokens(response_text)
        data = TagsData(
            tags=_split_list(response_text)[: req.maxTags],
            model=model,
            tokensUsed=tokens_used,
            latencyMs=latency_ms
        )
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
    try:
        model = await llm.resolve_effective_model(
            "titles",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        cache_key = (
            f"ai:titles:{hash_content(req.content)}:{model}:"
            f"{_prompt_version(req.promptVersion)}:{req.maxTitles}"
        )
        cached_data = await cache.get_json(cache_key)
        if cached_data:
            cached = True
            # Backfill missing metadata for old cache entries
            data = TitlesData(**cached_data)
            if not data.model:
                data.model = model
            if data.tokensUsed is None:
                data.tokensUsed = estimate_tokens(req.content) + estimate_tokens(",".join(data.titles))
            if data.latencyMs is None:
                data.latencyMs = int((time.perf_counter() - start_time) * 1000)
            return ApiResponse(data=data)

        prompt_variables = {
            "content": req.content,
            "max_titles": req.maxTitles
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="titles",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        tokens_used = estimate_tokens(req.content) + estimate_tokens(response_text)
        data = TitlesData(
            titles=_split_list(response_text)[: req.maxTitles],
            model=model,
            tokensUsed=tokens_used,
            latencyMs=latency_ms
        )
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
    try:
        model = await llm.resolve_effective_model(
            "polish",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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
            custom_prompt=req.promptTemplate,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        tokens_used = estimate_tokens(req.content) + estimate_tokens(response_text)
        return ApiResponse(data=PolishData(
            polishedContent=response_text,
            changes=None,
            model=model,
            tokensUsed=tokens_used,
            latencyMs=latency_ms,
        ))
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
    try:
        model = await llm.resolve_effective_model(
            "outline",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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
            custom_prompt=req.promptTemplate,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        tokens_used = estimate_tokens(topic) + estimate_tokens(response_text)
        return ApiResponse(data=OutlineData(
            outline=response_text,
            characterCount=len(response_text),
            model=model,
            tokensUsed=tokens_used,
            latencyMs=latency_ms
        ))
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


TRANSLATE_TTL = 60 * 60 * 24


@router.post("/translate", response_model=ApiResponse[TranslateData])
async def translate(
    req: TranslateRequest,
    request: Request,
    user=Depends(rate_limit),
    cache=Depends(get_cache),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> ApiResponse[TranslateData]:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    cached = False
    response_text = ""
    error_code = None
    try:
        model = await llm.resolve_effective_model(
            "translate",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        cache_key = (
            f"ai:translate:{hash_content(req.content)}:{model}:{req.providerCode or 'default'}:"
            f"{_prompt_version(req.promptVersion)}:{req.targetLanguage}:{req.sourceLanguage or 'auto'}"
        )
        cached_data = await cache.get_json(cache_key)
        if cached_data:
            cached = True
            response_text = cached_data.get("translatedContent", "")
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            tokens_used = estimate_tokens(req.content) + estimate_tokens(response_text)
            return ApiResponse(
                data=TranslateData(
                    translatedContent=response_text,
                    sourceLanguage=req.sourceLanguage,
                    targetLanguage=req.targetLanguage,
                    model=model,
                    tokensUsed=tokens_used,
                    latencyMs=latency_ms,
                )
            )

        prompt_variables = {
            "content": req.content,
            "target_language": req.targetLanguage,
            "source_language": req.sourceLanguage or "自动检测"
        }
        response_text = await llm.chat(
            prompt_variables=prompt_variables,
            model_alias="translate",
            user_id=user.user_id,
            custom_prompt=req.promptTemplate,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        tokens_used = estimate_tokens(req.content) + estimate_tokens(response_text)
        data = TranslateData(
            translatedContent=response_text,
            sourceLanguage=req.sourceLanguage,
            targetLanguage=req.targetLanguage,
            model=model,
            tokensUsed=tokens_used,
            latencyMs=latency_ms,
        )
        await cache.set_json(
            cache_key,
            {"translatedContent": response_text, "targetLanguage": req.targetLanguage},
            TRANSLATE_TTL,
        )
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


# =============================================================================
# Stream Endpoints with Think Block Detection
# =============================================================================


async def _stream_with_think_detection(
    request: Request,
    llm,
    prompt_variables: dict,
    model_alias: str,
    user_id: int,
    custom_prompt: str | None,
    model_id: str | None,
    provider_code: str | None,
    model: str,
    metrics,
    usage_logger,
    start_time: float,
    request_text: str,
):
    """Generic stream generator with think block detection - SSE format."""
    import json
    response_chars = 0
    error_code = None
    
    try:
        async for event in llm.stream_chat_with_think_detection(
            prompt_variables=prompt_variables,
            model_alias=model_alias,
            user_id=user_id,
            custom_prompt=custom_prompt,
            model_id=model_id,
            provider_code=provider_code,
        ):
            if event["type"] == "delta":
                response_chars += len(event.get("content", ""))
            # SSE format: data: {json}\n\n (double newline is critical for flush)
            sse_line = f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            yield sse_line.encode("utf-8")
            # Force async yield
            await asyncio.sleep(0)
    except Exception as exc:
        error_code = str(exc)
        error_event = {"type": "error", "code": "AI_STREAM_ERROR", "message": str(exc)}
        yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n".encode("utf-8")
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user_id,
            model=model,
            request_text=request_text,
            response_text="x" * response_chars,
            start_time=start_time,
            success=error_code is None,
            cached=False,
            error_code=error_code,
        )


@router.post("/tags/stream")
async def tags_stream(
    req: TagsRequest,
    request: Request,
    user=Depends(rate_limit),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> StreamingResponse:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    try:
        model = await llm.resolve_effective_model(
            "tags", user_id=user.user_id, model_id=req.modelId, provider_code=req.providerCode
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    prompt_variables = {"content": req.content, "max_tags": req.maxTags}
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "tags", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, metrics, usage_logger, start_time, req.content
        ),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.post("/titles/stream")
async def titles_stream(
    req: TitlesRequest,
    request: Request,
    user=Depends(rate_limit),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> StreamingResponse:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    try:
        model = await llm.resolve_effective_model(
            "titles", user_id=user.user_id, model_id=req.modelId, provider_code=req.providerCode
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    prompt_variables = {"content": req.content, "max_titles": req.maxTitles}
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "titles", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, metrics, usage_logger, start_time, req.content
        ),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.post("/polish/stream")
async def polish_stream(
    req: PolishRequest,
    request: Request,
    user=Depends(rate_limit),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> StreamingResponse:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    try:
        model = await llm.resolve_effective_model(
            "polish", user_id=user.user_id, model_id=req.modelId, provider_code=req.providerCode
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    prompt_variables = {"content": req.content, "tone": req.tone or "专业"}
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "polish", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, metrics, usage_logger, start_time, req.content
        ),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.post("/outline/stream")
async def outline_stream(
    req: OutlineRequest,
    request: Request,
    user=Depends(rate_limit),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> StreamingResponse:
    start_time = time.perf_counter()
    try:
        model = await llm.resolve_effective_model(
            "outline", user_id=user.user_id, model_id=req.modelId, provider_code=req.providerCode
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    topic = req.topic or req.content or ""
    prompt_variables = {
        "topic": topic,
        "depth": req.depth,
        "style": req.style,
        "context": f"\n现有内容参考：\n{req.existingContent}" if req.existingContent else ""
    }
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "outline", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, metrics, usage_logger, start_time, topic
        ),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.post("/translate/stream")
async def translate_stream(
    req: TranslateRequest,
    request: Request,
    user=Depends(rate_limit),
    llm=Depends(get_llm_router),
    metrics=Depends(get_metrics),
    usage_logger=Depends(get_usage_logger),
) -> StreamingResponse:
    _enforce_content_limit(req.content)
    start_time = time.perf_counter()
    try:
        model = await llm.resolve_effective_model(
            "translate", user_id=user.user_id, model_id=req.modelId, provider_code=req.providerCode
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    prompt_variables = {
        "content": req.content,
        "target_language": req.targetLanguage,
        "source_language": req.sourceLanguage or "自动检测"
    }
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "translate", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, metrics, usage_logger, start_time, req.content
        ),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
