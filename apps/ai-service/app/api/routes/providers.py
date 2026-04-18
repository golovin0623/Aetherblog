# ref: §5.1 - Provider Management API
"""
FastAPI routes for AI provider and credential management.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
import httpx
import asyncpg
from litellm import acompletion

from app.api.deps import (
    get_provider_registry,
    get_credential_resolver,
    get_model_router,
    get_remote_model_fetcher,
    get_pg_pool,
    require_admin,
)
from app.core.jwt import UserClaims
from app.schemas.common import ApiResponse
from app.schemas.provider import (
    ProviderResponse,
    ModelResponse,
    CredentialCreate,
    CredentialResponse,
    CredentialTestRequest,
    CredentialTestResponse,
    TaskTypeResponse,
    RoutingResponse,
    RoutingUpdateRequest,
    ProviderCreate,
    ProviderUpdate,
    ModelCreate,
    ModelUpdate,
    ModelSyncRequest,
    ModelSyncResponse,
    ModelBatchToggleRequest,
    ModelSortRequest,
    ProviderBatchToggleRequest,
)
from app.services.provider_registry import ProviderRegistry
from app.services.credential_resolver import CredentialResolver
from app.services.model_router import ModelRouter
from app.services.remote_model_fetcher import RemoteModelFetcher

logger = logging.getLogger("ai-service")


# SECURITY (VULN-066 / VULN-165): LiteLLM and upstream providers can echo back
# the raw Bearer token or ``sk-...`` API key inside error messages. Any path
# that surfaces ``str(exc)`` to the caller or writes it to logs MUST go through
# ``_redact_secrets`` first — a leaked exception body is the classic API-key
# exfil vector for rate-limit / auth failures.
_REDACT_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._\-~+/=]{20,}"),
)


def _redact_secrets(msg: str, api_key: Optional[str] = None) -> str:
    if not msg:
        return msg
    out = msg
    if api_key:
        out = out.replace(api_key, "***")
    for pat in _REDACT_PATTERNS:
        out = pat.sub("***", out)
    return out

router = APIRouter(
    prefix="/api/v1/admin/providers",
    tags=["providers"],
    dependencies=[Depends(require_admin)],
)


def format_remote_fetch_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        text = exc.response.text
        snippet = text[:200] + ("..." if len(text) > 200 else "")
        return f"Remote API error {status}: {snippet}".strip()
    if isinstance(exc, httpx.RequestError):
        return f"Remote API request failed: {exc}".strip()
    return f"Remote API error: {exc}".strip()


def build_model_response(model) -> ModelResponse:
    return ModelResponse(
        id=model.id,
        provider_id=model.provider_id,
        provider_code=model.provider_code,
        model_id=model.model_id,
        display_name=model.display_name,
        model_type=model.model_type,
        context_window=model.context_window,
        max_output_tokens=model.max_output_tokens,
        input_cost_per_1k=model.input_cost_per_1k,
        output_cost_per_1k=model.output_cost_per_1k,
        input_cost_per_1m=model.input_cost_per_1m,
        output_cost_per_1m=model.output_cost_per_1m,
        cached_input_cost_per_1m=model.cached_input_cost_per_1m,
        capabilities=model.capabilities,
        is_enabled=model.is_enabled,
    )


# ============================================================
# Provider Endpoints
# ============================================================

@router.get("", response_model=ApiResponse[list[ProviderResponse]])
async def list_providers(
    enabled_only: bool = True,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """List all AI providers."""
    providers = await registry.list_providers(enabled_only=enabled_only)
    return ApiResponse(
        data=[
            ProviderResponse(
                id=p.id,
                code=p.code,
                name=p.name,
                display_name=p.display_name,
                api_type=p.api_type,
                base_url=p.base_url,
                doc_url=p.doc_url,
                icon=p.icon,
                is_enabled=p.is_enabled,
                priority=p.priority,
                capabilities=p.capabilities,
                config_schema=p.config_schema,
            )
            for p in providers
        ],
    )


@router.post("", response_model=ApiResponse[ProviderResponse])
async def create_provider(
    req: ProviderCreate,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Create a new provider."""
    try:
        provider = await registry.create_provider(
            code=req.code,
            name=req.name,
            display_name=req.display_name,
            api_type=req.api_type,
            base_url=req.base_url,
            doc_url=req.doc_url,
            icon=req.icon,
            is_enabled=req.is_enabled,
            priority=req.priority,
            capabilities=req.capabilities,
            config_schema=req.config_schema,
        )
        return ApiResponse(
            code=200,
            message="success",
            data=ProviderResponse(
                id=provider.id,
                code=provider.code,
                name=provider.name,
                display_name=provider.display_name,
                api_type=provider.api_type,
                base_url=provider.base_url,
                doc_url=provider.doc_url,
                icon=provider.icon,
                is_enabled=provider.is_enabled,
                priority=provider.priority,
                capabilities=provider.capabilities,
                config_schema=provider.config_schema,
            ),
        )
    except Exception as exc:
        # SECURITY (VULN-069): do not echo raw exception text to client — it
        # may contain internal paths / SQL / secret material captured in the
        # traceback. Full detail is in logs via logger.exception above.
        logger.exception("Failed to create provider", extra={"data": {"error_class": type(exc).__name__}})
        raise HTTPException(status_code=400, detail="Failed to create provider") from exc


