# Agent Workflow Canvas 模块方案

状态：Canvas-first MVP 已落地，P1/P2 能力预留中  
日期：2026-05-12  
范围：AetherBlog 后台 AI 能力扩展，不包含独立工作空间知识库

## 0. 当前实施状态

本方案已按“新模块”路线推进到可验收的 MVP：

- 后台新增 `智能体编排` 菜单和 `/agent-workflows` 页面，支持 Workflow 列表、React Flow 画布、节点属性编辑、变量/工具/Agent/调度面板、保存草稿和模拟运行 trace。
- Go 后端新增 `agent_workflows` authoring API、tool/agent/schedule catalog API、runtime run API、最近 run 历史、run detail/log 查询、版本快照、run 记录和节点日志落库路径。
- ai-service 新增 workflow runner，支持输入校验、DAG/循环检测、拓扑执行、input/output/tool/extractor/branch/loop/llm/agent/code 节点的受控执行与 trace 返回。
- 数据库迁移已预留 `agent_connectors`、`agent_publications`、`agent_schedules` 等后续闭环表，并内置安全默认工具种子。
- 文档已同步到 `docs/agent/*`、`docs/output/04-backend-ai-search-system/*`、`docs/output/06-frontend-admin/*`、`docs/output/07-ai-service-python/*`。

本轮明确未把以下预留能力伪装成已完成能力：

- 定时任务扫描器、发布 slug 调用、run SSE/cancel/resume、真实 MCP/Skill/OpenAPI adapter、独立 sandbox-worker 仍是后续 P1/P2。
- Code 节点在 ai-service 内只允许注入执行器或模拟执行，不在主进程直接执行任意代码。
- 外部工具/LLM/Agent 节点默认需要 `simulateExternal=true` 或显式注入 executor，避免未配置真实适配器时误调用外部系统。

最新验证：

- `pnpm --filter @aetherblog/admin typecheck`
- `pnpm --filter @aetherblog/admin build`
- `pnpm --filter @aetherblog/admin exec eslint . --quiet`
- `cd apps/server-go && go test ./...`
- `cd apps/server-go && go test ./internal/pkg/agentworkflow -json | awk -F'"' '/"Action":"run"/ {count++} END {print count}'`，当前 157 个用例片段
- `cd apps/ai-service && .venv/bin/python -m pytest -q --no-cov`，当前 264 passed
- `docker compose -f docker-compose.yml config --quiet`
- `docker compose -f docker-compose.prod.yml config --quiet`
- `docker compose -f docker-compose.dev.yml config --quiet` 仍依赖本地 `.env` 的 `DB_PASSWORD`，缺失时会按既有配置失败

## 1. 结论

需要新增一个独立代码模块承接，建议命名为 **Agent Workflow** 或 **智能体编排**。

不要把这套能力继续塞进现有 `AIToolsPage` / `AIToolsWorkspace`。当前 AI 工具箱的本质是“文章级单工具生成、应用、复盘”，而这次需求是“可持久化、可调度、可运行、可审计的工作流编排平台”。两者的交互、数据模型、执行生命周期、权限和安全边界都不同。

推荐形态：

- 后台侧边栏 `INTELLIGENCE` 分组中，在 `AI 工具` 下方新增菜单：`智能体编排`。
- 新前端路由：`/agent-workflows`，不要复用 `/ai-tools` 的内部侧栏。
- 新后端域：`agent_workflows` / `agent_tools` / `agent_runs` / `agent_schedules`。
- 新 ai-service 执行域：`app/workflows/*` + `app/tools/*`，负责节点执行、模型调用、工具调用、MCP/Skill adapter、trace 流。
- 对外运行入口独立暴露给博客前台和后台使用：Authoring 走 admin API，已发布 workflow/agent 走 `/api/v1/agent/workflows/*`。

这能形成闭环：

```text
后台配置 Agent / Workflow / Tools
  -> 后端保存版本、权限、变量、调度
  -> ai-service 执行与追踪
  -> 发布为站内 Agent 能力
  -> 博客前台 / 后台 / 定时任务都可调用
```

## 2. 当前系统边界

已验证的现状：

