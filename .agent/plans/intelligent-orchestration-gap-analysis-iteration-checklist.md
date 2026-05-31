# 智能编排（Agent Workflow）落地策划书与迭代路线

> 本文是 AetherBlog「智能编排 / Agent Workflow Canvas」（三模式中的 **Code** 模式，见 `docs/agent/README.md`）的 **评审结论 + 落地策划书 + 可执行 Roadmap** 三合一文档。它在同一框架下对齐现状证据、能力差距、修复方案、排期与度量，并通过 §8 **可追溯矩阵** 把「问题 → 修复 → 排期 → 验收 → 度量」闭环。

| 项 | 值 |
| --- | --- |
| 文档状态 | Implementation v3.0 · 全量产品迭代落地版（本 PR 覆盖 §5 / §8 / §9.1 主工作包） |
| 版本 | 3.0 — 2026-05-31 在新 worktree 完成全量迭代：真实 KB/LLM/Agent/受限 Code 执行、异步 runtime、治理与限流、工具/Agent/Schedule/变量 CRUD、版本/模板/导入导出、运行控制、文章与 Chat 入口、docs/验证同步 |
| 适用范围 | 后台 `/agent-workflows` Canvas · Go authoring/runtime API · ai-service workflow runner · 与 Chat / Cowork / Code 三模式的结合 |
| 代码基线 | 本轮迭代后仓库 migrations 已至 **000069**；Agent Workflow 在 `000068_agent_workflow_run_simulated` 之后新增 `000069_agent_workflow_full_iteration`，补齐 runtime / governance / templates / approval / notification / marketplace 等产品边界 |
| 负责人 | 待指派（建议：1 名 owner + 全栈 0.5-1 + AI 工程 0.5） |
| 关联文档 | `docs/agent/README.md`（三模式总定位）· `docs/agent/CODE_ROADMAP.md`（Code 路线，本文是其 Phase 落地细化）· `docs/agent/COWORK_ROADMAP.md` · `.agent/plans/agent-workflow-canvas-module-plan.md` |
| 复审节奏 | 每个 Phase 退出门 + 每次 eval 回归后回写 §14 修订记录；KPI/eval 失败回灌 §4 GAP，形成下一轮迭代 |

**如何阅读**：决策者看 §1 / §7 / §9 / §10；执行者看 §4–§6 / §8 / §9.1 / §11；§2 是事实基线，任何结论以此为准、以 `file:line` 可核验。

---

## 1. 执行摘要

**判断**：智能编排已经从「Canvas-first MVP」推进到可提交评审的**全量产品迭代版**。本轮 PR 补齐了五条主线的可用闭环：**① 执行真实性**（真实 KB / LLM / Agent / 受限 Code 执行），**② 异步与可控运行**（pending/started/paused/cancel/retry/resume/canonicalize/stream），**③ 工具生态与治理**（tool/agent/schedule/variable CRUD、输入 schema、来源、限流、预算、脱敏、审批暂停），**④ AetherBlog 内容业务闭环**（文章写作面板一键审计、AetherHub `/audit <post_id>`），**⑤ autonomous/hybrid 与运行轨迹固化**（Agent v1 工具循环与 run→fixed 草稿）。

**最关键的一条事实（务必先记住）**：v2.1 审查发现「试运行成功」在绝大多数情况下是**模拟成功**。v2.2 已修正为默认真实运行、模拟必须显式选择、capabilities 状态驱动徽标、run history 持久显示 `real/sim`；v3.0 继续把真实执行接入到 ai-service runner，并让未接入或需审批的能力以失败/暂停/未连接状态显式返回，而不是伪成功。

**策划主张落地状态**：本轮不再只堆节点外观，而是把以下主线全部推进到产品可验收的 MVP 边界：

1. **先诚实**（已落地）：运行模式显式化、撤掉硬编码模拟、上线能力状态 API + 真实徽标。
2. **再真实**（已落地）：`kb_get_post` / `kb_search` / LLM / Agent v1 / 受限 Code 接入真实执行路径，配套错误分类。
3. **后可控**（已落地）：run 从创建到启动/暂停/取消/重试/续跑/固化/stream 的生命周期闭合。
4. **强治理**（已落地）：工具/Agent/Schedule/变量管理、输入 schema、审批暂停、预算字段、来源策略、发布限流、生产脱敏。
5. **达闭环**（已落地）：文章 AI 写作页和 AetherHub Chat 可直接触发 published Article Audit。
6. **再固化自治**（已落地）：Agent v1 允许工具循环，成功 run 可 `canonicalize` 为 fixed workflow 草稿。
7. **后生态**（已建边界）：Marketplace、Human Input、Cowork handoff、错误工作流、通知表进入迁移/服务边界；团队协作与独立 sandbox-worker 属于后续硬化，不再伪装为已完整生产化。

**产品定位红线**：不做通用 n8n/Dify 平替，而是**「围绕个人知识库与博客内容生产的 Agent 编排层」**（非目标见 §3.2，与 `CODE_ROADMAP.md §1.4` 对齐）。

---

## 2. 现状基线与证据（事实层，可核验）

> 下表每条结论均给出 `file:line`。**v1 → v2 已修正 5 处事实偏差**，标 ⚠️。

