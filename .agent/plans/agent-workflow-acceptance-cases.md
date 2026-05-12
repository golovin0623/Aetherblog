# Agent Workflow Acceptance Cases

日期：2026-05-12  
范围：后台「智能体编排」Canvas-first MVP。  
目标：给明天手工验收准备约 100 个可执行检查点。

## A. 导航与页面骨架（10）

1. 登录后台后，侧边栏 `INTELLIGENCE` 分组展示「智能体编排」。
2. 点击「智能体编排」进入 `/agent-workflows`。
3. 未登录访问 `/admin/agent-workflows` 会被 `AuthGuard` 重定向到登录页。
4. 页面首屏为三栏布局：左侧列表 / 中间画布 / 右侧 inspector。
5. 左侧统计展示 Nodes / Tools / Agents / Schedules。
6. 中间画布展示默认 Article Audit Agent。
7. 画布显示 MiniMap。
8. 画布显示 Controls。
9. 页面刷新后仍能从后端或 localStorage 恢复草稿。
10. 后端不可用时不会白屏，会回退本地草稿和默认 demo bundle。

## B. Workflow 列表与切换（8）

11. workflow 列表展示名称、描述、版本号。
12. 当前 workflow 高亮。
13. 点击不同 workflow 会切换 active workflow。
14. 后端数字 ID workflow 会请求 detail 并加载 definition。
15. 本地临时 workflow 使用本地 definition，不请求不存在的后端 detail。
16. 切换 workflow 后画布节点刷新。
17. 切换 workflow 后 Run Inputs 根据新 definition 刷新。
18. 切换 workflow 后 Run History 重新加载或清空。

## C. 画布基础操作（12）

19. 可以拖动画布节点。
20. 拖动节点后保存会带上新 position。
21. 可以使用 Node Palette 新增 Input 节点。
22. 可以使用 Node Palette 新增 Agent 节点。
23. 可以使用 Node Palette 新增 Tool 节点。
24. 可以使用 Node Palette 新增 Extractor 节点。
25. 可以使用 Node Palette 新增 Branch 节点。
26. 可以使用 Node Palette 新增 Loop 节点。
27. 可以使用 Node Palette 新增 Code 节点。
28. 可以使用 Node Palette 新增 Output 节点。
29. 可以在节点之间连接边。
30. 保存时会把当前节点和边重新构造成 `AgentWorkflowDefinition`。

## D. 节点属性编辑（14）

31. 选中节点后右侧显示 Selected Node。
32. 可以编辑节点 `label`。
33. 可以编辑节点 `description`。
34. Tool 节点可以编辑 `toolCode`。
35. Tool 节点可以编辑 `args JSON`。
36. Agent 节点可以编辑 `agentId`。
37. Agent 节点可以编辑 `model`。
38. Agent 节点可以编辑 `maxIterations`。
39. Agent 节点可以编辑 `allowedTools`。
40. Extractor 节点可以编辑 `mode`。
41. Extractor 节点可以编辑 `path`。
42. Branch 节点可以编辑 `when`。
43. Loop 节点可以编辑 `over` 和 `maxIterations`。
44. Code 节点可以编辑 `language`、`sandboxRef`、`code`，但不会在前端执行。

## E. 输入、变量、工具目录（11）

45. Run Inputs 根据 `definition.inputs` 展示字段。
46. `integer` 输入会转换为整数。
47. `number` 输入会转换为浮点数。
48. `boolean` 输入会以 checkbox 转换为布尔值。
49. `object` 输入要求合法 JSON。
50. `array` / `array[object]` 输入要求合法 JSON。
51. `array[string]` 支持 JSON 数组或逗号分隔文本。
52. 必填输入为空时阻止试运行并提示错误。
53. Variables 面板展示 workflow/system/run 变量。
54. 带 `secretRef` 的变量只显示锁图标，不暴露真实密钥。
55. Tool Catalog 可按 code、displayName、protocol 搜索。

## F. 保存与版本（10）

56. 点击保存会先写 localStorage 草稿。
57. 新建本地 workflow 保存时调用 `POST /v1/admin/agent-workflows`。
58. 已有后端 workflow 保存时调用 `PATCH /v1/admin/agent-workflows/:id`。
59. 后端返回 ID 后前端回填 active workflow ID。
60. 后端返回 version 后前端回填版本号。
61. 后端返回 updatedAt 后前端更新时间。
62. 保存失败时草稿仍保留在 localStorage。
63. 后端保存会调用 Go definition validator。
64. 更新 workflow 会让 version 自增。
65. 每次 create/update 都写 `agent_workflow_versions` 快照。

## G. 试运行与 Trace（12）

66. 点击试运行前会先保存当前画布。
67. 试运行请求使用 Run Inputs 面板的值，不使用硬编码输入。
68. 试运行调用 `POST /v1/agent/workflows/:id/runs`。
69. 试运行默认传 `simulateExternal=true`。
70. 未配置 ai-service/internal token 时后端返回 pending run。
71. 配置 ai-service/internal token 时后端同步调用 ai-service execute。
72. ai-service 返回 success 时前端 Trace 更新。
73. ai-service 返回 failed 时前端显示错误 toast。
74. 没有 trace 时前端显示 pending 占位 trace。
75. Trace item 展示 node label。
76. Trace item 展示 status。
77. Trace item 展示 durationMs 或 summary。

