from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_metrics, require_admin
from app.schemas.common import ApiResponse


router = APIRouter(prefix="/api/v1/admin/metrics", tags=["metrics"])


@router.get("/ai")
async def ai_metrics(user=Depends(require_admin), metrics=Depends(get_metrics)) -> ApiResponse[dict]:
    return ApiResponse(data=metrics.snapshot())
