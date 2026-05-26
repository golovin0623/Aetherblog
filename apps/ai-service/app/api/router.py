from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    agent,
    ai,
    atlas,
    health,
    knowledge_bases,
    log_level,
    metrics,
    profiles,
    providers,
    prompts,
    search,
    tasks,
    workflows,
)


router = APIRouter()
router.include_router(health.router)
router.include_router(ai.router)
router.include_router(agent.router)
router.include_router(search.router)
router.include_router(profiles.router)
router.include_router(metrics.router)
router.include_router(providers.router)
router.include_router(prompts.router)
router.include_router(tasks.router)
router.include_router(log_level.router)
router.include_router(workflows.router)
router.include_router(knowledge_bases.router)
router.include_router(atlas.router)