| 层 | 已具备 | 关键证据 | 主要缺口 |
| --- | --- | --- | --- |
| 后台入口 | Sidebar / 路由 / 命令面板可进入；文章 AI 写作页可触发 Article Audit；AetherHub Chat 支持 `/audit <post_id>` | `apps/admin/src/App.tsx`、`AiWritingWorkspacePage.tsx`、`AetherHubWorkspacePage.tsx` | Cowork UI 仍等待 Cowork 模块解冻 |
| Canvas authoring | React Flow 画布、8 类节点 palette、Inspector、运行输入、Trace、Run History、模板库、版本回滚、导入导出、指标、运行控制、工具测试 | `apps/admin/src/pages/agent-workflows/AgentWorkflowsPage.tsx` | 版本 diff 与节点级可视化 debugger 可继续硬化 |
| 本地草稿 | localStorage fallback，离线显示默认工作流 | `agentWorkflowService.ts:19,210-237` | 后端不可用时易让用户误以为已真实保存 / 运行 |
| Go authoring/runtime API | 工作流 CRUD、发布 slug、run 创建、run/log 查询、published invoke、stream/cancel/retry/resume/canonicalize、tool/agent/schedule/variable CRUD、版本/模板/导入导出/指标 | `internal/handler/agent_workflow_handler.go:27-77` | 调度 daemon 与团队协作策略可继续加固 |
| Definition 校验 | 节点类型、连接器、模板引用、URL 安全、DAG 无环；运行前补输入 schema、工具启用、审批、maxNodes 等治理校验 | `internal/pkg/agentworkflow/definition.go`、`agent_workflow_service.go` | 更细的 JSON Schema draft 兼容可继续补 |
| 数据模型 | `agent_connectors / agent_tools / agent_agents / agent_workflows / agent_workflow_versions / agent_variables / agent_workflow_runs / agent_workflow_node_logs / agent_schedules / agent_publications`；v2.2 新增 `simulated`；v3.0 新增审批、限流日志、eval、marketplace、error bindings、human input、cowork tasks、notifications 等边界 | `migrations/000052_agent_workflow_canvas.up.sql`、`000068_agent_workflow_run_simulated.up.sql`、`000069_agent_workflow_full_iteration.up.sql` | 独立 sandbox-worker 仍需专项落地 |
| runtime 转发 | Go 创建 pending run 后 detached goroutine 启动真实执行，ai-service 返回后写 trace / usage / error category；无 AI client 时明确 pending/failed，不伪成功 | `internal/service/agent_workflow_service.go` | 多实例队列/分布式 worker 可后续替换当前进程内 detached worker |
| run 生命周期 | `started_at`、`finished_at`、duration、pausedReason、cancelRequested、retryOfRunId、resumeFromNode、errorCode/category、usage、canonicalizedWorkflowId 全部映射和写入 | repo `StartRun` / `FinishRunWithMeta` / `PauseRunForApproval` / `CancelRun` | 断点改输入 UI 可继续细化 |
| 预算 | `max_tokens` / `max_cost_usd` / `max_duration_ms` / `max_nodes` 映射到 DTO/model/repo；CreateRun 校验节点预算，Finish 写 usage/cost | `model/agent_workflow.go`、`dto/agent_workflow.go`、`agent_workflow_service.go` | provider 成本精算依赖 LLM usage 明细后续增强 |
| 发布治理 | `allowedOrigins`、`rateLimitPerMin`、`inputSchema` 在 invoke 路径生效；published invoke 强制真实运行和生产脱敏 | `InvokePublished`、`enforcePublicationRateLimit`、`validateWorkflowInputs` | API key 级别 credential 管理可继续增强 |
| 调度 | Schedule CRUD、`nextRunAt`、missed-run policy、sourceType=schedule 边界已落地 | `agent_workflow_handler.go`、`agent_workflow_repo.go` | 常驻 daemon 扫描可独立接入服务启动生命周期 |
| ai-service runner | 拓扑排序、模板变量、branch、loop、trace；支持 `input/output/llm/agent/tool/extractor/branch/loop/code`；接入真实 KB、HTTP 工具、LLM Router、Agent v1、受限表达式 Code executor | `apps/ai-service/app/api/routes/workflows.py`、`definition.py` | MCP/Skill/OpenAPI 未配置时明确 not connected |
| workflow mode | Go / ai-service schema 接受 `fixed/autonomous/hybrid`；Agent v1 支持 allowedTools 内工具循环；run 可 canonicalize 为 fixed workflow 草稿 | `definition.go`、`definition.py`、`CanonicalizeRun` | hybrid 子图插入策略后续可更精细 |
| 内置工具 | `kb_get_post` / `kb_search` 查询真实 `posts`，按 user / published 约束访问；Article Audit 可基于真实文章正文运行 | `apps/ai-service/app/api/routes/workflows.py` | pgvector 语义检索可在后续替代当前 SQL 文本检索 |
| 模拟语义 | ⚠️ ai-service `simulateExternal` 默认 **`False`**；默认 False + executor=None 时节点**明确失败**（`test_external_node_requires_executor_by_default`） | `definition.py:61`、`runner.py:327-340` | 「伪成功」的真正成因是**前端硬编码 true + executor 缺失**，并非后端默认值——修复点在前端与 executor |
| LLM 能力 | `LlmRouter` 提供 `chat/stream_chat/embed/resolve_model/resolve_usage_context/resolve_effective_model`，已在 Chat 用 | `llm_router.py`、`api/routes/agent.py` | runner **从未调用** `LlmRouter`（P0-12 可直接复用，成本低） |
| AetherHub Chat | SSE 多轮、model routing、KB 注入、@文章/#标签；输入 `/audit <post_id>` 可调用 published Article Audit workflow | `AetherHubWorkspacePage.tsx` | Slash command registry 可后续扩成动态列表 |
| 测试 | Go service/repo/handler/pkg 测试覆盖治理与运行关键路径；ai-service runner 覆盖真实/受限执行与 not-connected 失败；admin typecheck/eslint/build 通过 | `apps/ai-service/tests/test_workflow_runner.py`、`agent_workflow_service_test.go` | admin 组件测试脚手架仍待建立 |
| 定位文档 | Chat / Cowork / Code 三模式边界清晰 | `docs/agent/README.md`、`CODE_ROADMAP.md`、`COWORK_ROADMAP.md` | 文档路线比实现更远，需用状态标签避免「路线能力」被误读为「已上线」 |

> **v3 落地校正清单**：① 默认模拟与静态绿盾已移除；② `started_at` / duration / pausedReason / cancel / retry / resume / canonicalize 已映射；③ 预算字段不再是死列；④ publication 治理在 invoke 路径生效；⑤ 真实 KB / LLM / Agent / 受限 Code executor 已接入；⑥ 文章与 Chat 已有不打开画布的触发入口。

---

## 3. 范围、定位与非目标

### 3.1 三模式中的位置

智能编排 = 三模式里的 **Code / Agent Workflow** 层：**最底层的创造层**，对外开放工具 / 模型调用 / 控制流原语，向上为 **Chat**（同步问答）与 **Cowork**（异步副手，当前设计冻结）提供工具、模板、版本、运行、调试、发布底座。三者共享：同一身份鉴权、同一 AI provider 路由（`ai_models`+`ai_credentials`）、同一知识库（`posts`+`pgvector`）、同一通知通道（`notifications`）。

### 3.2 产品定位与非目标（红线，承接 `CODE_ROADMAP.md §1.4`）

**定位**：> 围绕个人知识库与博客内容生产的 Agent 编排层。优先服务写作前/中、发布前/后、长期沉淀五个内容闭环（模板见 §6 产品落点）。

**明确非目标（防止范围蔓延）**：

- ❌ **不做通用 iPaaS / n8n·Dify 平替**——竞品（§5）只作能力参照，不照搬节点全集。
- ❌ **不在主进程跑任意代码**——本轮 Code 节点只支持受限表达式 executor；任意脚本 / Shell / Python 执行必须等独立 `sandbox-worker` 专项（P3-01）。
- ❌ **不做工作流互信任**——用户 A 的 workflow 不能调用用户 B 的 tool，除非 tool 标记 public。
- ❌ **不替代 Cowork 的高层任务模板**——Code 是「原料库+灶台」，Cowork 是「预制菜单」，并存互补。
- ❌ **v1 不做多租户团队协作**（P3-06 长期再议）。

---

## 4. 能力差距与问题登记册（GAP）

> 每个 GAP 有稳定 ID、维度、**严重度（S0 阻断 / S1 主要 / S2 次要 / S3 增强）**与证据。**严重度只表达「不修有多糟」，不等于排期**——排期见 §9，映射见 §8。维度：真=执行真实性 · 异=异步与可控 · 具=工具生态 · 治=治理与安全 · 观=可观测 · 工=authoring 体验 · 验=质量回归 · 闭=产品闭环 · 自=自治编排。

