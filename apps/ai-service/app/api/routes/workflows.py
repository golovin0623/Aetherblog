from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_admin_or_internal
from app.schemas.common import ApiResponse
from app.workflows import WorkflowExecutionRequest, WorkflowExecutionResult, WorkflowRunner

router = APIRouter(prefix="/api/v1/agent/workflows", tags=["agent-workflows"])


@router.post("/execute", response_model=ApiResponse[WorkflowExecutionResult])
async def execute_workflow(
    payload: WorkflowExecutionRequest,
    _user=Depends(require_admin_or_internal),
) -> ApiResponse[WorkflowExecutionResult]:
    runner = WorkflowRunner()
    result = await runner.run(
        payload.definition,
        payload.inputs,
        run_id=payload.runId,
        simulate_external=payload.simulateExternal,
    )
    return ApiResponse(data=result)
