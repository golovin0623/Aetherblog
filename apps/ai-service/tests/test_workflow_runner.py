from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.api.routes.workflows import (
    _coerce_post_id,
    _eval_safe_expression,
    _node_uses_kb_tool,
    _normalize_budget_status,
    execute_workflow,
)
from app.services.llm_router import _budgeted_max_tokens
from app.workflows import WorkflowDefinition, WorkflowExecutionRequest, WorkflowExecutionResult, WorkflowNode, WorkflowRunner
from app.workflows.runner import WorkflowExecutionError, evaluate_condition, get_path, resolve_template


def _workflow(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]] | None = None,
    inputs: dict[str, dict[str, Any]] | None = None,
) -> WorkflowDefinition:
    return WorkflowDefinition(
        version=1,
        name="Test Workflow",
        mode="fixed",
        inputs=inputs or {},
        nodes=nodes,
        edges=edges or [],
    )


@pytest.mark.asyncio
async def test_linear_tool_extractor_output_success() -> None:
    definition = _workflow(
        inputs={"payload": {"type": "object", "required": True}},
        nodes=[
            {"id": "input_1", "type": "input"},
            {"id": "tool_1", "type": "tool", "data": {"toolCode": "echo", "args": {"value": "{{ inputs.payload }}"}}},
            {"id": "extract_1", "type": "extractor", "data": {"mode": "jsonpath", "path": "$.value.title"}},
            {"id": "output_1", "type": "output", "data": {"outputPath": "{{ nodes.extract_1.output }}"}},
        ],
        edges=[
            {"source": "input_1", "target": "tool_1"},
            {"source": "tool_1", "target": "extract_1"},
            {"source": "extract_1", "target": "output_1"},
        ],
    )

    result = await WorkflowRunner().run(definition, {"payload": {"title": "hello"}})

    assert result.status == "success"
    assert result.outputs["output_1"] == "hello"
    assert [item.status for item in result.trace] == ["success", "success", "success", "success"]


@pytest.mark.asyncio
async def test_missing_required_input_fails_before_running_nodes() -> None:
    definition = _workflow(
        inputs={"post_id": {"type": "integer", "required": True}},
        nodes=[{"id": "input_1", "type": "input"}],
    )

    result = await WorkflowRunner().run(definition, {})

    assert result.status == "failed"
    assert "missing required input post_id" in (result.errorMessage or "")
    assert result.trace == []


@pytest.mark.parametrize(
    ("type_name", "value"),
    [
        ("string", "abc"),
        ("number", 1.2),
        ("integer", 1),
        ("boolean", True),
        ("object", {"a": 1}),
        ("array", [1, "x"]),
        ("array[string]", ["a", "b"]),
        ("array[number]", [1, 2.5]),
        ("array[object]", [{"a": 1}]),
        ("array[boolean]", [True, False]),
        ("file", {"name": "a.txt"}),
        ("file", "asset://file"),
    ],
)
@pytest.mark.asyncio
async def test_supported_input_types_pass(type_name: str, value: Any) -> None:
    definition = _workflow(
        inputs={"value": {"type": type_name, "required": True}},
        nodes=[{"id": "input_1", "type": "input"}, {"id": "output_1", "type": "output"}],
        edges=[{"source": "input_1", "target": "output_1"}],
    )

    result = await WorkflowRunner().run(definition, {"value": value})

    assert result.status == "success"


@pytest.mark.parametrize(
    ("type_name", "value"),
    [
        ("string", 1),
        ("number", True),
        ("integer", 1.5),
        ("boolean", "true"),
        ("object", []),
        ("array", {}),
        ("array[string]", ["a", 1]),
        ("array[number]", [1, True]),
        ("array[object]", [{"a": 1}, "x"]),
        ("array[boolean]", [True, 0]),
        ("file", 123),
    ],
)
@pytest.mark.asyncio
async def test_input_type_mismatch_fails(type_name: str, value: Any) -> None:
    definition = _workflow(
        inputs={"value": {"type": type_name, "required": True}},
        nodes=[{"id": "input_1", "type": "input"}],
    )

    result = await WorkflowRunner().run(definition, {"value": value})

    assert result.status == "failed"
    assert "input value must be" in (result.errorMessage or "")