- `apps/admin/src/App.tsx` 当前只挂载 `/ai-tools`、`/aetherhub`、`/ai-config`，没有工作流画布路由。
- `apps/admin/src/components/layout/Sidebar.tsx` 的 `INTELLIGENCE` 分组已有 `灵境`、`AI 工具`、`AI 配置` 等入口，适合新增同级菜单。
- `AIToolsPage` 当前维护系统工具和自定义文本工具列表，核心仍是选择一个 tool 后进入 `AIToolsWorkspace`。
- `apps/server-go/internal/handler/ai_handler.go` 负责 admin AI 工具和 provider 代理。
- `apps/server-go/internal/handler/agent_handler.go` 已存在 `/api/v1/agent/*`，但只支持 chat/models/articles/tags。
- `apps/ai-service/app/api/routes/agent.py` 当前是多轮对话和模型选择，不包含 tool-calling 工作流执行器。
- `docs/agent/CODE_ROADMAP.md` 已经提出 Agent 编排平台，但当前状态是“设计冻结、开发未启动”，且原路线把 Canvas 放在较后阶段。

因此，新需求不是“AI 工具箱自定义工具增强”，而是要启动 `docs/agent/CODE_ROADMAP.md` 的落地，并把 Canvas / MCP / Skills / Schedule 提前纳入核心设计。

## 3. 与 Dify-like 能力的映射

| 用户需求 | 新模块内的承接方式 | MVP 优先级 |
| --- | --- | --- |
| Dify 类画布 | React Flow 画布 + 节点属性面板 + trace 面板 | P0 |
| Agent 设定 | `agent_definitions`，含 system prompt、模型、工具白名单、迭代上限 | P0 |
| 定时任务 | `agent_schedules` + Go scheduler lease + run enqueue | P1 |
| 循环 | `loop` / `for_each` 节点，先单层循环，限制最大迭代 | P1 |
| 任务编排面板 | Canvas + DAG 校验 + Run panel + Trace timeline | P0 |
| 用户输入 | workflow `inputs_schema` + 运行表单 + User Input 节点 | P0 |
| 环境变量 / 系统变量 | `agent_variables`，区分 system/user/workflow/run，secret 只存引用 | P0 |
| 代码执行器 | `code` 节点，只允许 sandbox-worker 执行 | P2 |
| 沙盒 | 独立 sandbox service，禁主进程执行任意代码 | P2 |
| 插件 / MCP / skills | `agent_connectors` 注册表，适配 `mcp` / `skill` / `openapi` / `http` 协议 | P1 |
| 定义 agents | Agent definition 是 workflow 可复用节点，也可单独发布 | P0 |
| 指定协议插件拓展搜索 | Tool catalog 支持协议、能力标签、schema 搜索 | P1 |
| 各种 MCP 能力 | MCP adapter 发现 tool schema，映射成 `agent_tools` | P1 |
| 报文函数提取 | `extractor` 节点，支持 JSONPath/JMESPath/regex/schema/function-call args 提取 | P0 |
| 不做工作空间知识库 | 不新建 workspace KB，仅把现有 posts/search/media 作为 builtin tools | P0 |
| 暴露成智能体给前后台使用 | `published_agents` / public run endpoint + 权限/配额 | P1 |

## 4. 前端模块建议

新增目录：

```text
apps/admin/src/pages/agent-workflows/
  AgentWorkflowsPage.tsx
  components/
    WorkflowSidebar.tsx
    WorkflowCanvas.tsx
    NodePalette.tsx
    NodeInspector.tsx
    RunPanel.tsx
    TraceTimeline.tsx
    VariablePanel.tsx
    ToolCatalog.tsx
    AgentDefinitionPanel.tsx

apps/admin/src/services/agentWorkflowService.ts
packages/types/src/agent-workflow/
```

依赖建议：

- 新增 `@xyflow/react` 承接画布，不建议用现有 `@dnd-kit` 手写 DAG 画布。
- Code 节点编辑器复用已有 CodeMirror 依赖。
- 节点状态、运行 trace、变量面板可以先用本地组件，不急着抽 `packages/ui`。

菜单建议：

