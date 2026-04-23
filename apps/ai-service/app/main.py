from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router
from app.api import deps as deps_module
from app.core.config import get_settings
from app.core.jwt_keys import start_refresher as start_jwt_key_refresher, stop_refresher as stop_jwt_key_refresher
from app.core.logging import setup_logging
from app.schemas.common import ApiResponse
from app.services.rate_limiter import classify_redis_error


# ref: §2.4.2.5
settings = get_settings()
setup_logging(log_path=settings.log_path, level=settings.log_level)
logger = logging.getLogger("ai-service")


def _redacted_redis_url(url: str) -> str:
    """Return REDIS_URL with any password in the userinfo segment replaced by ``***``.

    We only emit this at startup so an on-call engineer can confirm whether the
    password was merged into the URL (via Settings._merge_redis_password) without
    leaking the raw secret into logs.
    """
    from urllib.parse import urlparse, urlunparse

    try:
        parsed = urlparse(url)
    except Exception:
        return "<unparseable>"
    netloc = parsed.netloc or ""
    if "@" in netloc:
        _, host_port = netloc.rsplit("@", 1)
        netloc = f":***@{host_port}"
    return urlunparse(parsed._replace(netloc=netloc))


# Upper bound for the startup Redis PING. redis-py's default socket_connect_timeout
# is None (unlimited), so an unreachable Redis would block lifespan() for the full
# TCP SYN retry window (~2min on Linux) — longer than the ai-service healthcheck
# start_period, which would mark the container unhealthy for the wrong reason.
# 3s is plenty for a same-network Redis and tight enough to fail fast.
_REDIS_PREFLIGHT_TIMEOUT_SEC = 3.0


async def _redis_preflight() -> None:
    """PING Redis at startup and log a classified failure if unreachable.

    Rate-limit failures fail-closed and return 503 on every AI request
    (VULN-070), so a misconfigured REDIS_URL / REDIS_PASSWORD silently breaks
    every admin AI feature until the first user report. Surfacing it in the
    startup banner gives operators an immediate, actionable signal rather than
    waiting for ``rate_limit.redis_error_fail_closed`` to fire in production.
    """
    try:
        redis = deps_module._get_redis()
        pong = await asyncio.wait_for(redis.ping(), timeout=_REDIS_PREFLIGHT_TIMEOUT_SEC)
        logger.info(
            "redis.preflight_ok",
            extra={"data": {"url": _redacted_redis_url(settings.redis_url), "pong": bool(pong)}},
        )
    except Exception as exc:
        logger.error(
            "redis.preflight_failed",
            extra={
                "data": {
                    "url": _redacted_redis_url(settings.redis_url),
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                    "category": classify_redis_error(exc),
                    "timeout_sec": _REDIS_PREFLIGHT_TIMEOUT_SEC,
                    "hint": (
                        "If category=auth, confirm REDIS_PASSWORD is exported to the "
                        "ai-service container and that REDIS_URL does not already carry "
                        "a userinfo segment (the @-check in Settings._merge_redis_password "
                        "skips the merge when one is present)."
                    ),
                }
            },
            exc_info=True,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the PG pool early so the JWT key refresher has something to talk to.
    # If PG isn't reachable yet, start_jwt_key_refresher's initial fetch fails
    # softly and we fall back to env seed until the refresher's first successful
    # tick (60s default).
    try:
        pool = await deps_module.get_pg_pool()
        await start_jwt_key_refresher(pool)
    except Exception as exc:
        # Non-fatal: auth still works with env seed (settings.jwt_secret).
        logger.warning("jwt_keys.startup_skipped", extra={"data": {"error": str(exc)}})

    # Non-fatal Redis ping — we deliberately do NOT abort startup on failure.
    # The service can still serve /health and cached responses; we just want the
    # misconfig spelled out loudly in the log so it doesn't hide behind the
    # generic 503 from the rate limiter.
    await _redis_preflight()

    yield

    await stop_jwt_key_refresher()
    if deps_module._redis is not None:
        await deps_module._redis.close()
    if deps_module._pg_pool is not None:
        await deps_module._pg_pool.close()


_docs_url = "/docs" if settings.env == "dev" else None
app = FastAPI(
    title="AetherBlog AI Service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs_url else None,
)

# SECURITY (VULN-068): tighten CORS. The previous config combined
# allow_origins=[localhost entries] with allow_methods=["*"] + allow_headers=["*"]
# + allow_credentials=True — a high-risk shape if the origin list ever grows or
# is misconfigured. We explicitly enumerate the verbs and headers we actually
# use; any new header (e.g. X-Internal-Service) must be added intentionally.
#
# NOTE: allow_headers deliberately does NOT include "X-Internal-Service" so
# the browser CORS path cannot trigger internal endpoints even if an origin
# is allow-listed in the future.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:7899",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Request-Id",
        "X-Trace-Id",
        "Accept",
    ],
)

app.include_router(router)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid4())
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-Id"] = request_id
    logger.info(
        "request %s %s %s %.2fms",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        extra={"traceId": request_id},
    )
    return response


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    payload = ApiResponse(
        code=exc.status_code,
        message=str(exc.detail),
        success=False,
        errorMessage=str(exc.detail),
        errorCode=f"HTTP_{exc.status_code}",
        requestId=getattr(request.state, "request_id", None)
    )
    return JSONResponse(
        status_code=exc.status_code, content=payload.model_dump(), headers=exc.headers
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    payload = ApiResponse(
        code=400,
        message="Validation failed",
        success=False,
        errorMessage="Validation failed",
        errorCode="VALIDATION_ERROR",
        data={"errors": [{"field": ".".join(str(loc) for loc in e.get("loc", [])), "message": e.get("msg", "Validation error")} for e in exc.errors()]},
        requestId=getattr(request.state, "request_id", None)
    )
    return JSONResponse(status_code=400, content=payload.model_dump())


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # extra={"data": {...}} because JSONFormatter only reads record.data;
    # the older extra={"error": ...} shape was silently dropped.
    logger.exception(
        "unhandled_exception",
        extra={"data": {"error": str(exc), "error_type": type(exc).__name__}},
    )
    payload = ApiResponse(
        code=500,
        message="Internal server error",
        success=False,
        errorMessage="Internal server error",
        errorCode="INTERNAL_ERROR",
        requestId=getattr(request.state, "request_id", None)
    )
    return JSONResponse(status_code=500, content=payload.model_dump())
