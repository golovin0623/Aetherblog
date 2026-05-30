# 08 · Agent Workflow Backend

> 范围：`apps/server-go/internal/{handler,service,repository,model,dto}/agent_workflow*`、`internal/pkg/agentworkflow/`、`migrations/000052_agent_workflow_canvas.*.sql`、`migrations/000067_agent_workflow_run_simulated.*.sql`、`migrations/000068_agent_workflow_full_iteration.*.sql`。
> 当前状态：authoring CRUD + catalog + capabilities + async runtime +治理 + published slug invoke + versions/templates/import/export/metrics MVP。

## 1. 路由面

Admin authoring：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/agent-workflows` | 当前用户 workflow 列表 |
| `POST` | `/api/v1/admin/agent-workflows` | 创建 workflow，并写版本快照 |
| `GET` | `/api/v1/admin/agent-workflows/capabilities` | 返回真实 LLM、真实工具、sandbox、scheduler、autonomous 的接入状态 |
| `GET` | `/api/v1/admin/agent-workflows/templates` | 返回内置/市场模板摘要 |
| `POST` | `/api/v1/admin/agent-workflows/import` | 从 JSON definition 导入 workflow |
| `DELETE` | `/api/v1/admin/agent-workflows/variables/:id` | 删除 workflow/user 变量 |
| `GET` | `/api/v1/admin/agent-workflows/:id` | workflow detail + definition JSON |
| `GET` | `/api/v1/admin/agent-workflows/:id/runs?limit=50` | 最近运行历史，默认 50 条，上限 100 |
| `GET` | `/api/v1/admin/agent-workflows/:id/versions` | 当前 workflow 的版本快照列表 |
| `POST` | `/api/v1/admin/agent-workflows/:id/versions/:version/rollback` | 回滚到指定版本并产生新快照 |
| `GET` | `/api/v1/admin/agent-workflows/:id/export` | 导出当前 workflow definition JSON |
| `GET/PUT` | `/api/v1/admin/agent-workflows/:id/variables` | 列表 / upsert workflow 变量 |
| `POST` | `/api/v1/admin/agent-workflows/:id/node-test` | 以单节点 definition 做受控测试 |
| `GET` | `/api/v1/admin/agent-workflows/:id/metrics` | 汇总 run 成功率、耗时、成本与最近错误 |
| `PATCH/PUT` | `/api/v1/admin/agent-workflows/:id` | 更新 definition，version 自增并写快照 |
| `PUT` | `/api/v1/admin/agent-workflows/:id/publication` | 发布或更新 workflow slug，默认启用 |
| `DELETE` | `/api/v1/admin/agent-workflows/:id/publication` | 停用发布入口，并把 workflow 标记为非 public |
| `DELETE` | `/api/v1/admin/agent-workflows/:id` | 删除当前用户 workflow |
| `GET` | `/api/v1/admin/agent-tools` | system/public/user tool catalog |
| `POST/PUT/DELETE` | `/api/v1/admin/agent-tools[/:id]` | 创建、更新、删除当前用户工具 |
| `POST` | `/api/v1/admin/agent-tools/:code/test` | 以工具注册表快照测试单个工具 |
| `GET` | `/api/v1/admin/agent-definitions` | 当前用户 agent definition catalog |
| `POST/PUT/DELETE` | `/api/v1/admin/agent-definitions[/:id]` | 创建、更新、删除当前用户 Agent 定义 |
| `GET` | `/api/v1/admin/agent-schedules` | 当前用户 schedule catalog |
| `POST/PUT/DELETE` | `/api/v1/admin/agent-schedules[/:id]` | 创建、更新、删除 schedule |

Runtime：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/agent/workflows/:id/runs` | 创建 run；`simulateExternal=true` 只在显式模拟运行时使用；配置了 ai-service client 与 internal token 时进入 detached execution |
| `GET` | `/api/v1/agent/published?limit=50` | 列出已启用且 workflow public 的 published agent |
| `POST` | `/api/v1/agent/published/:slug/invoke` | 通过 slug 创建 run，走同一执行链路 |
| `GET` | `/api/v1/agent/runs/:id` | run detail + node logs，允许 run 发起人或 workflow owner 查看 |
| `GET` | `/api/v1/agent/runs/:id/logs` | 按 sequence 返回节点级 trace logs |
| `GET` | `/api/v1/agent/runs/:id/stream` | SSE 轮询输出 run 状态与 trace，用于前端实时回放 |
| `POST` | `/api/v1/agent/runs/:id/cancel` | 请求取消 pending/running run |
| `POST` | `/api/v1/agent/runs/:id/retry` | 基于原 run 输入创建 retry run，可从失败节点续跑 |
| `POST` | `/api/v1/agent/runs/:id/resume` | 续跑 paused run，可指定 `resumeFromNode` |
| `POST` | `/api/v1/agent/runs/:id/canonicalize` | 把成功真实 run 固化为 fixed workflow 草稿 |

## 2. 数据边界

`000052_agent_workflow_canvas` 新增：

- `agent_connectors`：builtin / http / openapi / mcp / skill connector registry。
- `agent_tools`：工具 schema、handler type、审批、限流、超时。
- `agent_agents`：可复用 Agent 定义、模型、工具白名单、迭代/token/tool-call 上限。
- `agent_workflows`：Canvas definition JSON 真相源。
- `agent_workflow_versions`：运行冻结快照。
- `agent_variables`：system/user/workflow/run 变量，`secret_ref` 与 `value_json` 互斥。
- `agent_workflow_runs`：运行实例、状态、输入输出、成本字段。
- `agent_workflow_node_logs`：节点级 trace。
- `agent_schedules`：后续 scheduler 使用的 cron 配置。
- `agent_publications`：前后台通过 slug 调用 published agent 的 runtime 入口。