| GAP | 维度 | 严重度 | 问题（含校正后表述） | 证据 |
| --- | --- | --- | --- | --- |
| G01 | 真 | S0 | 试运行结果不可信：前端硬编码 `simulateExternal=true` + executor=None + 静态绿盾，三者叠加导致「伪成功」 | `AgentWorkflowsPage.tsx:651,905`、`runner.py:33-38,327-340` |
| G02 | 真 | S0 | 内置 `kb_get_post`/`kb_search` 返回模拟数据（空正文 / 空列表），默认 Article Audit 拿不到真实文章 | `runner.py:381-395` |
| G03 | 治 | S0 | runner 不读 DB 工具注册表，`enabled/requires_approval/rate_limit/timeout` 在运行时全部失效 | `runner.py:252-258` |
| G04 | 具 | S1 | HTTP/OpenAPI/MCP/Skill 连接器只有 schema 与 seed，**无可执行 adapter** | `definition.go`（校验）↔ runner 无调用链 |
| G05 | 异 | S0 | 同步执行架构不适合长任务：`CreateRun` 在单个 HTTP 请求内 `DoSync` 完成 | `agent_workflow_service.go:323-362,409` |
| G06 | 异 | S0 | run 生命周期不完整：`started_at` 恒 NULL、`paused_reason` 从不写、duration 口径偏差、无 running/paused/cancelled 推进 | repo `FinishRun`、`migrations/000052:158` |
| G07 | 治 | S1 | 发布缺运行时治理：`allowedOrigins/rateLimitPerMin/inputSchema` 取到不校验 | `agent_workflow_service.go:268-278` |
| G08 | 治 | S1 | 预算字段无约束：列为死列，Go 模型未映射，无 token/cost 计量与 budget 上限 | `model/agent_workflow.go:73-88`、`migrations/000052:163-168` |
| G09 | 异 | S1 | 调度仅表结构：只有 `ListSchedules`，无 CRUD / daemon / missed-run 策略 | `agent_workflow_handler.go:163` |
| G10 | 观 | S1 | 错误处理不可产品化：仅字符串错误，无分类 / 可重试标记 / 重试策略 / 失败通知 / 错误工作流 | runner / service 错误返回 |
| G11 | 工 | S2 | 控制流能力不足：Loop 仅数组映射 + `bodyTemplate`，**不执行子图**；无并行分支 / join / 并发策略 | `runner.py:292-313` |
| G12 | 工 | S2 | Branch 语义隐式：靠 edge label 决定跳过路径，UI 无 true/false/default 强约束 | `runner.py:179-201,549-557` |
| G13 | 工 | S2 | 无单节点测试 / 断点 / 从节点续跑，调一个节点要跑整图 | `AgentWorkflowsPage.tsx`（仅整图试运行） |
| G14 | 工 | S2 | 版本历史无产品入口：已存版本但无列表 / diff / rollback / 发布版本锁定 | `AgentWorkflowsPage.tsx:804` |
| G15 | 闭 | S2 | 模板与导入导出缺失：仅一条 demo，无 Article Audit/SEO/Brief/Sweep 模板，无 JSON/YAML 迁移 | `agentWorkflowService.ts:32-129` |
| G16 | 治 | S2 | 变量 / secret 只展示不可管理：无安全编辑 / 作用域 / 运行时覆盖 | `AgentWorkflowsPage.tsx:1138-1150` |
| G17 | 观 | S2 | Run history / trace 可观测性不足：无原始输入输出展开、脱敏、耗时瀑布、token/cost、工具请求响应、失败堆栈 | `AgentWorkflowsPage.tsx:1182-1227` |
| G18 | 工 | S2 | Agent 定义表无管理面：`agent_agents` 只读，不能创建 / 编辑 / 禁用 / 测试 | `agent_workflow_handler.go`（仅 list） |
| G19 | 真 | S1 | Code 节点展示早于能力：`sandboxRef` 是正确占位，但 UI 未标「未接入执行器」，易误以为可跑脚本 | `runner.py:33-38` |
| G20 | 验 | S1 | 前端零自动化测试，复杂 UI 改动易回归 | 无 `AgentWorkflowsPage` 测试文件 |
| G21 | 闭 | S2 | 未与内容生命周期绑定：编排未出现在写作 / 草稿 / 发布 / 标签 / 媒体 / KB 维护等高频场景 | 前端入口孤岛 |
| G22 | 闭 | S2 | 无「把一次 Chat 变成 Workflow」的路径 | `chat.ts`（无 workflow 引用） |
| G23 | 闭 | S2 | Cowork 与 Workflow 无承接关系（Cowork 设计冻结，缺产品/技术接口） | `COWORK_ROADMAP.md` |
| G24 | 闭 | S3 | 缺 Marketplace / Recipe / Sharing，学习成本高 | — |
| G25 | 验 | S1 | 缺评估与回归集：「运行成功」无法代表「结果好」，无 gold case / 评分 / 价值度量 | 无 eval 资产 |
| G26 | 自 | S1 | 策划书强调 autonomous / hybrid / run 固化是 Code 模式差异化，但当前只在 schema 层接受 mode，runtime/UI/API 均未形成自主工具调用循环与 `canonicalize` 路径 | `CODE_ROADMAP.md:397-426,638-642`、`definition.go:32-36`、`definition.py:8,49`、`runner.py:44-70` |

---

## 5. 同类产品对比与采纳决策

> 竞品仅作能力参照。新增「采纳决策」列把分析挂到 Roadmap，避免「只对比不决策」。

| 产品 | 参考能力 | 对 AetherBlog 的启发 | **采纳决策（→Phase）** |
| --- | --- | --- | --- |
| Dify | Agent 节点授权内自主决策；Iteration 节点对数组逐项跑子工作流（顺序/并发 + 失败策略） | 真实工具授权、KB 节点、迭代子图、错误策略；文章批处理/长文特别适合 iteration | **采纳**：Agent v1→P1、Iteration 子图→P3（P1-05）、错误策略→P2/P3 |
| Langflow | 拖拽组件、Playground 实时测试、组件即 agent tool、MCP client/server、flow 可 API 调用 | 「边建边测」低摩擦；workflow 可作 Chat 工具 / 外部 API | **采纳**：单节点 Playground→P3（P1-01）、published 作 Chat 工具→P4（P2-06） |
| n8n | 触发器、Schedule、执行历史、失败重试、错误工作流、数据保存/脱敏、超时 | 「运行后怎么办」是一等能力：历史/重试/通知/定时/超时/脱敏 | **采纳**：重试→P2、调度→P3（P1-21）、脱敏→P2（P1-18）、错误工作流→P5（P3-09） |
| Flowise Agentflow V2 | 节点执行队列、Flow State、Loop Back、Human Input、审批后继续 | 需要运行状态与暂停语义，审批/人工输入内置为节点 | **采纳**：队列/状态→P2、Human Input→P5（P3-02） |
| OpenAI Agents SDK | code-first agent loop、tools、handoffs、guardrails、human review、streaming、tracing、sandbox | 工具调用/交接/护栏/追踪/审批作为 runtime 原语 | **部分采纳**：tools+streaming+tracing→P1/P2；autonomous loop→P4B（P3-10）；handoff/guardrail→P5（P3-03/04）；sandbox→P5（P3-01） |

参考链接见 §13。

---

## 6. 解决方案 Backlog（按主题分组，ID 稳定）

> **重要**：下文 P0/P1/P2/P3 是**主题批次编号，不是排期**。真正排期见 §9 Roadmap，问题覆盖见 §8 矩阵。每行含：解决的 GAP、规模（**S ≤3 人日 / M ≤1.5 人周 / L ≤3 人周 / XL >3 人周**）、目标 Phase、验收标准。v2 新增 **P1-21、P3-09** 两项以闭合覆盖空洞；v2.1 新增 **P3-10、P3-11** 对齐 `CODE_ROADMAP.md` 的 autonomous/hybrid 产品策划。

### 6.1 P0 批次 — 让 MVP 成为可信的真实运行底座

