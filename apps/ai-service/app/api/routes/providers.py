# 引用: §5.1 - 提供商管理 API
"""
AI provider 与凭证管理的 FastAPI 路由。
"""
from __future__ import annotations

import logging
import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
import httpx
import asyncpg
from litellm import acompletion

from app.api.deps import (
    get_provider_registry,
    get_credential_resolver,
    get_global_pricing_service,
    get_model_router,
    get_remote_model_fetcher,
    get_pg_pool,
    get_llm_router,
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
    GlobalPricingResponse,
    GlobalPricingUpsert,
    GlobalPricingCoverageRow,
    GlobalPricingApplyRequest,
    GlobalPricingApplyResponse,
    PricingCatalogSyncRequest,
    PricingSyncProposalResponse,
    PricingCatalogPreviewResponse,
    PricingCatalogSyncResponse,
)
from app.services.pricing_catalog import PricingCatalogUnavailable
from app.services.provider_registry import ProviderRegistry, ModelInfo
from app.services.credential_resolver import CredentialResolver
from app.services.global_pricing import GlobalPricingService
from app.services.model_router import ModelRouter
from app.services.remote_model_fetcher import RemoteModelFetcher
from app.services.llm_router import LlmRouter

logger = logging.getLogger("ai-service")


# SECURITY (VULN-066 / VULN-165)：LiteLLM 与上游 provider 可能在错误消息中
# 回显原始 Bearer token 或 ``sk-...`` API key。任何把 ``str(exc)`` 暴露给
# 调用方或写入日志的路径，都必须先经过 ``_redact_secrets``。泄露异常正文
# 是 rate-limit / auth 失败场景下经典的 API key 外泄通道。
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


def _assert_header_encodable(api_key: str, base_url: Optional[str]) -> None:
    """防止用户把含非 ASCII 智能引号 / 长破折号的凭证粘贴进来。

    HTTP 头必须可用 latin-1 编码，URL 必须是 ASCII；如果用户粘贴的 api_key
    或 base_url 在字处理软件中被自动替换（U+2014 长破折号、弯引号、全角
    冒号……），httpx 会在传输层深处抛出难以理解的 UnicodeEncodeError。
    这里在保存阶段就抛出清晰的 400 错误。
    """
    def _first_bad(text: str) -> tuple[int, str] | None:
        for idx, ch in enumerate(text):
            if ord(ch) > 0x7F:
                return idx, ch
        return None

    if api_key:
        bad = _first_bad(api_key)
        if bad:
            idx, ch = bad
            raise HTTPException(
                status_code=400,
                detail=(
                    f"API Key 含非 ASCII 字符（U+{ord(ch):04X} 在第 {idx + 1} 位），"
                    "常见于从 Word/备忘录粘贴时被自动替换成破折号或中文引号。"
                    "请重新复制原始密钥并保存。"
                ),
            )
    if base_url:
        bad = _first_bad(base_url)
        if bad:
            idx, ch = bad
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Base URL 含非 ASCII 字符（U+{ord(ch):04X} 在第 {idx + 1} 位）。"
                    "请检查供应商 Base URL 是否混入了中文符号或破折号。"
                ),
            )

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
# Provider 端点
# ============================================================

