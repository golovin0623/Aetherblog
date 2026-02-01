from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_llm_router, require_admin
from app.schemas.common import ApiResponse
from app.services.llm_router import LlmRouter

logger = logging.getLogger("ai-service")

router = APIRouter(prefix="/api/v1/admin/ai/tasks", tags=["tasks"], dependencies=[Depends(require_admin)])

class TaskTypeCreate(BaseModel):
    code: str
    name: str
    description: str | None = None
    model_type: str | None = "chat"
    temperature: float | None = 0.7
    max_tokens: int | None = None
    prompt_template: str | None = None

class TaskTypeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    model_type: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    prompt_template: str | None = None

@router.get("", response_model=ApiResponse[list[dict]])
async def list_tasks(llm: LlmRouter = Depends(get_llm_router)):
    tasks = await llm.model_router.list_task_types()
    return ApiResponse(data=tasks)

@router.post("", response_model=ApiResponse[int])
async def create_task(req: TaskTypeCreate, llm: LlmRouter = Depends(get_llm_router)):
    try:
        payload = req.model_dump()
        if payload.get("model_type") is None:
            payload["model_type"] = "chat"
        if payload.get("temperature") is None:
            payload["temperature"] = 0.7
        task_id = await llm.model_router.create_task_type(**payload)
        return ApiResponse(data=task_id)
    except Exception as e:
        logger.error(f"Failed to create task: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{code}", response_model=ApiResponse[bool])
async def update_task(code: str, req: TaskTypeUpdate, llm: LlmRouter = Depends(get_llm_router)):
    success = await llm.model_router.update_task_type(code, **req.model_dump(exclude_unset=True))
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return ApiResponse(data=success)

@router.delete("/{code}", response_model=ApiResponse[bool])
async def delete_task(code: str, llm: LlmRouter = Depends(get_llm_router)):
    success = await llm.model_router.delete_task_type(code)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return ApiResponse(data=success)
