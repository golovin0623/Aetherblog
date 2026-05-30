from __future__ import annotations

import ast
import operator
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header

from app.api.deps import get_llm_router, get_pg_pool, require_admin_or_internal
from app.schemas.common import ApiResponse
from app.services.llm_router import LlmRouter
from app.utils.url_validator import validate_external_url_async
from app.workflows import WorkflowExecutionRequest, WorkflowExecutionResult, WorkflowNode, WorkflowRunner
from app.workflows.runner import WorkflowExecutionError, default_tools, resolve_template

router = APIRouter(prefix="/api/v1/agent/workflows", tags=["agent-workflows"])


@router.post("/execute", response_model=ApiResponse[WorkflowExecutionResult])
async def execute_workflow(
    payload: WorkflowExecutionRequest,
    _user=Depends(require_admin_or_internal),
    forwarded_user_id: str | None = Header(default=None, alias="X-Forwarded-User-ID"),
) -> ApiResponse[WorkflowExecutionResult]:
    user_id = _resolve_workflow_user_id(_user, forwarded_user_id)
    runner = await _build_runner(payload, user_id)
    result = await runner.run(
        payload.definition,
        payload.inputs,
        run_id=payload.runId,
        simulate_external=payload.simulateExternal,
    )
    return ApiResponse(data=result)


def _resolve_workflow_user_id(user: Any, forwarded: str | None) -> int | None:
    raw_sub: Any = None
    if user is None:
        raw_sub = None
    elif isinstance(user, dict):
        raw_sub = user.get("sub") or user.get("user_id")
    else:
        raw_sub = getattr(user, "user_id", None)
    if raw_sub == "system":
        raw_sub = forwarded
    try:
        user_id = int(str(raw_sub).strip())
        return user_id if user_id > 0 else None
    except (TypeError, ValueError):
        return None


async def _build_runner(payload: WorkflowExecutionRequest, user_id: int | None) -> WorkflowRunner:
    tools = default_tools()
    tool_snapshots = {item.code: item for item in payload.tools if item.enabled}
    needs_db = any(
        node.type == "tool" and str(node.data.get("toolCode") or "") in {"kb_get_post", "kb_search"}
        for node in payload.definition.nodes
    )
    pool = await get_pg_pool() if needs_db and not payload.simulateExternal else None
    if pool is not None:
        tools["kb_get_post"] = _kb_get_post_tool(pool, user_id)
        tools["kb_search"] = _kb_search_tool(pool, user_id)

    for code, snapshot in tool_snapshots.items():
        if snapshot.requiresApproval:
            tools[code] = _approval_required_tool(code)
            continue
        if snapshot.handlerType == "http":
            tools[code] = _http_tool(snapshot.handlerConfig, snapshot.timeoutMs)
        elif snapshot.handlerType in {"mcp", "skill", "openapi"}:
            tools[code] = _not_connected_tool(code, snapshot.handlerType)

    needs_llm_agent = any(node.type in {"llm", "agent"} for node in payload.definition.nodes)
    llm_router = await get_llm_router() if needs_llm_agent and not payload.simulateExternal else None

    return WorkflowRunner(
        tools=tools,
        llm_executor=_llm_executor(llm_router, user_id) if llm_router is not None else None,
        agent_executor=_agent_executor(llm_router, tools, user_id) if llm_router is not None else None,
        code_executor=_safe_code_executor,
    )


