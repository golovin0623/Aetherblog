# ref: §5.1 - Provider Management API
"""
FastAPI routes for AI provider and credential management.
"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException
import httpx
from litellm import acompletion

from app.api.deps import (
    get_provider_registry,
    get_credential_resolver,
    get_model_router,
    get_remote_model_fetcher,
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
)
from app.services.provider_registry import ProviderRegistry
from app.services.credential_resolver import CredentialResolver
from app.services.model_router import ModelRouter
from app.services.remote_model_fetcher import RemoteModelFetcher

logger = logging.getLogger("ai-service")

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
        logger.exception("Failed to create provider")
        raise HTTPException(status_code=400, detail=str(exc))


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
        data=[
            ModelResponse(
                id=m.id,
                provider_id=m.provider_id,
                provider_code=m.provider_code,
                model_id=m.model_id,
                display_name=m.display_name,
                model_type=m.model_type,
                context_window=m.context_window,
                max_output_tokens=m.max_output_tokens,
                input_cost_per_1k=m.input_cost_per_1k,
                output_cost_per_1k=m.output_cost_per_1k,
                capabilities=m.capabilities,
                is_enabled=m.is_enabled,
            )
            for m in models
        ],
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
            input_cost_per_1k=req.input_cost_per_1k,
            output_cost_per_1k=req.output_cost_per_1k,
            capabilities=req.capabilities,
            is_enabled=req.is_enabled,
        )
        if not model:
            raise HTTPException(status_code=404, detail="Provider not found")
        return ApiResponse(
            code=200,
            message="success",
            data=ModelResponse(
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
                capabilities=model.capabilities,
                is_enabled=model.is_enabled,
            ),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to create model")
        raise HTTPException(status_code=400, detail=str(exc))


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
        data=[
            ModelResponse(
                id=m.id,
                provider_id=m.provider_id,
                provider_code=m.provider_code,
                model_id=m.model_id,
                display_name=m.display_name,
                model_type=m.model_type,
                context_window=m.context_window,
                max_output_tokens=m.max_output_tokens,
                input_cost_per_1k=m.input_cost_per_1k,
                output_cost_per_1k=m.output_cost_per_1k,
                capabilities=m.capabilities,
                is_enabled=m.is_enabled,
            )
            for m in models
        ],
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
        data=ModelResponse(
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
            capabilities=model.capabilities,
            is_enabled=model.is_enabled,
        ),
    )


@router.delete("/models/{model_id}", response_model=ApiResponse[bool])
async def delete_model(
    model_id: int,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Delete a model."""
    deleted = await registry.delete_model(model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Model not found")
    return ApiResponse(code=200, message="success", data=True)


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

    credential = await resolver.get_credential(
        provider_code=provider_code,
        user_id=user.user_id,
        credential_id=req.credential_id,
    )
    if not credential:
        raise HTTPException(status_code=404, detail="Credential not found")

    try:
        models = await fetcher.fetch_models(provider, credential)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.warning(
            "remote_model_fetch_failed provider=%s api_type=%s base_url=%s error=%s",
            provider.code,
            provider.api_type,
            credential.base_url,
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
        logger.exception("Failed to save credential")
        raise HTTPException(status_code=400, detail=str(e))


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
    credential = await resolver.get_credential(
        provider_code="",  # Will be resolved by credential_id
        credential_id=credential_id,
        user_id=user.user_id,
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
        error_msg = str(e)
        
        # Update last error
        await resolver.update_last_used(credential_id, error=error_msg)
        
        return ApiResponse(
            data=CredentialTestResponse(
                success=False,
                message=f"API test failed: {error_msg}",
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


@router.get("/routing/{task_type}", response_model=ApiResponse[RoutingResponse | None])
async def get_routing(
    task_type: str,
    user: UserClaims = Depends(require_admin),
    model_router: ModelRouter = Depends(get_model_router),
):
    """Get routing configuration for a task type."""
    user_id = user.user_id
    routing = await model_router.resolve_routing(task_type, user_id=user_id)
    
    if not routing:
        return ApiResponse(data=None)
    
    primary_model = ModelResponse(
        id=routing.model.id,
        provider_id=routing.model.provider_id,
        provider_code=routing.model.provider_code,
        model_id=routing.model.model_id,
        display_name=routing.model.display_name,
        model_type=routing.model.model_type,
        context_window=routing.model.context_window,
        max_output_tokens=routing.model.max_output_tokens,
        input_cost_per_1k=routing.model.input_cost_per_1k,
        output_cost_per_1k=routing.model.output_cost_per_1k,
        capabilities=routing.model.capabilities,
        is_enabled=routing.model.is_enabled,
    )
    
    fallback_model = None
    if routing.fallback_model:
        fallback_model = ModelResponse(
            id=routing.fallback_model.id,
            provider_id=routing.fallback_model.provider_id,
            provider_code=routing.fallback_model.provider_code,
            model_id=routing.fallback_model.model_id,
            display_name=routing.fallback_model.display_name,
            model_type=routing.fallback_model.model_type,
            context_window=routing.fallback_model.context_window,
            max_output_tokens=routing.fallback_model.max_output_tokens,
            input_cost_per_1k=routing.fallback_model.input_cost_per_1k,
            output_cost_per_1k=routing.fallback_model.output_cost_per_1k,
            capabilities=routing.fallback_model.capabilities,
            is_enabled=routing.fallback_model.is_enabled,
        )
    
    return ApiResponse(
        data=RoutingResponse(
            task_type=task_type,
            primary_model=primary_model,
            fallback_model=fallback_model,
            config=routing.config,
        ),
    )


@router.put("/routing/{task_type}", response_model=ApiResponse[bool])
async def update_routing(
    task_type: str,
    req: RoutingUpdateRequest,
    user: UserClaims = Depends(require_admin),
    model_router: ModelRouter = Depends(get_model_router),
):
    """Update routing configuration for a task type."""
    user_id = user.user_id
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
        user_id=user_id,
    )
    
    return ApiResponse(data=True)
