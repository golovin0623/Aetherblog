from __future__ import annotations

import logging
from typing import AsyncGenerator

from fastapi import Depends, Header, HTTPException, Request, status
from redis.asyncio import Redis
import asyncpg
from pgvector.asyncpg import register_vector

from app.core.config import get_settings
from app.core.jwt import UserClaims, decode_token, extract_user
from app.services.cache import CacheStore
from app.services.llm_router import LlmRouter
from app.services.metrics import MetricsStore, get_metrics_store
from app.services.rate_limiter import RateLimiter
from app.services.usage_logger import UsageLogger
from app.services.vector_store import VectorStoreService

# ref: §4.4, §8.3.1
logger = logging.getLogger(__name__)

_redis: Redis | None = None
_router: LlmRouter | None = None
_vector_store: VectorStoreService | None = None
_pg_pool: asyncpg.Pool | None = None
_usage_logger: UsageLogger | None = None


def _get_redis() -> Redis:
    global _redis
    if _redis is None:
        settings = get_settings()
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def get_pg_pool() -> asyncpg.Pool:
    global _pg_pool
    if _pg_pool is None:
        settings = get_settings()
        _pg_pool = await asyncpg.create_pool(
            settings.postgres_dsn, min_size=1, max_size=5, init=register_vector
        )
    return _pg_pool


def get_cache() -> CacheStore:
    return CacheStore(_get_redis())


def get_rate_limiter() -> RateLimiter:
    return RateLimiter(_get_redis())


def get_llm_router() -> LlmRouter:
    global _router
    if _router is None:
        _router = LlmRouter()
    return _router


async def get_vector_store() -> VectorStoreService:
    global _vector_store
    if _vector_store is None:
        pool = await get_pg_pool()
        _vector_store = VectorStoreService(pool, get_llm_router())
    return _vector_store


def get_metrics() -> MetricsStore:
    return get_metrics_store()


async def get_usage_logger() -> UsageLogger:
    global _usage_logger
    if _usage_logger is None:
        pool = await get_pg_pool()
        _usage_logger = UsageLogger(pool)
    return _usage_logger


async def require_user(authorization: str | None = Header(default=None)) -> UserClaims:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    token = authorization.replace("Bearer ", "", 1).strip()
    try:
        claims = decode_token(token)
        return extract_user(claims)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("jwt.invalid", extra={"error": str(exc)})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def require_admin(user: UserClaims = Depends(require_user)) -> UserClaims:
    role = (user.role or "").lower()
    if role not in {"admin", "super_admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return user


async def rate_limit(
    request: Request,
    user: UserClaims = Depends(require_user),
    limiter: RateLimiter = Depends(get_rate_limiter),
) -> UserClaims:
    endpoint = request.url.path
    await limiter.enforce_global_limit(endpoint)
    await limiter.enforce_user_limit(user.user_id, endpoint)
    return user