def _kb_get_post_tool(pool: Any, user_id: int | None):
    async def tool(args: dict[str, Any], _context: dict[str, Any]) -> dict[str, Any]:
        post_id = args.get("id") or args.get("post_id")
        if post_id is None:
            raise WorkflowExecutionError("kb_get_post requires id")
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, title, slug, content_markdown, summary, status, author_id, updated_at
                FROM posts
                WHERE id = $1
                  AND deleted = FALSE
                  AND ($2::bigint IS NULL OR author_id = $2 OR status = 'PUBLISHED')
                LIMIT 1
                """,
                int(post_id),
                user_id,
            )
            if row is None:
                raise WorkflowExecutionError("post not found or not accessible")
            tags = await conn.fetch(
                """
                SELECT t.name
                FROM tags t
                JOIN post_tags pt ON pt.tag_id = t.id
                WHERE pt.post_id = $1
                ORDER BY t.name ASC
                """,
                int(post_id),
            )
        return {
            "id": row["id"],
            "title": row["title"],
            "slug": row["slug"],
            "content_markdown": row["content_markdown"] or "",
            "summary": row["summary"] or "",
            "status": row["status"],
            "author_id": row["author_id"],
            "tags": [item["name"] for item in tags],
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        }

    return tool


def _kb_search_tool(pool: Any, user_id: int | None):
    async def tool(args: dict[str, Any], _context: dict[str, Any]) -> dict[str, Any]:
        query = str(args.get("query") or "").strip()
        if not query:
            raise WorkflowExecutionError("kb_search requires query")
        limit = int(args.get("limit") or args.get("top_k") or 5)
        limit = max(1, min(limit, 20))
        pattern = f"%{query}%"
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, title, slug, summary, status, updated_at
                FROM posts
                WHERE deleted = FALSE
                  AND ($3::bigint IS NULL OR author_id = $3 OR status = 'PUBLISHED')
                  AND (
                    title ILIKE $1 OR
                    COALESCE(summary, '') ILIKE $1 OR
                    COALESCE(content_markdown, '') ILIKE $1
                  )
                ORDER BY
                    CASE WHEN title ILIKE $1 THEN 0 ELSE 1 END,
                    updated_at DESC
                LIMIT $2
                """,
                pattern,
                limit,
                user_id,
            )
        return {
            "query": query,
            "items": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "slug": row["slug"],
                    "summary": row["summary"] or "",
                    "status": row["status"],
                    "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
                }
                for row in rows
            ],
        }

    return tool


def _approval_required_tool(code: str):
    async def tool(_args: dict[str, Any], _context: dict[str, Any]) -> dict[str, Any]:
        raise WorkflowExecutionError(f"tool {code} requires approval")

    return tool


def _not_connected_tool(code: str, handler_type: str):
    async def tool(_args: dict[str, Any], _context: dict[str, Any]) -> dict[str, Any]:
        raise WorkflowExecutionError(f"{handler_type} tool {code} is not connected")

    return tool


def _http_tool(config: dict[str, Any], timeout_ms: int | None):
    async def tool(args: dict[str, Any], _context: dict[str, Any]) -> dict[str, Any]:
        url = str(config.get("url") or args.get("url") or "").strip()
        if not url:
            raise WorkflowExecutionError("http tool requires url")
        if not await validate_external_url_async(url):
            raise WorkflowExecutionError("http tool url is not allowed")
        method = str(config.get("method") or args.get("method") or "GET").upper()
        if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            raise WorkflowExecutionError("http tool method is not allowed")
        headers = config.get("headers") if isinstance(config.get("headers"), dict) else {}
        timeout = max(1.0, min((timeout_ms or 30000) / 1000, 30.0))
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(method, url, headers=headers, params=args.get("params"), json=args.get("body"))
        content_type = response.headers.get("content-type", "")
        body: Any
        if "application/json" in content_type:
            body = response.json()
        else:
            body = response.text[:5000]
        return {"status_code": response.status_code, "headers": dict(response.headers), "body": body}

    return tool