迁移同时 seed 了 system builtin connectors/tools：`kb_get_post`、`kb_search`、`text_join`、`echo`，并把 `web_search` / `skill_security_audit` 作为默认禁用且 `requires_approval=true` 的受控工具。

`000067_agent_workflow_run_simulated` 为 `agent_workflow_runs` 增加 `simulated BOOLEAN NOT NULL DEFAULT FALSE`，用于区分真实运行和显式模拟运行。历史未知 run 会按保守口径回填为 `simulated=true`，新 run 由服务层按请求模式显式写入。

`000068_agent_workflow_full_iteration` 扩展：

- `agent_workflow_runs`：retry/resume/cancel/source/redaction/budget/error/canonicalized workflow 字段。
- `agent_workflow_node_logs`：`metadata_json`，用于 tokens/source/tool metadata。
- `agent_schedules`：`missed_run_policy`、`last_error`。
- `agent_publications`：`trusted_internal_only`。
- 新表：`agent_workflow_approvals`、`agent_publication_invocations`、`agent_workflow_eval_cases`、`agent_workflow_marketplace_items`、`agent_workflow_error_bindings`、`agent_workflow_human_inputs`、`agent_cowork_tasks`、`agent_workflow_notifications`。
- Seed 模板：Article Audit、SEO and Tags、Knowledge Base Sweep。

## 3. 校验器

`internal/pkg/agentworkflow` 是 Go 侧保存前校验器：

- 检查 definition JSON、version、mode、inputs、nodes、edges。
- 检查节点类型、重复 ID、自环、未知 source/target、DAG cycle。
- 对 HTTP/tool/secret/code 等高风险字段做基础安全约束。
- Code 节点只允许声明 `sandboxRef`，不能在 Go 主进程执行。

## 4. 运行链路

`AgentWorkflowService.CreateRun`：

1. `FindRunnableWorkflow` 校验所有权或 public。
2. 插入 `agent_workflow_runs`，同时增加 workflow `run_count`。
3. 校验 workflow inputs、预算、工具启用状态、审批要求、source / redaction policy。
4. 插入 run 后返回 pending/started；若配置了 ai-service client 与 internal token，则启动 detached goroutine 执行。
5. detached worker POST `/api/v1/agent/workflows/execute`，带：
   - `runId`
   - `definition`
   - `inputs`
   - `simulateExternal`
   - `tools`
   - `budget`
   - `redactionPolicy`
   - `resumeFromNode`
   - `X-Internal-Service`
   - `X-Forwarded-User-ID`
6. ai-service 返回后，Go 写入 run status / outputs / current_node / error_message / error category / usage / cost，并把 trace 批量写入 `agent_workflow_node_logs`。
7. response 中带 `trace`，供 admin Canvas 试运行面板立即展示；SSE stream 可继续轮询完整 run。
8. 后台可通过 `/agent-workflows/:id/runs` 拉最近 50 条 run，点击某条 run 再通过 `/agent/runs/:id` 回放节点日志。
9. `simulateExternal` 会持久化到 run 的 `simulated` 字段；published slug invoke 会强制按真实运行创建 run，避免外部调用默认获得模拟成功。

## 5. 发布链路

`AgentWorkflowService.PublishWorkflow`：

1. 只允许 workflow owner 发布。
2. 默认从 workflow name 生成 ASCII slug；显式 slug 只允许小写字母、数字和单个连字符。
3. `inputSchema` 默认从 `definition.inputs` 派生，`outputSchema` 默认 `{}`，`allowedOrigins` 默认 `[]`。
4. `rateLimitPerMin` 校验为 1 到 300，默认 30。
5. 发布会把 `agent_workflows.is_public` 置为 true，并 upsert `agent_publications`。
6. 停用发布会把 `agent_workflows.is_public` 置为 false，并禁用对应 publication。
7. `/agent/published/:slug/invoke` 先确认 publication enabled 且 workflow public，再校验 Origin、rate limit、input schema，并以 `sourceType=publication`、`redactionPolicy=production` 复用 `CreateRun` 创建执行记录。

## 6. ai-service 执行面

- `kb_get_post` / `kb_search` 读取真实 `posts`，按 owner 或 published 约束访问。
- LLM 节点复用 `LlmRouter.chat`，支持 provider/model override。
- Agent v1 在 `allowedTools` 内尝试工具调用并用 LLM 汇总结果。
- HTTP 工具按注册表 handlerConfig 走 allowlist / method / timeout 校验。
- Code 节点只支持受限 AST 表达式，不在主进程执行任意 Python / Shell。
- MCP / Skill / OpenAPI 未配置时返回明确 `not connected` 错误。

## 7. 后续硬化

- Schedule CRUD、nextRunAt 与 missed-run policy 已就绪；常驻 daemon 扫描可按部署形态接入 server lifecycle。
- 独立 sandbox-worker、团队协作权限、动态 slash command registry 可继续迭代。
- Admin 组件测试脚手架仍需建立；当前以 type-check / ESLint / build / Playwright 页面验证兜底。