@router.put("/batch-toggle", response_model=ApiResponse[dict[str, int]])
async def batch_toggle_providers(
    req: ProviderBatchToggleRequest,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Batch toggle provider enabled state."""
    updated = await registry.batch_toggle_providers(req.ids, req.enabled)
    return ApiResponse(data={"updated": updated})


@router.put("/{provider_id}", response_model=ApiResponse[ProviderResponse])
async def update_provider(
    provider_id: int,
    req: ProviderUpdate,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Update provider information."""
    updates = {}
    fields_set = req.model_fields_set
    if "name" in fields_set:
        updates["name"] = req.name
    if "display_name" in fields_set:
        updates["display_name"] = req.display_name
    if "api_type" in fields_set:
        updates["api_type"] = req.api_type
    if "base_url" in fields_set:
        updates["base_url"] = req.base_url
    if "doc_url" in fields_set:
        updates["doc_url"] = req.doc_url
    if "icon" in fields_set:
        updates["icon"] = req.icon
    if "is_enabled" in fields_set:
        updates["is_enabled"] = req.is_enabled
    if "priority" in fields_set:
        updates["priority"] = req.priority
    if "capabilities" in fields_set:
        updates["capabilities"] = req.capabilities
    if "config_schema" in fields_set:
        updates["config_schema"] = req.config_schema

    provider = await registry.update_provider(provider_id, updates)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    return ApiResponse(
        code=200,
        message="success",
        data=ProviderResponse(
            id=provider.id,
            code=provider.code,
            name=provider.name,
            display_name=provider.display_name,
            api_type=provider.api_type,
            base_url=provider.base_url,
            doc_url=provider.doc_url,
            icon=provider.icon,
            is_enabled=provider.is_enabled,
            priority=provider.priority,
            capabilities=provider.capabilities,
            config_schema=provider.config_schema,
        ),
    )


@router.delete("/{provider_id}", response_model=ApiResponse[bool])
async def delete_provider(
    provider_id: int,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Delete a provider and its models."""
    deleted = await registry.delete_provider(provider_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Provider not found")
    return ApiResponse(code=200, message="success", data=True)


@router.get("/{provider_code}/models", response_model=ApiResponse[list[ModelResponse]])
async def list_provider_models(
    provider_code: str,
    enabled_only: bool = True,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """List models for a provider."""
    models = await registry.list_models(provider_code=provider_code, enabled_only=enabled_only)
    return ApiResponse(
        data=[build_model_response(m) for m in models],
    )


@router.post("/{provider_code}/models", response_model=ApiResponse[ModelResponse])
async def create_model(
    provider_code: str,
    req: ModelCreate,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Create a new model for a provider."""
    try:
        model = await registry.create_model(
            provider_code=provider_code,
            model_id=req.model_id,
            display_name=req.display_name,
            model_type=req.model_type,
            context_window=req.context_window,
            max_output_tokens=req.max_output_tokens,
            input_cost_per_1m=req.input_cost_per_1m,
            output_cost_per_1m=req.output_cost_per_1m,
            cached_input_cost_per_1m=req.cached_input_cost_per_1m,
            capabilities=req.capabilities,
            is_enabled=req.is_enabled,
        )
        if not model:
            raise HTTPException(status_code=404, detail="Provider not found")
        return ApiResponse(
            code=200,
            message="success",
            data=build_model_response(model),
        )
    except HTTPException:
        raise
    except Exception as exc:
        # SECURITY (VULN-069): generic client error, full detail to logs.
        logger.exception("Failed to create model", extra={"data": {"error_class": type(exc).__name__}})
        raise HTTPException(status_code=400, detail="Failed to create model") from exc


# ============================================================
# Model Endpoints
# ============================================================

@router.get("/models", response_model=ApiResponse[list[ModelResponse]])
async def list_all_models(
    model_type: str | None = None,
    enabled_only: bool = True,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """List all models across providers."""
    models = await registry.list_models(model_type=model_type, enabled_only=enabled_only)
    return ApiResponse(
        data=[build_model_response(m) for m in models],
    )


@router.put("/models/{model_id}", response_model=ApiResponse[ModelResponse])
async def update_model(
    model_id: int,
    req: ModelUpdate,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Update model information."""
    updates = {}
    fields_set = req.model_fields_set
    if "display_name" in fields_set:
        updates["display_name"] = req.display_name
    if "model_type" in fields_set:
        updates["model_type"] = req.model_type
    if "context_window" in fields_set:
        updates["context_window"] = req.context_window
    if "max_output_tokens" in fields_set:
        updates["max_output_tokens"] = req.max_output_tokens
    if "input_cost_per_1k" in fields_set:
        updates["input_cost_per_1k"] = req.input_cost_per_1k
    if "output_cost_per_1k" in fields_set:
        updates["output_cost_per_1k"] = req.output_cost_per_1k
    if "input_cost_per_1m" in fields_set:
        updates["input_cost_per_1m"] = req.input_cost_per_1m
    if "output_cost_per_1m" in fields_set:
        updates["output_cost_per_1m"] = req.output_cost_per_1m
    if "cached_input_cost_per_1m" in fields_set:
        updates["cached_input_cost_per_1m"] = req.cached_input_cost_per_1m
    if "capabilities" in fields_set:
        updates["capabilities"] = req.capabilities
    if "is_enabled" in fields_set:
        updates["is_enabled"] = req.is_enabled

    model = await registry.update_model(model_id, updates)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return ApiResponse(
        code=200,
        message="success",
        data=build_model_response(model),
    )


@router.delete("/models/{model_id}", response_model=ApiResponse[bool])
async def delete_model(
    model_id: int,
    registry: ProviderRegistry = Depends(get_provider_registry),
    pool: asyncpg.Pool = Depends(get_pg_pool),
):
    """Delete a model.

    Note: Related ai_task_routing entries will have their model references
    automatically set to NULL via FK constraints.
    """
    # Optional: Check and warn if model is in use (for better UX)
    async with pool.acquire() as conn:
        usage_count = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM ai_task_routing
            WHERE primary_model_id = $1 OR fallback_model_id = $1
            """,
            model_id,
        )

    deleted = await registry.delete_model(model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Model not found")

    # Info message if model was in use
    message = "success"
    if usage_count and usage_count > 0:
        message = f"Model deleted. {usage_count} task routing(s) updated to use default model."

    return ApiResponse(code=200, message=message, data=True)


@router.post("/{provider_code}/models/remote", response_model=ApiResponse[ModelSyncResponse])
async def fetch_remote_models(
    provider_code: str,
    req: ModelSyncRequest,
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
    registry: ProviderRegistry = Depends(get_provider_registry),
    fetcher: RemoteModelFetcher = Depends(get_remote_model_fetcher),
):
    """Fetch remote model list and insert into database."""
    provider = await registry.get_provider(provider_code)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    try:
        credential = await resolver.get_credential(
            provider_code=provider_code,
            user_id=user.user_id,
            credential_id=req.credential_id,
        )
    except Exception as e:
        logger.warning("Failed to decrypt credential for provider %s: %s", provider_code, e)
        raise HTTPException(
            status_code=400,
            detail="无法解密 API Key（可能密钥配置已变更）。请删除并重新添加凭证。",
        )
    if not credential:
        raise HTTPException(status_code=404, detail="Credential not found")

    try:
        models = await fetcher.fetch_models(provider, credential)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.warning(
            "remote_model_fetch_failed provider=%s api_type=%s error=%s",
            provider.code,
            provider.api_type,
            exc,
        )
        raise HTTPException(status_code=502, detail=format_remote_fetch_error(exc))

    inserted = await registry.bulk_insert_models(provider_code, models)

    return ApiResponse(
        data=ModelSyncResponse(
            inserted=inserted,
            total=len(models),
        ),
    )


@router.delete("/{provider_code}/models", response_model=ApiResponse[dict[str, int]])
async def delete_models_by_provider(
    provider_code: str,
    source: str | None = None,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Delete models by provider (optionally remote only)."""
    deleted = await registry.delete_models_by_provider(provider_code, source=source)
    return ApiResponse(data={"deleted": deleted})


@router.put("/{provider_code}/models/batch-toggle", response_model=ApiResponse[dict[str, int]])
async def batch_toggle_models(
    provider_code: str,
    req: ModelBatchToggleRequest,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Batch toggle model enabled state."""
    updated = await registry.batch_toggle_models(req.ids, req.enabled)
    return ApiResponse(data={"updated": updated})


@router.put("/{provider_code}/models/sort", response_model=ApiResponse[dict[str, int]])
async def update_model_sort(
    provider_code: str,
    req: ModelSortRequest,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Update model sort order."""
    updated = await registry.update_models_sort(
        [{"id": item.id, "sort": item.sort} for item in req.items]
    )
    return ApiResponse(data={"updated": updated})


# ============================================================
# Credential Endpoints
# ============================================================

@router.post("/credentials", response_model=ApiResponse[dict[str, int]])
async def create_credential(
    req: CredentialCreate,
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
):
    """Save a new API credential."""
    user_id = user.user_id
    
    try:
        cred_id = await resolver.save_credential(
            provider_code=req.provider_code,
            api_key=req.api_key,
            user_id=user_id,
            name=req.name,
            base_url_override=req.base_url_override,
            is_default=req.is_default,
            extra_config=req.extra_config,
        )
        return ApiResponse(data={"id": cred_id})
    except Exception as e:
        # SECURITY (VULN-069): don't leak internal exception text (may include
        # connection strings / SQL fragments); rely on logs for diagnosis.
        logger.exception("Failed to save credential", extra={"data": {"error_class": type(e).__name__}})
        raise HTTPException(status_code=400, detail="Failed to save credential") from e


@router.get("/credentials", response_model=ApiResponse[list[CredentialResponse]])
async def list_credentials(
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
):
    """List user's credentials."""
    user_id = user.user_id
    credentials = await resolver.list_credentials(user_id=user_id)
    return ApiResponse(
        data=[
            CredentialResponse(
                id=c["id"],
                name=c["name"],
                api_key_hint=c["api_key_hint"],
                provider_code=c["provider_code"],
                provider_name=c["provider_name"],
                base_url_override=c["base_url_override"],
                extra_config=c.get("extra_config"),
                is_default=c["is_default"],
                is_enabled=c["is_enabled"],
                last_used_at=c["last_used_at"],
                last_error=c["last_error"],
                created_at=c["created_at"],
            )
            for c in credentials
        ],
    )


@router.get("/credentials/{credential_id}/reveal", response_model=ApiResponse[dict])
async def reveal_credential(
    credential_id: int,
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
):
    """
    Reveal the actual API key for a credential.
    
    This endpoint returns the decrypted API key for admin users.
    The key is encrypted in transit via HTTPS.
    """
    user_id = user.user_id
    try:
        credential = await resolver.get_credential_by_id(
            credential_id, 
            user_id=user_id, 
            decrypt_key=True
        )
    except Exception as e:
        logger.warning(f"Failed to decrypt credential {credential_id}: {e}")
        raise HTTPException(
            status_code=400, 
            detail="无法解密 API Key（可能密钥配置已变更）。请删除并重新添加凭证。"
        )
    
    if not credential:
        raise HTTPException(status_code=404, detail="Credential not found")

    logger.warning(
        "Credential revealed",
        extra={
            "credential_id": credential_id,
            "user_id": getattr(user, 'user_id', 'unknown'),
            "action": "credential_reveal",
        },
    )

    return ApiResponse(data={
        "id": credential["id"],
        "api_key": credential["api_key"],
    })


@router.delete("/credentials/{credential_id}", response_model=ApiResponse[bool])
async def delete_credential(
    credential_id: int,
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
):
    """Delete a credential."""
    user_id = user.user_id
    deleted = await resolver.delete_credential(credential_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Credential not found")
    return ApiResponse(data=True)


@router.post("/credentials/{credential_id}/test", response_model=ApiResponse[CredentialTestResponse])
async def test_credential(
    credential_id: int,
    req: CredentialTestRequest,
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Test a credential by making a simple API call."""
    # Get credential
    try:
        credential = await resolver.get_credential(
            provider_code="",  # Will be resolved by credential_id
            credential_id=credential_id,
            user_id=user.user_id,
        )
    except Exception as e:
        logger.warning("Failed to decrypt credential %s: %s", credential_id, e)
        raise HTTPException(
            status_code=400,
            detail="无法解密 API Key（可能密钥配置已变更）。请删除并重新添加凭证。",
        )
    if not credential:
        raise HTTPException(status_code=404, detail="Credential not found")
    
    # Get provider info
    provider = await registry.get_provider(credential.provider_code)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    # Determine model name with proper prefix for LiteLLM routing
    # LiteLLM auto-detects providers based on model name prefixes (e.g., gemini-* -> Vertex AI)
    # We must add explicit prefixes to force correct routing for custom endpoints
    model_name = req.model_id
    if provider.api_type in ("openai_compat", "custom"):
        # Force OpenAI-compatible protocol
        if not model_name.startswith("openai/"):
            model_name = f"openai/{model_name}"
    elif provider.api_type == "azure":
        # Azure OpenAI Service
        if not model_name.startswith("azure/"):
            model_name = f"azure/{model_name}"
    # anthropic/google: LiteLLM handles natively with api_key + api_base
    
    # SECURITY (VULN-057): even the admin "test" endpoint must not issue
    # SSRF against internal hosts (IMDS / internal services).
    from app.utils.url_validator import validate_external_url_async
    if credential.base_url and not await validate_external_url_async(credential.base_url):
        raise HTTPException(
            status_code=400,
            detail="Provider base_url resolves to an internal or private network",
        )
    # Test with a simple completion
    start = time.perf_counter()
    try:
        response = await acompletion(
            model=model_name,
            messages=[{"role": "user", "content": "Say 'OK'"}],
            api_key=credential.api_key,
            api_base=credential.base_url,
            max_tokens=5,
        )
        latency_ms = (time.perf_counter() - start) * 1000
        
        # Update last used
        await resolver.update_last_used(credential_id, error=None)
        
        return ApiResponse(
            data=CredentialTestResponse(
                success=True,
                message=f"API connected successfully. Response: {response.choices[0].message.content}",
                latency_ms=latency_ms,
            ),
        )
    except Exception as e:
        latency_ms = (time.perf_counter() - start) * 1000
        # SECURITY (VULN-066): LiteLLM can put the request's Bearer / sk- key
        # into the exception body when the upstream returns 401/429 etc.
        # Redact before both persisting and returning.
        error_msg = _redact_secrets(str(e), credential.api_key)

        # Update last error
        await resolver.update_last_used(credential_id, error=error_msg)

        return ApiResponse(
            data=CredentialTestResponse(
                success=False,
                message=f"API test failed: {error_msg}",
                latency_ms=latency_ms,
            ),
        )


@router.post("/credentials/{credential_id}/test-embedding", response_model=ApiResponse[CredentialTestResponse])
async def test_embedding_credential(
    credential_id: int,
    req: CredentialTestRequest,
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Test a credential by making an embedding API call."""
    from litellm import aembedding

    # Get credential
    try:
        credential = await resolver.get_credential(
            provider_code="",
            credential_id=credential_id,
            user_id=user.user_id,
        )
    except Exception as e:
        logger.warning("Failed to decrypt credential %s: %s", credential_id, e)
        raise HTTPException(
            status_code=400,
            detail="无法解密 API Key（可能密钥配置已变更）。请删除并重新添加凭证。",
        )
    if not credential:
        raise HTTPException(status_code=404, detail="Credential not found")

    # Get provider info
    provider = await registry.get_provider(credential.provider_code)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    # Determine model name with proper prefix
    model_name = req.model_id
    if provider.api_type in ("openai_compat", "custom"):
        if not model_name.startswith("openai/"):
            model_name = f"openai/{model_name}"
    elif provider.api_type == "azure":
        if not model_name.startswith("azure/"):
            model_name = f"azure/{model_name}"

    # SECURITY (VULN-057): SSRF guard also applies to the embedding test path.
    from app.utils.url_validator import validate_external_url_async
    if credential.base_url and not await validate_external_url_async(credential.base_url):
        raise HTTPException(
            status_code=400,
            detail="Provider base_url resolves to an internal or private network",
        )
    # Test with embedding
    start = time.perf_counter()
    try:
        response = await aembedding(
            model=model_name,
            input=["Hello, this is a test for embedding model."],
            api_key=credential.api_key,
            api_base=credential.base_url,
        )
        latency_ms = (time.perf_counter() - start) * 1000

        # Get vector dimension
        dimension = len(response.data[0]["embedding"])

        # Update last used
        await resolver.update_last_used(credential_id, error=None)

        return ApiResponse(
            data=CredentialTestResponse(
                success=True,
                message=f"Embedding test OK, dimension: {dimension}",
                latency_ms=latency_ms,
            ),
        )
    except Exception as e:
        latency_ms = (time.perf_counter() - start) * 1000
        # SECURITY (VULN-066): redact potential Bearer / sk- tokens leaked in
        # the upstream 401/429 body before it hits logs or the client.
        error_msg = _redact_secrets(str(e), credential.api_key)

        await resolver.update_last_used(credential_id, error=error_msg)

        return ApiResponse(
            data=CredentialTestResponse(
                success=False,
                message=f"Embedding test failed: {error_msg}",
                latency_ms=latency_ms,
            ),
        )


# ============================================================
# Task Routing Endpoints
# ============================================================

@router.get("/tasks", response_model=ApiResponse[list[TaskTypeResponse]])
async def list_task_types(
    model_router: ModelRouter = Depends(get_model_router),
):
    """List all AI task types."""
    tasks = await model_router.list_task_types()
    return ApiResponse(
        data=[TaskTypeResponse(**t) for t in tasks],
    )


def _model_info_to_response(info: Any | None) -> ModelResponse | None:
    if info is None:
        return None
    return ModelResponse(
        id=info.id,
        provider_id=info.provider_id,
        provider_code=info.provider_code,
        model_id=info.model_id,
        display_name=info.display_name,
        model_type=info.model_type,
        context_window=info.context_window,
        max_output_tokens=info.max_output_tokens,
        input_cost_per_1k=info.input_cost_per_1k,
        output_cost_per_1k=info.output_cost_per_1k,
        input_cost_per_1m=info.input_cost_per_1m,
        output_cost_per_1m=info.output_cost_per_1m,
        cached_input_cost_per_1m=info.cached_input_cost_per_1m,
        capabilities=info.capabilities,
        is_enabled=info.is_enabled,
    )


@router.get("/routing/{task_type}", response_model=ApiResponse[Optional[RoutingResponse]])
async def get_routing(
    task_type: str,
    user: UserClaims = Depends(require_admin),
    model_router: ModelRouter = Depends(get_model_router),
    provider_registry: ProviderRegistry = Depends(get_provider_registry),
    credential_resolver: CredentialResolver = Depends(get_credential_resolver),
):
    """Get routing configuration for a task type.

    Admin UI (SearchConfig / AI Config) manages *system-default* routing
    (``user_id IS NULL``), not per-admin overrides. Background workers such as
    the embedding index job invoke ``llm_router.embed()`` without a user_id,
    which matches only system-default rows — so the admin UI must read/write
    the same row to stay in sync with runtime.

    This endpoint intentionally bypasses ``resolve_routing`` (which returns
    None the moment credential resolution fails) so a freshly-saved
    ``primary_model_id`` always appears in the UI even before the admin has
    wired up a credential. Credential status is surfaced separately via
    ``credential_configured``.
    """
    stored = await model_router.get_routing_db(task_type, user_id=None)

    if not stored:
        return ApiResponse(data=None)

    primary_info = None
    if stored.get("primary_model_id") is not None:
        primary_info = await provider_registry.get_model_by_id(stored["primary_model_id"])
    fallback_info = None
    if stored.get("fallback_model_id") is not None:
        fallback_info = await provider_registry.get_model_by_id(stored["fallback_model_id"])

    primary_model = _model_info_to_response(primary_info)
    fallback_model = _model_info_to_response(fallback_info)

    credential_configured = False
    if primary_model is not None:
        try:
            cred = await credential_resolver.get_credential(
                primary_model.provider_code,
                user_id=None,
                credential_id=stored.get("credential_id"),
            )
            credential_configured = cred is not None
        except Exception as exc:  # noqa: BLE001
            logger.warning("credential probe failed for %s: %s", task_type, exc)
            credential_configured = False

    return ApiResponse(
        data=RoutingResponse(
            task_type=task_type,
            primary_model=primary_model,
            fallback_model=fallback_model,
            config=stored.get("config_override") or {},
            credential_id=stored.get("credential_id"),
            credential_configured=credential_configured,
        ),
    )


@router.put("/routing/{task_type}", response_model=ApiResponse[bool])
async def update_routing(
    task_type: str,
    req: RoutingUpdateRequest,
    user: UserClaims = Depends(require_admin),
    model_router: ModelRouter = Depends(get_model_router),
):
    """Update routing configuration for a task type.

    Writes to the system-default row (``user_id IS NULL``); see ``get_routing``
    for rationale. AetherBlog is a single-admin blog where all AI routing is
    site-wide, so admin-scoped routing rows only cause drift between UI and
    runtime (which calls ``embed()`` without a user_id).
    """
    fields_set = req.model_fields_set
    update_primary = "primary_model_id" in fields_set
    update_fallback = "fallback_model_id" in fields_set
    update_credential = "credential_id" in fields_set
    update_config = "config_override" in fields_set

    await model_router.update_routing(
        task_type=task_type,
        primary_model_id=req.primary_model_id if update_primary else None,
        fallback_model_id=req.fallback_model_id if update_fallback else None,
        credential_id=req.credential_id if update_credential else None,
        config_override=req.config_override if update_config else None,
        update_primary=update_primary,
        update_fallback=update_fallback,
        update_credential=update_credential,
        update_config=update_config,
        user_id=None,
    )

    return ApiResponse(data=True)