@pytest.mark.parametrize(
    ("path", "want"),
    [
        ("inputs.post_id", 171),
        ("nodes.load.output.title", "Aether"),
        ("nodes.items.output[1].name", "second"),
        ("workflow.name", "WF"),
        ("run.id", "r1"),
        ("missing.path", None),
    ],
)
def test_get_path(path: str, want: Any) -> None:
    context = {
        "inputs": {"post_id": 171},
        "nodes": {
            "load": {"output": {"title": "Aether"}},
            "items": {"output": [{"name": "first"}, {"name": "second"}]},
        },
        "workflow": {"name": "WF"},
        "run": {"id": "r1"},
    }

    assert get_path(context, path) == want


@pytest.mark.parametrize(
    ("template", "want"),
    [
        ("{{ inputs.title }}", "Hello"),
        ("Post {{ inputs.id }}: {{ inputs.title }}", "Post 7: Hello"),
        ({"id": "{{ inputs.id }}", "title": "{{ inputs.title }}"}, {"id": 7, "title": "Hello"}),
        (["{{ inputs.title }}", "{{ inputs.id }}"], ["Hello", 7]),
        ("plain text", "plain text"),
    ],
)
def test_resolve_template(template: Any, want: Any) -> None:
    assert resolve_template(template, {"inputs": {"id": 7, "title": "Hello"}}) == want


@pytest.mark.parametrize(
    ("expression", "want"),
    [
        ("inputs.score > 0.8", True),
        ("inputs.score < 0.8", False),
        ("inputs.score >= 0.91", True),
        ("inputs.score <= 0.9", False),
        ("inputs.title == \"ok\"", True),
        ("inputs.title != \"bad\"", True),
        ("exists(inputs.title)", True),
        ("exists(inputs.missing)", False),
        ("nodes.audit.output.score > inputs.min_score", True),
    ],
)
def test_evaluate_condition(expression: str, want: bool) -> None:
    context = {
        "inputs": {"score": 0.91, "title": "ok", "min_score": 0.9},
        "nodes": {"audit": {"output": {"score": 0.92}}},
    }

    assert evaluate_condition(expression, context) is want


@pytest.mark.parametrize("expression", ["", "inputs.score + 1", "__import__('os')", "inputs.score;drop"])
def test_evaluate_condition_rejects_unsupported_expression(expression: str) -> None:
    with pytest.raises(ValueError):
        evaluate_condition(expression, {"inputs": {"score": 1}})


@pytest.mark.parametrize(
    ("expression", "want"),
    [
        ("inputs.score >= 0.8 and not inputs.blocked", True),
        ("inputs.score < 0.8 or inputs.flag", False),
        ("-inputs.delta", -3),
        ("0 < inputs.score < 2", True),
    ],
)
def test_safe_code_expression_supports_reviewed_operators(expression: str, want: Any) -> None:
    variables = {"inputs": {"score": 1, "blocked": False, "flag": False, "delta": 3}, "nodes": {}}

    assert _eval_safe_expression(expression, variables) == want


@pytest.mark.parametrize("post_id", ["abc", "1.5", "", True])
def test_kb_post_id_rejects_non_integer_values(post_id: Any) -> None:
    with pytest.raises(WorkflowExecutionError, match="kb_get_post id must be integer"):
        _coerce_post_id(post_id)


def test_agent_allowed_kb_tool_requires_real_db_tool() -> None:
    node = WorkflowNode(id="agent_1", type="agent", data={"allowedTools": ["kb_search"]})

    assert _node_uses_kb_tool(node) is True


