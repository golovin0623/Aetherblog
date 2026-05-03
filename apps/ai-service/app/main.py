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
    """返回把 userinfo 段密码替换为 ``***`` 后的 REDIS_URL。

    仅在启动时输出一次,让 on-call 工程师可以确认密码是否已经被
    (通过 Settings._merge_redis_password) 合并进 URL,
    同时避免把原始 secret 泄露到日志里。
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


# 启动期 Redis PING 的超时上限。redis-py 的默认 socket_connect_timeout
# 为 None (无限),Redis 不可达时会让 lifespan() 阻塞整个 TCP SYN 重试窗口
# (Linux 下约 2 分钟) —— 长于 ai-service healthcheck 的 start_period,
# 会导致容器被错误地判定为 unhealthy。
# 3 秒对同网段 Redis 完全够用,又紧凑到能快速失败。
_REDIS_PREFLIGHT_TIMEOUT_SEC = 3.0


async def _redis_preflight() -> None:
    """启动时对 Redis 进行 PING,失败则按类型记录日志。

    Rate-limit 走 fail-closed,在每个 AI 请求上都会返回 503 (VULN-070),
    因此 REDIS_URL / REDIS_PASSWORD 配错会悄悄让所有 admin AI 功能失效,
    直到第一份用户反馈出现才被发现。在启动 banner 里把问题显式抛出,
    让运维拿到一个立即可操作的信号,不必等到生产环境里
    ``rate_limit.redis_error_fail_closed`` 触发。
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
    # 提前预热 PG pool,这样 JWT key refresher 启动时有目标可对话。
    # 如果 PG 此时还连不上,start_jwt_key_refresher 的初次拉取会软失败,
    # 在 refresher 首次成功 tick (默认 60s) 之前我们都靠环境 seed 兜底。
    try:
        pool = await deps_module.get_pg_pool()
        await start_jwt_key_refresher(pool)
    except Exception as exc:
        # 非致命: 鉴权仍可用环境 seed (settings.jwt_secret) 工作。
        logger.warning("jwt_keys.startup_skipped", extra={"data": {"error": str(exc)}})

    # 非致命的 Redis ping —— 这里有意**不**因失败终止启动。
    # 服务依然能提供 /health 和缓存响应;
    # 我们只是想把配置错误大声写进日志,
    # 避免它被 rate limiter 抛出的通用 503 给盖掉。
    await _redis_preflight()

    # 预热核心服务，消除"第一次点击 AI 工具报错、第二次成功"的冷启动抖动。
    # 原因：deps 中 provider_registry / credential_resolver / model_router /
    # llm_router / usage_logger 都是惰性创建。首次请求会同步触发它们的链式
    # 初始化（DB 查询 + Fernet key 解析 + LiteLLM 客户端首次握手），叠加
    # provider 的 TLS 握手，任意一环 200ms 抖动都会被外层 SSE 当成 fail。
    # 这里在 lifespan 阶段把它们一次性建好；任何一个失败都软降级（保持
    # lazy 路径作为兜底），不阻塞启动。
    await _prewarm_core_services()

    yield

    await stop_jwt_key_refresher()
    if deps_module._redis is not None:
        await deps_module._redis.close()
    if deps_module._pg_pool is not None:
        await deps_module._pg_pool.close()


async def _prewarm_core_services() -> None:
    """在 lifespan 中预初始化所有 AI 路径会用到的全局 services。

    单一职责：减少首请求延迟与抖动。任何一个初始化失败都只 ``warning`` 不抛，
    保持 deps 中 ``get_xxx()`` 的 lazy 兜底路径作为最后防线。
    """
    prewarm_targets = [
        ("provider_registry", deps_module.get_provider_registry),
        ("credential_resolver", deps_module.get_credential_resolver),
        ("model_router", deps_module.get_model_router),
        ("llm_router", deps_module.get_llm_router),
        ("usage_logger", deps_module.get_usage_logger),
    ]
    for name, factory in prewarm_targets:
        try:
            await factory()
        except Exception as exc:
            logger.warning(
                "ai_service.prewarm_failed",
                extra={
                    "data": {
                        "service": name,
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                },
            )
            continue
    logger.info("ai_service.prewarm_done")


_docs_url = "/docs" if settings.env == "dev" else None
app = FastAPI(
    title="AetherBlog AI Service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=None,
    openapi_url="/openapi.json" if _docs_url else None,
)

# 安全 (VULN-068): 收紧 CORS。旧配置把 allow_origins=[localhost 条目]
# 与 allow_methods=["*"] + allow_headers=["*"] + allow_credentials=True 拼在一起 ——
# 一旦 origin 列表扩张或被配错,这种形态就是高风险的。
# 这里显式枚举我们真正使用的方法和 header;
# 任何新 header (例如 X-Internal-Service) 都必须刻意添加。
#
# 注意: allow_headers 故意**不**包含 "X-Internal-Service",
# 这样即使将来 origin 被 allow-list,浏览器 CORS 路径也无法触发内部 endpoint。
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


# Liveness 路径每 10s 由 docker healthcheck / SystemMonitor 调用一次,
# 业务排查时是噪声。2xx 直接不落访问日志;失败仍按状态码升级到 warning/error。
# 与 Go 后端 internal/middleware/trace.go::isHealthProbePath 行为对齐。
_HEALTH_PROBE_PATHS = frozenset({"/health", "/ready"})


def _is_health_probe(path: str) -> bool:
    if path in _HEALTH_PROBE_PATHS:
        return True
    return path.endswith("/health") or path.endswith("/ready")


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid4())
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-Id"] = request_id

    status_code = response.status_code
    if status_code < 400 and _is_health_probe(request.url.path):
        return response

    if status_code >= 500:
        log_method = logger.error
    elif status_code >= 400:
        log_method = logger.warning
    else:
        log_method = logger.info

    log_method(
        "request %s %s %s %.2fms",
        request.method,
        request.url.path,
        status_code,
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
    # 用 extra={"data": {...}},因为 JSONFormatter 只读 record.data;
    # 老的 extra={"error": ...} 形态会被悄悄丢弃。
    logger.exception(
        "unhandled_exception",
        extra={"data": {"error": str(exc), "error_type": type(exc).__name__}},
    )
    # 把异常类型 + 截断后的 message 一并回传给 admin。光说 "Internal server error"
    # 不带任何上下文,前端只能给用户看一个红色 toast,运维只能去捞 docker logs ——
    # 这两个失败都属于 "可避免的痛苦"。截断到 240 字符避免泄露完整堆栈;
    # 如果 message 包含敏感信息(比如 DSN 字符串)需要在更上层 raise 时主动包装。
    error_type = type(exc).__name__
    raw_msg = str(exc).strip()
    safe_msg = raw_msg[:240] + "…" if len(raw_msg) > 240 else raw_msg
    detail = f"{error_type}: {safe_msg}" if safe_msg else error_type
    payload = ApiResponse(
        code=500,
        message=detail or "Internal server error",
        success=False,
        errorMessage=detail or "Internal server error",
        errorCode=f"INTERNAL_{error_type.upper()}",
        requestId=getattr(request.state, "request_id", None),
    )
    return JSONResponse(status_code=500, content=payload.model_dump())
