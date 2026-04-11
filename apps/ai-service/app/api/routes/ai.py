from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

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
logger = logging.getLogger("ai-service")

SUMMARY_TTL = 60 * 60 * 24
TAGS_TTL = 60 * 60 * 24
TITLES_TTL = 60 * 60

settings = get_settings()


def _prompt_version(version: str | None) -> str:
    return version or "v1"


def _split_list(text: str) -> list[str]:
    parts = [p.strip() for p in text.replace("\n", ",").split(",") if p.strip()]
    return parts or [text]


_LIST_PREFIX_RE = re.compile(r"^(?:\d+[\.\)、]|[-•*])\s*")
_QUOTE_STRIP = "\"'`“”‘’「」『』"
# Characters stripped from the outer edge of each parsed token. Includes
# Unicode quotes + JSON-style brackets so that malformed JSON output from LLMs
# (e.g. `[“tag1”, “tag2”]` with smart quotes — which `json.loads` rejects) is
# still cleanly extractable via the delimiter-split fallback path.
_OUTER_STRIP = _QUOTE_STRIP + "[]【】《》"


def _strip_token(value: str) -> str:
    """Normalize a parsed token: strip whitespace + outer quotes/brackets + `#` prefix."""
    result = value.strip().strip(_OUTER_STRIP).strip()
    if result.startswith("#"):
        result = result.lstrip("#").strip()
    return result


def _parse_tags(text: str) -> list[str]:
    """Robust tag parser: JSON array / comma / newline / numbered list."""
    text = (text or "").strip()
    if not text:
        return []
    # Try JSON array first
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                items = [_strip_token(str(item)) for item in parsed]
                items = [it for it in items if it]
                if items:
                    return items
        except (json.JSONDecodeError, ValueError):
            pass
    # Line/delimiter split with numbered-list stripping
    collected: list[str] = []
    for raw_line in text.splitlines():
        line = _LIST_PREFIX_RE.sub("", raw_line.strip())
        if not line:
            continue
        for piece in re.split(r"[,，、;；]", line):
            cleaned = _strip_token(piece)
            if cleaned:
                collected.append(cleaned)
    return collected or _split_list(text)


def _parse_titles(text: str) -> list[str]:
    """Robust title parser: handles numbered/bulleted lists and JSON arrays."""
    text = (text or "").strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                items = [_strip_token(str(item)) for item in parsed]
                items = [it for it in items if it]
                if items:
                    return items
        except (json.JSONDecodeError, ValueError):
            pass
    collected: list[str] = []
    for raw_line in text.splitlines():
        line = _LIST_PREFIX_RE.sub("", raw_line.strip())
        cleaned = _strip_token(line)
        if cleaned:
            collected.append(cleaned)
    return collected or _split_list(text)


