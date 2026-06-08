# ref: §5.1 - 远程模型列表抓取器（Remote model list fetcher）
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

from app.services.provider_registry import ProviderInfo
from app.services.credential_resolver import CredentialInfo
from app.services.model_capabilities import infer_capabilities, infer_model_type
from app.utils.provider_urls import normalize_api_base
from app.utils.url_validator import validate_external_url


@dataclass
class RemoteModelInfo:
    model_id: str
    display_name: str | None
    model_type: str
    context_window: int | None
    max_output_tokens: int | None
    input_cost_per_1k: float | None
    output_cost_per_1k: float | None
    input_cost_per_1m: float | None
    output_cost_per_1m: float | None
    cached_input_cost_per_1m: float | None
    capabilities: dict[str, Any]
    is_enabled: bool


def _build_remote_capabilities(model_id: str, model_type: str, released_at: str | None) -> dict[str, Any]:
    """远程模型统一附带：来源标记、发布日期、以及按命名启发式推断的规范能力标志。

    历史实现只写 ``source``，导致远程拉取的模型在管理端能力徽章全部缺失、需逐个手填。
    这里复用 model_capabilities 的推断，让 vision / reasoning / functionCall 等开箱即用，
    管理员仍可在配置弹窗中人工覆盖。
    """
    capabilities: dict[str, Any] = {"source": "remote"}
    if released_at:
        capabilities["released_at"] = released_at
    abilities = infer_capabilities(model_id, model_type)
    if abilities:
        capabilities["abilities"] = abilities
    return capabilities


def _to_finite_float(value: Any) -> float | None:
    """把价格字段（可能是字符串）安全转成有限非负浮点；不合法返回 None。"""
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0 or not math.isfinite(parsed):
        return None
    return parsed


def _extract_remote_pricing(item: dict[str, Any]) -> tuple[float | None, float | None, dict[str, Any] | None]:
    """从 ``/models`` 响应项解析单价。

    采用 OpenAI 兼容聚合站（OpenRouter / AiHubMix 等）的通行约定：
    ``pricing.prompt`` / ``pricing.completion`` 为 **USD/Token** 字符串，换算为「每百万 Token」。
    仅当存在该结构时才捕获，避免对无定价响应误判。返回 (input_per_1m, output_per_1m, pricing_caps)。
    """
    pricing = item.get("pricing")
    if not isinstance(pricing, dict):
        return None, None, None

    prompt = _to_finite_float(pricing.get("prompt"))
    completion = _to_finite_float(pricing.get("completion"))
    if prompt is None and completion is None:
        return None, None, None

    input_per_1m = round(prompt * 1_000_000, 6) if prompt is not None else None
    output_per_1m = round(completion * 1_000_000, 6) if completion is not None else None

    pricing_caps: dict[str, Any] = {"currency": "USD"}
    if input_per_1m is not None:
        pricing_caps["input"] = input_per_1m
    if output_per_1m is not None:
        pricing_caps["output"] = output_per_1m
    return input_per_1m, output_per_1m, pricing_caps


def _format_released_at(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc).strftime("%Y-%m-%d")
        except (OSError, ValueError):
            return None
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            return value
    return None


