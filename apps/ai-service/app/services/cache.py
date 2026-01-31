from __future__ import annotations

import hashlib
import json
from typing import Any

from redis.asyncio import Redis


# ref: §8.4.1
class CacheStore:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def get_json(self, key: str) -> dict[str, Any] | None:
        raw = await self.redis.get(key)
        if not raw:
            return None
        return json.loads(raw)

    async def set_json(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        await self.redis.set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)


def hash_content(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()