## H. Run History 与回放（8）

78. 页面加载后端 workflow 时请求最近 50 条 run。
79. 试运行完成后当前 run 插入 Run History 顶部。
80. Run History 展示 run id。
81. Run History 展示 status。
82. Run History 展示 createdAt。
83. Run History 展示 duration 或 total node count。
84. 点击历史 run 会请求 `GET /v1/agent/runs/:id`。
85. 后端返回 logs 后前端把 node logs 转为 Trace timeline。

## I. 后端 API 与权限（10）

86. `GET /api/v1/admin/agent-workflows` 只返回当前用户 workflow。
87. `GET /api/v1/admin/agent-workflows/:id` 只允许 owner。
88. `PATCH /api/v1/admin/agent-workflows/:id` 只允许 owner。
89. `DELETE /api/v1/admin/agent-workflows/:id` 只允许 owner。
90. `POST /api/v1/agent/workflows/:id/runs` 允许 owner 或 public workflow。
91. `GET /api/v1/admin/agent-workflows/:id/runs` 限制为 run 发起人或 workflow owner。
92. `GET /api/v1/agent/runs/:id` 限制为 run 发起人或 workflow owner。
93. `GET /api/v1/agent/runs/:id/logs` 限制为 run 发起人或 workflow owner。
94. `limit` 默认 50，上限 100。
95. 无效 workflow/run ID 返回 400。

## J. Definition 校验与安全边界（13）

96. 空 nodes 被拒绝。
97. 超过最大节点数被拒绝。
98. 超过最大边数被拒绝。
99. 重复 node id 被拒绝。
100. 自环 edge 被拒绝。
101. 未知 source/target edge 被拒绝。
102. DAG cycle 被拒绝。
103. Agent `maxIterations` 必须在 1 到 50。
104. Loop `maxIterations` 必须为正且不超过上限。
105. HTTP/connector URL 默认拒绝 localhost。
106. HTTP/connector URL 默认拒绝 127.0.0.1。
107. HTTP/connector URL 默认拒绝内网或 metadata host。
108. Code 节点必须声明 `sandboxRef`，Go 和 ai-service 主进程不直接执行任意代码。

## K. ai-service Runner（12）

109. 输入 required 校验生效。
110. 输入类型校验生效。
111. 拓扑排序按依赖执行。
112. 上游失败时下游跳过。
113. Branch 条件为 false 时对应下游跳过。
114. Loop 对数组逐项生成 items。
115. Loop 超过 `maxIterations` 时标记 truncated。
116. Extractor 支持 JSONPath 风格 path。
117. Tool `echo` 可执行。
118. Tool `text_join` 可执行。
119. 外部 LLM/Agent/Code 未启用模拟或 executor 时失败。
120. 失败节点会写 trace 和 errorMessage。

## L. 文档与运维验证（10）

121. `.agent/plans/agent-workflow-canvas-module-plan.md` 说明当前 MVP 和后续缺口。
122. `.agent/plans/agent-workflow-completion-audit.md` 映射目标、artifact 和证据。
123. `docs/agent/README.md` 说明 Code/Agent Workflow 当前状态。
124. `docs/agent/CODE_ROADMAP.md` 说明 Canvas-first pivot。
125. `docs/output/04-backend-ai-search-system/08-agent-workflows.md` 说明后端 API。
126. `docs/output/06-frontend-admin/10-agent-workflows.md` 说明前端页面和运行流程。
127. `docs/output/07-ai-service-python/07-workflow-runner.md` 说明 runner 行为。
128. `pnpm --filter @aetherblog/admin typecheck` 通过。
129. `cd apps/server-go && go test ./...` 通过。
130. `cd apps/ai-service && .venv/bin/python -m pytest -q --no-cov` 通过。

## M. Published Agent 发布闭环（12）

131. 未保存的本地 demo workflow 点击发布时，会先创建后端 workflow。
132. `PUT /api/v1/admin/agent-workflows/:id/publication` 只允许 workflow owner。
133. 发布后 workflow 列表显示 published 状态。
134. 默认 slug 从英文 workflow name 生成，例如 `Article Audit Agent` -> `article-audit-agent`。
135. 中文或非 ASCII 名称无法生成 slug 时，默认回退为 `workflow-<id>`。
136. 显式 slug 只允许小写字母、数字和单个连字符。
137. `rateLimitPerMin` 小于 1 或大于 300 时返回 400。
138. `GET /api/v1/agent/published` 只返回 enabled 且 workflow public 的 publication。
139. `POST /api/v1/agent/published/:slug/invoke` 会复用 workflow run 创建链路。
140. 停用发布后，slug invoke 返回不存在或停用。
141. 停用发布会把 workflow 标记为非 public。
142. published invoke 创建的 run 仍可通过 run detail/logs 回放。
