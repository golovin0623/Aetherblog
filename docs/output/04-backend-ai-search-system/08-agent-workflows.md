# 08 · Agent Workflow Backend

> 范围：`apps/server-go/internal/{handler,service,repository,model,dto}/agent_workflow*`、`internal/pkg/agentworkflow/`、`migrations/000052_agent_workflow_canvas.*.sql`。
> 当前状态：authoring CRUD + catalog + runtime run proxy + published slug invoke MVP。

## 1. 路由面

Admin authoring：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/agent-workflows` | 当前用户 workflow 列表 |
| `POST` | `/api/v1/admin/agent-workflows` | 创建 workflow，并写版本快照 |
| `GET` | `/api/v1/admin/agent-workflows/:id` | workflow detail + definition JSON |
| `GET` | `/api/v1/admin/agent-workflows/:id/runs?limit=50` | 最近运行历史，默认 50 条，上限 100 |
| `PATCH/PUT` | `/api/v1/admin/agent-workflows/:id` | 更新 definition，version 自增并写快照 |
| `PUT` | `/api/v1/admin/agent-workflows/:id/publication` | 发布或更新 workflow slug，默认启用 |
| `DELETE` | `/api/v1/admin/agent-workflows/:id/publication` | 停用发布入口，并把 workflow 标记为非 public |
| `DELETE` | `/api/v1/admin/agent-workflows/:id` | 删除当前用户 workflow |
| `GET` | `/api/v1/admin/agent-tools` | system/public/user tool catalog |
| `GET` | `/api/v1/admin/agent-definitions` | 当前用户 agent definition catalog |
| `GET` | `/api/v1/admin/agent-schedules` | 当前用户 schedule catalog |

Runtime：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/agent/workflows/:id/runs` | 创建 run；如果配置了 ai-service client 与 internal token，则同步转发执行 |
| `GET` | `/api/v1/agent/published?limit=50` | 列出已启用且 workflow public 的 published agent |
| `POST` | `/api/v1/agent/published/:slug/invoke` | 通过 slug 创建 run，走同一执行链路 |
| `GET` | `/api/v1/agent/runs/:id` | run detail + node logs，允许 run 发起人或 workflow owner 查看 |
| `GET` | `/api/v1/agent/runs/:id/logs` | 按 sequence 返回节点级 trace logs |

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
3. 若未配置 ai-service client 或 internal token，返回 pending run。
4. 若已配置，则 POST `/api/v1/agent/workflows/execute`，带：
   - `runId`
   - `definition`
   - `inputs`
   - `simulateExternal`
   - `X-Internal-Service`
   - `X-Forwarded-User-ID`
5. ai-service 返回后，Go 写入 run status / outputs / current_node / error_message，并把 trace 批量写入 `agent_workflow_node_logs`。
6. response 中带 `trace`，供 admin Canvas 试运行面板立即展示。
7. 后台可通过 `/agent-workflows/:id/runs` 拉最近 50 条 run，点击某条 run 再通过 `/agent/runs/:id` 回放节点日志。

## 5. 发布链路

`AgentWorkflowService.PublishWorkflow`：

1. 只允许 workflow owner 发布。
2. 默认从 workflow name 生成 ASCII slug；显式 slug 只允许小写字母、数字和单个连字符。
3. `inputSchema` 默认从 `definition.inputs` 派生，`outputSchema` 默认 `{}`，`allowedOrigins` 默认 `[]`。
4. `rateLimitPerMin` 校验为 1 到 300，默认 30。
5. 发布会把 `agent_workflows.is_public` 置为 true，并 upsert `agent_publications`。
6. 停用发布会把 `agent_workflows.is_public` 置为 false，并禁用对应 publication。
7. `/agent/published/:slug/invoke` 先确认 publication enabled 且 workflow public，再复用 `CreateRun` 创建执行记录。

## 6. 后续缺口

- Scheduler daemon 尚未扫描 `agent_schedules`。
- Tool/connector 的完整 CRUD 与真实 HTTP/MCP/Skill adapter 尚未接入。
- 长跑 run 的 SSE stream / cancel / resume 还未实现。