| ID | 事项 | 解决 GAP | 规模 | Phase | 建议修复 | 验收标准 |
| --- | --- | --- | --- | --- | --- | --- |
| P0-01 | 运行模式显式化 | G01 | S | 0 | 前端「模拟/真实」切换；模拟态显著 badge；真实运行遇未接入 executor 必须失败而非伪成功 | UI 与 run record 均显示 `simulated=true/false`；未接入时返回明确错误 |
| P0-02 | 撤销硬编码模拟 | G01 | S | 0 | `simulateRun(...,true)` 改为按用户选择传参；published invoke 默认禁止模拟，除非管理员显式开启 | 代码不再固定传 true；发布调用默认真实执行 |
| P0-03 | 接入真实 `kb_get_post` | G02 | M | 1 | ai-service 经 Go internal endpoint 读当前用户可访问文章 | 真实 post_id → trace 出现真实标题/正文摘要；无权限返回权限错误 |
| P0-04 | 接入真实 `kb_search` | G02 | M | 1 | 复用现有搜索 / KB profile，支持关键词 + 语义、top_k、threshold | 已有文章关键词返回命中列表；trace 展示来源 |
| P0-05 | 工具注册表运行时生效 | G03 | M | 1 | Go 在 run payload 下发工具快照（或 ai-service 内部查询解析）；校验 enabled/owner/public | 禁用工具不能运行；不存在工具保存或运行报错一致 |
| P0-06 | 工具审批短路 | G03 | M | 3 | `requires_approval` 触发 run 进入 paused，记 `paused_reason=requires_approval` | web_search / skill_security_audit 默认触发审批暂停，不自动执行 |
| P0-07 | 执行队列化 | G05 | L | 2 | run queue + worker：CreateRun 只 enqueue，worker 异步执行，前端轮询或 SSE | 创建 run 立即返回 pending/running；长任务不占用前端请求 |
| P0-08 | 运行状态推进 | G06 | M | 2 | worker 设置 running/`started_at`；FinishRun 修正 duration 以 started_at 计 | run history 正确显示开始/结束/耗时；`started_at` 不再恒 NULL |
| P0-09 | SSE trace stream | G05 | M | 2 | `GET /v1/agent/runs/:id/stream` 推送 node_started/succeeded/failed/heartbeat | 前端运行时实时更新 trace，不等最终响应 |
| P0-10 | Cancel endpoint | G06 | M | 2 | `POST /v1/agent/runs/:id/cancel`，worker 周期检查 cancel flag/context | 取消后 run→cancelled，worker 停止后续节点 |
| P0-11 | Retry endpoint | G06 | M | 2 | 支持从头 / 从失败节点、当前版本 / 原版本重试，记 `retryOf`/parentRunId | 失败 run 可重试并溯源 |
| P0-12 | 真实 LLM executor | G01,G08 | M | 1 | 复用 `LlmRouter`（`chat/stream_chat/embed`），支持 model/provider、structured output、usage 记录 | LLM 节点真实生成；trace 有 tokens/model/provider |
| P0-13 | Agent executor v1 | G01 | L | 1 | tools-agent 最小循环：system prompt + allowed_tools + maxIterations + function calling | Article Audit Agent 能读文章、调 kb_search、输出结构化报告 |
| P0-14 | Input schema enforcement | G07 | S | 3 | run 前按 workflow inputs / publication inputSchema 校验类型、必填、范围 | 错误输入返回字段级错误，不创建无效 run |
| P0-15 | Budget enforcement | G08 | M | 3 | 每 run 配 maxTokens/maxCost/maxDuration/maxNodes，超限标记 budget_exceeded（先在 Go 模型映射这些列） | 超限用例稳定停止并写入 budget_exceeded |
| P0-16 | Publication rate limit | G07 | S | 3 | 按 slug + user/IP 限流，超限 429 | 同 slug 短时超阈被拒 |
| P0-17 | Publication origin policy | G07 | S | 3 | 浏览器来源检查 Origin；服务端内部走 trusted path | 不在 allowedOrigins 的前端来源无法 invoke |
| P0-18 | 错误分类 | G10 | M | 1 | 定义 errorCode/errorCategory/retryable/nodeId/upstreamStatus | UI 按配置/权限/上游/预算错误分类展示 |
| P0-19 | 敏感信息脱敏 | G17 | M | 2 | 对 secretRef、Authorization、API key、cookie、长正文做 redaction/preview | trace 不展示 secret；长正文默认折叠 |
| P0-20 | 能力状态 API | G01,G19 | S | 0 | `/v1/admin/agent-workflows/capabilities` 返回 realLLM/realTools/sandbox/scheduler 状态；前端据此渲染真实徽标 | 未接入能力显示 disabled/coming soon，绿盾改为真实状态驱动 |

### 6.2 P1 批次 — 完善编排体验与作者效率

| ID | 事项 | 解决 GAP | 规模 | Phase | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| P1-01 | 单节点测试 | G13 | M | 3 | 节点可独立执行并显示输入/输出（自动收集上游样本） |
| P1-02 | 断点暂停 | G13 | M | 2 | run 停在指定节点，可查看上下文 |
| P1-03 | 从节点续跑 | G13 | M | 2 | 修改当前节点输入/变量后 resume，只影响后续节点 |
| P1-04 | Branch 显式化 | G12 | S | 3 | branch 提供 true/false/default handles，UI 看得出每条边何时执行 |
| P1-05 | Loop 子图（Iteration） | G11 | L | 3 | iteration container：内部节点逐 item 执行，可顺序/并发 + 失败策略，汇总结果 |
| P1-06 | 并行分支 | G11 | M | 3 | parallel branches + join + 最大并发；trace 展示并行耗时 |
| P1-07 | 工具管理 UI | G04 | M | 3 | 可创建 HTTP tool、编辑 schema、测试、启禁用 |
| P1-08 | OpenAPI import | G04 | M | 3 | 上传 spec 生成多个 tool，可单独启用 |
| P1-09 | MCP discovery | G04 | L | 3 | 配置 MCP server，拉取 tools，权限/描述确认，受 approval 控制 |
| P1-10 | Skill manifest import | G04 | M | 3 | 读本地 skill manifest，暴露只读受控工具（如安全审计 skill） |
| P1-11 | Agent 管理 UI | G18 | M | 3 | Agent CRUD：prompt/model/allowed tools/limits；可在节点中选择 |
| P1-12 | 版本列表 | G14 | M | 3 | UI 展示版本/change note/diff/rollback；运行历史仍指向原版本 |
| P1-13 | 发布版本锁定 | G14 | S | 3 | publication 绑定 version；编辑不影响已发布版本，需重新发布 |
| P1-14 | 模板库 | G15 | M | 3 | 模板中心：Article Audit/SEO/Daily Brief/KB Sweep，可从模板创建 |
| P1-15 | 导入导出 | G15 | M | 3 | JSON/YAML 导入导出，导入时检查工具/变量依赖并提示缺失 |
| P1-16 | 变量管理 | G16 | M | 3 | workflow/user/run 变量编辑；secretRef 只能选不能明文看，secret 不下发前端 |
| P1-17 | Trace 详情 | G17 | M | 2 | 节点日志展开 input/output/duration/tokens/tool request/source links |
| P1-18 | 脱敏策略开关 | G17 | S | 2 | 区分 manual run 保存详情 / production run 默认脱敏（仿 n8n） |
| P1-19 | 前端测试 | G20 | M | 0 | AgentWorkflowsPage 最小组件/交互测试：加载/保存/运行/发布/错误态 |
| P1-20 | 文档状态修正 | G01 | S | 0 | 文档加「已上线/模拟/预留/未接入」状态标签，roadmap 能力不被误读为现状 |
| **P1-21** | **调度 CRUD + daemon + missed-run**（v2 新增） | **G09** | **L** | **3** | 可创建/编辑/启停 schedule；daemon 扫描 `next_run_at` enqueue run；定义 missed-run（skip/catch-up）策略 |