@router.get("", response_model=ApiResponse[list[ProviderResponse]])
async def list_providers(
    enabled_only: bool = True,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """列出所有 AI provider。"""
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
    """创建新的 provider。"""
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
        # SECURITY (VULN-069)：不要把原始异常文本回显给客户端 —— 它可能
        # 包含 traceback 捕获的内部路径 / SQL / 机密素材。详细信息上面已
        # 通过 logger.exception 记录到日志。
        logger.exception("Failed to create provider", extra={"data": {"error_class": type(exc).__name__}})
        raise HTTPException(status_code=400, detail="Failed to create provider") from exc


@router.put("/batch-toggle", response_model=ApiResponse[dict[str, int]])
async def batch_toggle_providers(
    req: ProviderBatchToggleRequest,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """批量切换 provider 的启用状态。"""
    updated = await registry.batch_toggle_providers(req.ids, req.enabled)
    return ApiResponse(data={"updated": updated})


@router.put("/{provider_id}", response_model=ApiResponse[ProviderResponse])
async def update_provider(
    provider_id: int,
    req: ProviderUpdate,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """更新 provider 信息。"""
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
    """删除一个 provider 及其下的模型。"""
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
    """列出指定 provider 的模型。"""
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
    """为指定 provider 创建新模型。"""
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
        # SECURITY (VULN-069)：返回通用的客户端错误，详细信息只写入日志。
        logger.exception("Failed to create model", extra={"data": {"error_class": type(exc).__name__}})
        raise HTTPException(status_code=400, detail="Failed to create model") from exc


# ============================================================
# Model 端点
# ============================================================

@router.get("/models", response_model=ApiResponse[list[ModelResponse]])
async def list_all_models(
    model_type: str | None = None,
    enabled_only: bool = True,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """列出全部 provider 下的所有模型。"""
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
    """更新模型信息。"""
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
    """删除一个模型。

    注意：相关 ai_task_routing 中的模型引用会通过外键约束被自动置为 NULL。
    """
    # 可选：检查模型是否仍被引用，提示更友好的提示信息
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

    # 若模型曾被引用，给出提示信息
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
    """拉取远端模型列表并写入数据库。"""
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
    """按 provider 删除模型（可选仅删除远端来源的模型）。"""
    deleted = await registry.delete_models_by_provider(provider_code, source=source)
    return ApiResponse(data={"deleted": deleted})


@router.put("/{provider_code}/models/batch-toggle", response_model=ApiResponse[dict[str, int]])
async def batch_toggle_models(
    provider_code: str,
    req: ModelBatchToggleRequest,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """批量切换模型的启用状态。"""
    updated = await registry.batch_toggle_models(req.ids, req.enabled)
    return ApiResponse(data={"updated": updated})


@router.put("/{provider_code}/models/sort", response_model=ApiResponse[dict[str, int]])
async def update_model_sort(
    provider_code: str,
    req: ModelSortRequest,
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """更新模型排序。"""
    updated = await registry.update_models_sort(
        [{"id": item.id, "sort": item.sort} for item in req.items]
    )
    return ApiResponse(data={"updated": updated})


# ============================================================
# Credential 端点
# ============================================================

@router.post("/credentials", response_model=ApiResponse[dict[str, int]])
async def create_credential(
    req: CredentialCreate,
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
):
    """保存新的 API 凭证。"""
    user_id = user.user_id

    # 在保存阶段就拒绝非 ASCII 智能引号 / 长破折号，避免下游 HTTP 调用
    # 抛出难以排查的 UnicodeEncodeError。
    _assert_header_encodable(req.api_key or "", req.base_url_override)

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
        # SECURITY (VULN-069)：不要泄露内部异常文本（可能含连接串 / SQL 片段），
        # 排障改为依赖日志。
        logger.exception("Failed to save credential", extra={"data": {"error_class": type(e).__name__}})
        raise HTTPException(status_code=400, detail="Failed to save credential") from e


@router.get("/credentials", response_model=ApiResponse[list[CredentialResponse]])
async def list_credentials(
    user: UserClaims = Depends(require_admin),
    resolver: CredentialResolver = Depends(get_credential_resolver),
):
    """列出当前用户的凭证。"""
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
    查看凭证对应的真实 API key。

    本端点向管理员返回解密后的 API key。
    传输过程依赖 HTTPS 进行加密。
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
    """删除一条凭证。"""
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
    """通过一次简单的 API 调用来测试凭证可用性。"""
    # 获取凭证
    try:
        credential = await resolver.get_credential(
            provider_code="",  # 将通过 credential_id 解析
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
    
    # 获取 provider 信息
    provider = await registry.get_provider(credential.provider_code)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    # 为 LiteLLM 路由确定带正确前缀的模型名
    # LiteLLM 会按模型名前缀自动识别 provider（例如 gemini-* -> Vertex AI），
    # 因此自定义端点必须显式加前缀以强制正确路由。
    model_name = req.model_id
    if provider.api_type in ("openai_compat", "custom"):
        # 强制走 OpenAI 兼容协议
        if not model_name.startswith("openai/"):
            model_name = f"openai/{model_name}"
    elif provider.api_type == "azure":
        # Azure OpenAI Service
        if not model_name.startswith("azure/"):
            model_name = f"azure/{model_name}"
    # anthropic/google：LiteLLM 通过 api_key + api_base 原生处理

    # SECURITY (VULN-057)：即便是管理员的“测试”端点，也不能向内部主机
    # 发起 SSRF（IMDS / 内部服务）。
    from app.utils.url_validator import validate_external_url_async
    if credential.base_url and not await validate_external_url_async(credential.base_url):
        raise HTTPException(
            status_code=400,
            detail="Provider base_url resolves to an internal or private network",
        )
    # 拦截粘贴到凭证字段的非 ASCII 智能引号 / 长破折号 ——
    # 否则 httpx 会在传输层深处抛出难以解读的 UnicodeEncodeError。
    _assert_header_encodable(credential.api_key, credential.base_url)
    # 通过一次简单 completion 调用进行测试
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

        # 更新 last_used_at
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
        # SECURITY (VULN-066)：当上游返回 401/429 等错误时，LiteLLM 可能把
        # 请求中的 Bearer / sk- key 嵌入到异常正文里。无论是持久化还是
        # 返回客户端，都要先脱敏。
        error_msg = _redact_secrets(str(e), credential.api_key)

        # 更新 last_error
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
    """通过一次 embedding API 调用来测试凭证。"""
    from litellm import aembedding

    # 获取凭证
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

    # 获取 provider 信息
    provider = await registry.get_provider(credential.provider_code)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    # 为模型名补全正确前缀
    model_name = req.model_id
    if provider.api_type in ("openai_compat", "custom"):
        if not model_name.startswith("openai/"):
            model_name = f"openai/{model_name}"
    elif provider.api_type == "azure":
        if not model_name.startswith("azure/"):
            model_name = f"azure/{model_name}"

    # SECURITY (VULN-057)：embedding 测试路径同样需要 SSRF 防护。
    from app.utils.url_validator import validate_external_url_async
    if credential.base_url and not await validate_external_url_async(credential.base_url):
        raise HTTPException(
            status_code=400,
            detail="Provider base_url resolves to an internal or private network",
        )
    # 拦截粘贴到凭证字段中的非 ASCII 智能引号 / 长破折号。
    _assert_header_encodable(credential.api_key, credential.base_url)
    # 通过 embedding 调用进行测试
    start = time.perf_counter()
    try:
        response = await aembedding(
            model=model_name,
            input=["Hello, this is a test for embedding model."],
            api_key=credential.api_key,
            api_base=credential.base_url,
        )
        latency_ms = (time.perf_counter() - start) * 1000

        # 获取向量维度
        dimension = len(response.data[0]["embedding"])

        # 更新 last_used_at
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
        # SECURITY (VULN-066)：在写入日志或返回客户端之前，先脱敏可能在
        # 上游 401/429 正文中泄露的 Bearer / sk- token。
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
# 全局模型价格端点（按 model_id 汇总，跨 provider 共享）
# ============================================================

def _global_pricing_to_response(row) -> GlobalPricingResponse:
    return GlobalPricingResponse(
        id=row.id,
        model_id=row.model_id,
        display_name=row.display_name,
        currency=row.currency,
        input_cost_per_1m=row.input_cost_per_1m,
        output_cost_per_1m=row.output_cost_per_1m,
        cached_input_cost_per_1m=row.cached_input_cost_per_1m,
        pricing=row.pricing,
        notes=row.notes,
        updated_at=row.updated_at,
        provider_count=row.provider_count,
        in_sync_count=row.in_sync_count,
    )


@router.get("/global-pricing", response_model=ApiResponse[list[GlobalPricingResponse]])
async def list_global_pricing(
    service: GlobalPricingService = Depends(get_global_pricing_service),
):
    """列出全部全局模型价格条目（含每个 model_id 的同步状态统计）。"""
    rows = await service.list_all()
    return ApiResponse(data=[_global_pricing_to_response(r) for r in rows])


@router.get(
    "/global-pricing/coverage",
    response_model=ApiResponse[list[GlobalPricingCoverageRow]],
)
async def global_pricing_coverage(
    enabled_only: bool = Query(
        True,
        description="仅统计供应商启用的模型（m.is_enabled AND p.is_enabled）；传 false 查看全量目录。",
    ),
    service: GlobalPricingService = Depends(get_global_pricing_service),
):
    """返回 distinct model_id 的覆盖率视图。

    默认仅含「供应商启用」的模型；前端用这张表实现「全部 / 已配置 / 未配置 / 部分脱锚」过滤与一键编辑。
    """
    rows = await service.coverage(enabled_only=enabled_only)
    return ApiResponse(
        data=[
            GlobalPricingCoverageRow(
                model_id=r.model_id,
                display_name=r.display_name,
                provider_count=r.provider_count,
                has_global=r.has_global,
                in_sync_count=r.in_sync_count,
                out_of_sync_count=r.out_of_sync_count,
                missing_count=r.missing_count,
                global_input_per_1m=r.global_input_per_1m,
                global_output_per_1m=r.global_output_per_1m,
                global_cached_input_per_1m=r.global_cached_input_per_1m,
                currency=r.currency,
                providers=r.providers,
            )
            for r in rows
        ]
    )


# 注意：catalog 路由必须声明在 /global-pricing/{model_id:path} 之前，
# 否则 path 转换器会把 "catalog/preview" 当成 model_id 吞掉。
@router.post(
    "/global-pricing/catalog/preview",
    response_model=ApiResponse[PricingCatalogPreviewResponse],
)
async def preview_pricing_catalog_sync(
    req: PricingCatalogSyncRequest,
    service: GlobalPricingService = Depends(get_global_pricing_service),
):
    """预览：把（默认仅供应商启用的）model_id 匹配数据源价格，给出 diff。

    数据源默认 LiteLLM 内置价格表（USD / 1M tokens），离线可用。
    """
    try:
        source, source_model_count, proposals = await service.preview_catalog_sync(
            enabled_only=req.enabled_only,
            overwrite_existing=req.overwrite_existing,
            source=req.source,
        )
    except PricingCatalogUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    matched = sum(1 for p in proposals if p.matched_key is not None)
    applicable = sum(1 for p in proposals if p.will_apply)
    return ApiResponse(
        data=PricingCatalogPreviewResponse(
            source=source,
            source_model_count=source_model_count,
            total_candidates=len(proposals),
            matched_count=matched,
            applicable_count=applicable,
            proposals=[PricingSyncProposalResponse(**vars(p)) for p in proposals],
        )
    )


@router.post(
    "/global-pricing/catalog/sync",
    response_model=ApiResponse[PricingCatalogSyncResponse],
)
async def apply_pricing_catalog_sync(
    req: PricingCatalogSyncRequest,
    service: GlobalPricingService = Depends(get_global_pricing_service),
):
    """应用：把数据源价格写入全局表。

    - ``model_ids``：限定只同步这些（预览里勾选的）model_id；空 = 全部可同步项。
    - ``overwrite_existing``：False 时只为「未配置全局价格」的 model_id 写入，
      已有价格的一律跳过；True 时覆盖（更新会保留已有 notes / display_name）。
    """
    try:
        result = await service.apply_catalog_sync(
            model_ids=req.model_ids,
            enabled_only=req.enabled_only,
            overwrite_existing=req.overwrite_existing,
            source=req.source,
        )
    except PricingCatalogUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ApiResponse(
        data=PricingCatalogSyncResponse(
            source=result.source,
            total_candidates=result.total_candidates,
            matched=result.matched,
            created=result.created,
            updated=result.updated,
            skipped=result.skipped,
        )
    )


@router.get(
    "/global-pricing/{model_id:path}",
    response_model=ApiResponse[GlobalPricingResponse],
)
async def get_global_pricing(
    model_id: str,
    service: GlobalPricingService = Depends(get_global_pricing_service),
):
    """按 model_id 查询全局价格。"""
    row = await service.get_by_model_id(model_id)
    if not row:
        raise HTTPException(status_code=404, detail="Global pricing not found")
    return ApiResponse(data=_global_pricing_to_response(row))


@router.put(
    "/global-pricing/{model_id:path}",
    response_model=ApiResponse[GlobalPricingResponse],
)
async def upsert_global_pricing(
    model_id: str,
    req: GlobalPricingUpsert,
    service: GlobalPricingService = Depends(get_global_pricing_service),
):
    """新增 / 更新指定 model_id 的全局价格。

    URL 中的 ``model_id`` 会覆盖请求体里的 ``model_id``，确保一致。
    """
    try:
        row = await service.upsert(
            model_id=model_id,
            display_name=req.display_name,
            currency=req.currency or "USD",
            input_cost_per_1m=req.input_cost_per_1m,
            output_cost_per_1m=req.output_cost_per_1m,
            cached_input_cost_per_1m=req.cached_input_cost_per_1m,
            pricing=req.pricing or {},
            notes=req.notes,
        )
        return ApiResponse(data=_global_pricing_to_response(row))
    except Exception as exc:
        logger.exception(
            "Failed to upsert global pricing",
            extra={"data": {"error_class": type(exc).__name__, "model_id": model_id}},
        )
        raise HTTPException(status_code=400, detail="Failed to save global pricing") from exc


@router.delete("/global-pricing/{model_id:path}", response_model=ApiResponse[bool])
async def delete_global_pricing(
    model_id: str,
    service: GlobalPricingService = Depends(get_global_pricing_service),
):
    """删除指定 model_id 的全局价格条目。"""
    deleted = await service.delete(model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Global pricing not found")
    return ApiResponse(data=True)


@router.post(
    "/global-pricing/{model_id:path}/apply",
    response_model=ApiResponse[GlobalPricingApplyResponse],
)
async def apply_global_pricing(
    model_id: str,
    req: GlobalPricingApplyRequest,
    service: GlobalPricingService = Depends(get_global_pricing_service),
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """把 ``model_id`` 对应的全局价格批量应用到所有同名 ai_models 行。

    - ``provider_codes``：可选，用于把作用域限制到指定 provider；空 = 全部。
    - ``overwrite_existing``：False 时只填充原本缺失的字段；True 直接覆盖。
    """
    updated, skipped, target = await service.apply_to_models(
        model_id=model_id,
        provider_codes=req.provider_codes,
        overwrite_existing=req.overwrite_existing,
    )
    if target == 0:
        raise HTTPException(
            status_code=404,
            detail="No matching models found for this model_id",
        )
    # 失效 provider_registry 的缓存，确保后续 GET 拿到新价格
    registry.clear_cache()
    return ApiResponse(
        data=GlobalPricingApplyResponse(
            updated=updated,
            skipped=skipped,
            target_count=target,
        ),
    )


@router.post(
    "/models/{model_db_id}/sync-global-pricing",
    response_model=ApiResponse[GlobalPricingResponse],
)
async def sync_pricing_from_model_to_global(
    model_db_id: int,
    service: GlobalPricingService = Depends(get_global_pricing_service),
):
    """从指定 ai_models 行把价格写回 ai_global_pricing。

    用于「在某个供应商下编辑完模型价格后，一键同步到全局基准」的反向闭环。
    """
    row = await service.sync_from_model(model_db_id)
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    return ApiResponse(data=_global_pricing_to_response(row))


@router.post(
    "/models/{model_db_id}/sync-from-global",
    response_model=ApiResponse[GlobalPricingApplyResponse],
)
async def sync_single_model_from_global(
    model_db_id: int,
    service: GlobalPricingService = Depends(get_global_pricing_service),
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """从全局表把价格同步到指定 ai_models 行（不影响其他同名行）。

    用于「在单条模型详情面板里点击 ↺ 从全局回填」。
    """
    info = await registry.get_model_by_id(model_db_id)
    if not info:
        raise HTTPException(status_code=404, detail="Model not found")
    global_row = await service.get_by_model_id(info.model_id)
    if not global_row:
        raise HTTPException(status_code=404, detail="No global pricing for this model_id")

    updated, skipped, target = await service.apply_to_models(
        model_id=info.model_id,
        provider_codes=[info.provider_code],
        overwrite_existing=True,
    )
    registry.clear_cache()
    return ApiResponse(
        data=GlobalPricingApplyResponse(
            updated=updated,
            skipped=skipped,
            target_count=target,
        ),
    )


# ============================================================
# 任务路由端点
# ============================================================

@router.get("/tasks", response_model=ApiResponse[list[TaskTypeResponse]])
async def list_task_types(
    model_router: ModelRouter = Depends(get_model_router),
):
    """列出所有 AI task type。"""
    tasks = await model_router.list_task_types()
    return ApiResponse(
        data=[TaskTypeResponse(**t) for t in tasks],
    )


def _model_info_to_response(info: ModelInfo | None) -> ModelResponse | None:
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
    """获取指定 task type 的路由配置。

    管理后台 UI（SearchConfig / AI Config）管理的是 *系统默认* 路由
    （``user_id IS NULL``），并非按管理员维度的覆盖。后台 worker（例如
    embedding 索引任务）调用 ``llm_router.embed()`` 时不传 user_id，
    只能命中系统默认行 —— 所以管理后台必须读写同一行才能与运行时保持
    一致。

    本端点有意绕开 ``resolve_routing``（一旦凭证解析失败它就返回 None），
    这样即便管理员还未配置凭证，刚保存的 ``primary_model_id`` 也能立即
    在 UI 中可见。凭证配置状态通过 ``credential_configured`` 单独暴露。
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
    llm_router: LlmRouter = Depends(get_llm_router),
    pool: asyncpg.Pool = Depends(get_pg_pool),
):
    """更新指定 task type 的路由配置。

    写入系统默认行（``user_id IS NULL``）；理由见 ``get_routing``。
    AetherBlog 是单管理员博客，所有 AI 路由都是站点级的，因此带 admin
    维度的路由行只会让 UI 与运行时（调用 ``embed()`` 时不带 user_id）
    出现状态漂移。
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

    # 蓝绿安全地同步 site_settings.search.active_embedding_model 指针。
    # 历史 bug: 管理员改 embedding 路由后, site_settings 里的指针不变, 导致
    # admin UI "活跃 embedding" 与 "当前使用" 两值背离 (顶部显示 migration
    # seed 的 text-embedding-3-small, 底部显示实际路由的 text-embedding-3-large).
    #
    # 蓝绿不变量: 指针只能指向 `post_embeddings` 里当前有 `status='active'` 行的
    # 模型, 否则 `semantic_search` 的过滤器 (model_id=pointer AND status='active')
    # 瞬间返回空, 整个未重建窗口语义搜索全挂 (CHANGELOG 2026-01 记录过).
    #
    # 策略:
    #   · 新路由模型已有 active 行 (用户切回旧模型的场景, 或已跑过 reindex)
    #     → 立即写入指针, UI 两值即刻对齐
    #   · 新路由模型无 active 行 (首次切换, 等待管理员触发 reindex)
    #     → 不写. vector_store.reindex 的蓝绿完成阶段会负责翻转.
    #     此时 UI 仍会看到指针落后于路由——但诊断信息会标明 "pending reindex",
    #     这是正确的语义, 不是 bug.
    if task_type == "embedding" and update_primary:
        try:
            await _sync_active_embedding_pointer(llm_router, pool)
        except Exception as exc:  # noqa: BLE001
            # 同步失败不能阻塞路由更新——路由保存本身是主操作, 指针同步是增强.
            logger.warning(
                "embedding routing pointer sync failed: %s",
                exc,
                extra={"data": {"task_type": task_type}},
            )

    return ApiResponse(data=True)


async def _sync_active_embedding_pointer(
    llm_router: LlmRouter,
    pool: asyncpg.Pool,
) -> None:
    """以蓝绿安全的方式 upsert `site_settings.search.active_embedding_model`。"""
    new_model_id = await llm_router.resolve_embedding_model_id(user_id=None)
    if not new_model_id:
        return

    async with pool.acquire() as conn:
        has_active = await conn.fetchval(
            "SELECT EXISTS("
            "  SELECT 1 FROM post_embeddings "
            "  WHERE model_id = $1 AND status = 'active' LIMIT 1"
            ")",
            new_model_id,
        )
        if not has_active:
            logger.info(
                "routing.pointer_sync.skipped",
                extra={"data": {
                    "reason": "no_active_rows_for_new_model",
                    "new_model_id": new_model_id,
                }},
            )
            return

        await conn.execute(
            """
            INSERT INTO site_settings
                (setting_key, setting_value, setting_type, group_name, description)
            VALUES ('search.active_embedding_model', $1, 'STRING', 'search',
                '当前活跃的 embedding 模型 ID')
            ON CONFLICT (setting_key) DO UPDATE
            SET setting_value = EXCLUDED.setting_value,
                updated_at = NOW()
            """,
            new_model_id,
        )
        logger.info(
            "routing.pointer_sync.ok",
            extra={"data": {"new_model_id": new_model_id}},
        )
