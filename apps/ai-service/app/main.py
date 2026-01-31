from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import router
from app.api import deps as deps_module
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.schemas.common import ApiResponse


# ref: §2.4.2.5
configure_logging()
logger = logging.getLogger("ai-service")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    if deps_module._redis is not None:
        await deps_module._redis.close()
    if deps_module._pg_pool is not None:
        await deps_module._pg_pool.close()


app = FastAPI(title="AetherBlog AI Service", version="0.1.0", lifespan=lifespan)
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
    )
    return response


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    payload = ApiResponse(
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
        success=False,
        errorMessage="Validation failed",
        errorCode="VALIDATION_ERROR",
        data={"errors": exc.errors()},
        requestId=getattr(request.state, "request_id", None)
    )
    return JSONResponse(status_code=400, content=payload.model_dump())


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("unhandled_exception", extra={"error": str(exc)})
    payload = ApiResponse(
        success=False,
        errorMessage="Internal server error",
        errorCode="INTERNAL_ERROR",
        requestId=getattr(request.state, "request_id", None)
    )
    return JSONResponse(status_code=500, content=payload.model_dump())
