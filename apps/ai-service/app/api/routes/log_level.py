"""Runtime log level control for the ai-service.

GET  /api/v1/admin/log-level  → returns the root logger's current level.
PUT  /api/v1/admin/log-level  → sets the root logger's level on the fly.

Both endpoints accept either an admin JWT or the X-Internal-Service token
(see ``app.api.deps.require_admin_or_internal``) so the Go backend can
proxy admin UI requests through its own ``/v1/admin/system/log-level``
endpoint without exposing the ai-service directly to the browser.

The change is in-process and NOT persisted: a container restart returns
to ``AI_LOG_LEVEL`` from the environment. Long-term changes belong in
docker-compose / .env, the runtime API is for one-off triage.
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
    level: str = Field(..., description="Current root logger level (lowercase).")


class LogLevelUpdate(BaseModel):
    level: str = Field(..., description="One of debug/info/warning/error/critical.")


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
    # Log the change at the new level itself (with INFO as the floor) so the
    # event is visible regardless of how aggressive the new threshold is.
    # Picking .warning() unconditionally would silently drop the audit line
    # when the operator just set the root logger to ERROR/CRITICAL.
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
