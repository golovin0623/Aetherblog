from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_llm_router, require_admin
from app.schemas.common import ApiResponse
from app.services.llm_router import LlmRouter

logger = logging.getLogger("ai-service")

router = APIRouter(prefix="/api/v1/admin/ai/prompts", tags=["prompts"], dependencies=[Depends(require_admin)])


class PromptConfigResponse(BaseModel):
    task_type: str
    default_prompt: str | None
    custom_prompt: str | None


class PromptUpdateRequest(BaseModel):
    prompt_template: str | None


@router.get("", response_model=ApiResponse[list[PromptConfigResponse]])
async def get_all_prompts(
    llm: LlmRouter = Depends(get_llm_router)
) -> ApiResponse[list[PromptConfigResponse]]:
    """Get all prompt configurations."""
    query = """
        SELECT tt.code as task_type, tt.prompt_template as default_prompt, r.prompt_template as custom_prompt
        FROM ai_task_types tt
        LEFT JOIN ai_task_routing r ON r.task_type_id = tt.id AND r.user_id IS NULL
        ORDER BY tt.id
    """
    async with llm.model_router.pool.acquire() as conn:
        rows = await conn.fetch(query)
    
    data = [
        PromptConfigResponse(
            task_type=row["task_type"],
            default_prompt=row["default_prompt"],
            custom_prompt=row["custom_prompt"]
        )
        for row in rows
    ]
    return ApiResponse(data=data)


@router.get("/{task_type}", response_model=ApiResponse[PromptConfigResponse])
async def get_prompt_config(
    task_type: str,
    llm: LlmRouter = Depends(get_llm_router)
) -> ApiResponse[PromptConfigResponse]:
    """Get prompt configuration for a task type."""
    
    query = """
        SELECT r.config_override as config_override
        FROM ai_task_types tt
        LEFT JOIN ai_task_routing r ON r.task_type_id = tt.id AND r.user_id IS NULL
        WHERE tt.code = $1
    """
    async with llm.model_router.pool.acquire() as conn:
        row = await conn.fetchrow(query, task_type)
    
    if not row:
        raise HTTPException(status_code=404, detail=f"Task type {task_type} not found")

    config_override = row["config_override"] or {}
    custom_prompt = None
    if isinstance(config_override, dict):
        custom_prompt = config_override.get("prompt_template")

    return ApiResponse(
        data=PromptConfigResponse(
            task_type=task_type,
            default_prompt=None,
            custom_prompt=custom_prompt
        )
    )


@router.put("/{task_type}", response_model=ApiResponse[bool])
async def update_prompt_config(
    task_type: str,
    req: PromptUpdateRequest,
    llm: LlmRouter = Depends(get_llm_router)
) -> ApiResponse[bool]:
    """Update prompt configuration for a task type."""
    query = """
        SELECT r.config_override
        FROM ai_task_types tt
        LEFT JOIN ai_task_routing r ON r.task_type_id = tt.id AND r.user_id IS NULL
        WHERE tt.code = $1
    """
    async with llm.model_router.pool.acquire() as conn:
        row = await conn.fetchrow(query, task_type)
    if not row:
        raise HTTPException(status_code=404, detail=f"Task type {task_type} not found")

    config_override = row["config_override"] or {}
    if not isinstance(config_override, dict):
        config_override = {}
    if req.prompt_template:
        config_override["prompt_template"] = req.prompt_template
    else:
        config_override.pop("prompt_template", None)

    success = await llm.model_router.update_routing(
        task_type=task_type,
        config_override=config_override,
        update_config=True,
        user_id=None
    )
    return ApiResponse(data=success)
