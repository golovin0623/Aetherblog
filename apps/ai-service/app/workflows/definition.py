from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


WorkflowMode = Literal["fixed", "autonomous", "hybrid"]
NodeType = Literal[
    "input",
    "output",
    "llm",
    "agent",
    "tool",
    "extractor",
    "branch",
    "loop",
    "code",
]
RunStatus = Literal["pending", "running", "paused", "success", "failed", "cancelled", "budget_exceeded"]
TraceStatus = Literal["pending", "running", "success", "failed", "skipped"]


class WorkflowInputSpec(BaseModel):
    type: str
    required: bool = False
    description: str | None = None


class WorkflowNode(BaseModel):
    id: str
    type: NodeType
    label: str | None = None
    description: str | None = None
    position: dict[str, float] | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class WorkflowEdge(BaseModel):
    id: str | None = None
    source: str
    target: str
    label: str | None = None


class WorkflowDefinition(BaseModel):
    version: int
    name: str
    mode: WorkflowMode
    description: str | None = None
    inputs: dict[str, WorkflowInputSpec] = Field(default_factory=dict)
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge] = Field(default_factory=list)
    viewport: dict[str, Any] | None = None


class WorkflowExecutionRequest(BaseModel):
    definition: WorkflowDefinition
    inputs: dict[str, Any] = Field(default_factory=dict)
    runId: int | str | None = None
    simulateExternal: bool = False
    tools: list["WorkflowToolSnapshot"] = Field(default_factory=list)
    budget: "WorkflowBudget" = Field(default_factory=lambda: WorkflowBudget())
    redactionPolicy: str | None = None
    resumeFromNode: str | None = None


class WorkflowToolSnapshot(BaseModel):
    code: str
    handlerType: str
    handlerConfig: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    requiresApproval: bool = False
    rateLimitPerMin: int | None = None
    timeoutMs: int | None = None


class WorkflowBudget(BaseModel):
    maxTokens: int | None = None
    maxCostUsd: float | None = None
    maxDurationMs: int | None = None
    maxNodes: int | None = None


class WorkflowTraceItem(BaseModel):
    id: str
    nodeId: str
    nodeLabel: str
    nodeType: NodeType
    status: TraceStatus
    summary: str | None = None
    input: Any | None = None
    output: Any | None = None
    error: str | None = None
    durationMs: int = 0


class WorkflowExecutionResult(BaseModel):
    runId: int | str | None = None
    status: RunStatus
    outputs: dict[str, Any] = Field(default_factory=dict)
    currentNode: str | None = None
    trace: list[WorkflowTraceItem] = Field(default_factory=list)
    errorMessage: str | None = None
    promptTokens: int = 0
    completionTokens: int = 0
    totalCostUsd: float = 0