```ts
{ path: '/ai-tools', icon: Sparkles, label: 'AI 工具' },
{ path: '/agent-workflows', icon: Workflow, label: '智能体编排' },
```

页面布局建议：

```text
左：Workflow / Agent / Tool 列表
中：Canvas
右：Node Inspector / Run Inputs / Trace
底部或右侧：运行日志与输出
```

## 5. 后端边界

### 5.1 Go 后端负责

- 鉴权与权限：admin authoring、普通用户 runtime 调用隔离。
- CRUD：workflow、version、tool、agent、schedule、run records。
- 发布控制：哪些 workflow/agent 可被博客前台调用。
- 调度控制：定时任务扫描、加锁、创建 run。
- 审计：写入 `activity_events` 和 run trace 索引。
- 代理：把执行请求转发给 ai-service internal endpoint。

建议新增：

```text
apps/server-go/internal/handler/agent_workflow_handler.go
apps/server-go/internal/service/agent_workflow_service.go
apps/server-go/internal/repository/agent_workflow_repo.go
apps/server-go/internal/model/agent_workflow.go
apps/server-go/internal/dto/agent_workflow.go
```

API 分层：

```text
Admin authoring:
GET/POST/PATCH/DELETE /api/v1/admin/agent-workflows
GET/POST/PATCH/DELETE /api/v1/admin/agent-tools
GET/POST/PATCH/DELETE /api/v1/admin/agent-schedules

Runtime:
POST /api/v1/agent/workflows/:id/runs
GET  /api/v1/agent/runs/:id
GET  /api/v1/agent/runs/:id/logs
GET  /api/v1/agent/runs/:id/stream
POST /api/v1/agent/runs/:id/cancel

Published agent:
GET  /api/v1/agent/published
POST /api/v1/agent/published/:slug/invoke
```

### 5.2 ai-service 负责

- 解析 workflow definition。
- DAG 校验、拓扑排序、变量解析。
- 节点执行：LLM、Agent、Tool、Extractor、Branch、Loop。
- MCP/Skill/OpenAPI adapter 调度。
- 代码执行请求转发给 sandbox-worker。
- 节点级 SSE trace。
- token/cost/timeout/budget 汇总。

建议新增：

```text
apps/ai-service/app/api/routes/workflows.py
apps/ai-service/app/workflows/
  definition.py
  validator.py
  engine.py
  runner.py
  trace.py
  variables.py
  nodes/
    llm.py
    agent.py
    tool.py
    extractor.py
    branch.py
    loop.py
    code.py
apps/ai-service/app/tools/
  registry.py
  builtin.py
  http_tool.py
  mcp_adapter.py
  skill_adapter.py
```

## 6. 数据模型草案

沿用 `docs/agent/CODE_ROADMAP.md` 的核心表，但需要扩展：

```text
agent_tools
agent_workflows
agent_workflow_versions
agent_workflow_runs
agent_workflow_node_logs
agent_agents
agent_schedules
agent_variables
agent_connectors
agent_publications
```

关键字段：

- `agent_workflows.definition_json`：画布真相源，包含 nodes/edges/viewState。
- `agent_workflow_versions.snapshot_json`：运行冻结快照，防止编辑影响已启动 run。
- `agent_variables.scope`：`system | user | workflow | run`。
- `agent_variables.secret_ref`：密钥引用，不下发明文。
- `agent_connectors.protocol`：`builtin | http | openapi | mcp | skill`。
- `agent_schedules.cron_expr`：定时表达式，配合 timezone、enabled、next_run_at。
- `agent_publications.slug`：暴露给前台和后台其他模块调用。

## 7. 工作流定义建议

这次要做画布，不建议继续让 YAML 做第一真相源。更适合：

- P0 真相源：`definition_json`，直接服务 Canvas。
- 导入/导出：支持 YAML/JSON，但不是数据库第一形态。
- 后端保存时生成 `definition_ast` 供执行器使用。
- 每次发布或运行都冻结 version snapshot。

示例：

