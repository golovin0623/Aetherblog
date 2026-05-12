# 07 · Agent Workflow Runner

> 范围：`apps/ai-service/app/api/routes/workflows.py`、`apps/ai-service/app/workflows/`、`apps/ai-service/tests/test_workflow_runner.py`。
> 当前状态：deterministic runner MVP，供 Go backend 通过 internal token 调用。

## 1. Endpoint

`POST /api/v1/agent/workflows/execute`

鉴权：`require_admin_or_internal`。Go backend 代理运行时会带 `X-Internal-Service` 与 `X-Forwarded-User-ID`。

Request：

```json
{
  "runId": 123,
  "definition": {},
  "inputs": {},
  "simulateExternal": true
}
```

Response：

```json
{
  "success": true,
  "data": {
    "runId": 123,
    "status": "success",
    "outputs": {},
    "currentNode": null,
    "trace": []
  }
}
```

## 2. Definition Schema

`app/workflows/definition.py` 用 Pydantic 定义：

- `WorkflowDefinition`：version / name / mode / inputs / nodes / edges / viewport。
- `WorkflowNode`：`input | output | llm | agent | tool | extractor | branch | loop | code`。
- `WorkflowTraceItem`：节点 ID、label、type、status、summary、input、output、error、durationMs。

## 3. Runner 能力

`WorkflowRunner.run()` 当前支持：

- 输入 schema required/type 校验。
- 节点 ID 去重、edge source/target 校验、自环拒绝、cycle detection。
- DAG 拓扑执行。
- `{{ inputs.x }}` / `{{ nodes.id.output }}` / `{{ loop.item }}` 模板解析。
- Tool 节点：内置 `echo`、`merge`、`pick`、`text_join`、`kb_get_post`、`kb_search`。
- Extractor 节点：jsonpath/jmespath 子集、regex、function_call_args、schema pass-through。
- Branch 节点：受限比较表达式与 `exists(path)`。
- Loop 节点：数组遍历、`maxIterations` 截断、`bodyTemplate`。
- LLM / Agent / Code 节点：必须显式传 executor；未接 executor 时只有 `simulateExternal=true` 才返回模拟结果。

## 4. 安全边界

- 模板表达式只允许 dotted path / array index，不执行 Python 表达式。
- Branch 表达式只允许比较与 exists，不 eval 任意代码。
- Code 节点不会在 ai-service 主进程执行；真实代码执行必须接 sandbox-worker。
- 外部 LLM / MCP / HTTP / Skill adapter 未连接时默认失败；测试和 UI 试运行必须显式传 `simulateExternal=true`。

## 5. 测试

`tests/test_workflow_runner.py` 覆盖核心路径：

- 输入类型和 required 约束。
- 拓扑排序、未知 edge、自环、cycle。
- 模板路径、数组索引、非法表达式。
- tool / extractor / branch / loop / output。
- 外部 executor 注入和模拟执行。
- 失败节点 trace 和 errorMessage。

推荐局部验证：

```bash
cd apps/ai-service
.venv/bin/python -m pytest tests/test_workflow_runner.py -q --no-cov
.venv/bin/python -m compileall app/workflows app/api/routes/workflows.py
```
