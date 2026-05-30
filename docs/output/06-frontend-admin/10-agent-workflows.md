# 10 · Agent Workflows / 智能体编排

> 范围：`apps/admin/src/pages/agent-workflows/`、`apps/admin/src/services/agentWorkflowService.ts`、`packages/types/src/agent-workflow/`。
> 当前状态：Canvas-first 产品迭代版，已接入后台路由、侧边栏、保存、发布、运行模式切换、capabilities 状态提示、模板、版本、导入导出、指标、运行控制、工具测试，并把 Article Audit 接到文章写作与 AetherHub Chat。

## 1. 入口

- 路由：`/agent-workflows`，挂在 `apps/admin/src/App.tsx` 的受保护后台路由下。
- 菜单：`apps/admin/src/components/layout/Sidebar.tsx` 的 `INTELLIGENCE` 分组中，位于「AI 工具」之后。
- 依赖：`@xyflow/react` 负责画布、节点、边、MiniMap 和 Controls。

## 2. 页面结构

`AgentWorkflowsPage.tsx` 是三栏操作台：

| 区域 | 职责 |
| --- | --- |
| 左侧 | workflow 列表、模板库、节点 palette、节点数量 / 工具 / Agent / Schedule 统计 |
| 中间 | React Flow Canvas，支持新增节点、拖动节点、连接边、保存、发布/停用发布、导出、快速 schedule、重置、试运行 |
| 右侧 | Selected Node inspector、Run Inputs、Runtime Actions、Metrics、Versions、Variables、Tool Catalog、Run History、Trace timeline |

页面启动会并行请求：

- `GET /v1/admin/agent-workflows`
- `GET /v1/admin/agent-workflows/capabilities`
- `GET /v1/admin/agent-workflows/templates`
- `GET /v1/admin/agent-tools`
- `GET /v1/admin/agent-definitions`
- `GET /v1/admin/agent-schedules`
- `GET /v1/admin/agent-workflows/:id/runs?limit=50`
- `GET /v1/admin/agent-workflows/:id/versions`
- `GET /v1/admin/agent-workflows/:id/metrics`

如果后端不可用或还没有数据，页面回退到 `localStorage` 草稿和内置 demo bundle，避免新模块空白。

## 3. 保存与运行

保存流程：

1. 从 React Flow 当前节点和边生成 `AgentWorkflowDefinition`。
2. 先写 `localStorage`，保证网络失败时草稿不丢。
3. 若当前 workflow ID 是后端数字 ID，则 `PATCH /v1/admin/agent-workflows/:id`；否则 `POST /v1/admin/agent-workflows`。
4. 后端返回的 ID / version / runCount / updatedAt 会回填到本地 bundle。

发布流程：

1. 点击「发布」会先执行保存流程，确保发布的是后端最新 definition。
2. 页面调用 `PUT /v1/admin/agent-workflows/:id/publication`，默认使用 definition name / description 作为 published agent 展示信息。
3. 后端返回 slug 后，workflow 列表显示 Globe 图标，当前项标记为 published。
4. 已发布 workflow 点击「停用发布」会调用 `DELETE /v1/admin/agent-workflows/:id/publication`，停用 slug invoke 入口。

节点编辑：

1. 选中画布节点后，右侧 inspector 可编辑 label、description。
2. 根据节点类型暴露关键字段：toolCode / args、agentId / model / maxIterations / allowedTools、extractor path、branch when、loop over、code sandboxRef / code、outputPath。
3. 保存时以 React Flow 当前节点、边和 inspector 最新值生成 `AgentWorkflowDefinition`。

试运行流程：

1. 先调用保存流程，确保运行的是后端最新 definition。
2. Run Inputs 面板根据 `definition.inputs` 渲染输入表单，提交前按 schema 转换 integer / number / boolean / JSON array/object。
3. Run Inputs 面板提供「真实 / 模拟」分段按钮。默认是真实运行；当前未接入的真实能力会返回明确失败，不再伪装成功。
4. 调 `POST /v1/agent/workflows/:id/runs`，仅在用户显式选择「模拟」时传 `simulateExternal=true`，同时携带 source/redaction/budget 元数据。
5. run response 里的 `trace` 回填右侧 Trace 面板；没有 trace 时显示 pending 占位。
6. Runtime Actions 可对最近 run 执行取消、重试、续跑、固化；固化会把真实成功 run 回填为新的 fixed workflow 草稿。
7. Metrics 显示总 run、成功数、最近版本与成本/耗时摘要；Versions 支持回滚到上一版。
8. Run History 显示 `real` / `sim`、sourceType、pausedReason、errorCategory，来自后端持久化字段。

运行历史：

1. 后端 workflow ID 存在时，页面加载最近 50 条 run。
2. 试运行成功或失败后，会把本次 run 插入 Run History。
3. 点击历史项会请求 `GET /v1/agent/runs/:id`，把 node logs 转成 Trace timeline 回放。

## 4. 类型契约

共享类型集中在 `packages/types/src/agent-workflow/index.ts`：

- `AgentWorkflowDefinition`：画布 JSON 真相源，包含 version / mode / inputs / nodes / edges / viewport。
- `AgentWorkflowNodeType`：`input | output | llm | agent | tool | extractor | branch | loop | code`。
- `AgentWorkflowRunSummary.trace`：后端把 ai-service 的节点 trace 转回前端 timeline。
- `AgentWorkflowRunSummary.simulated`：标记本次 run 是否显式使用模拟外部执行器。
- `AgentWorkflowRunSummary.sourceType` / `errorCategory` / `pausedReason`：驱动运行历史状态说明。
- `AgentWorkflowCapabilities`：驱动 Inspector 能力徽标和 Run Inputs 中的真实能力状态说明。
- `AgentWorkflowVersionSummary` / `AgentWorkflowTemplateSummary` / `AgentWorkflowMetrics`：驱动版本回滚、模板库与指标面板。
- `AgentWorkflowRunDetail.logs`：点击历史 run 时回放节点级 input / output / duration / error。
- `AgentPublicationSummary`：发布入口的 slug、schema、限流和启用状态。

## 5. 内容入口

- 文章 AI 写作页可点击「Article Audit」，会查找 published `article-audit` / `article-audit-agent` 并以当前 `post_id` 触发 workflow。
- AetherHub Chat 支持 `/audit <post_id>`，走同一个 published workflow invoke，成功后在对话里返回 run id。
- 两个入口都不要求用户打开 Canvas，分别以 `sourceType=article` / `sourceType=chat` 记录来源。

## 6. 约束

- Secret 只展示 `secretRef`，前端不持有真实密钥。
- Code 节点默认展示 `sandboxRef` / expression；真实执行由 ai-service 受限表达式 executor 处理，任意代码执行仍需独立 sandbox-worker。
- Tool Catalog 中 `requiresApproval=true` 的工具默认是受控能力；真实 run 会暂停并生成 approval 边界，不再直接调用。
- 当前 admin 仍缺组件测试脚手架；本轮以 type-check / ESLint / build / Playwright 页面验证兜底。