### 6.3 P2 批次 — 与 AetherBlog 核心业务形成闭环

| ID | 事项 | 解决 GAP | 规模 | Phase | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| P2-01 | 文章编辑页入口 | G21 | M | 4 | 编辑页一键运行 Article Audit/SEO/Fact Check，自动带入 post_id |
| P2-02 | 审计报告回写 | G21 | M | 4 | 报告可存为文章私有 note/checklist/comment，文章页可见历史 |
| P2-03 | 标签建议应用 | G21 | M | 4 | SEO&Tags 输出一键应用标题/摘要/标签，进表单待确认不自动发布 |
| P2-04 | Draft creation | G21 | M | 4 | 工作流 output 可创建 post draft，需用户确认 |
| P2-05 | 通知中心 | G10,G23 | M | 4 | run 成功/失败写 notifications，带 run 链接与摘要，可跳转详情 |
| P2-06 | AetherHub slash command | G22 | M | 4 | published workflow 注册为 slash command/tool，`/audit 123` 可运行 |
| P2-07 | Chat-to-workflow 固化 | G22 | L | 4 | 从一次成功 Chat/Agent 轨迹生成 draft workflow，可存模板二次编辑 |
| P2-08 | Cowork task backend | G23 | L | 4 | Cowork 高层任务引用 workflow_id + schedule + notification policy（依赖 Cowork 解冻） |
| P2-09 | 知识库维护模板 | G21,G25 | M | 4 | KB Sweep 模板接入索引统计 / 搜索 profile / chunk 评估，产出重建建议 |
| P2-10 | 内容运营仪表盘 | G25 | M | 4 | 展示本周自动化次数/节省时间/失败率/常见问题，量化收益 |
| P2-11 | Run eval case | G25 | L | 1→5 | Article Audit/SEO/KB Search 建 gold case + 评分脚本（**P1 先建最小集，P5 扩全量**） |
| P2-12 | 模板参数向导 | G15,G21 | M | 4 | 模板先走表单向导再展开高级画布，非技术用户可创建配方 |

### 6.4 P3 批次 — 高级能力与生态（长期差异化）

| ID | 事项 | 解决 GAP | 规模 | Phase | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| P3-01 | Sandbox worker | G19 | XL | 5 | 独立 sandbox-worker：JS/Python、文件隔离、资源/网络限制；Code 节点超时/内存可控 |
| P3-02 | Human Input node | G06 | M | 5 | 人类输入/审批节点，可暂停等待用户选择 |
| P3-03 | Guardrails | G07 | L | 5 | input/output/tool 护栏：PII、prompt injection、URL allowlist、schema validation |
| P3-04 | Agent handoff | G11 | M | 5 | 一个 agent 节点 handoff 给 specialist；trace 展示 handoff 链路 |
| P3-05 | Marketplace | G24 | XL | 5 | 用户发布模板/工具配方，管理员审核，可一键安装并检查依赖 |
| P3-06 | 多租户团队协作 | G24 | XL | 5 | shared workflow、角色权限、审计日志 |
| P3-07 | OpenTelemetry 导出 | G17 | M | 5 | 导出 OTel spans 或接外部观测平台，一个 run 可见完整 spans |
| P3-08 | 自治轨迹固化 | G22,G26 | L | 4B | autonomous run 成功后生成 fixed workflow 草稿，保留工具调用、输入输出、成本、失败节点与用户可编辑的节点命名；用户可审阅保存 |
| **P3-09** | **错误工作流（n8n-style）**（v2 新增） | **G10** | **M** | **5** | 主工作流失败时触发 error workflow（通知/补偿/降级），可配置绑定 |
| **P3-10** | **Autonomous executor v1**（v2.1 新增） | **G26** | **L** | **4B** | LiteLLM tool-calling/ReAct 循环受 `allowed_tools/maxSteps/maxTokens` 约束；每步写 node log；连续重复 tool call 触发死循环保护 |
| **P3-11** | **Hybrid mode v1**（v2.1 新增） | **G26** | **L** | **5** | 在固定骨架节点之间允许 agent 插入受控子步骤；必须继承同一工具治理、预算与 trace 语义 |

---

## 7. 关键决策（ADR 摘要，待评审落定）

> v1 的「8 个建议」升级为带状态的决策，落定后转 Approved 并驱动 §9。**状态：A=建议接受 / P=待定 / D=暂缓**。

| # | 决策点 | 结论建议 | 状态 | 理由与后果 |
| --- | --- | --- | --- | --- |
| D1 | 试运行是否允许默认模拟？ | **否**，必须显式展示模拟状态 | A | 直接决定 Phase 0 范围（P0-01/02/20）；不修则一切「成功」不可信 |
| D2 | 真实工具先做哪些？ | 只先做 `kb_get_post`/`kb_search`/LLM executor 支撑 Article Audit | A | 收敛 Phase 1 范围，避免摊大饼 |
| D3 | 是否立即队列化执行架构？ | **是**，Phase 2 必做 | A | 否则 schedule/Cowork/长任务全部返工（G05/G06） |
| D4 | MCP/Skill 现在做吗？ | **暂不**，等内置工具 + 治理闭环后接 | D | 降低 Phase 1/2 复杂度与攻击面；置于 Phase 3 |
| D5 | 文章编辑页作为首个产品落点？ | **是** | A | 比独立画布更能体现价值，定义 Phase 4 优先级 |
| D6 | workflow 作为 Cowork 底座？ | **是**，但 Cowork UI 不暴露节点级复杂度 | P | 依赖 Cowork 解冻（`COWORK_ROADMAP.md`），P2-08 有外部依赖 |
| D7 | Code 节点何时真实启用？ | 等 sandbox-worker 专项，**禁止主进程执行** | A | 安全红线（§3.2 非目标）；Phase 5（P3-01） |
| D8 | 是否建立 eval？ | **是**，Article Audit 一接真实 LLM 即建最小集 | A | 「成功运行 ≠ 质量好」（G25）；Phase 1 起 P2-11 |
| D9 | autonomous 是否进入产品闭环前置能力？ | **是，但排在真实工具/异步/治理之后** | A | `CODE_ROADMAP.md` 把 autonomous+固化列为 Code 差异化；若没有真实工具、预算、trace 和暂停语义，自主执行不可控 |

---

## 8. 可追溯矩阵（闭环核心）

> **闭环定义**：每个 GAP → 至少一个 FIX → 归属一个 Phase → 有验收 → 关联 KPI/eval；反向每个 FIX 都能追到 GAP。eval/KPI 失败回灌新 GAP，进入下一轮。

**正向覆盖（GAP → FIX → Phase → KPI）**：