def test_budgeted_max_tokens_honors_requested_token_limit() -> None:
    assert (
        _budgeted_max_tokens(
            configured_max_tokens=200,
            requested_max_tokens=50,
            max_cost_usd=None,
            messages=[{"role": "user", "content": "hello"}],
            input_cost_per_1m=None,
            output_cost_per_1m=None,
            cached_input_cost_per_1m=None,
        )
        == 49
    )


def test_budgeted_max_tokens_caps_output_by_cost() -> None:
    assert (
        _budgeted_max_tokens(
            configured_max_tokens=200,
            requested_max_tokens=None,
            max_cost_usd=0.00001,
            messages=[{"role": "user", "content": "hello"}],
            input_cost_per_1m=0,
            output_cost_per_1m=10,
            cached_input_cost_per_1m=None,
        )
        == 1
    )


def test_budgeted_max_tokens_rejects_exhausted_cost_budget() -> None:
    with pytest.raises(ValueError, match="budget exceeded"):
        _budgeted_max_tokens(
            configured_max_tokens=200,
            requested_max_tokens=None,
            max_cost_usd=0,
            messages=[{"role": "user", "content": "hello"}],
            input_cost_per_1m=None,
            output_cost_per_1m=None,
            cached_input_cost_per_1m=None,
        )


def test_budget_failure_status_normalizes_to_budget_exceeded() -> None:
    result = _normalize_budget_status(
        WorkflowExecutionResult(status="failed", outputs={}, errorMessage="budget exceeded: maxCostUsd")
    )

    assert result.status == "budget_exceeded"


@pytest.mark.parametrize(
    ("mode", "node_input", "data", "want"),
    [
        ("jsonpath", {"post": {"title": "hello"}}, {"path": "$.post.title"}, "hello"),
        ("jmespath", {"items": [{"id": 1}]}, {"path": "$.items[0].id"}, 1),
        ("regex", "Title: Hello\nBody: X", {"pattern": r"Title:\s+(.+)"}, "Hello"),
        ("function_call_args", {"arguments": "{\"id\": 7}"}, {}, {"id": 7}),
        ("schema", {"ok": True}, {}, {"ok": True}),
    ],
)
@pytest.mark.asyncio
async def test_extractor_modes(mode: str, node_input: Any, data: dict[str, Any], want: Any) -> None:
    node = WorkflowNode(id="extract_1", type="extractor", data={"mode": mode, "source": "{{ nodes.tool_1.output.value }}", **data})

    result = await WorkflowRunner().run(
        _workflow(
            nodes=[
                {"id": "tool_1", "type": "tool", "data": {"toolCode": "echo", "args": {"value": node_input}}},
                node.model_dump(),
                {"id": "output_1", "type": "output", "data": {"outputPath": "{{ nodes.extract_1.output }}"}},
            ],
            edges=[
                {"source": "tool_1", "target": "extract_1"},
                {"source": "extract_1", "target": "output_1"},
            ],
        )
    )

    assert result.status == "success"
    assert result.outputs["output_1"] == want


@pytest.mark.asyncio
async def test_branch_skips_unmatched_path() -> None:
    definition = _workflow(
        inputs={"score": {"type": "number", "required": True}},
        nodes=[
            {"id": "input_1", "type": "input"},
            {"id": "branch_1", "type": "branch", "data": {"when": "inputs.score > 0.8"}},
            {"id": "pass_1", "type": "output", "data": {"value": "pass"}},
            {"id": "repair_1", "type": "output", "data": {"value": "repair"}},
        ],
        edges=[
            {"source": "input_1", "target": "branch_1"},
            {"source": "branch_1", "target": "pass_1", "label": "true"},
            {"source": "branch_1", "target": "repair_1", "label": "false"},
        ],
    )

    result = await WorkflowRunner().run(definition, {"score": 0.9})

    assert result.status == "success"
    assert result.outputs["pass_1"] == "pass"
    assert result.outputs["repair_1"] is None
    assert result.trace[-1].status == "skipped"


