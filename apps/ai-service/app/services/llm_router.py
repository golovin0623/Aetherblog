from __future__ import annotations

import asyncio
from typing import AsyncGenerator

import hashlib
from litellm import acompletion, aembedding

from app.core.config import get_settings


# ref: §2.4.2.5
class LlmRouter:
    def __init__(self) -> None:
        self.settings = get_settings()

    def resolve_model(self, alias: str) -> str:
        mapping = {
            "summary": self.settings.model_summary,
            "tags": self.settings.model_tags,
            "titles": self.settings.model_titles,
            "polish": self.settings.model_polish,
            "outline": self.settings.model_outline,
            "embedding": self.settings.model_embedding,
        }
        return mapping.get(alias, alias)

    async def chat(self, prompt: str, model_alias: str) -> str:
        model = self.resolve_model(model_alias)
        if self.settings.mock_mode:
            return f"[mock:{model}]"
        response = await acompletion(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            api_key=self.settings.openai_api_key,
            api_base=self.settings.openai_base_url,
        )
        content = response.choices[0].message.content
        return content or ""

    async def stream_chat(self, prompt: str, model_alias: str) -> AsyncGenerator[str, None]:
        model = self.resolve_model(model_alias)
        if self.settings.mock_mode:
            for chunk in ["[", "mock", f":{model}", "]"]:
                yield chunk
                await asyncio.sleep(0)
            return
        stream = await acompletion(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            api_key=self.settings.openai_api_key,
            api_base=self.settings.openai_base_url,
            stream=True,
        )
        async for part in stream:
            delta = part.choices[0].delta
            content = getattr(delta, "content", None)
            if content:
                yield content

    async def embed(self, text: str) -> list[float]:
        model = self.resolve_model("embedding")
        if self.settings.mock_mode:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            seed = [b / 255 for b in digest]
            dim = self.settings.vector_dim
            repeats = dim // len(seed) + 1
            return (seed * repeats)[:dim]
        response = await aembedding(
            model=model,
            input=[text],
            api_key=self.settings.openai_api_key,
            api_base=self.settings.openai_base_url,
        )
        return response.data[0]["embedding"]