| GAP | 严重度 | FIX | 主要 Phase | 关联 KPI（§10） |
| --- | --- | --- | --- | --- |
| G01 真实性 | S0 | P0-01,02,12,13,20 / P1-20 | 0–1 | K1 真实运行成功率、K2 模拟透明度 |
| G02 内置工具 | S0 | P0-03,04 | 1 | K3 Article Audit eval 通过率 |
| G03 工具注册表 | S0 | P0-05,06 | 1,3 | K4 工具治理覆盖率 |
| G04 连接器生态 | S1 | P1-07,08,09,10 | 3 | K5 第三方工具接入数 |
| G05 异步架构 | S0 | P0-07,09 | 2 | K6 长任务成功率、K7 P95 时延 |
| G06 run 生命周期 | S0 | P0-08,10,11 / P1-02,03 / P3-02 | 2,5 | K6、K8 可控操作可用性 |
| G07 发布治理 | S1 | P0-14,16,17 / P3-03 | 3,5 | K4、K9 安全事件数=0 |
| G08 预算 | S1 | P0-15 / P0-12(usage) | 1,3 | K10 预算命中正确率 |
| G09 调度 | S1 | **P1-21** | 3 | K11 定时任务按时率 |
| G10 错误处理 | S1 | P0-18 / P2-05 / **P3-09** | 1,4,5 | K12 失败可诊断率 |
| G11 控制流 | S2 | P1-05,06 / P3-04 | 3,5 | K13 复杂工作流可表达性 |
| G12 Branch | S2 | P1-04 | 3 | K13 |
| G13 调试体验 | S2 | P1-01,02,03 | 2,3 | K14 作者构建时长 |
| G14 版本 | S2 | P1-12,13 | 3 | K8 |
| G15 模板/迁移 | S2 | P1-14,15 / P2-12 | 3,4 | K15 模板创建占比 |
| G16 变量/secret | S2 | P1-16 | 3 | K9 |
| G17 可观测 | S2 | P0-19 / P1-17,18 / P3-07 | 2,5 | K12 |
| G18 Agent 管理 | S2 | P1-11 | 3 | K13 |
| G19 Code 节点诚实 | S1 | P0-20 / P3-01 | 0,5 | K2 |
| G20 前端测试 | S1 | P1-19 | 0 | K16 回归拦截率 |
| G21 内容闭环 | S2 | P2-01,02,03,04,09 | 4 | K17 高频场景采用率（北极星） |
| G22 Chat→WF | S2 | P2-06,07 / P3-08 | 4,4B | K17 |
| G23 Cowork 承接 | S2 | P2-05,08 | 4 | K17 |
| G24 生态 | S3 | P3-05,06 | 5 | K15 |
| G25 评估 | S1 | P2-10,11 | 1→5 | K3 质量分（防回归） |
| G26 autonomous/hybrid | S1 | P3-08,10,11 | 4B,5 | K18 自治轨迹可固化率 |

**反向覆盖检查**：§6 全部 FIX（P0-01…P0-20、P1-01…P1-21、P2-01…P2-12、P3-01…P3-11）均在上表出现 ≥1 次；v2 新增 **P1-21（→G09）**、**P3-09（→G10）** 已闭合 v1 的两处覆盖空洞（调度 daemon、错误工作流此前无对应 FIX）；v2.1 新增 **P3-10/P3-11（→G26）** 补齐产品策划书里的 autonomous/hybrid 主线。**无孤儿 FIX，无未覆盖 GAP。**

---

## 9. 迭代路线（Roadmap，可执行）

**假设**：1 名 owner + 全栈 0.5-1 + AI 工程 0.5；以串行为主、Phase 3↔4 可部分并行。规模图例同 §6。**每个 Phase 设进入门 / 退出门，门不达不进下一阶段。**

```
关键路径： Phase0 ──► Phase1 ──► Phase2 ──► Phase3 ──► Phase4 ──► Phase4B ──► Phase5
 诚实化     真实工具    异步可控    生态治理    产品闭环    自治固化       高级生态
 (~1w)      (2-3w)      (3-5w)      (4-6w)      (3-6w)      (2-3w)       (长期)
                                      └──── Phase4 / Phase4B 可与 Phase3 后段并行 ────┘
依赖： P1依赖P0诚实化；P2依赖P1真实executor；P3依赖P2队列/审批暂停；
       P4依赖P1(真实输出)+P2(异步)；P4B依赖P1真实工具+P2 trace/预算+P3治理；
       P2-08(Cowork)额外依赖Cowork解冻(D6)。
```

| Phase | 目标 | 进入门 | 含 FIX | 退出门（验收） |
| --- | --- | --- | --- | --- |
| **0 · 诚实化与风险收敛**（~1w） | 让 MVP 不误导用户 | D1 决策接受 | P0-01,02,20 / P1-19,20 | 用户无法把模拟误认为真实；能力徽标由 capabilities API 驱动；前端最小测试 + 文档状态标签落地 |
| **1 · 真实内置工具与首个真实工作流**（2-3w） | Article Audit 跑真实文章 | Phase 0 退出；D2 接受 | P0-03,04,05,12,13,18 / P2-11(最小) | 输入真实 post_id 产出**基于真实正文**的审计报告（非 simulated）；trace 有 tokens/source；最小 eval 集通过 |
| **2 · 异步 runtime 与可控运行**（3-5w） | 长任务可靠可控 | Phase 1 退出；D3 接受 | P0-07,08,09,10,11,19 / P1-02,03,17,18 | 长文审计 / 批量循环 / 失败重试可靠执行回放；可 cancel/resume；`started_at`/duration 正确 |
| **3 · 工具/连接器生态与治理**（4-6w） | 安全接第三方工具 + 调度 | Phase 2 退出；D4 解锁 | P0-06,14,15,16,17 / P1-01,04,05,06,07,08,09,10,11,12,13,14,15,16,21 | 可注册外部 HTTP/OpenAPI 工具受控执行；审批/预算/限流/来源/脱敏生效；调度 daemon 按时 enqueue |
| **4 · 产品闭环**（3-6w，可与 P3 后段并行） | 进入高频内容场景 | Phase 1+2 退出；D5 接受 | P2-01,02,03,04,05,06,07,09,10,12 / P2-08(若 Cowork 解冻) | 不打开画布也能在写作/聊天/通知中用到编排；输出可回写 note/draft/tags；`/audit` 可在 Chat 运行 |
| **4B · autonomous 与轨迹固化**（2-3w） | 兑现 Code 模式差异化 | Phase 1+2 退出；Phase 3 的工具治理可用；D9 接受 | P3-08,10 | autonomous run 可自主调用允许工具并实时记录 step；成功 run 可 `canonicalize` 为 fixed workflow 草稿 |
| **5 · 高级编排与生态**（长期） | 形成长期壁垒 | 前序稳定 + D7 sandbox 立项 | P3-01,02,03,04,05,06,07,09,11 / P2-11(全量) | Human Input/Guardrails/Handoff/Sandbox/Marketplace/错误工作流/hybrid/eval 回归集就绪 |

---

### 9.1 本轮迭代落地包（全量产品闭环）

