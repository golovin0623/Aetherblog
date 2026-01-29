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
from typing import AsyncGenerator, TYPE_CHECKING

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
            "embedding": self.settings.model_embedding,
        }
        return mapping.get(alias, alias)

    async def _get_routing(self, task_type: str, user_id: int | None = None) -> "RoutingConfig | None":
        """Get routing config from model router if available."""
        if self.model_router:
            try:
                return await self.model_router.resolve_routing(task_type, user_id)
            except Exception as e:
                logger.warning(f"Failed to get routing from DB, using env config: {e}")
        return None

    def _render_prompt(self, template: str | None, default_template: str, **kwargs) -> str:
        """Render prompt template with provided variables."""
        tpl = template or default_template
        try:
            return tpl.format(**kwargs)
        except Exception as e:
            logger.error(f"Failed to render prompt: {e}")
            # Fallback to a simple concatenation if formatting fails
            return f"{tpl}\n\nContext: {kwargs}"

    async def chat(
        self, 
        prompt_variables: dict[str, Any], 
        model_alias: str, 
        user_id: int | None = None,
        custom_prompt: str | None = None
    ) -> str:
        """Send a chat completion request with dynamic prompt rendering."""
        # Try dynamic routing first
        routing = await self._get_routing(model_alias, user_id)
        
        if routing:
            model = routing.model.model_id
            api_key = routing.credential.api_key
            api_base = routing.credential.base_url
            temperature = routing.config.get("temperature", 0.7)
            max_tokens = routing.config.get("max_tokens")
        else:
            model = self.resolve_model(model_alias)
            api_key = self.settings.openai_api_key
            api_base = self.settings.openai_base_url
            temperature = 0.7
            max_tokens = None
        
        # Determine and render prompt
        prompt_template = custom_prompt or (routing.config.get("prompt_template") if routing else None)
        prompt = self._render_prompt(
            template=prompt_template,
            default_template=prompt_variables.get("content", ""),
            **prompt_variables
        )
        
        if self.settings.mock_mode:
            return f"[mock:{model}]"
        
        try:
            response = await acompletion(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                api_key=api_key,
                api_base=api_base,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            content = response.choices[0].message.content
            return content or ""
        except Exception as e:
            # Try fallback model if available
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
        prompt_variables: dict[str, Any], 
        model_alias: str, 
        user_id: int | None = None,
        custom_prompt: str | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion response with dynamic prompt rendering."""
        routing = await self._get_routing(model_alias, user_id)
        
        if routing:
            model = routing.model.model_id
            api_key = routing.credential.api_key
            api_base = routing.credential.base_url
            temperature = routing.config.get("temperature", 0.7)
            max_tokens = routing.config.get("max_tokens")
        else:
            model = self.resolve_model(model_alias)
            api_key = self.settings.openai_api_key
            api_base = self.settings.openai_base_url
            temperature = 0.7
            max_tokens = None
        
        # Determine and render prompt
        prompt_template = custom_prompt or (routing.config.get("prompt_template") if routing else None)
        prompt = self._render_prompt(
            template=prompt_template,
            default_template=prompt_variables.get("content", ""),
            **prompt_variables
        )
        
        if self.settings.mock_mode:
            for chunk in ["[", "mock", f":{model}", "]"]:
                yield chunk
                await asyncio.sleep(0)
            return
        
        stream = await acompletion(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            api_key=api_key,
            api_base=api_base,
            temperature=temperature,
            max_tokens=max_tokens,
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
