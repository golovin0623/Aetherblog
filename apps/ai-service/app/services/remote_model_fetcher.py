# ref: §5.1 - Remote model list fetcher
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from app.services.provider_registry import ProviderInfo
from app.services.credential_resolver import CredentialInfo


@dataclass
class RemoteModelInfo:
    model_id: str
    display_name: str | None
    model_type: str
    context_window: int | None
    max_output_tokens: int | None
    input_cost_per_1k: float | None
    output_cost_per_1k: float | None
    capabilities: dict[str, Any]
    is_enabled: bool


def _infer_model_type(model_id: str) -> str:
    model_lower = model_id.lower()
    if "embedding" in model_lower:
        return "embedding"
    if "tts" in model_lower:
        return "tts"
    if "stt" in model_lower or "whisper" in model_lower:
        return "stt"
    if "realtime" in model_lower:
        return "realtime"
    if "image" in model_lower or "dall-e" in model_lower or "dalle" in model_lower:
        return "image"
    return "chat"


def _format_released_at(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.utcfromtimestamp(value).strftime("%Y-%m-%d")
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
        if provider.api_type == "openai_compat":
            return await self._fetch_openai_models(provider, credential)
        raise ValueError(f"Unsupported provider api_type: {provider.api_type}")

    async def _fetch_openai_models(
        self, provider: ProviderInfo, credential: CredentialInfo
    ) -> list[RemoteModelInfo]:
        if not credential.base_url:
            raise ValueError("Missing base_url for provider")

        url = f"{credential.base_url}/models"
        headers = {
            "Authorization": f"Bearer {credential.api_key.strip()}",
            "Content-Type": "application/json",
            "X-API-Key": credential.api_key.strip(),
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
            model_id = item.get("id") or item.get("model") or item.get("name")
            if not model_id:
                continue
            released_at = _format_released_at(item.get("created") or item.get("created_at"))
            capabilities: dict[str, Any] = {"source": "remote"}
            if released_at:
                capabilities["released_at"] = released_at
            models.append(
                RemoteModelInfo(
                    model_id=model_id,
                    display_name=item.get("display_name") or item.get("name"),
                    model_type=_infer_model_type(model_id),
                    context_window=None,
                    max_output_tokens=None,
                    input_cost_per_1k=None,
                    output_cost_per_1k=None,
                    capabilities=capabilities,
                    is_enabled=False,
                )
            )

        return models

    async def _fetch_anthropic_models(
        self, provider: ProviderInfo, credential: CredentialInfo
    ) -> list[RemoteModelInfo]:
        if not credential.base_url:
            raise ValueError("Missing base_url for provider")

        url = f"{credential.base_url}/models"
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
            capabilities: dict[str, Any] = {"source": "remote"}
            if released_at:
                capabilities["released_at"] = released_at
            models.append(
                RemoteModelInfo(
                    model_id=model_id,
                    display_name=item.get("display_name") or item.get("name"),
                    model_type="chat",
                    context_window=None,
                    max_output_tokens=None,
                    input_cost_per_1k=None,
                    output_cost_per_1k=None,
                    capabilities=capabilities,
                    is_enabled=False,
                )
            )

        return models