| Work package | 关联 FIX | 主要文件 | 交付边界 | 验证命令 / 证据 |
| --- | --- | --- | --- | --- |
| 显式运行模式 | P0-01, P0-02 | `apps/admin/src/pages/agent-workflows/AgentWorkflowsPage.tsx`、`apps/admin/src/services/agentWorkflowService.ts`、`apps/server-go/internal/dto/agent_workflow.go` | 前端提供「模拟/真实」切换；默认真实运行；模拟 run 在 trace/history/输出区都有 badge；published invoke 默认禁止模拟 | `pnpm --filter @aetherblog/admin typecheck`；ai-service `test_external_node_requires_executor_by_default` 继续证明真实模式遇未接入 executor 会失败 |
| 能力状态 API 与真实徽标 | P0-20 | `apps/server-go/internal/handler/agent_workflow_handler.go`、`apps/server-go/internal/service/agent_workflow_service.go`、`apps/admin/src/services/agentWorkflowService.ts`、`AgentWorkflowsPage.tsx` | 新增 capabilities response：`realLLM/realTools/sandbox/scheduler/autonomous`；Inspector 静态绿盾改为状态驱动，不再默认绿色 | `cd apps/server-go && go test ./internal/handler ./internal/service ./internal/pkg/agentworkflow`；截图/Playwright 证明 disabled/coming-soon 状态可见 |
| 真实执行器 | P0-03, P0-04, P0-05, P0-12, P0-13, P0-18 | `apps/ai-service/app/api/routes/workflows.py`、`apps/ai-service/app/workflows/definition.py` | `kb_get_post` / `kb_search` 读真实文章；LLM 走 `LlmRouter`；Agent v1 在 allowedTools 内调用工具后汇总；Code 节点仅执行受限表达式；MCP/Skill/OpenAPI 未接入时显式失败 | `PYTHONPATH=. uv run pytest tests/test_workflow_runner.py -q --no-cov` |
| 异步 runtime 与运行控制 | P0-07, P0-08, P0-09, P0-10, P0-11, P0-19 | `apps/server-go/internal/service/agent_workflow_service.go`、`agent_workflow_repo.go`、`agent_workflow_handler.go` | CreateRun 返回 pending/started；detached execution 写完整 trace；SSE stream、cancel、retry、resume、pause for approval、canonicalize API 可用；`started_at` / duration 正确写入 | `cd apps/server-go && go test ./...` |
| 治理与数据边界 | P0-06, P0-14, P0-15, P0-16, P0-17, P1-01, P1-04, P1-05, P1-06, P1-07, P1-08, P1-10, P1-11, P1-16, P1-21 | `migrations/000069_agent_workflow_full_iteration.*.sql`、`agent_workflow_service.go`、`agent_workflow_repo.go` | tool/agent/schedule/variable CRUD；HTTP 工具 URL/方法治理；publication origin/rate/input schema；预算字段；审批暂停；生产脱敏；marketplace/error/human/cowork/notification 表边界 | `docker compose -f docker-compose.yml config --quiet`、`go test ./...` |
| Admin 产品闭环 | P1-01, P1-03, P1-15, P1-17, P1-18, P2-09, P3-08 | `AgentWorkflowsPage.tsx`、`agentWorkflowService.ts`、`packages/types/src/agent-workflow/index.ts` | 模板库、版本回滚、导入导出、指标、runtime 操作区、工具测试、schedule 快捷入口、run error/category/source 展示、canonicalized workflow 回填 | `pnpm --filter @aetherblog/admin typecheck`、`pnpm --filter @aetherblog/admin exec eslint . --quiet`、`pnpm --filter @aetherblog/admin build`、Playwright 页面验证 |
| 内容业务入口 | P2-01, P2-02, P2-06, P2-07 | `AiWritingWorkspacePage.tsx`、`AetherHubWorkspacePage.tsx` | 文章 AI 写作页一键运行 published Article Audit；AetherHub Chat 支持 `/audit <post_id>` 调用 published workflow；sourceType 分别写 `article` / `chat` | admin build + Playwright 页面验证 |
| 文档状态标签 | P1-20 | `docs/agent/README.md`、`docs/agent/CODE_ROADMAP.md`、本文、`docs/output/*/agent-workflows.md`、`.claude/docs/*` | `已上线 / 可用 MVP / 未连接时显式失败 / 后续硬化` 标签覆盖 Code 路线关键能力，避免把 roadmap 当现状 | `rg -n "000069\|Article Audit\|canonicalize\|capabilities\|scheduler" docs .claude .agent/plans/intelligent-orchestration-gap-analysis-iteration-checklist.md` |
| 前端最小回归测试 | P1-19 | `apps/admin/src/pages/agent-workflows/*` 附近测试文件 | 当前 admin 尚无组件测试脚手架；本轮用 type-check / ESLint / build / Playwright 页面验证兜底，并把测试脚手架作为后续工程化事项保留 | `pnpm --filter @aetherblog/admin typecheck`、`pnpm --filter @aetherblog/admin build` |

---

## 10. 成功度量（KPI 与 eval 门）

**北极星指标 K17**：作者在**不打开画布**的前提下，借真实工作流完成内容动作（发布前检查 / SEO / 草稿 / 简报）的**周采用率与留存**。

| KPI | 定义 | 目标门（建议） | 起测 Phase |
| --- | --- | --- | --- |
| K1 真实运行成功率 | 非模拟 run 的成功 / 总数 | Phase1 ≥70%，Phase2 ≥90% | 1 |
| K2 模拟透明度 | 模拟 run 被正确标识比例 | 100% | 0 |
| K3 Article Audit eval 通过率 | gold case 评分 ≥ 阈值占比 | ≥80% 且无回归 | 1 |
| K4 工具治理覆盖率 | enabled/approval/限流在运行时被尊重的工具占比 | 100% | 1→3 |
| K5 第三方工具接入数 | 受控注册并成功执行的外部工具数 | 设基线后增长 | 3 |
| K6 长任务成功率 | >30s 任务成功 / 总数 | ≥95% | 2 |
| K7 P95 入队-完成时延 | 队列化后端到端 | 设基线后逐期收敛 | 2 |
| K8 可控操作可用性 | cancel/resume/版本回滚成功率 | ≥99% | 2 |
| K9 安全事件数 | SSRF/越权/secret 泄漏/沙箱逃逸 | 恒为 0 | 1→5 |
| K10 预算命中正确率 | 超限被正确拦截 / 应拦截 | 100% | 3 |
| K11 定时任务按时率 | 在容差窗内触发占比 | ≥99% | 3 |
| K12 失败可诊断率 | 失败 run 能定位到节点+错误类别占比 | ≥95% | 1→2 |
| K13 复杂工作流可表达性 | iteration/parallel/branch 覆盖的目标场景占比 | 目标场景全覆盖 | 3 |
| K14 作者构建时长 | 从模板到可运行工作流的中位耗时 | 设基线后下降 | 2→3 |
| K15 模板创建占比 | 经模板/向导创建的工作流占比 | ≥60% | 3→4 |
| K16 回归拦截率 | CI 在合并前拦住的回归占比 | 持续上升 | 0 |
| K17 高频场景采用率 | 见北极星 | 设基线后季度增长 | 4 |
| K18 自治轨迹可固化率 | autonomous run 成功后可生成可运行 fixed 草稿的比例 | Phase4B ≥80%，Phase5 ≥95% | 4B |

**eval 门（防「成功但不好」）**：Article Audit / SEO / KB Search 各维护 gold case + 评分脚本（P2-11）；**真实 LLM 一旦接入，eval 即为 Phase 退出门的强制项**，未达不进下一 Phase。

---

## 11. 风险登记册

> 概率/影响：高/中/低。安全项对齐本仓库既有「KB 18 轮安全评审」基线，不得降级。

