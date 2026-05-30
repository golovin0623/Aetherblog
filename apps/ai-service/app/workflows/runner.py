from __future__ import annotations

import json
import operator
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.workflows.definition import (
    WorkflowDefinition,
    WorkflowEdge,
    WorkflowExecutionResult,
    WorkflowNode,
    WorkflowTraceItem,
)


class WorkflowExecutionError(ValueError):
    """Raised for deterministic workflow definition or runtime errors."""


BuiltinTool = Callable[[dict[str, Any], dict[str, Any]], Awaitable[Any] | Any]
ExternalExecutor = Callable[[WorkflowNode, dict[str, Any]], Awaitable[Any] | Any]


_TEMPLATE_RE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
_PATH_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*$")
_COMPARISON_RE = re.compile(r"^\s*(?P<left>[A-Za-z_][A-Za-z0-9_.\[\]]*)\s*(?P<op>==|!=|>=|<=|>|<)\s*(?P<right>.+?)\s*$")


@dataclass
class WorkflowRunner:
    tools: dict[str, BuiltinTool] = field(default_factory=dict)
    llm_executor: ExternalExecutor | None = None
    agent_executor: ExternalExecutor | None = None
    code_executor: ExternalExecutor | None = None

    def __post_init__(self) -> None:
        if not self.tools:
            self.tools = default_tools()

    async def run(
        self,
        definition: WorkflowDefinition,
        inputs: dict[str, Any] | None = None,
        *,
        run_id: int | str | None = None,
        simulate_external: bool = False,
        resume_from_node: str | None = None,
    ) -> WorkflowExecutionResult:
        inputs = inputs or {}
        trace: list[WorkflowTraceItem] = []
        context: dict[str, Any] = {
            "inputs": inputs,
            "workflow": {"name": definition.name, "mode": definition.mode},
            "run": {"id": run_id, "resumeFromNode": resume_from_node},
            "nodes": {},
        }

        try:
            self._validate_inputs(definition, inputs)
            nodes_by_id = self._nodes_by_id(definition)
            incoming, outgoing = self._edge_maps(definition, nodes_by_id)
            order = self._topological_order(definition, incoming, outgoing)
            if resume_from_node and resume_from_node not in nodes_by_id:
                raise WorkflowExecutionError(f"resumeFromNode {resume_from_node} is not in workflow")

            skipped: set[str] = set()
            resume_reached = resume_from_node is None
            for node_id in order:
                node = nodes_by_id[node_id]
                if not resume_reached:
                    if node_id == resume_from_node:
                        resume_reached = True
                    else:
                        trace.append(self._trace(node, "skipped", summary="resumeFromNode 前置节点已跳过"))
                        context["nodes"][node.id] = {"output": None, "status": "skipped"}
                        continue
                if self._should_skip(node, incoming[node_id], skipped, context):
                    skipped.add(node.id)
                    trace.append(self._trace(node, "skipped", summary="上游分支未命中，跳过节点"))
                    context["nodes"][node.id] = {"output": None, "status": "skipped"}
                    continue

                started = time.perf_counter()
                try:
                    node_input = self._node_input(node, incoming[node_id], context)
                    output = await self._execute_node(
                        node,
                        node_input,
                        context,
                        simulate_external=simulate_external,
                    )
                    context["nodes"][node.id] = {"output": output, "status": "success"}
                    trace.append(
                        self._trace(
                            node,
                            "success",
                            input_value=node_input,
                            output=output,
                            duration_ms=_elapsed_ms(started),
                        )
                    )
                except Exception as exc:
                    context["nodes"][node.id] = {"output": None, "status": "failed"}
                    trace.append(
                        self._trace(
                            node,
                            "failed",
                            error=str(exc),
                            duration_ms=_elapsed_ms(started),
                        )
                    )
                    return WorkflowExecutionResult(
                        runId=run_id,
                        status="failed",
                        outputs={},
                        currentNode=node.id,
                        trace=trace,
                        errorMessage=str(exc),
                    )

            outputs = self._collect_outputs(definition, context)
            return WorkflowExecutionResult(runId=run_id, status="success", outputs=outputs, trace=trace)
        except Exception as exc:
            return WorkflowExecutionResult(runId=run_id, status="failed", outputs={}, trace=trace, errorMessage=str(exc))

    def _validate_inputs(self, definition: WorkflowDefinition, inputs: dict[str, Any]) -> None:
        if definition.version != 1:
            raise WorkflowExecutionError("workflow version must be 1")
        if not definition.nodes:
            raise WorkflowExecutionError("workflow must contain at least one node")
        for name, spec in definition.inputs.items():
            if spec.required and name not in inputs:
                raise WorkflowExecutionError(f"missing required input {name}")
            if name in inputs and not _matches_type(inputs[name], spec.type):
                raise WorkflowExecutionError(f"input {name} must be {spec.type}")

    def _nodes_by_id(self, definition: WorkflowDefinition) -> dict[str, WorkflowNode]:
        nodes: dict[str, WorkflowNode] = {}
        for node in definition.nodes:
            if node.id in nodes:
                raise WorkflowExecutionError(f"duplicate node id {node.id}")
            nodes[node.id] = node
        return nodes

    def _edge_maps(
        self,
        definition: WorkflowDefinition,
        nodes_by_id: dict[str, WorkflowNode],
    ) -> tuple[dict[str, list[WorkflowEdge]], dict[str, list[WorkflowEdge]]]:
        incoming: dict[str, list[WorkflowEdge]] = defaultdict(list)
        outgoing: dict[str, list[WorkflowEdge]] = defaultdict(list)
        for node_id in nodes_by_id:
            incoming[node_id]
            outgoing[node_id]
        for edge in definition.edges:
            if edge.source not in nodes_by_id:
                raise WorkflowExecutionError(f"edge source {edge.source} not found")
            if edge.target not in nodes_by_id:
                raise WorkflowExecutionError(f"edge target {edge.target} not found")
            if edge.source == edge.target:
                raise WorkflowExecutionError(f"self-loop edge {edge.source} is not allowed")
            incoming[edge.target].append(edge)
            outgoing[edge.source].append(edge)
        return incoming, outgoing

    def _topological_order(
        self,
        definition: WorkflowDefinition,
        incoming: dict[str, list[WorkflowEdge]],
        outgoing: dict[str, list[WorkflowEdge]],
    ) -> list[str]:
        indegree = {node.id: len(incoming[node.id]) for node in definition.nodes}
        queue = deque([node.id for node in definition.nodes if indegree[node.id] == 0])
        order: list[str] = []
        while queue:
            node_id = queue.popleft()
            order.append(node_id)
            for edge in outgoing[node_id]:
                indegree[edge.target] -= 1
                if indegree[edge.target] == 0:
                    queue.append(edge.target)
        if len(order) != len(definition.nodes):
            raise WorkflowExecutionError("workflow contains a cycle")
        return order

    def _should_skip(
        self,
        node: WorkflowNode,
        incoming: list[WorkflowEdge],
        skipped: set[str],
        context: dict[str, Any],
    ) -> bool:
        if not incoming:
            return False
        allowed = False
        for edge in incoming:
            if edge.source in skipped:
                continue
            source_state = context["nodes"].get(edge.source, {})
            source_output = source_state.get("output")
            if isinstance(source_output, dict) and "branchMatched" in source_output:
                if _edge_matches_branch(edge.label, bool(source_output.get("branchMatched"))):
                    allowed = True
                    break
                continue
            allowed = True
            break
        return not allowed

    def _node_input(
        self,
        node: WorkflowNode,
        incoming: list[WorkflowEdge],
        context: dict[str, Any],
    ) -> Any:
        if source_ref := node.data.get("source"):
            return resolve_template(source_ref, context)
        if not incoming:
            return context["inputs"]
        values = [context["nodes"].get(edge.source, {}).get("output") for edge in incoming]
        values = [value for value in values if value is not None]
        if len(values) == 1:
            return values[0]
        return values

    async def _execute_node(
        self,
        node: WorkflowNode,
        node_input: Any,
        context: dict[str, Any],
        *,
        simulate_external: bool,
    ) -> Any:
        if node.type == "input":
            return context["inputs"]
        if node.type == "output":
            if "outputPath" in node.data:
                return resolve_template(node.data["outputPath"], context)
            if "value" in node.data:
                return resolve_template(node.data["value"], context)
            return node_input
        if node.type == "tool":
            return await self._execute_tool(node, context)
        if node.type == "extractor":
            return self._execute_extractor(node, node_input)
        if node.type == "branch":
            matched = evaluate_condition(str(node.data.get("when", "")), context)
            return {"branchMatched": matched}
        if node.type == "loop":
            return self._execute_loop(node, context)
        if node.type == "llm":
            return await self._execute_external(node, context, self.llm_executor, simulate_external)
        if node.type == "agent":
            return await self._execute_external(node, context, self.agent_executor, simulate_external)
        if node.type == "code":
            return await self._execute_external(node, context, self.code_executor, simulate_external)
        raise WorkflowExecutionError(f"unsupported node type {node.type}")

    async def _execute_tool(self, node: WorkflowNode, context: dict[str, Any]) -> Any:
        tool_code = str(node.data.get("toolCode") or "")
        if not tool_code:
            raise WorkflowExecutionError(f"tool node {node.id} requires toolCode")
        tool = self.tools.get(tool_code)
        if tool is None:
            raise WorkflowExecutionError(f"tool {tool_code} is not registered")
        args = resolve_template(node.data.get("args", {}), context)
        if not isinstance(args, dict):
            raise WorkflowExecutionError(f"tool node {node.id} args must resolve to object")
        result = tool(args, context)
        if hasattr(result, "__await__"):
            return await result
        return result

    def _execute_extractor(self, node: WorkflowNode, node_input: Any) -> Any:
        mode = str(node.data.get("mode") or "")
        if mode in {"jsonpath", "jmespath"}:
            path = str(node.data.get("path") or "")
            return get_path(node_input, _normalize_json_path(path))
        if mode == "regex":
            pattern = str(node.data.get("pattern") or "")
            if not pattern:
                raise WorkflowExecutionError(f"extractor node {node.id} requires pattern")
            match = re.search(pattern, str(node_input), flags=re.MULTILINE)
            if not match:
                return None
            return match.group(1) if match.groups() else match.group(0)
        if mode == "function_call_args":
            if isinstance(node_input, dict) and "arguments" in node_input:
                raw = node_input["arguments"]
            else:
                raw = node_input
            if isinstance(raw, str):
                return json.loads(raw)
            return raw
        if mode == "schema":
            return node_input
        raise WorkflowExecutionError(f"unsupported extractor mode {mode}")

    def _execute_loop(self, node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
        values = resolve_template(node.data.get("over"), context)
        if values is None:
            values = []
        if not isinstance(values, list):
            raise WorkflowExecutionError(f"loop node {node.id} over must resolve to array")
        max_iterations = int(node.data.get("maxIterations") or 100)
        if max_iterations < 1:
            raise WorkflowExecutionError(f"loop node {node.id} maxIterations must be positive")
        limited = values[:max_iterations]
        body_template = node.data.get("bodyTemplate")
        if body_template is None:
            items = [{"index": index, "item": item} for index, item in enumerate(limited)]
        else:
            items = []
            for index, item in enumerate(limited):
                loop_context = {
                    **context,
                    "loop": {"index": index, "item": item},
                }
                items.append(resolve_template(body_template, loop_context))
        return {"items": items, "count": len(items), "truncated": len(values) > len(limited)}

    async def _execute_external(
        self,
        node: WorkflowNode,
        context: dict[str, Any],
        executor: ExternalExecutor | None,
        simulate_external: bool,
    ) -> Any:
        if simulate_external:
            payload: dict[str, Any] = {
                "simulated": True,
                "nodeId": node.id,
                "nodeType": node.type,
                "summary": f"{node.type} executor is not connected",
            }
            if node.type == "agent":
                payload.update({"score": 1.0, "issues": [], "report": "Simulated agent report"})
            if node.type == "llm":
                payload.update({"text": "Simulated LLM output"})
            if node.type == "code":
                payload.update({"result": None})
            return payload
        if executor is not None:
            result = executor(node, context)
            if hasattr(result, "__await__"):
                return await result
            return result
        raise WorkflowExecutionError(f"{node.type} executor is not connected")

    def _collect_outputs(self, definition: WorkflowDefinition, context: dict[str, Any]) -> dict[str, Any]:
        outputs: dict[str, Any] = {}
        for node in definition.nodes:
            if node.type != "output":
                continue
            outputs[node.id] = context["nodes"].get(node.id, {}).get("output")
        if outputs:
            return outputs
        if definition.nodes:
            last = definition.nodes[-1]
            return {last.id: context["nodes"].get(last.id, {}).get("output")}
        return {}

    def _trace(
        self,
        node: WorkflowNode,
        status: str,
        *,
        summary: str | None = None,
        input_value: Any | None = None,
        output: Any | None = None,
        error: str | None = None,
        duration_ms: int = 0,
    ) -> WorkflowTraceItem:
        return WorkflowTraceItem(
            id=f"trace_{node.id}",
            nodeId=node.id,
            nodeLabel=node.label or node.id,
            nodeType=node.type,
            status=status,
            summary=summary,
            input=input_value,
            output=output,
            error=error,
            durationMs=duration_ms,
        )


def default_tools() -> dict[str, BuiltinTool]:
    return {
        "echo": lambda args, _context: args,
        "merge": lambda args, _context: args,
        "pick": lambda args, context: get_path(context, str(args.get("path") or "")),
        "text_join": _text_join,
        "kb_get_post": lambda args, _context: {
            "simulated": True,
            "id": args.get("id"),
            "title": f"Post {args.get('id')}",
            "content_markdown": "",
            "summary": "",
        },
        "kb_search": lambda args, _context: {"simulated": True, "query": args.get("query"), "items": []},
    }


def _text_join(args: dict[str, Any], _context: dict[str, Any]) -> str:
    items = args.get("items") or []
    sep = str(args.get("separator") or "")
    if not isinstance(items, list):
        raise WorkflowExecutionError("text_join.items must be an array")
    return sep.join(str(item) for item in items)


def resolve_template(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: resolve_template(item, context) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_template(item, context) for item in value]
    if not isinstance(value, str):
        return value
    matches = list(_TEMPLATE_RE.finditer(value))
    if not matches:
        return value
    if len(matches) == 1 and matches[0].span() == (0, len(value)):
        return resolve_expr(matches[0].group(1), context)
    rendered = value
    for match in matches:
        resolved = resolve_expr(match.group(1), context)
        rendered = rendered.replace(match.group(0), "" if resolved is None else str(resolved))
    return rendered


def resolve_expr(expr: str, context: dict[str, Any]) -> Any:
    expr = expr.strip()
    if not _PATH_RE.match(expr):
        raise WorkflowExecutionError(f"unsupported template expression {expr!r}")
    return get_path(context, expr)


def get_path(value: Any, path: str) -> Any:
    if path == "":
        return value
    current = value
    for token in _split_path(path):
        if isinstance(token, int):
            if not isinstance(current, list) or token >= len(current):
                return None
            current = current[token]
            continue
        if isinstance(current, dict):
            current = current.get(token)
        else:
            current = getattr(current, token, None)
        if current is None:
            return None
    return current


def evaluate_condition(expression: str, context: dict[str, Any]) -> bool:
    expression = expression.strip()
    if not expression:
        raise WorkflowExecutionError("branch condition is required")
    if expression.startswith("exists(") and expression.endswith(")"):
        return resolve_expr(expression[7:-1], context) is not None
    match = _COMPARISON_RE.match(expression)
    if not match:
        raise WorkflowExecutionError(f"unsupported branch expression {expression!r}")
    left = resolve_expr(match.group("left"), context)
    right = _parse_literal_or_path(match.group("right"), context)
    op = match.group("op")
    operations = {
        "==": operator.eq,
        "!=": operator.ne,
        ">": operator.gt,
        "<": operator.lt,
        ">=": operator.ge,
        "<=": operator.le,
    }
    try:
        return bool(operations[op](left, right))
    except TypeError as exc:
        raise WorkflowExecutionError(f"branch expression type mismatch: {exc}") from exc


def _parse_literal_or_path(raw: str, context: dict[str, Any]) -> Any:
    raw = raw.strip()
    if _PATH_RE.match(raw):
        resolved = resolve_expr(raw, context)
        if resolved is not None:
            return resolved
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
        return raw[1:-1]
    try:
        return int(raw)
    except ValueError:
        try:
            return float(raw)
        except ValueError:
            return raw


def _split_path(path: str) -> list[str | int]:
    tokens: list[str | int] = []
    for part in path.split("."):
        while "[" in part:
            before, rest = part.split("[", 1)
            if before:
                tokens.append(before)
            index, part = rest.split("]", 1)
            tokens.append(int(index))
            if part.startswith("."):
                part = part[1:]
        if part:
            tokens.append(part)
    return tokens


def _normalize_json_path(path: str) -> str:
    path = path.strip()
    if path.startswith("$."):
        return path[2:]
    if path == "$":
        return ""
    return path


def _matches_type(value: Any, type_name: str) -> bool:
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if type_name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "array":
        return isinstance(value, list)
    if type_name == "array[string]":
        return isinstance(value, list) and all(isinstance(item, str) for item in value)
    if type_name == "array[number]":
        return isinstance(value, list) and all(isinstance(item, int | float) and not isinstance(item, bool) for item in value)
    if type_name == "array[object]":
        return isinstance(value, list) and all(isinstance(item, dict) for item in value)
    if type_name == "array[boolean]":
        return isinstance(value, list) and all(isinstance(item, bool) for item in value)
    if type_name == "file":
        return isinstance(value, dict | str)
    return False


def _edge_matches_branch(label: str | None, matched: bool) -> bool:
    if label is None or label == "":
        return matched
    normalized = label.strip().lower()
    if normalized in {"true", "yes", "matched", "then"}:
        return matched
    if normalized in {"false", "no", "else", "pass"}:
        return not matched
    return matched


def _elapsed_ms(started: float) -> int:
    return max(0, int((time.perf_counter() - started) * 1000))