class RemoteModelFetcher:
    async def fetch_models(self, provider: ProviderInfo, credential: CredentialInfo) -> list[RemoteModelInfo]:
        if provider.api_type == "anthropic":
            return await self._fetch_anthropic_models(provider, credential)
        if provider.api_type == "google":
            return await self._fetch_google_models(provider, credential)
        if provider.api_type == "openai_compat":
            return await self._fetch_openai_models(provider, credential)
        raise ValueError(f"Unsupported provider api_type: {provider.api_type}")

    async def _fetch_openai_models(
        self, provider: ProviderInfo, credential: CredentialInfo
    ) -> list[RemoteModelInfo]:
        base_url = normalize_api_base(credential.base_url, provider.api_type, credential.extra_config)
        if not base_url:
            raise ValueError("Missing base_url for provider")
        if not validate_external_url(base_url):
            raise ValueError("Blocked: base_url resolves to a private/internal network")

        url = f"{base_url}/models"
        headers = {
            "Authorization": f"Bearer {credential.api_key.strip()}",
            "Content-Type": "application/json",
            "X-API-Key": credential.api_key.strip(),
        }

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            payload = resp.json()

        data: list[Any] = []
        if isinstance(payload, list):
            data = payload
        elif isinstance(payload, dict):
            for key in ("data", "models", "model_list", "items", "result"):
                value = payload.get(key)
                if isinstance(value, list):
                    data = value
                    break
        models: list[RemoteModelInfo] = []

        for item in data:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id") or item.get("model") or item.get("name")
            if not model_id:
                continue
            released_at = _format_released_at(item.get("created") or item.get("created_at"))
            model_type = infer_model_type(model_id)
            capabilities = _build_remote_capabilities(model_id, model_type, released_at)

            # 聚合站常在 /models 响应里直接给出单价与上下文长度，顺手捕获
            input_per_1m, output_per_1m, pricing_caps = _extract_remote_pricing(item)
            if pricing_caps:
                capabilities["pricing"] = pricing_caps
            context_length = item.get("context_length")
            context_window = context_length if isinstance(context_length, int) else None

            models.append(
                RemoteModelInfo(
                    model_id=model_id,
                    display_name=item.get("display_name") or item.get("name"),
                    model_type=model_type,
                    context_window=context_window,
                    max_output_tokens=None,
                    # bulk_insert 落库走 *_per_1k 列，故同时换算两种粒度
                    input_cost_per_1k=(input_per_1m / 1000 if input_per_1m is not None else None),
                    output_cost_per_1k=(output_per_1m / 1000 if output_per_1m is not None else None),
                    input_cost_per_1m=input_per_1m,
                    output_cost_per_1m=output_per_1m,
                    cached_input_cost_per_1m=None,
                    capabilities=capabilities,
                    is_enabled=False,
                )
            )

        return models

    async def _fetch_anthropic_models(
        self, provider: ProviderInfo, credential: CredentialInfo
    ) -> list[RemoteModelInfo]:
        base_url = normalize_api_base(credential.base_url, provider.api_type, credential.extra_config)
        if not base_url:
            raise ValueError("Missing base_url for provider")
        if not validate_external_url(base_url):
            raise ValueError("Blocked: base_url resolves to a private/internal network")

        url = f"{base_url}/models"
        version = credential.extra_config.get("anthropic_version", "2023-06-01")
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": credential.api_key.strip(),
            "anthropic-version": version,
        }

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            payload = resp.json()

        data = payload.get("data", []) if isinstance(payload, dict) else []
        models: list[RemoteModelInfo] = []

        for item in data:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id") or item.get("name")
            if not model_id:
                continue
            released_at = _format_released_at(item.get("created_at"))
            capabilities = _build_remote_capabilities(model_id, "chat", released_at)
            models.append(
                RemoteModelInfo(
                    model_id=model_id,
                    display_name=item.get("display_name") or item.get("name"),
                    model_type="chat",
                    context_window=None,
                    max_output_tokens=None,
                    input_cost_per_1k=None,
                    output_cost_per_1k=None,
                    input_cost_per_1m=None,
                    output_cost_per_1m=None,
                    cached_input_cost_per_1m=None,
                    capabilities=capabilities,
                    is_enabled=False,
                )
            )

        return models

    async def _fetch_google_models(
        self, provider: ProviderInfo, credential: CredentialInfo
    ) -> list[RemoteModelInfo]:
        """抓取 Google Gemini 模型列表（``GET {base}/models``，密钥走请求头不入 URL）。

        Gemini 返回结构含 ``inputTokenLimit`` / ``outputTokenLimit`` /
        ``supportedGenerationMethods``，据此直接回填上下文窗口与最大输出，并按命名补能力。
        """
        base_url = normalize_api_base(credential.base_url, provider.api_type, credential.extra_config)
        if not base_url:
            raise ValueError("Missing base_url for provider")
        if not validate_external_url(base_url):
            raise ValueError("Blocked: base_url resolves to a private/internal network")

        url = f"{base_url}/models"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": credential.api_key.strip(),
        }

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            payload = resp.json()

        data = payload.get("models", []) if isinstance(payload, dict) else []
        models: list[RemoteModelInfo] = []

        for item in data:
            if not isinstance(item, dict):
                continue
            raw_name = item.get("name") or item.get("id")
            if not raw_name:
                continue
            # Gemini 用 ``models/gemini-1.5-pro`` 形式，去掉前缀作为内部 model_id
            model_id = str(raw_name).split("/", 1)[-1]
            model_type = infer_model_type(model_id)
            context_window = item.get("inputTokenLimit")
            max_output = item.get("outputTokenLimit")
            capabilities = _build_remote_capabilities(model_id, model_type, None)
            models.append(
                RemoteModelInfo(
                    model_id=model_id,
                    display_name=item.get("displayName") or item.get("display_name"),
                    model_type=model_type,
                    context_window=context_window if isinstance(context_window, int) else None,
                    max_output_tokens=max_output if isinstance(max_output, int) else None,
                    input_cost_per_1k=None,
                    output_cost_per_1k=None,
                    input_cost_per_1m=None,
                    output_cost_per_1m=None,
                    cached_input_cost_per_1m=None,
                    capabilities=capabilities,
                    is_enabled=False,
                )
            )

        return models