def _llm_executor(llm_router: LlmRouter | None, user_id: int | None):
    async def executor(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
        if llm_router is None:
            raise WorkflowExecutionError("llm executor is not connected")
        source = resolve_template(node.data.get("source", "{{ inputs }}"), context)
        prompt = str(node.data.get("prompt") or node.data.get("systemPrompt") or "请基于输入完成任务。")
        model_id = str(node.data.get("modelId") or node.data.get("model") or "") or None
        provider_code = str(node.data.get("providerCode") or "") or None
        text = await llm_router.chat(
            {"content": _stringify_for_prompt(source)},
            "qa",
            user_id=user_id,
            custom_prompt=prompt,
            model_id=model_id,
            provider_code=provider_code,
            allow_override=True,
        )
        return {"text": text, "model": model_id, "provider": provider_code}

    return executor


def _agent_executor(llm_router: LlmRouter | None, tools: dict[str, Any], user_id: int | None):
    async def executor(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
        if llm_router is None:
            raise WorkflowExecutionError("agent executor is not connected")
        source = resolve_template(node.data.get("source", "{{ inputs }}"), context)
        allowed = node.data.get("allowedTools") or node.data.get("allowed_tools") or []
        if not isinstance(allowed, list):
            allowed = []
        tool_results: list[dict[str, Any]] = []
        for tool_code in allowed[:3]:
            tool = tools.get(str(tool_code))
            if tool is None:
                continue
            if str(tool_code) == "kb_search":
                query = ""
                if isinstance(source, dict):
                    query = str(source.get("title") or source.get("summary") or "")[:120]
                if query:
                    result = tool({"query": query, "limit": 5}, context)
                    if hasattr(result, "__await__"):
                        result = await result
                    tool_results.append({"tool": tool_code, "result": result})
        prompt = str(node.data.get("prompt") or "你是内容审计 Agent。请输出结构化 JSON 报告。")
        max_iterations = int(node.data.get("maxIterations") or 4)
        text = await llm_router.chat(
            {
                "content": _stringify_for_prompt(
                    {
                        "source": source,
                        "tool_results": tool_results,
                        "max_iterations": max_iterations,
                    }
                )
            },
            "qa",
            user_id=user_id,
            custom_prompt=prompt,
            allow_override=True,
        )
        return {"report": text, "tool_results": tool_results, "iterations": min(max_iterations, 1)}

    return executor


async def _safe_code_executor(node: WorkflowNode, context: dict[str, Any]) -> dict[str, Any]:
    expression = str(node.data.get("expression") or node.data.get("code") or "").strip()
    if expression.startswith("return "):
        expression = expression[7:].strip()
    if not expression:
        raise WorkflowExecutionError("code node requires expression")
    value = _eval_safe_expression(expression, {"inputs": context.get("inputs", {}), "nodes": context.get("nodes", {})})
    return {"result": value, "sandbox": "restricted-expression"}


_SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
}


def _eval_safe_expression(expression: str, variables: dict[str, Any]) -> Any:
    tree = ast.parse(expression, mode="eval")
    return _eval_node(tree.body, variables)


def _eval_node(node: ast.AST, variables: dict[str, Any]) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in variables:
            raise WorkflowExecutionError(f"name {node.id} is not allowed")
        return variables[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_OPERATORS:
        return _SAFE_OPERATORS[type(node.op)](_eval_node(node.left, variables), _eval_node(node.right, variables))
    if isinstance(node, ast.Subscript):
        value = _eval_node(node.value, variables)
        key = _eval_node(node.slice, variables)
        return value[key]
    if isinstance(node, ast.Attribute):
        value = _eval_node(node.value, variables)
        if isinstance(value, dict):
            return value.get(node.attr)
        return getattr(value, node.attr)
    if isinstance(node, ast.Dict):
        return {_eval_node(k, variables): _eval_node(v, variables) for k, v in zip(node.keys, node.values) if k is not None}
    if isinstance(node, ast.List):
        return [_eval_node(item, variables) for item in node.elts]
    raise WorkflowExecutionError("unsupported code expression")


def _stringify_for_prompt(value: Any) -> str:
    if isinstance(value, str):
        return value
    import json

    return json.dumps(value, ensure_ascii=False, default=str)
