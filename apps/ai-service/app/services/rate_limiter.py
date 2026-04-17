from __future__ import annotations

import logging

from fastapi import HTTPException, status
from redis.asyncio import Redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Atomic rate limit script
# KEYS[1]: rate limit key
# ARGV[1]: window seconds
LUA_SCRIPT = """
local count = redis.call('incr', KEYS[1])
if tonumber(count) == 1 then
  redis.call('expire', KEYS[1], ARGV[1])
end
return count
"""


# ref: §4.4
class RateLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def _check(self, key: str, limit: int, window_seconds: int) -> bool:
        try:
            # Use Lua script for atomic increment-and-expire
            # keys=[key], args=[window_seconds]
            current = await self.redis.eval(LUA_SCRIPT, 1, key, str(window_seconds))
            return int(current) <= limit
        except Exception as exc:  # pragma: no cover - defensive
            # SECURITY (VULN-070): by default we fail CLOSED so a Redis outage
            # cannot bypass the limiter and enable wallet-drain on LLM endpoints.
            # Flip AI_RATE_LIMIT_FAIL_OPEN=true only when infrastructure
            # reliability is more critical than limit enforcement.
            settings = get_settings()
            if settings.rate_limit_fail_open:
                logger.warning("rate_limit.redis_error_fail_open", extra={"error": str(exc)})
                return True
            logger.error("rate_limit.redis_error_fail_closed", extra={"error": str(exc)})
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Rate limiter unavailable",
                headers={"Retry-After": "30"},
            )

    async def enforce_user_limit(self, user_id: str, endpoint: str) -> None:
        settings = get_settings()
        key = f"rl:user:{user_id}:{endpoint}"
        allowed = await self._check(key, settings.rate_limit_user_per_min, 60)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": "60"},
            )

    async def enforce_global_limit(self, endpoint: str) -> None:
        settings = get_settings()
        key = f"rl:global:{endpoint}"
        allowed = await self._check(key, settings.rate_limit_global_per_min, 60)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
                headers={"Retry-After": "60"},
            )