| ID | 风险 | 概率 | 影响 | 缓解（关联 FIX） | Owner |
| --- | --- | --- | --- | --- | --- |
| R1 | **伪成功误导决策**：用户基于模拟结果发布内容 | 高 | 高 | Phase 0 即修（P0-01/02/20）；published 默认禁模拟 | 待指派 |
| R2 | **SSRF / 越权**：HTTP/OpenAPI 连接器访问内网或他人文章 | 中 | 高 | URL allowlist + `ValidatePublicURL`（已有，需运行时强制）+ origin policy(P0-17) + 工具注册表鉴权(P0-05) | 待指派 |
| R3 | **沙箱逃逸**：Code 节点真实执行 | 中 | 高 | v1/v2 禁用（D7/§3.2）；仅 sandbox-worker 隔离后启用(P3-01) | 待指派 |
| R4 | **Secret 泄漏**：trace/前端暴露密钥或长正文 | 中 | 高 | 脱敏(P0-19/P1-18)；secret 不下发前端(P1-16) | 待指派 |
| R5 | **Prompt injection**：文章/检索内容操纵 Agent 调危险工具 | 中 | 中 | 审批短路(P0-06) + guardrails(P3-03) + allowed_tools 收敛 | 待指派 |
| R6 | **成本失控**：真实 LLM + 循环/批处理烧 token | 中 | 中 | 预算硬约束(P0-15) + usage 计量(P0-12) | 待指派 |
| R7 | **同步架构返工**：先做产品闭环再补队列 | 中 | 高 | 顺序锁定：Phase 2 队列先于 Phase 4（D3） | 待指派 |
| R8 | **Cowork 外部依赖**：P2-08 卡在 Cowork 冻结 | 中 | 中 | D6 标 Pending；Phase 4 中 P2-08 可延后不阻塞其他闭环项 | 待指派 |
| R9 | **MCP/Skill 攻击面**：第三方工具引入 RCE/数据外泄 | 中 | 高 | 延后至 Phase 3(D4)；强制 approval + 只读优先 + 描述确认 | 待指派 |
| R10 | **文档漂移**：实现推进未回写，能力被误读 | 中 | 中 | DoD 强制 doc-sync（§12）；P1-20 状态标签 | 待指派 |
| R11 | **autonomous 不可控**：主 Agent 重复调用同一工具、烧 token 或越权扩展任务 | 中 | 高 | D9 约束前置条件；`allowed_tools/maxSteps/maxTokens` 硬限制；死循环检测；每步 trace + budget enforcement（P3-10/P0-15） | 待指派 |

---

## 12. Definition of Done 与文档同步

每个 FIX / Phase 退出必须满足（对齐 `AGENTS.md` 仓库规则与 `CLAUDE.md §5/§6`「交付即验证」）：

1. **代码 + 测试**：新逻辑配单测/组件测试；真实 executor 路径与 DB 工具路径必须有测试（补 G20）。
2. **服务可验**：`./start.sh --gateway` 起栈后端到端验证目标场景（非仅 HTTP 200）。
3. **eval 门**（Phase 1 起）：相关 gold case 通过、无质量回归。
4. **文档同步**（强制触发器）：
   - 新增/改 API → `docs/architecture.md` API 节 + `.claude/docs/api-handlers.md`。
   - 新建 migration（队列/审批/预算/调度列）→ `docs/architecture.md` 数据库节 + `.claude/docs/database-migrations.md`。
   - 改 Agent 模式定位/阶段 → `docs/agent/README.md` + `CODE_ROADMAP.md`（本文是其细化，需双向对齐）。
   - 里程碑 → `CHANGELOG.md`（不得落后 HEAD >1 模块）。
5. **设计系统红线**：任何新增 UI（工具/版本/模板/向导等）`pnpm design-system:check` 保持 **0 error**，不留半 Codex 半 legacy。
6. **PR 描述**含 `文档影响：[已更新 X] 或 [无需更新，原因...]`。

---

## 13. 外部参考来源

- Dify Agent / Iteration / 编排逻辑：`https://docs.dify.ai/en/use-dify/nodes/agent`、`/nodes/iteration`、`/build/orchestrate-node`
- Langflow：`https://docs.langflow.org/`
- n8n AI Agent / executions / error-handling / schedule / settings：`https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/`、`/workflows/executions/all-executions/`、`/flow-logic/error-handling/`、`/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/`、`/workflows/settings/`
- Flowise Agentflow V2：`https://docs.flowiseai.com/using-flowise/agentflowv2`
- OpenAI Agents guide / tracing：`https://developers.openai.com/api/docs/guides/agents`、`https://openai.github.io/openai-agents-python/tracing/`

---

## 14. 文档修订记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v3.0 | 2026-05-31 | 在新 worktree 完成策划书全量产品迭代并准备提交 PR：① 后端新增 `000069_agent_workflow_full_iteration`，补齐 runtime metadata、审批、publication invocation 限流日志、eval、marketplace、错误工作流、human input、cowork handoff、notifications 等边界；② Go authoring/runtime 新增 tool/agent/schedule/variable CRUD、versions/templates/import/export/metrics、stream/cancel/retry/resume/canonicalize、publication origin/rate/input schema、预算/脱敏/错误分类；③ ai-service runner 接真实 KB、LLM Router、Agent v1、受限 Code executor 与 HTTP 工具治理；④ admin `/agent-workflows` 增加模板、导入导出、版本回滚、指标、runtime 操作与工具测试；⑤ 文章 AI 写作页与 AetherHub `/audit <post_id>` 接 published Article Audit；⑥ 同步 docs/output、docs/agent、architecture、.claude 文档与验证证据。 |
| v2.2 | 2026-05-30 | 在新 worktree 落地 Phase 0 核心产品迭代并回写计划状态：① 新增 capabilities API 与前端状态驱动徽标；② 显式真实/模拟运行模式，默认真实，模拟需要用户选择；③ run `simulated` 持久化，历史未知 run 保守回填为 simulated；④ published slug invoke 强制真实运行；⑤ 同步 docs/agent、backend/admin 输出文档与迁移/API 说明；⑥ 记录 admin 组件测试脚手架仍待补齐。 |
| v2.1 | 2026-05-30 | 根据 `CODE_ROADMAP.md` 二次对齐产品策划：① 将 autonomous/hybrid 与 run→fixed 固化提升为独立主线，新增 G26 / D9 / K18 / R11；② 新增 P3-10 Autonomous executor v1、P3-11 Hybrid mode v1，并把 P3-08 调整到 Phase 4B；③ Roadmap 新增 Phase 4B「autonomous 与轨迹固化」；④ 新增 §9.1 Phase 0 开工包，明确文件范围、交付边界与验证证据；⑤ 修正 §13/§14 引用与 DoD 对齐 `AGENTS.md`。 |
| v2.0 | 2026-05-30 | 评审重构：① 校正 5 处事实（模拟默认值成因、`started_at` 恒 NULL、静态绿盾、预算死列、000052 冻结/000066 基线）；② 严重度（S0-S3）与 Phase 排期解耦，消除 v1「P0 批次 ↔ Phase」语义冲突；③ 新增 §8 可追溯矩阵实现 GAP↔FIX↔Phase↔KPI 闭环，补 **P1-21 调度 daemon、P3-09 错误工作流** 闭合两处覆盖空洞；④ 新增 §7 决策（ADR）、§10 KPI/eval 门、§11 风险登记册、§12 DoD/文档同步、§3.2 非目标；⑤ 全部修复项加「解决 GAP / 规模 / 目标 Phase」列；⑥ 重定标题为「策划书与迭代路线」。 |
| v1.0 | 2026-05-30 | 初稿《智能编排差距分析与迭代评审清单》。 |
