# ref: §2.4.2.5 - LLM Router with Dynamic Configuration
"""
LLM Router service with support for dynamic model routing.

This is an enhanced version that supports:
- Dynamic model routing from database
- Multiple providers (OpenAI, DeepSeek, Qwen, etc.)
- Fallback models
- Per-user configuration
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from typing import Any, AsyncGenerator, TYPE_CHECKING

from litellm import acompletion, aembedding

from app.core.config import get_settings

if TYPE_CHECKING:
    from app.services.model_router import ModelRouter, RoutingConfig

logger = logging.getLogger("ai-service")


class LlmRouter:
    """
    LLM Router with dynamic configuration support.
    
    Falls back to environment config when database routing is not available.
    """

    def __init__(self, model_router: "ModelRouter | None" = None) -> None:
        self.settings = get_settings()
        self.model_router = model_router

    def resolve_model(self, alias: str) -> str:
        """Resolve model alias to model name (env-based fallback)."""
        mapping = {
            "summary": self.settings.model_summary,
            "tags": self.settings.model_tags,
            "titles": self.settings.model_titles,
            "polish": self.settings.model_polish,
            "outline": self.settings.model_outline,
            "translate": self.settings.model_translate,
            "embedding": self.settings.model_embedding,
        }
        return mapping.get(alias, alias)

    @staticmethod
    def _prefix_model_for_litellm(model_id: str, api_type: str | None) -> str:
        """
        Apply provider prefix to model name for correct LiteLLM routing.
        
        LiteLLM auto-detects providers based on model name prefixes:
        - gemini-* → Vertex AI (requires Google Cloud SDK)
        - claude-* → Anthropic API
        - gpt-* → OpenAI API
        
        For custom API endpoints, we must add explicit prefixes to force the correct routing:
        - openai_compat/custom: Add 'openai/' prefix to force OpenAI-compatible protocol
        - azure: Add 'azure/' prefix for Azure OpenAI Service
        - anthropic: No prefix needed (LiteLLM natively supports Anthropic API)
        - google: No prefix needed IF using API key auth; Vertex AI needs credentials
        """
        if not api_type:
            return model_id
            
        # openai_compat and custom: Force OpenAI-compatible routing
        if api_type in ("openai_compat", "custom"):
            if not model_id.startswith("openai/"):
                return f"openai/{model_id}"
        
        # Azure OpenAI: Add azure/ prefix
        elif api_type == "azure":
            if not model_id.startswith("azure/"):
                return f"azure/{model_id}"
        
        # anthropic: LiteLLM handles claude-* models natively
        # google: LiteLLM handles gemini-* models natively with api_key
        # No prefix needed for these - they work with api_key + api_base
        
        return model_id

    @dataclass
    class _ResolvedRoute:
        model: str
        api_key: str | None
        api_base: str | None
        temperature: float
        max_tokens: int | None
        prompt_template: str | None
        override: bool

    async def _get_routing(self, task_type: str, user_id: int | None = None) -> "RoutingConfig | None":
        """Get routing config from model router if available."""
        if self.model_router:
            try:
                return await self.model_router.resolve_routing(task_type, user_id)
            except Exception as e:
                logger.warning(f"Failed to get routing from DB, using env config: {e}")
        return None

    async def _resolve_override(
        self,
        model_id: str | None,
        provider_code: str | None,
        user_id: int | None,
    ) -> "LlmRouter._ResolvedRoute | None":
        if not model_id:
            return None
        if not self.model_router:
            raise ValueError("Model override is not available")

        model = await self.model_router.provider_registry.get_model(model_id, provider_code)
        if not model:
            raise ValueError("Requested model not found")

        credential = await self.model_router.credential_resolver.get_credential(
            model.provider_code,
            user_id=user_id,
        )
        if not credential:
            raise ValueError("Credential not found for requested provider")

        # Apply provider prefix for correct LiteLLM routing
        prefixed_model = self._prefix_model_for_litellm(model.model_id, credential.api_type)

        return LlmRouter._ResolvedRoute(
            model=prefixed_model,
            api_key=credential.api_key,
            api_base=credential.base_url,
            temperature=0.7,
            max_tokens=None,
            prompt_template=None,
            override=True,
        )

    async def _resolve_route(
        self,
        model_alias: str,
        user_id: int | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
    ) -> "LlmRouter._ResolvedRoute":
        override = await self._resolve_override(model_id, provider_code, user_id)
        if override:
            return override

        routing = await self._get_routing(model_alias, user_id)
        if routing:
            # Apply provider prefix for correct LiteLLM routing
            prefixed_model = self._prefix_model_for_litellm(
                routing.model.model_id, routing.credential.api_type
            )
            return LlmRouter._ResolvedRoute(
                model=prefixed_model,
                api_key=routing.credential.api_key,
                api_base=routing.credential.base_url,
                temperature=routing.config.get("temperature", 0.7),
                max_tokens=routing.config.get("max_tokens"),
                prompt_template=routing.prompt_template,
                override=False,
            )

        return LlmRouter._ResolvedRoute(
            model=self.resolve_model(model_alias),
            api_key=self.settings.openai_api_key,
            api_base=self.settings.openai_base_url,
            temperature=0.7,
            max_tokens=None,
            prompt_template=None,
            override=False,
        )

    async def resolve_effective_model(
        self,
        model_alias: str,
        user_id: int | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
    ) -> str:
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
        )
        return resolved.model

    def _render_prompt(self, template: str | None, default_template: str, **kwargs) -> str:
        """Render prompt template with provided variables."""
        tpl = template or default_template
        try:
            return tpl.format(**kwargs)
        except Exception as e:
            logger.error(f"Failed to render prompt: {e}")
            # Fallback to a simple concatenation if formatting fails
            return f"{tpl}\n\nContext: {kwargs}"

    def _normalize_prompt_variables(self, prompt_variables: dict[str, Any] | str) -> dict[str, Any]:
        if isinstance(prompt_variables, str):
            return {"content": prompt_variables}
        return prompt_variables

    async def chat(
        self,
        prompt_variables: dict[str, Any] | str,
        model_alias: str,
        user_id: int | None = None,
        custom_prompt: str | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
    ) -> str:
        """Send a chat completion request with dynamic prompt rendering."""
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
        )

        prompt_template = custom_prompt or resolved.prompt_template
        normalized_variables = self._normalize_prompt_variables(prompt_variables)
        prompt = self._render_prompt(
            template=prompt_template,
            default_template=normalized_variables.get("content", ""),
            **normalized_variables
        )

        if self.settings.mock_mode and not resolved.override:
            return f"[mock:{resolved.model}]"
        
        try:
            response = await acompletion(
                model=resolved.model,
                messages=[{"role": "user", "content": prompt}],
                api_key=resolved.api_key,
                api_base=resolved.api_base,
                temperature=resolved.temperature,
                max_tokens=resolved.max_tokens,
            )
            content = response.choices[0].message.content
            return content or ""
        except Exception as e:
            # Try fallback model if available
            if self.model_router:
                routing = await self._get_routing(model_alias, user_id)
            else:
                routing = None
            if routing and routing.fallback_model:
                logger.warning(f"Primary model failed, trying fallback: {e}")
                fallback_routing = await self._get_routing_for_fallback(routing)
                if fallback_routing:
                    response = await acompletion(
                        model=fallback_routing.model.model_id,
                        messages=[{"role": "user", "content": prompt}],
                        api_key=fallback_routing.credential.api_key,
                        api_base=fallback_routing.credential.base_url,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                    return response.choices[0].message.content or ""
            raise

    async def _get_routing_for_fallback(self, original: "RoutingConfig") -> "RoutingConfig | None":
        """Get credential for fallback model."""
        if not original.fallback_model or not self.model_router:
            return None
        
        from app.services.credential_resolver import CredentialInfo
        
        # Get credential for fallback provider
        cred = await self.model_router.credential_resolver.get_credential(
            original.fallback_model.provider_code
        )
        if not cred:
            return None
        
        from app.services.model_router import RoutingConfig
        return RoutingConfig(
            task_type=original.task_type,
            model=original.fallback_model,
            credential=cred,
            config=original.config,
        )

    async def stream_chat(
        self,
        prompt_variables: dict[str, Any] | str,
        model_alias: str,
        user_id: int | None = None,
        custom_prompt: str | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion response with dynamic prompt rendering."""
        resolved = await self._resolve_route(
            model_alias=model_alias,
            user_id=user_id,
            model_id=model_id,
            provider_code=provider_code,
        )

        prompt_template = custom_prompt or resolved.prompt_template
        normalized_variables = self._normalize_prompt_variables(prompt_variables)
        prompt = self._render_prompt(
            template=prompt_template,
            default_template=normalized_variables.get("content", ""),
            **normalized_variables
        )

        if self.settings.mock_mode and not resolved.override:
            for chunk in ["[", "mock", f":{resolved.model}", "]"]:
                yield chunk
                await asyncio.sleep(0)
            return
        
        stream = await acompletion(
            model=resolved.model,
            messages=[{"role": "user", "content": prompt}],
            api_key=resolved.api_key,
            api_base=resolved.api_base,
            temperature=resolved.temperature,
            max_tokens=resolved.max_tokens,
            stream=True,
        )
        async for part in stream:
            delta = part.choices[0].delta
            content = getattr(delta, "content", None)
            if content:
                yield content

    async def embed(self, text: str, user_id: int | None = None) -> list[float]:
        """Generate embedding for text."""
        routing = await self._get_routing("embedding", user_id)
        
        if routing:
            model = routing.model.model_id
            api_key = routing.credential.api_key
            api_base = routing.credential.base_url
        else:
            model = self.resolve_model("embedding")
            api_key = self.settings.openai_api_key
            api_base = self.settings.openai_base_url
        
        if self.settings.mock_mode:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            seed = [b / 255 for b in digest]
            dim = self.settings.vector_dim
            repeats = dim // len(seed) + 1
            return (seed * repeats)[:dim]
        
        response = await aembedding(
            model=model,
            input=[text],
            api_key=api_key,
            api_base=api_base,
        )
        return response.data[0]["embedding"]

    async def stream_chat_with_think_detection(
        self,
        prompt_variables: dict[str, Any] | str,
        model_alias: str,
        user_id: int | None = None,
        custom_prompt: str | None = None,
        model_id: str | None = None,
        provider_code: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Stream chat completion with <think> block detection.
        
        Yields events in format:
        - {"type": "delta", "content": "...", "isThink": False}
        - {"type": "delta", "content": "...", "isThink": True}
        - {"type": "done"}
        """
        in_think = False
        buffer = ""
        # Minimum chars to keep for tag detection (length of "</think>")
        # Minimum chars to keep for tag detection (length of "</think>")
        TAG_BUFFER_SIZE = 8
        
        async for chunk in self.stream_chat(
            prompt_variables=prompt_variables,
            model_alias=model_alias,
            user_id=user_id,
            custom_prompt=custom_prompt,
            model_id=model_id,
            provider_code=provider_code,
        ):
            buffer += chunk
            
            # Process buffer incrementally
            while len(buffer) > TAG_BUFFER_SIZE:
                if not in_think:
                    # Look for <think> start
                    think_start = buffer.find("<think>")
                    if think_start != -1 and think_start < len(buffer) - TAG_BUFFER_SIZE:
                        # Yield content before <think>
                        if think_start > 0:
                            yield {"type": "delta", "content": buffer[:think_start], "isThink": False}
                        buffer = buffer[think_start + 7:]  # Skip <think>
                        in_think = True
                    elif think_start == -1:
                        # No <think> found, safe to yield most of buffer
                        safe_len = len(buffer) - TAG_BUFFER_SIZE
                        if safe_len > 0:
                            yield {"type": "delta", "content": buffer[:safe_len], "isThink": False}
                            buffer = buffer[safe_len:]
                        break
                    else:
                        # <think> found but too close to end, wait for more data
                        break
                else:
                    # Look for </think> end
                    think_end = buffer.find("</think>")
                    if think_end != -1 and think_end < len(buffer) - TAG_BUFFER_SIZE:
                        # Yield think content
                        if think_end > 0:
                            yield {"type": "delta", "content": buffer[:think_end], "isThink": True}
                        buffer = buffer[think_end + 8:]  # Skip </think>
                        in_think = False
                    elif think_end == -1:
                        # No </think> found, safe to yield most of buffer
                        safe_len = len(buffer) - TAG_BUFFER_SIZE
                        if safe_len > 0:
                            yield {"type": "delta", "content": buffer[:safe_len], "isThink": True}
                            buffer = buffer[safe_len:]
                        break
                    else:
                        # </think> found but too close to end, wait for more data
                        break
        
        # Yield remaining buffer
        if buffer:
            yield {"type": "delta", "content": buffer, "isThink": in_think}
        
        yield {"type": "done"}