def _build_stream_result_payload(
    task_type: str,
    full_text: str,
    prompt_variables: dict[str, Any],
    model: str,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Construct the structured terminal payload emitted on stream completion.

    Mirrors the non-stream endpoints so the front-end receives the exact same
    shape regardless of transport.
    """
    text = (full_text or "").strip()
    if not text:
        return None

    extras = extras or {}

    try:
        if task_type == "summary":
            data = SummaryData(
                summary=text,
                characterCount=len(text),
                model=model or None,
            )
            return data.model_dump()

        if task_type == "tags":
            try:
                max_tags = int(prompt_variables.get("max_tags", 5) or 5)
            except (TypeError, ValueError):
                max_tags = 5
            tags = _parse_tags(text)[:max_tags]
            data = TagsData(tags=tags, model=model or None)
            return data.model_dump()

        if task_type == "titles":
            try:
                max_titles = int(prompt_variables.get("max_titles", 5) or 5)
            except (TypeError, ValueError):
                max_titles = 5
            titles = _parse_titles(text)[:max_titles]
            data = TitlesData(titles=titles, model=model or None)
            return data.model_dump()

        if task_type == "polish":
            data = PolishData(polishedContent=text, model=model or None)
            return data.model_dump()

        if task_type == "outline":
            data = OutlineData(
                outline=text,
                characterCount=len(text),
                model=model or None,
            )
            return data.model_dump()

        if task_type == "translate":
            source_raw = prompt_variables.get("source_language")
            source = source_raw if source_raw and source_raw != "自动检测" else None
            target = str(prompt_variables.get("target_language") or extras.get("target_language") or "en")
            data = TranslateData(
                translatedContent=text,
                sourceLanguage=source,
                targetLanguage=target,
                model=model or None,
            )
            return data.model_dump()
    except Exception as exc:  # pragma: no cover - defensive, never break the stream
        logger.warning(
            "ai.stream_result_build_failed",
            extra={"task_type": task_type, "error": str(exc)},
        )
        return None

    return None


def _enforce_content_limit(content: str) -> None:
    if len(content) > settings.max_input_chars:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Content too large",
        )


def _truncate_error_message(value: str, limit: int = 200) -> str:
    text = " ".join((value or "").split())
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def _normalize_generation_error(exc: Exception) -> tuple[int, str]:
    message = _truncate_error_message(str(exc) or exc.__class__.__name__)
    lower = message.lower()

    if any(keyword in lower for keyword in ("rate limit", "too many requests", "429")):
        return status.HTTP_429_TOO_MANY_REQUESTS, "AI provider rate limit exceeded"

    if any(keyword in lower for keyword in ("timeout", "timed out", "deadline exceeded")):
        return status.HTTP_504_GATEWAY_TIMEOUT, "AI provider request timed out"

    if any(keyword in lower for keyword in ("unauthorized", "authentication", "invalid api key", "api key", "401", "403")):
        return status.HTTP_502_BAD_GATEWAY, "AI provider authentication failed"

    if any(keyword in lower for keyword in ("context length", "max tokens", "prompt is too long", "invalid request", "unsupported parameter", "model_not_found")):
        return status.HTTP_400_BAD_REQUEST, f"AI request rejected: {message}"

    return status.HTTP_502_BAD_GATEWAY, f"AI generation failed: {message}"


async def _safe_cache_get_json(cache, key: str):
    try:
        return await cache.get_json(key)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("ai.cache_read_failed", extra={"key": key, "error": str(exc)})
        return None


async def _safe_cache_set_json(cache, key: str, value, ttl_seconds: int) -> None:
    try:
        await cache.set_json(key, value, ttl_seconds)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("ai.cache_write_failed", extra={"key": key, "error": str(exc)})


async def _log_usage(
    *,
    request: Request,
    metrics: MetricsStore,
    usage_logger: UsageLogger,
    user_id: str | int,
    task_type: str,
    model: str,
    provider_code: str | None,
    model_id: str | None,
    input_cost_per_1m: float | None,
    output_cost_per_1m: float | None,
    cached_input_cost_per_1m: float | None,
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
        task_type=task_type,
        provider_code=provider_code,
        model_id=model_id,
        model=model,
        input_cost_per_1m=input_cost_per_1m,
        output_cost_per_1m=output_cost_per_1m,
        cached_input_cost_per_1m=cached_input_cost_per_1m,
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


async def _resolve_model_context(
    llm,
    *,
    task_type: str,
    user_id: int,
    model_id: str | None,
    provider_code: str | None,
) -> tuple[str, dict[str, str | float | None]]:
    usage_context = await llm.resolve_usage_context(
        task_type,
        user_id=user_id,
        model_id=model_id,
        provider_code=provider_code,
    )
    model = str(usage_context.get("model") or "")
    return model, usage_context


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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="summary",
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
        cached_data = await _safe_cache_get_json(cache, cache_key)
        if cached_data:
            try:
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
            except Exception as exc:  # pragma: no cover - defensive
                cached = False
                response_text = ""
                logger.warning("ai.cache_payload_invalid", extra={"key": cache_key, "error": str(exc)})

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
        await _safe_cache_set_json(
            cache,
            cache_key,
            data.model_dump(),
            SUMMARY_TTL,
        )
        return ApiResponse(data=data)
    except HTTPException as exc:
        error_code = str(exc.detail)
        raise
    except Exception as exc:
        status_code, detail = _normalize_generation_error(exc)
        error_code = detail
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user.user_id,
            task_type="summary",
            model=model,
            provider_code=usage_context.get("provider_code") if usage_context else None,
            model_id=usage_context.get("model_id") if usage_context else None,
            input_cost_per_1m=usage_context.get("input_cost_per_1m") if usage_context else None,
            output_cost_per_1m=usage_context.get("output_cost_per_1m") if usage_context else None,
            cached_input_cost_per_1m=usage_context.get("cached_input_cost_per_1m") if usage_context else None,
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="summary",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
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
            model, usage_context, metrics, usage_logger, start_time, req.content
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="tags",
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
        cached_data = await _safe_cache_get_json(cache, cache_key)
        if cached_data:
            try:
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
            except Exception as exc:  # pragma: no cover - defensive
                cached = False
                logger.warning("ai.cache_payload_invalid", extra={"key": cache_key, "error": str(exc)})

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
        await _safe_cache_set_json(cache, cache_key, data.model_dump(), TAGS_TTL)
        return ApiResponse(data=data)
    except HTTPException as exc:
        error_code = str(exc.detail)
        raise
    except Exception as exc:
        status_code, detail = _normalize_generation_error(exc)
        error_code = detail
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user.user_id,
            task_type="tags",
            model=model,
            provider_code=usage_context.get("provider_code") if usage_context else None,
            model_id=usage_context.get("model_id") if usage_context else None,
            input_cost_per_1m=usage_context.get("input_cost_per_1m") if usage_context else None,
            output_cost_per_1m=usage_context.get("output_cost_per_1m") if usage_context else None,
            cached_input_cost_per_1m=usage_context.get("cached_input_cost_per_1m") if usage_context else None,
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="titles",
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
        cached_data = await _safe_cache_get_json(cache, cache_key)
        if cached_data:
            try:
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
            except Exception as exc:  # pragma: no cover - defensive
                cached = False
                logger.warning("ai.cache_payload_invalid", extra={"key": cache_key, "error": str(exc)})

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
        await _safe_cache_set_json(cache, cache_key, data.model_dump(), TITLES_TTL)
        return ApiResponse(data=data)
    except HTTPException as exc:
        error_code = str(exc.detail)
        raise
    except Exception as exc:
        status_code, detail = _normalize_generation_error(exc)
        error_code = detail
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user.user_id,
            task_type="titles",
            model=model,
            provider_code=usage_context.get("provider_code") if usage_context else None,
            model_id=usage_context.get("model_id") if usage_context else None,
            input_cost_per_1m=usage_context.get("input_cost_per_1m") if usage_context else None,
            output_cost_per_1m=usage_context.get("output_cost_per_1m") if usage_context else None,
            cached_input_cost_per_1m=usage_context.get("cached_input_cost_per_1m") if usage_context else None,
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="polish",
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
        status_code, detail = _normalize_generation_error(exc)
        error_code = detail
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user.user_id,
            task_type="polish",
            model=model,
            provider_code=usage_context.get("provider_code") if usage_context else None,
            model_id=usage_context.get("model_id") if usage_context else None,
            input_cost_per_1m=usage_context.get("input_cost_per_1m") if usage_context else None,
            output_cost_per_1m=usage_context.get("output_cost_per_1m") if usage_context else None,
            cached_input_cost_per_1m=usage_context.get("cached_input_cost_per_1m") if usage_context else None,
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="outline",
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
        status_code, detail = _normalize_generation_error(exc)
        error_code = detail
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user.user_id,
            task_type="outline",
            model=model,
            provider_code=usage_context.get("provider_code") if usage_context else None,
            model_id=usage_context.get("model_id") if usage_context else None,
            input_cost_per_1m=usage_context.get("input_cost_per_1m") if usage_context else None,
            output_cost_per_1m=usage_context.get("output_cost_per_1m") if usage_context else None,
            cached_input_cost_per_1m=usage_context.get("cached_input_cost_per_1m") if usage_context else None,
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="translate",
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
        cached_data = await _safe_cache_get_json(cache, cache_key)
        if cached_data:
            try:
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
            except Exception as exc:  # pragma: no cover - defensive
                cached = False
                response_text = ""
                logger.warning("ai.cache_payload_invalid", extra={"key": cache_key, "error": str(exc)})

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
        await _safe_cache_set_json(
            cache,
            cache_key,
            {"translatedContent": response_text, "targetLanguage": req.targetLanguage},
            TRANSLATE_TTL,
        )
        return ApiResponse(data=data)
    except HTTPException as exc:
        error_code = str(exc.detail)
        raise
    except Exception as exc:
        status_code, detail = _normalize_generation_error(exc)
        error_code = detail
        raise HTTPException(status_code=status_code, detail=detail) from exc
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user.user_id,
            task_type="translate",
            model=model,
            provider_code=usage_context.get("provider_code") if usage_context else None,
            model_id=usage_context.get("model_id") if usage_context else None,
            input_cost_per_1m=usage_context.get("input_cost_per_1m") if usage_context else None,
            output_cost_per_1m=usage_context.get("output_cost_per_1m") if usage_context else None,
            cached_input_cost_per_1m=usage_context.get("cached_input_cost_per_1m") if usage_context else None,
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
    usage_context: dict[str, str | float | None],
    metrics,
    usage_logger,
    start_time: float,
    request_text: str,
    result_extras: dict[str, Any] | None = None,
):
    """Generic stream generator with think block detection - SSE format.

    In addition to the raw ``delta`` / ``done`` / ``error`` events emitted by
    the underlying LLM router, this wrapper accumulates the non-think text and
    emits a final ``result`` event containing the structured payload that
    matches the corresponding non-stream endpoint. This lets the front-end
    apply the output directly to articles without re-parsing the text.
    """
    response_chars = 0
    error_code = None
    # Accumulate non-think text via a list + final join instead of repeated
    # ``+=`` concatenation. The naive ``full_text += content`` form is O(n²)
    # in CPython since each `+=` on a str allocates a fresh object; for long
    # generations (e.g. polish / outline producing thousands of tokens) this
    # adds noticeable latency (PR #435 review C6).
    full_text_chunks: list[str] = []
    result_emitted = False

    def _make_sse(event: dict) -> bytes:
        return f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")

    async def _maybe_emit_result():
        nonlocal result_emitted
        if result_emitted:
            return None
        payload = _build_stream_result_payload(
            task_type=model_alias,
            full_text="".join(full_text_chunks),
            prompt_variables=prompt_variables,
            model=model,
            extras=result_extras,
        )
        if payload is None:
            return None
        result_emitted = True
        return _make_sse({"type": "result", "data": payload})

    try:
        async for event in llm.stream_chat_with_think_detection(
            prompt_variables=prompt_variables,
            model_alias=model_alias,
            user_id=user_id,
            custom_prompt=custom_prompt,
            model_id=model_id,
            provider_code=provider_code,
        ):
            event_type = event.get("type")

            if event_type == "delta":
                content = event.get("content", "") or ""
                response_chars += len(content)
                if not event.get("isThink"):
                    full_text_chunks.append(content)
                yield _make_sse(event)
            elif event_type == "done":
                # Emit structured result right before the done marker so the
                # front-end can commit the final shape in a single pass.
                result_line = await _maybe_emit_result()
                if result_line is not None:
                    yield result_line
                yield _make_sse(event)
            else:
                # Pass-through unknown / error events
                yield _make_sse(event)

            await asyncio.sleep(0)

        # Some providers close the stream without sending an explicit ``done``
        # event. Make sure the result is still delivered in that case.
        if not result_emitted:
            result_line = await _maybe_emit_result()
            if result_line is not None:
                yield result_line
            yield _make_sse({"type": "done"})
    except Exception as exc:
        _status_code, detail = _normalize_generation_error(exc)
        error_code = detail
        error_event = {"type": "error", "code": "AI_STREAM_ERROR", "message": detail}
        yield _make_sse(error_event)
    finally:
        await _log_usage(
            request=request,
            metrics=metrics,
            usage_logger=usage_logger,
            user_id=user_id,
            task_type=model_alias,
            model=model,
            provider_code=usage_context.get("provider_code") if usage_context else None,
            model_id=usage_context.get("model_id") if usage_context else None,
            input_cost_per_1m=usage_context.get("input_cost_per_1m") if usage_context else None,
            output_cost_per_1m=usage_context.get("output_cost_per_1m") if usage_context else None,
            cached_input_cost_per_1m=usage_context.get("cached_input_cost_per_1m") if usage_context else None,
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="tags",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    prompt_variables = {"content": req.content, "max_tags": req.maxTags}
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "tags", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, usage_context, metrics, usage_logger, start_time, req.content
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="titles",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    prompt_variables = {"content": req.content, "max_titles": req.maxTitles}
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "titles", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, usage_context, metrics, usage_logger, start_time, req.content
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="polish",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    prompt_variables = {"content": req.content, "tone": req.tone or "专业"}
    return StreamingResponse(
        _stream_with_think_detection(
            request, llm, prompt_variables, "polish", user.user_id,
            req.promptTemplate, req.modelId, req.providerCode,
            model, usage_context, metrics, usage_logger, start_time, req.content
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="outline",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
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
            model, usage_context, metrics, usage_logger, start_time, topic
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
    model = ""
    usage_context: dict[str, str | float | None] = {}
    try:
        model, usage_context = await _resolve_model_context(
            llm,
            task_type="translate",
            user_id=user.user_id,
            model_id=req.modelId,
            provider_code=req.providerCode,
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
            model, usage_context, metrics, usage_logger, start_time, req.content
        ),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
