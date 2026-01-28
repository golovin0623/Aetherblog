from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import ai, health, metrics, search


router = APIRouter()
router.include_router(health.router)
router.include_router(ai.router)
router.include_router(search.router)
router.include_router(metrics.router)