```json
{
  "version": 1,
  "inputs": {
    "post_id": { "type": "integer", "required": true }
  },
  "nodes": [
    {
      "id": "input_1",
      "type": "input",
      "data": { "schemaRef": "inputs" }
    },
    {
      "id": "extract_1",
      "type": "extractor",
      "data": { "mode": "jsonpath", "path": "$.post_id" }
    },
    {
      "id": "agent_1",
      "type": "agent",
      "data": {
        "agentId": "article_auditor",
        "maxIterations": 8,
        "allowedTools": ["kb_get_post", "web_search"]
      }
    }
  ],
  "edges": [
    { "source": "input_1", "target": "extract_1" },
    { "source": "extract_1", "target": "agent_1" }
  ]
}
```

## 8. 安全边界

必须作为 P0 设计，而不是后补：

- HTTP/MCP 工具默认 SSRF 防护：禁止 localhost、内网、metadata IP、未批准协议。
- Secret 不进前端：前端只能看到 `secret_ref` 和 hint。
- Code 节点不在 Go 或 ai-service 主进程执行。
- Agent 最大迭代、最大 token、最大工具调用次数、最大运行时长必须硬限制。
- Tool 调用可配置 `requires_approval`，写操作默认需要人工确认。
- Published agent 需要明确输入 schema、输出 schema、配额和可调用来源。
- Schedule 只能调用已保存版本，不能调用编辑中草稿。

## 9. 分期建议

### Phase 0：骨架和菜单

- 新增 `/agent-workflows` 路由和侧边栏菜单。
- 新建页面空壳：左列表、中画布占位、右 inspector。
- 新建 shared types 和 service 占位。
- 文档更新：`docs/agent/CODE_ROADMAP.md` 从 YAML-first 修订为 Canvas-first 或新增本方案链接。

### Phase 1：可保存的画布

- DB 表：workflow、version、tool、agent、variables。
- CRUD API。
- React Flow 画布：input、llm、agent、tool、extractor、output 节点。
- 保存、加载、版本快照、基础 DAG 校验。

### Phase 2：可运行的线性/DAG 执行

- ai-service workflow engine。
- 节点级 SSE trace。
- 内置工具：`kb_get_post`、`kb_search`、`model_call`、`extractor`。
- Run history 和日志查看。

### Phase 3：插件 / MCP / skills

- `agent_connectors` 注册表。
- MCP tool discovery -> `agent_tools` 映射。
- Skill manifest -> tool schema 映射。
- Tool catalog 搜索、测试、启停、权限。

### Phase 4：定时任务与发布闭环

- `agent_schedules` + Go scheduler。
- Workflow 发布为 `published agent`：后台发布/停用和 slug invoke 已有 MVP，前台消费入口后续接。
- 执行完成可写通知、草稿、活动记录。

### Phase 5：代码执行和沙盒

- 独立 sandbox-worker。
- Python/JS code node。
- 包白名单、资源限制、网络隔离、超时和输出大小限制。

## 10. 需要同步调整的既有文档

如果采用该方案，至少同步：

- `docs/agent/README.md`：Code/Workflow 不再只是 `/agent/workspace` 的一个 mode，而是后台独立菜单 + 可发布 runtime。
- `docs/agent/CODE_ROADMAP.md`：把 Canvas 从 P3 提前到 P0/P1，补 MCP/skills/schedules/variables/extractor。
- `docs/AETHERHUB_BLUEPRINT_V1.md`：确认本方案不包含“工作空间知识库”，避免和 AetherHub 私有知识库路线混淆。
- `docs/output/06-frontend-admin/*`：新增后台页面后同步。
- `docs/output/04-backend-ai-search-system/*` 和 `docs/output/07-ai-service-python/*`：新增 API/engine 后同步。

## 11. 推荐决策

建议现在按“新模块”立项：

1. 菜单叫 `智能体编排`，路由 `/agent-workflows`。
2. 它是 `INTELLIGENCE` 下和 `AI 工具` 同级的模块，不是 `AI 工具` 子页面。
3. 架构采用“Go 管理与调度，ai-service 执行，sandbox 独立服务”的三段式。
4. 第一阶段只做可保存、可校验、可版本化的画布，不急着开放真实 MCP 和代码执行。
5. Published agent 从一开始进数据模型，避免后期再把后台配置能力硬接给前台。
