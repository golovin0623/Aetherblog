"""ai-service 的运行时日志级别控制。

GET  /api/v1/admin/log-level  → 返回 root logger 当前的级别。
PUT  /api/v1/admin/log-level  → 在线设置 root logger 的级别。

两个端点都接受管理员 JWT 或 X-Internal-Service token（参见
``app.api.deps.require_admin_or_internal``），这样 Go 后端就可以通过自身
``/v1/admin/system/log-level`` 端点代理管理后台请求，而不必把 ai-service
直接暴露给浏览器。

变更只作用于当前进程且不会持久化：容器重启后会回到环境变量中
``AI_LOG_LEVEL`` 指定的级别。长期修改应改 docker-compose / .env，
运行时 API 仅用于一次性故障排查。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import require_admin_or_internal
from app.schemas.common import ApiResponse


router = APIRouter(
    prefix="/api/v1/admin/log-level",
    tags=["admin"],
    dependencies=[Depends(require_admin_or_internal)],
)


_VALID_LEVELS: dict[str, int] = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "warn": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
}


class LogLevelResponse(BaseModel):
    level: str = Field(..., description="当前 root logger 级别（小写）。")


class LogLevelUpdate(BaseModel):
    level: str = Field(..., description="取值之一：debug/info/warning/error/critical。")


def _current_level_name() -> str:
    return logging.getLevelName(logging.getLogger().getEffectiveLevel()).lower()


@router.get("", response_model=ApiResponse[LogLevelResponse])
async def get_log_level() -> ApiResponse[LogLevelResponse]:
    return ApiResponse[LogLevelResponse](
        code=200,
        message="ok",
        success=True,
        data=LogLevelResponse(level=_current_level_name()),
    )


@router.put("", response_model=ApiResponse[LogLevelResponse])
async def set_log_level(payload: LogLevelUpdate) -> ApiResponse[LogLevelResponse]:
    requested = payload.level.strip().lower()
    if requested not in _VALID_LEVELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"invalid level: {payload.level!r}",
        )
    new_level = _VALID_LEVELS[requested]
    logging.getLogger().setLevel(new_level)
    # 用新级别本身（以 INFO 为下限）来记录这次变更，保证无论新阈值多严格
    # 该事件都能可见。如果无脑使用 .warning()，当运维刚把 root logger 调到
    # ERROR/CRITICAL 时，这条审计日志就会被静默丢弃。
    logging.getLogger("ai-service").log(
        max(logging.INFO, new_level),
        "log_level.changed",
        extra={"data": {"level": requested, "by": "admin-api"}},
    )
    return ApiResponse[LogLevelResponse](
        code=200,
        message="ok",
        success=True,
        data=LogLevelResponse(level=_current_level_name()),
    )