@pytest.mark.asyncio
async def test_loop_resolves_body_template_and_truncates() -> None:
    definition = _workflow(
        inputs={"items": {"type": "array[string]", "required": True}},
        nodes=[
            {
                "id": "loop_1",
                "type": "loop",
                "data": {
                    "over": "{{ inputs.items }}",
                    "maxIterations": 2,
                    "bodyTemplate": "item {{ loop.index }}={{ loop.item }}",
                },
            },
            {"id": "output_1", "type": "output", "data": {"outputPath": "{{ nodes.loop_1.output }}"}},
        ],
        edges=[{"source": "loop_1", "target": "output_1"}],
    )

    result = await WorkflowRunner().run(definition, {"items": ["a", "b", "c"]})

    assert result.status == "success"
    assert result.outputs["output_1"] == {
        "items": ["item 0=a", "item 1=b"],
        "count": 2,
        "truncated": True,
    }


@pytest.mark.asyncio
async def test_unregistered_tool_fails_with_trace() -> None:
    definition = _workflow(nodes=[{"id": "tool_1", "type": "tool", "data": {"toolCode": "missing"}}])

    result = await WorkflowRunner().run(definition, {})

    assert result.status == "failed"
    assert result.currentNode == "tool_1"
    assert "not registered" in (result.errorMessage or "")
    assert result.trace[0].status == "failed"


@pytest.mark.asyncio
async def test_external_node_requires_executor_by_default() -> None:
    definition = _workflow(nodes=[{"id": "llm_1", "type": "llm", "data": {"prompt": "hi"}}])

    result = await WorkflowRunner().run(definition, {})

    assert result.status == "failed"
    assert "executor is not connected" in (result.errorMessage or "")


@pytest.mark.asyncio
async def test_external_node_can_be_simulated_explicitly() -> None:
    definition = _workflow(nodes=[{"id": "llm_1", "type": "llm", "data": {"prompt": "hi"}}])

    result = await WorkflowRunner().run(definition, {}, simulate_external=True)

    assert result.status == "success"
    assert result.outputs["llm_1"]["simulated"] is True


@pytest.mark.asyncio
async def test_simulated_code_node_does_not_execute_restricted_expression() -> None:
    definition = _workflow(nodes=[{"id": "code_1", "type": "code", "data": {"expression": "# sandbox-worker 接入后启用"}}])

    result = await WorkflowRunner(code_executor=lambda _node, _context: {"unexpected": True}).run(
        definition,
        {},
        simulate_external=True,
    )

    assert result.status == "success"
    assert result.outputs["code_1"]["simulated"] is True
    assert result.outputs["code_1"]["result"] is None


