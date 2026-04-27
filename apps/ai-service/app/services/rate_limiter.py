from __future__ import annotations

import asyncio
import logging

from fastapi import HTTPException, status
from redis.asyncio import Redis
from redis.exceptions import (
    AuthenticationError,
    ConnectionError as RedisConnectionError,
    ResponseError,
    TimeoutError as RedisTimeoutError,
)

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def classify_redis_error(exc: Exception) -> str:
    """将 Redis 原始异常映射为简短、运维友好的分类标签。

    标签会出现在结构化日志中，让 on-call 工程师一眼判断限流器是因为
    AUTH（配置漂移）、网络（基础设施）还是 Redis 服务端错误响应
    （例如 LOADING、BUSY、OOM）而失败。
    """
    if isinstance(exc, AuthenticationError):
        return "auth"
    # 当命令前没有完成 AUTH 协商时，redis-py 会以普通 ResponseError 抛出
    # NOAUTH / WRONGPASS；要先于通用兜底分类把这些识别出来。
    if isinstance(exc, ResponseError):
        msg = str(exc).upper()
        if "NOAUTH" in msg or "WRONGPASS" in msg:
            return "auth"
        return "response"
    if isinstance(exc, RedisTimeoutError) or isinstance(exc, asyncio.TimeoutError):
        return "timeout"
    if isinstance(exc, RedisConnectionError):
        return "connection"
    return "unknown"

# 原子化的限流 Lua 脚本
# KEYS[1]：限流 key
# ARGV[1]：窗口秒数
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
            # 使用 Lua 脚本原子化地完成 incr 与 expire
            # keys=[key]，args=[window_seconds]
            current = await self.redis.eval(LUA_SCRIPT, 1, key, str(window_seconds))
            return int(current) <= limit
        except Exception as exc:  # pragma: no cover - 防御性
            # SECURITY (VULN-070)：默认 fail CLOSED，避免 Redis 故障时限流器
            # 被绕过，导致 LLM 端点被刷爆账单。仅在“基础设施可用性高于限流
            # 强制力”的场景下，才将 AI_RATE_LIMIT_FAIL_OPEN=true。
            settings = get_settings()
            # 使用 extra={"data": {...}}，让 JSONFormatter（读取 record.data）
            # 真正把错误细节渲染出来。先前的 extra={"error": ...} 写法会被
            # 静默丢弃，日志里只剩裸的事件名。
            payload = {
                "error": str(exc),
                "error_type": type(exc).__name__,
                "category": classify_redis_error(exc),
            }
            if settings.rate_limit_fail_open:
                logger.warning(
                    "rate_limit.redis_error_fail_open",
                    extra={"data": payload},
                    exc_info=True,
                )
                return True
            logger.error(
                "rate_limit.redis_error_fail_closed",
                extra={"data": payload},
                exc_info=True,
            )
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
