from __future__ import annotations

import jwt
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api import deps as deps_module


@pytest.mark.asyncio
async def test_require_user_missing_token():
    with pytest.raises(HTTPException) as exc:
        await deps_module.require_user(None, None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_require_user_accepts_cookie_token():
    token = jwt.encode({"userId": "cookie-user", "role": "user"}, "test-secret", algorithm="HS256")

    user = await deps_module.require_user(None, token)

    assert user.user_id == "cookie-user"


@pytest.mark.asyncio
async def test_require_user_prefers_header_over_cookie():
    header_token = jwt.encode({"userId": "header-user", "role": "user"}, "test-secret", algorithm="HS256")
    cookie_token = jwt.encode({"userId": "cookie-user", "role": "user"}, "test-secret", algorithm="HS256")

    user = await deps_module.require_user(f"Bearer {header_token}", cookie_token)

    assert user.user_id == "header-user"


@pytest.mark.asyncio
async def test_require_admin_forbidden():
    token = jwt.encode({"userId": "u1", "role": "user"}, "test-secret", algorithm="HS256")
    user = await deps_module.require_user(f"Bearer {token}")
    with pytest.raises(HTTPException) as exc:
        await deps_module.require_admin(user)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_current_user_valid_and_invalid():
    token = jwt.encode({"userId": "u2", "role": "admin"}, "test-secret", algorithm="HS256")
    user = await deps_module.get_current_user(f"Bearer {token}")
    assert user == {"sub": "u2", "role": "admin"}

    invalid = await deps_module.get_current_user("Bearer invalid")
    assert invalid is None


@pytest.mark.asyncio
async def test_rate_limit_calls_limiters():
    class FakeLimiter:
        def __init__(self):
            self.global_calls = []
            self.user_calls = []

        async def enforce_global_limit(self, endpoint: str):
            self.global_calls.append(endpoint)

        async def enforce_user_limit(self, user_id: str, endpoint: str):
            self.user_calls.append((user_id, endpoint))

    request = Request({"type": "http", "path": "/api/v1/ai/summary", "headers": []})
    user = type("User", (), {"user_id": "user-1"})()
    limiter = FakeLimiter()

    result = await deps_module.rate_limit(request, user=user, limiter=limiter)
    assert result.user_id == "user-1"
    assert limiter.global_calls == ["/api/v1/ai/summary"]
    assert limiter.user_calls == [("user-1", "/api/v1/ai/summary")]


@pytest.mark.asyncio
async def test_get_pg_pool_cached(monkeypatch):
    deps_module._pg_pool = None

    class SentinelPool:
        async def close(self):
            return None

    sentinel = SentinelPool()

    async def fake_create_pool(*args, **kwargs):
        return sentinel

    monkeypatch.setattr(deps_module.asyncpg, "create_pool", fake_create_pool)
    pool = await deps_module.get_pg_pool()
    assert pool is sentinel
    pool_again = await deps_module.get_pg_pool()
    assert pool_again is sentinel
    deps_module._pg_pool = None


def test_get_remote_model_fetcher_singleton():
    deps_module._remote_model_fetcher = None
    first = deps_module.get_remote_model_fetcher()
    second = deps_module.get_remote_model_fetcher()
    assert first is second