@pytest.mark.asyncio
async def test_resume_from_node_skips_prior_nodes_without_rerunning_side_effects() -> None:
    def blocked_tool(_args: dict[str, Any], _context: dict[str, Any]) -> dict[str, Any]:
        raise AssertionError("upstream tool should not run when resuming from code_1")

    async def code_executor(_node: WorkflowNode, _context: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    definition = _workflow(
        nodes=[
            {"id": "tool_1", "type": "tool", "data": {"toolCode": "side_effect", "args": {}}},
            {"id": "code_1", "type": "code", "data": {"expression": "inputs.value"}},
            {"id": "output_1", "type": "output", "data": {"outputPath": "{{ nodes.code_1.output.ok }}"}},
        ],
        edges=[
            {"source": "tool_1", "target": "code_1"},
            {"source": "code_1", "target": "output_1"},
        ],
    )

    result = await WorkflowRunner(tools={"side_effect": blocked_tool}, code_executor=code_executor).run(
        definition,
        {"value": "unused"},
        resume_from_node="code_1",
    )

    assert result.status == "success"
    assert result.outputs["output_1"] is True
    assert [(item.nodeId, item.status) for item in result.trace] == [
        ("tool_1", "skipped"),
        ("code_1", "success"),
        ("output_1", "success"),
    ]


@pytest.mark.asyncio
async def test_resume_from_node_restores_prior_outputs_for_templates() -> None:
    async def code_executor(_node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
        return {"title": context["nodes"]["load_post"]["output"]["title"]}

    definition = _workflow(
        nodes=[
            {"id": "load_post", "type": "tool", "data": {"toolCode": "kb_get_post", "args": {"id": 1}}},
            {"id": "code_1", "type": "code", "data": {"expression": "nodes.load_post.output.title"}},
        ],
        edges=[{"source": "load_post", "target": "code_1"}],
    )

    result = await WorkflowRunner(code_executor=code_executor).run(
        definition,
        {},
        resume_from_node="code_1",
        resume_context={"nodes": {"load_post": {"output": {"title": "Restored"}, "status": "success"}}},
    )

    assert result.status == "success"
    assert result.outputs["code_1"]["title"] == "Restored"


@pytest.mark.asyncio
async def test_external_node_uses_injected_executor() -> None:
    async def fake_agent(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
        return {"node": node.id, "topic": context["inputs"]["topic"]}

    definition = _workflow(
        inputs={"topic": {"type": "string", "required": True}},
        nodes=[{"id": "agent_1", "type": "agent"}],
    )

    result = await WorkflowRunner(agent_executor=fake_agent).run(definition, {"topic": "Aether"})

    assert result.status == "success"
    assert result.outputs["agent_1"] == {"node": "agent_1", "topic": "Aether"}


@pytest.mark.asyncio
async def test_execute_workflow_route_runs_restricted_code_executor_without_llm_router() -> None:
    payload = WorkflowExecutionRequest(
        definition=_workflow(
            inputs={"value": {"type": "integer", "required": True}},
            nodes=[
                {"id": "input_1", "type": "input"},
                {"id": "code_1", "type": "code", "data": {"expression": "inputs.value + 2"}},
                {"id": "output_1", "type": "output", "data": {"outputPath": "{{ nodes.code_1.output.result }}"}},
            ],
            edges=[
                {"source": "input_1", "target": "code_1"},
                {"source": "code_1", "target": "output_1"},
            ],
        ),
        inputs={"value": 40},
    )

    response = await execute_workflow(payload, _user=SimpleNamespace(user_id="1", role="admin"))

    assert response.data is not None
    assert response.data.status == "success"
    assert response.data.outputs["output_1"] == 42


@pytest.mark.asyncio
async def test_execute_workflow_route_blocks_unconnected_mcp_tool() -> None:
    payload = WorkflowExecutionRequest(
        definition=_workflow(
            nodes=[
                {"id": "tool_1", "type": "tool", "data": {"toolCode": "web_search", "args": {"query": "Aether"}}},
            ],
        ),
        tools=[
            {
                "code": "web_search",
                "handlerType": "mcp",
                "handlerConfig": {},
                "enabled": True,
                "requiresApproval": False,
            }
        ],
    )

    response = await execute_workflow(payload, _user=SimpleNamespace(user_id="1", role="admin"))

    assert response.data is not None
    assert response.data.status == "failed"
    assert "mcp tool web_search is not connected" in (response.data.errorMessage or "")


@pytest.mark.asyncio
async def test_execute_workflow_route_returns_api_response() -> None:
    definition = _workflow(nodes=[{"id": "tool_1", "type": "tool", "data": {"toolCode": "echo", "args": {"ok": True}}}])
    payload = WorkflowExecutionRequest(definition=definition, runId="r1")

    response = await execute_workflow(payload, _user=SimpleNamespace(user_id="system", role="admin"))

    assert response.success is True
    assert response.data is not None
    assert response.data.runId == "r1"
    assert response.data.status == "success"
