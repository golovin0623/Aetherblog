# Knowledge Atlas Gap Analysis And Iteration Roadmap

> Date: 2026-05-30 (revised, code-verified)
> Scope: Atlas / 知识图集, KnowledgeBase / RAG 知识库, AetherHub / Agent, Admin intelligence surfaces, future blog-facing knowledge surfaces.
> Goal: 在对照真实代码（migrations 000062-000066 · `apps/server-go/internal/knowledge/**` · `apps/admin/src/pages/atlas/**` · `apps/ai-service/app/**`）和产品策划书（`docs/plan/task-aether-knowledge-system.md` · `docs/plan/knowledge.md` · `docs/plan/task-knowledge-decisions.md`）的前提下, 给出可评审、可追溯、可闭环的功能修复与迭代路线图。
> Status legend: 所有问题与修复项均带 **代码证据**（`file:line`）与 **验证结论**（CONFIRMED / CORRECTED / NEW）。第 9 节是完整 traceability matrix —— 每个 checklist ID 都落到某个 Sprint 或显式 Backlog, 不留悬空项。

## Landing Update（2026-05-31, `codex/knowledge-atlas-landing`）

本 PR 在新 worktree 中完成本文 Sprint 0 / Multi-user Gate 的落地, 并继续补齐 R1/R2/R3/R4/R5 的可验证 gate 基线:

- P0-01/P0-02: `/atlas` 从 Phase 0 占位页改为真实 dashboard, Sidebar 与 dashboard 均能进入 KP 列表、Graph、Suggestions。
- P0-03/P0-11: Atlas 读写改为 RBAC + scope middleware, list/get/graph/relation/suggestion/carrier/annotation 执行 author/owner 过滤; `source_uri` 唯一性改为 live per-owner expression index。
- P0-04/P0-07: Graph edge 查询按节点集和 author scope 收敛; relation evidence 增 repo/service/API, create relation 和 AI relation accept 都能绑定 evidence annotation。
- P0-05/P0-06/P2-10: KP suggestion 必须绑定 carrier/annotation, create 阶段执行 ignored/pending fingerprint 去重, 并补 proposed KP type 校验与迁移约束。
- P0-08/P0-12: 新增 Go repo/service/handler 测试、Atlas UI 红线 grep、phase gate ledger; R1 real-PDF corpus gate、R2 live relation-health gate、R3 live non-stub AI quality gate、R4 runtime/build budget gate、R5 admin/multi-user smoke gate 均已有当前证据; 详细证据见 `.agent/plans/knowledge-atlas-phase-gate-ledger.md`。
- P1-02/P1-04/P1-08 baseline: Markdown Reader 支持从 annotation 提炼 KP; 新增 `/atlas/kps`; Atlas 已触达页面移除原生 `<select>` 与 spinner, 改用共享 `Select` 与 skeleton。
- P1-07/P3-06 semantic search baseline: `/atlas/search` 保留 KP/Annotation/Carrier 关键词聚合，同时默认开启 `semantic=true` 语义重排；server-go 通过内部 token 调 ai-service `/v1/atlas/search/semantic`，复用 active-profile Atlas recall，按 scope hydrate KP，并在 AI 不可用时降级为关键词结果。
- P2-01/P2-07 baseline: Atlas AI claim/relation 结构化 wrapper 已存在; migration `000072` seed `atlas_claims` / `atlas_relations` task types 并继承默认 chat routing; `scripts/atlas/run-ai-quality-live-gate.mjs` 会阻断无可用凭证或回退到 `atlas-stub/heuristic-v1` 的 R3 伪通过, 并已用显式 live 模型 `gemini-3.1-flash-lite-preview` 跑通非 stub KP/relation 建议质量证据。
- P2-02/P2-08 baseline: 新增 `POST /atlas/carriers/:id/suggestions` 与 `/suggestions/preview`，可从 Markdown note、PDF/blog_post/web text layer 的整篇 root text 有界抽取 KP suggestions 入 Inbox；Markdown/PDF/Web/Blog Post Reader 头部新增 `全文 AI 建议` 入口，并在生成前做 per-run cost preview 与 `maxCostUsd` 阈值拦截；仍保持“AI 只进建议箱、accept 才入图谱”的硬约束。
- M2-02 baseline: 新增 `blog_post` carrier + Blog Post Reader，`POST /atlas/carriers/post` 可把当前用户可访问的草稿/已发布文章包装为 `posts://{id}` 载体并持久化 text layer；migration `000075` 已同步放开 `atlas_carriers.type` CHECK 约束，避免真实数据库插入被旧枚举阻断；AI 写作工作台头部可打开 `/atlas/reader/blog-post/:carrierId` 标注文章正文，也可复用 carrier preview/extract 预算与建议箱链路。
- M2-03 baseline: 新增 `web` clip carrier + Web Reader，`POST /atlas/carriers/web` 保存用户提供的网页 URL/title/Markdown 正文快照，持久化 text layer；`/atlas` 可保存 Web 快照并跳转 `/atlas/reader/web/:carrierId` 标注正文，Web Reader 支持 annotation/full-text AI 建议与预算 preflight。
- M2-04 baseline: 新增 video/audio transcript carrier，媒体详情页可保存手动转录文本为 `video`/`audio` carrier text layer，Transcript Reader 支持按转录文本标注、从邻近 `[mm:ss]`/`[hh:mm:ss]` 时间戳生成 media `#t=` 跳转，并复用全文 AI 建议与预算 preflight；自动 speech-to-text 和更细的分段播放器联动仍属后续。
- M2-05 baseline: 媒体详情页对 PDF 暴露 `加入 Atlas`、`查看标注`、`抽取知识点` 三个操作，对 video/audio 暴露 `Atlas Transcript`、`保存转录`、`查看转录`、`抽取知识点`；已上传 PDF 与手动转录音视频可直接进入 Atlas input stream，图片仍属后续多模态扩展。
- A3-02 evidence-citation baseline: AI 写作工作台 Atlas 参考面板按当前标题/摘要/正文调用 scoped semantic Atlas search 拉取相关 KP；Search KP 结果可携带首条可访问 evidence quote，面板支持插入内部 KP 链接或不含 `/admin` 路径的公开 blockquote citation。

未在本 PR 宣称完成的项仍按本文路线图后移: full GraphRAG/community/global query、公开知识地图、自动 speech-to-text、图片 carrier、更丰富的媒体播放器联动、浏览器/Readability 自动抓取 UI、生产部署复跑证据、生产默认 Atlas routing credential 配置、生产执行 KP/note embedding backfill、以及更大样本的 prompt/model A/B 与真实用户遥测。P2-02 当前是同步有界 baseline，并已补 per-run preflight cost preview 与预算阈值拦截，但还不是带后台 job、进度、持久预算策略和批量任务成本 rollup 的完整批量抽取系统。当前本地 R3 live gate 已证明非 stub 模型输出、accept/reject 度量、schema/grounding/token 覆盖均满足本 PR gate；D2 `note_embeddings` worker、历史 backfill 命令、搜索页语义重排、以及 carrier 级 AI 建议入口已补成 landing baseline，但生产环境实际回填仍需 release evidence。

---

## 0. Review Corrections Log（本次评审改了什么 / 原稿存在的问题）

本节回答“原计划书有什么问题”。下列条目是在逐文件核对代码后, 对上一版草稿的**事实纠正**与**闭环补全**。后续章节已按这些结论改写。

| # | 原稿问题 | 纠正后的事实 | 证据 | 影响 |
| --- | --- | --- | --- | --- |
| C-1 | P0-03 暗示需要新增 `content.atlas.admin` 才能跨用户 | 该权限码**已存在**并已授予 ADMIN 角色; 缺的是 **handler 层 owner 过滤的执行** + admin scope 切换 UI, 不是权限本身 | `migrations/000063_atlas_permissions.up.sql:17-18,26-31` | P0-03 改为“执行隔离 + 复用既有权限码”, 不再新建权限 |
| C-2 | P0-05 把问题描述成“P3-DEMO 样例 seeding 污染 inbox” | 后端**不存在**自动 seeding 路径。真实问题是: `Create` 允许 `kind=kp` 的建议**不绑定任何 carrier/annotation**（migration CHECK 只要求 `proposed_title`）, 且前端有一个 `createSuggestion`“demo”调用 | `suggestion_service.go:71-108`; `migrations/000065:45-48`; `atlasService.ts` createSuggestion | P0-05 改为“建议必须绑定证据来源 + demo 创建入口仅 dev” |
| C-3 | P0-06 暗示要从零做指纹与忽略机制 | `fingerprintSuggestion` 已实现, `Reject` 已写入忽略列表; **唯独 `Create` 没有查 `IsIgnored` / pending 去重** | `suggestion_service.go:276,283-306`; `repository SuggestionRepo.IsIgnored` | P0-06 工作量更小: 只在 `Create` 前加 fingerprint+IsIgnored+pending 去重; 并提示“标题型指纹易被措辞绕过”的精化点 |
| C-4 | 计划未发现 carrier 唯一性与多用户隔离冲突 | `000066` 把 `source_uri` 设为**全局 UNIQUE**（无 owner 维度）。这与 P0-03 的“多用户各自拥有 Atlas”目标**直接冲突**: 两个用户无法各自为同一 note 建 carrier | `migrations/000066_atlas_carrier_unique_source_uri.up.sql:12-13` | 新增 P0-11; 并把“开放多用户”定义为一个显式 gate（见 §3 框架判断） |
| C-5 | Implementation Note 称 `atlas_recall.py` 应“mirror kb_recall.py” | 只有 **embedding 路由 + pgvector ANN + profile 抽象** 可复用; **relation 邻域召回是图遍历（recursive CTE）**, kb_recall 无对应物。整体“镜像”说法过强 | `kb_recall.py`（纯向量, 单向文档召回）; `vector_store.py` / `llm_router.embed` 可复用 | P2-05 拆为“语义召回(复用)” + “图邻域召回(新建)”; §13 Implementation Notes 同步改写 |
| C-6 | P2-06 提议 Phase 2 做 Leiden 社区发现, 与“暂不做 community workload”自相矛盾 | Leiden **不是 Postgres 原生能力**, 需 Python worker（`leidenalg`/`python-louvain`）把图载入内存; 与本计划自己的 invariant 冲突 | `ai-service` 无任何社区检测依赖; §13 原 invariant | P2-06 降级/后移到 Backlog; 近期“global query”用 degree/hub 主题分组 + 预计算邻域替代 |
| C-7 | P2-01 默认 LiteLLM 即可结构化抽取 | `llm_router` 有 task routing + 成本/token 记录 + fallback, 但**没有** pydantic schema 校验 + 失败重试。结构化抽取需要先建一个 validate+retry wrapper | `llm_router.py`（task 默认 max_tokens / 成本记录, 无 schema 校验环） | P2-01 验收标准补“结构化输出校验 + 重试 wrapper”作为前置 |
| C-8 | 路线图未覆盖全部 checklist | 约 12 个项（P1-07/08/10, G1-04/05/06, P2-02, M2-04/05, A3-01/04/05/06）从未排进任何 Sprint; 3 个 P0（P0-02/06/07）不在 Sprint 0 | 见原 §7 | §8 路线图重排, §9 traceability matrix 强制 100% 覆盖 |
| C-9 | 指标无“如何度量” | 多个目标（转化率/探索成功率/grounded 率）无埋点、无测试集, 无法计算 → 退出标准不可验证 | 原 §8 | §11 指标补“数据来源/埋点”列; 新增 P1-12 埋点项作为度量前置 |
| C-10 | 未点出 spinner 红线违规 | 5 个 Atlas 页用 `Loader2 animate-spin`, 违反 CLAUDE.md “禁止 spinner” UI 红线 | `AtlasPage.tsx:159`; `MarkdownReaderPage.tsx:216`; `AtlasGraphPage.tsx:218`; `SuggestionsPage.tsx:161`; `KnowledgePointPage.tsx:185` | 并入 P1-08（控件统一 + 骨架屏） |
| C-11 | 未把产品策划书的 Phase Gate 当成一等约束 | `task-aether-knowledge-system.md` 明确“进入下一阶段 = 上阶段验收全绿 + 红线未触发 + 决策闭环”; 但当前完成日志已有 P1-P3 MVP, 同时 A1 PDF/R1、A2 真实关系密度、A3 真实质量仍未证明 | `docs/plan/task-aether-knowledge-system.md:244-246,672-677`; 本文 §11 | 新增 P0-12, 把“阶段完成”改为 evidence ledger, 防止把 MVP 链路误当完整 Phase 通过 |
| C-12 | 未处理 D2 `note_embeddings` worker 的策划书债务 | 已修正: 策划书 D2 选择“复活而非废弃”，并已补 `NoteIndexerService`、`/v1/notes/{id}/index`、Go note index client/async trigger、`000074` profile/HNSW、Markdown Carrier note recall 与 historical backfill command | `migrations/000054_create_notes.up.sql:119-140`; `migrations/000074_note_embedding_profile_index.up.sql`; `apps/ai-service/app/services/note_indexer.py`; `scripts/atlas/reindex-embeddings.mjs` | P2-11 landing baseline 已落地；生产环境实际 backfill 仍为 release evidence |
| C-13 | 未记录“不同 worktree 迭代”的对照基线 | 同名 review 文件只在当前工作树存在; 但 7 个 worktree 对关键事实收敛一致: `/atlas` 仍是 Phase 0 占位, `source_uri` 仍是全局 UNIQUE, relation evidence 只有表, 当时 `note_embeddings` 有表无 worker/code（后续 PR #745 已修 C-12） | 本文 §16 Cross-Worktree Iteration Log | 新增第二轮 cross-worktree 证据, 说明本 review 不是单一工作树的孤立判断; 也明确它只覆盖高风险事实抽样, 不替代完整代码审计 |

> 其余约 18 项原稿断言经代码核对为 **CONFIRMED**（见 §2.2 与 §17 验证附录）, 保持不变。原计划的**总体方向与四层模型判断是正确的**, 本次修订主要是“纠正事实、补设计冲突、降过激技术提案、把路线图补成闭环、把产品策划书红线补成可验证 gate”。

---

## 1. Executive Assessment

当前 Atlas 的底层方向是对的: 已经把 `Annotation` 与 `KnowledgePoint` 解耦, 用 9 种 `TypedRelation` 替代无类型双链, 把 AI 产物限制在 suggestion inbox（accept 才落库, 且 accept 路径已做**原子事务 + `SELECT FOR UPDATE` + `RowsAffected` 并发守卫**）。这一层比多数简单双链笔记更稳, 不应推翻。

但当前产品停在“schema + MVP 子页 + stub 链路”阶段, 离可用的个人知识图集仍有明显距离:

- 入口页 `/atlas` 仍是 Phase 0 占位（明确写“严禁在此页提交真实用户操作”）, 用户无法从真实 dashboard 进入完整流程。
- Reader 能创建标注, 但正文不显示内嵌高亮（`highlightedMarkdown` 直接返回原文）, 也没有“从标注一键提炼 KP”的主路径。
- Graph 是纯 SVG MVP（`MAX_NODES=200`, 手写力导向）, 缺 zoom/pan/search/local graph/布局持久化/语义筛选/大图渐进加载; 且后端边查询不按节点集过滤。
- AI 端是 deterministic stub（`stub:true` + 关键词/bigram 启发式）, 没有 LiteLLM 真实抽取、结构化校验、批量任务、质量评估、成本预算和去重闭环。
- KP `embedding`/`embedding_dim` 字段已预留但**无 HNSW index、无写入、无召回**, 故无语义搜索 / GraphRAG / AetherHub 图谱问答。
- 权限码（read/write/admin）已存在, 但 list/graph/relation 查询**没有按 owner/author 执行隔离**; 同时 `source_uri` 是全局 UNIQUE —— 这两点共同构成“开放多用户前必须先关上的闸”。
- `atlas_relation_evidence` 表存在, 但无 service/API/UI, 关系“为什么成立”不可追溯。
- 测试覆盖薄: 仅 `pkg/anchoring/markdown_text_test.go`; KP/relation/suggestion 的 handler/service/repo 与前端 smoke 均无专门测试。

产品判断: Atlas 不应继续堆图谱视觉, 应先修“可信闭环”和“使用主链路”。近期目标:

1. 把 Atlas 从占位页改为真实工作台, 并补齐子页导航。
2. 打通 `Note -> Annotation -> KP -> Relation -> Graph -> AetherHub 问答` 主链路（先做到不依赖 AI 也能闭环）。
3. 把 AI 从 stub 升级为 suggestion pipeline（结构化输出 + 校验 + 去重 + 成本）, 仍保持“用户确认才入图”硬约束。
4. 把 KP graph 与既有 KB/RAG/AetherHub 融合, 复用 embedding/vector 基建, 新建 relation 邻域召回。

> 重要前提（原稿未点明）: **Atlas 目前事实上是单管理员工具** —— `content.atlas.*` 仅授予 ADMIN 角色, 真实数据“来自 admin 手动操作”。因此“权限隔离 / source_uri 唯一性”等并非**当前线上正在发生的越权**, 而是 **向非 ADMIN 用户开放前的硬前置**。本计划据此把它们归入一个显式的“Multi-user Gate”, 而不是描述成正在泄漏。

### 1.1 产品策划书对齐审计

本节把本文与 `docs/plan/task-aether-knowledge-system.md` / `docs/plan/knowledge.md` 的核心约束逐条对齐。结论是: **代码层的四层模型方向正确, 但产品阶段状态不能按“已有 MVP 子链路”直接判定为 Phase 通过**。后续迭代必须用策划书的红线与验收项做 gate, 否则会继续出现“技术表已建好、产品主链路不可用”的偏航。

| 策划书约束 | 当前代码/本文判断 | 迭代处理 |
| --- | --- | --- |
| 三条铁律: `Annotation ≠ KP`; 9 种 typed relation; AI 不直写图谱 | schema/service 基本守住; suggestion accept 事务也守住 AI 不直写 | 继续作为所有 Sprint 的 invariant, 写入 P0-08 / §14 |
| R1 锚定召回率 ≥90% 才能稳定进入 KP/图谱层 | Markdown reanchor 有 MVP, 但 PDF A1-1、跨版本 A1-3、综合 A1-4 未被当前代码证据证明 | P0-12 建 gate ledger; P0-08 增 R1 测试语料; P1-01 高亮只对 anchored 结果做强视觉承诺 |
| R2 关系密度 ≥2, 不达标要回到关系建立 UX | 完成日志曾记录测试数据 `1/4=0.25`, 本文也确认关系 UX 和 evidence 缺口 | P1-06 / G1-06 优先做关系向导、健康指标, 不用 AI 自动补关系掩盖 UX |
| R3 AI 接受率 <20% 必须砍掉自动建议 | Landing PR 已把 Atlas AI 从纯 stub 提升为结构化 wrapper + explicit-model live gate; 当前本地 R3 live gate KP accept `100%`, relation accept `50%`, schema/grounding/non-stub/token coverage `100%` | AI 仍只能作为候选建议, 不自动写图谱; 生产 release 前复跑 live gate, 并继续用 P1-12 遥测和 P2-07 eval 监控 prompt/model 质量 |
| R4 性能预算与设计系统 | Atlas 当前仍有 spinner/原生 select; Graph 手写 SVG 只适合小 smoke | P1-08 先修 UI 红线; G1-02 前做渲染库决策和 bundle gate |
| R5 不破坏 notes / KB / blog | Atlas 将接入 notes、KB、AetherHub、blog publishing, 风险从“模块局部”变成“跨域契约” | P0-08 和 Sprint exit 必须包含 notes/KB/blog smoke, 不只跑 Atlas 单元测试 |
| D1 保守编辑器路径 | 当前 Reader 复用 Markdown/CodeMirror 路线, 未引入 Yjs | 保持; 若 R1 不达标才重估 Y.RelativePosition/Tiptap |
| D2 `note_embeddings` worker | 已按 P2-11 恢复 worker: `NoteIndexerService` 写 active profile note chunks, server-go note 变更异步触发, Markdown Carrier recall 复用 `notes://{id}` chunks, `scripts/atlas/reindex-embeddings.mjs` 可补历史 KP/note embeddings | 保留生产实际运行 backfill 的 release evidence 与未来 carrier_embeddings 统一表重估 |
| D3 `note_links` 与 typed relations 并存 | 当前没有把 note_links 迁入 Atlas relation | 保持; 全局搜索/写作集成只做跨模块引用, 不迁移语义 |
| Whole-plan DoD: 用户手册、50 alpha、公开文档同步 | 本文已有 `docs/atlas-user-guide.md` 项; alpha/主力 PKM 属全计划终点, 不应提前伪装成 P1/P2 指标 | S4 以后才评估公开化与 alpha; P0-12 ledger 保留 Whole-plan DoD 状态 |

### 1.2 Phase Gate Audit（不能把 MVP 当作完整阶段通过）

`task-aether-knowledge-system.md` 的完成日志显示 Phase 1/2/3 的 MVP 链路已经落地, 但同一日志也明确留下未完成或未验证项。本文据此把“Phase 状态”重新定义为 **已落地能力 + 未证明 gate** 两层:

| Phase | 策划书目标 | 当前证据 | Gate 结论 |
| --- | --- | --- | --- |
| Phase 0 | 数据骨架与栈决策 | migrations 000062-000063、权限码、决策记录均存在 | 基本通过, 但后续文档要同步 current HEAD 而不是沿用 2026-05-26 快照 |
| Phase 1 | Markdown/PDF 标注稳定, R1 ≥90% | Markdown 标注与 reanchor MVP 存在; PDF viewer/稳定性、A1-1/A1-3/A1-4/A1-8 未完整证明 | 不可宣称 Phase 1 完整通过; 先补 R1 gate evidence |
| Phase 2 | KP + typed relation + 可用图谱, R2 ≥2 | KP/relation CRUD 和 Graph MVP 存在; relation evidence API/UI 缺; 真实 R2 未达可判定状态 | 可称“Phase 2 code skeleton/MVP”, 不可称产品闭环完成 |
| Phase 3 | AI suggestion + hybrid retrieval, R3 质量门 | suggestion inbox/accept/reject 存在; Atlas claim/relation 已有结构化 wrapper、task seed、固定语料 gate 与 explicit-model live R3 evidence; hybrid retrieval/embedding 仍未完成 | AI suggestion 质量门在本 PR 的 scoped baseline 可判定通过; GraphRAG/hybrid retrieval 仍属于后续阶段 |
| Phase 4/5 | 多模态、视频/音频、FSRS、激活与发布 | schema 支持载体类型, 但具体 reader/selector/FSRS/公开流程未实现 | 保持后置; 任何公开知识地图前必须先过 Multi-user Gate |

---

## 2. Current State Evidence

### 2.1 已经做对的部分（CONFIRMED）

| Area | Current state | Evidence |
| --- | --- | --- |
| 四层模型 | `Carrier -> Annotation -> KnowledgePoint -> TypedRelation` 已落库, Atlas 与 KB 分域清晰 | `migrations/000062_atlas_core.up.sql`; `docs/output/11-aether-knowledge-atlas/README.md:11-16` |
| 标注标准 | 服务端要求 ≥3 selector 且必含 TextQuote + TextPosition; 前端按 W3C 生成 3 selector | `annotation_service.go:68-76`; `apps/admin/src/pages/atlas/lib/selectors.ts:49-87` |
| KP 一阶对象 | KP CRUD / evidence link / relation CRUD / graph endpoint 已挂载并带权限中间件 | `kp_handler.go:47-63`; `server.go`（`/atlas` group, `content.atlas.read|write`） |
| Typed relation | 9 种类型在 service + SQL CHECK 双重校验; self-loop 被拒绝（create 与 accept 两处） | `model/knowledge_point.go:40-48`; `kp_service.go:207-209`; `migrations/000062:227-230` |
| AI 不直写 | suggestion accept 才写 KP/Relation, 带 `provenance='ai_suggested'` + `ai_suggestion_id` 回指 | `suggestion_service.go:120-254` |
| Accept 并发安全 | accept 为单一事务 + `SELECT ... FOR UPDATE` + `UPDATE ... WHERE status='pending'` 后查 `RowsAffected` | `suggestion_service.go:151-248` |
| KB/RAG 可复用 | 已有 search/KB profile、per-profile embedding model、pgvector ANN(`<=>`)、HNSW/halfvec/IVFFlat、chunk checkpoint | `vector_store.py`; `kb_recall.py`; `kb_indexer.py` |
| 关系类型来源 | Go / SQL / TS / Python 四处定义**值一致**（虽手工同步, 见 2.2 风险） | `knowledge_point.go:40-48`; `000062:227-230`; `packages/types/src/models/atlas.ts:52-62`; `ai-service/app/api/routes/atlas.py:140-150` |

### 2.2 主要问题证据（含验证结论）

| Problem | Evidence | Impact | 结论 |
| --- | --- | --- | --- |
| Atlas 入口页过期 | `AtlasPage.tsx:1,62,136`（“Phase 0 占位 / 严禁在此页提交真实用户操作”） | 误判模块状态, 找不到真实入口 | CONFIRMED |
| Reader 不内嵌高亮 | `MarkdownReaderPage.tsx:204-211`（`highlightedMarkdown` 返回原文, 注释明言留到 Phase 2） | 标注后正文无视觉反馈 | CONFIRMED |
| Reader 无一键提炼 KP | `MarkdownReaderPage.tsx:89-196`（仅 create/delete/reanchor） | 主链路断裂, KP 创建需绕道 | CONFIRMED |
| KP 详情编辑缺失 | `KnowledgePointPage.tsx:1-10`(头注释声称有编辑/归档/删除) vs `:200-221`(仅只读元信息); service 已有 `updateKnowledgePoint/deleteKnowledgePoint` 但 UI 未调用 | KP 生命周期管理不可用 | CONFIRMED（头注释过期, 能力缺口真实） |
| Graph MVP 过简 | `AtlasGraphPage.tsx:1-5,47`（纯 SVG + 手写力导向, `MAX_NODES=200`, 无 zoom/pan/search/minimap） | 数据稍大不可探索 | CONFIRMED |
| Graph 边查询不按节点集过滤 | handler 取 KP list 后调 `RelationRepo.ListAll(limit)`, 仅 `WHERE deleted=false`, 不按 node ids 过滤 | 大图下边集合与节点集不一致 / 悬挂边 | CONFIRMED |
| AI 仍是 stub | `ai-service/app/api/routes/atlas.py:10-14,72-80,111-115`（`stub:true` + 关键词触发 + bigram Jaccard） | “AI 建图”当前不可用于真实质量 | CONFIRMED |
| 建议可无证据来源（原“demo 污染”更正） | `Create` 不校验 carrier/annotation 至少其一; `000065:45-48` CHECK 对 kp 仅要求 `proposed_title`; 前端有 `createSuggestion` demo 调用 | unbound 建议污染 inbox; demo 入口可进生产 | CORRECTED（见 C-2） |
| Ignore 未在 Create 生效 | `Create`(`suggestion_service.go:71-108`) 无 `IsIgnored`/pending 去重; `Reject:276` 已写指纹, `fingerprintSuggestion:283` 已存在 | 已拒绝建议可重新入 inbox | CONFIRMED（修复更小, 见 C-3） |
| KP embedding 未成闭环 | `000062:175-176`(`embedding vector` + `embedding_dim`), `:212`(HNSW 注明 Phase 3 再建); KP SELECT 列未含 embedding | 无语义搜索 / GraphRAG / 图谱问答 | CONFIRMED |
| 权限隔离未执行 | `KPListFilter.AuthorID` 字段存在但 handler 从不填充; graph 传空 filter; relation list 无 owner 维度 | 一旦给非 ADMIN 授 read 即跨用户可见 | CONFIRMED（权限码已存在, 缺执行, 见 C-1） |
| carrier 唯一性与多用户冲突 | `000066:12-13` `source_uri` 全局 UNIQUE, 无 owner 维度 | 多用户无法各自登记同一来源 | NEW（见 C-4） |
| Relation evidence 未暴露 | `000064:35-47` 建 `atlas_relation_evidence`, 但 repo/service/handler/UI 全无 | 关系不可解释、不可审计 | CONFIRMED |
| 前端控件粗糙 + spinner 红线违规 | 6 处原生 `<select>`(`AtlasGraphPage/KnowledgePointPage/SuggestionsPage`); 5 处 `Loader2 animate-spin`(违反 CLAUDE.md UI 红线) | 与设计系统不一致 + 违红线 | CONFIRMED + NEW（见 C-10） |
| 数据完整性小洞 | `000065:23` `proposed_kp_type` 无 CHECK（非法值 accept 时才暴雷）; `atlas_annotations.carrier_version_id` 无 FK index | 脏建议占位 / re-anchor 查询 seq scan | NEW |
| 测试薄弱 | 仅 `pkg/anchoring/markdown_text_test.go`; KP/relation/suggestion handler/service/repo 与前端 smoke 均缺 | 迭代易回归 | CONFIRMED |
| 产品阶段 gate 证据缺失 | 策划书要求 Phase gate 全绿再前进; 完成日志同时承认 A1 PDF/R1、A2 关系密度、A3 真实质量未验证 | roadmap 若只按“已实现 MVP”推进会偏航 | NEW（见 C-11） |
| D2 note embedding 未闭环 | `note_embeddings` 表和 notes AI UI 存在; landing baseline 已补 `apps/server-go/internal/service/note_indexer_client.go`、`NoteService.ScheduleEmbedding`、`apps/ai-service/app/services/note_indexer.py`、Markdown carrier note recall 与历史 KP/note backfill 命令 | 生产环境仍需运行 backfill 并保存输出才能保证生产召回完整 | CORRECTED（P2-11 baseline） |

---

## 3. 组织框架: 单管理员现状 vs 多用户 Gate

把所有“隐私/隔离/唯一性”问题统一为一个**显式闸门**, 比逐条当成 bug 更正确, 也让优先级更诚实:

- **现状**: `content.atlas.*` 仅授予 ADMIN（`000063:26-31`）, 数据来自单管理员手动操作。故跨用户可见、`source_uri` 全局唯一在**今天不构成线上越权**。
- **Multi-user Gate（开放给任何非 ADMIN 角色前必须全绿）**:
  - P0-03 owner/author 在 list/get/graph/relation 查询中真正执行隔离。
  - P0-11 `source_uri` 唯一性下沉到 `(owner_id, source_uri)` 或显式定义“carrier 跨用户共享”的语义。
  - 标注/KP/relation/suggestion 的 author 归属与可见性回归测试。
- **结论**: 这些项仍是 **P0**（因为它们是“可信”前置）, 但路线图把它们标为“Gate 前必做、Gate 未开前可与单管理员功能并行”, 避免被误读成“线上正在泄漏、需热修”。

---

## 4. Product Benchmark

只抽取与 AetherBlog Atlas 相关的成熟能力, 非泛泛比较。

| Product | Mature capability | What Atlas should learn | Avoid |
| --- | --- | --- | --- |
| Obsidian | Graph view 有全局/局部图、过滤、分组、力参数, local graph 支持深度 | Atlas Graph 必须有 local graph、过滤、分组、搜索、布局参数和交互导航 | 不要做无类型双链花球 |
| Tana | Supertags 把节点变 typed object, fields 提供稳定结构与表格/搜索视图 | KP type 不应只是颜色, 应驱动字段模板、视图、验证、关系建议 | 不要让用户从零维护复杂本体 |
| Readwise Reader | 统一导入文章/PDF/视频/Newsletter, 阅读中 highlight/note, Ghostreader 辅助 | Atlas 需要输入流与阅读场景, AI 应在上下文里产生建议 | 不要让标注成为终点 |
| Zotero | PDF annotation 直接进 note, 自动带回 PDF 页链接与引用 | Evidence 必须能回到来源位置, 关系也要能带引用 | 不要只存文本 quote 而丢出处跳转 |
| NotebookLM | source-grounded chat, sources 转 briefing/audio/mind map, node 可直接提问 | AetherHub 应能对 Atlas 子图提问, 节点成为 query scope | 不要生成无法溯源的回答 |
| Microsoft GraphRAG | Local search 结合 KG + raw chunks, Global search 用 community reports | Atlas 先做 graph recall + local 查询; community/global 留后期 | 不要一开始 port 全量昂贵 pipeline |
| Heptabase | Whiteboards/cards/tags 形成可视化 sense-making, 支持 deeplink 和 AI/MCP 读写 | Atlas 需要可持久化的白板/专题空间, 而非一次性力导向图 | 不要每次布局都随机重排 |
| Anytype | Object types / relations / graph, local-first ownership 强 | KP 应逐步具备 object-like fields 与 relation schema | 不要让关系列表失控或难命名 |
| Mem / AI notes | 低摩擦 capture + AI organize + chat recall | Atlas 接入 AetherHub、移动分享、快速 capture | 不要让 AI 自动写入长期真值 |

结论: Atlas 的差异化不是“再做一个 Obsidian 图”, 而是把 AetherBlog 已有内容、笔记、媒体、KB、Agent、博客发布串成一个**可溯源、可问答、可复习、可发布**的个人知识系统。

---

## 5. Core Product Gaps

### 5.1 主流程不闭环

目标流程:

```
Note / Post / PDF / Web / Video
  -> Reader / Capture
  -> Annotation with stable anchor
  -> Extract KP (manual or AI suggestion)
  -> Add typed relation with evidence
  -> Explore local/global graph
  -> Ask AetherHub with Atlas context
  -> Reuse insights in writing / blog / review
```

当前稳定覆盖（且每段都有缺口）:

```
Markdown note -> Reader -> Annotation -> manual KP API -> manual relation -> small graph MVP
```

缺失最关键两段: (a) Annotation→KP 的产品化提炼入口; (b) Graph/KP→AetherHub/写作/搜索/复习 的激活入口。

### 5.2 图谱是“可视化”而非“认知工具”

当前 Graph 只证明 nodes+edges 可渲染, 还不能回答: 这个 KP 的上下游论证链是什么? 哪些证据支撑这条 relation? 哪些孤立 KP 需补关系? 哪些 hub 是主题、哪些是噪音? 最近 30 天新知识如何与旧知识连接? 写某篇文章应引用哪些 KP? —— 图谱迭代应从“探索任务”倒推, 而非继续美化力导向图。

### 5.3 AI 现在只是链路 demo

`atlas.py` 是 deterministic stub, 适合验证 accept/reject, 不适合评价产品价值。下一阶段把 AI 定位为“建议者”与“解释者”: 对选中 annotation 生成 1-3 个 KP 候选; 对 KP evidence 生成 title/body/type/confidence; 对两个 KP 生成 typed relation + rationale + evidence spans; 对一个 carrier 批量生成建议（按置信度、去重、已忽略指纹入 inbox）。**所有建议必须可预览、可编辑、可拒绝, 不能自动写正式图谱。**

> 技术现实（更正 C-7）: 真实抽取需要在 `llm_router` 之上加一层 **结构化输出（pydantic schema）校验 + 失败重试** wrapper —— 这层目前不存在, 是 P2-01 的前置工作。

### 5.4 与 AetherBlog 结合不足

AetherBlog 已有资产: blog posts + 公开阅读面、admin notes + AI writing、AetherHub Agent、KB/RAG 索引与召回、media library、全局模型路由与定价。Atlas 应成为这些资产之间的“语义层”, 而非 admin 侧孤立模块。

---

## 6. Fix And Iteration Checklist

Priority semantics:

- **P0**: 阻断真实使用、信任、隐私或主链路的修复（含 Multi-user Gate 前置）。
- **P1**: 形成可用闭环与核心差异化的功能。
- **P2**: 增强效率、体验、AI 质量与规模化。
- **P3**: 长期差异化或生态能力。

> 说明: 保留原有 ID 以便追溯历史引用; 新增项使用新编号。每项带 **Depends** 列, §9 traceability 强制每项落到一个 Sprint 或 Backlog。

### P0. Repair Current Product Truth And Safety

| ID | Item | Fix | Acceptance criteria | Depends |
| --- | --- | --- | --- | --- |
| ATLAS-P0-01 | 入口页不再误导 | `/atlas` 改真实 dashboard: 最近 carriers、待处理 suggestions、孤立 KP、最近 relations、快捷入口 | `/atlas` 不再出现 Phase 0 “严禁真实操作”; 能进入 reader/graph/suggestions/KP 列表 | — |
| ATLAS-P0-02 | 主导航补二级入口 | Sidebar `知识图集` 下增 Dashboard/Reader/Graph/Suggestions, 或 dashboard 内清晰 tab | 不靠手输 URL 即可访问所有已实现子页 | P0-01 |
| ATLAS-P0-03 | **执行**权限隔离（权限码已存在） | 复用既有 `content.atlas.read/write/admin`; 在 list/get/graph/relation/suggestion/carrier/annotation 查询按 owner/author 过滤; `content.atlas.admin` 才能跨用户 | 非 admin 只见自己的 Atlas; admin 有显式 owner/scope 切换 | — |
| ATLAS-P0-04 | Graph 边按节点集过滤 | Graph endpoint 先取 node ids, 再 `WHERE from_kp_id = ANY(ids) AND to_kp_id = ANY(ids)` 查 edges | 不返回节点集外/悬挂边; 大图分页下边集合一致 | — |
| ATLAS-P0-05 | 建议必须绑定证据来源（更正自“去 demo 污染”） | `Create` 校验 kp 建议至少绑定 carrier 或 annotation（或显式 `provenance=imported/manual`）; 前端 “demo 抽取” 入口仅 dev 构建可见 | 生产 suggestion 都可溯源; demo 不进生产 UI | — |
| ATLAS-P0-06 | Suggestion ignore 在 Create 生效 | `Create` 前算 `fingerprintSuggestion`（已存在）, 查 `IsIgnored`, 并对 pending 同指纹去重 | 已拒绝/重复建议不再入 inbox | P0-05 |
| ATLAS-P0-07 | Relation evidence API | 为 `atlas_relation_evidence` 加 repo/service/handler 的 create/list/delete; relation 创建可带 evidence annotation ids | 每条 relation 能显示并跳转其 evidence | — |
| ATLAS-P0-08 | 测试补底线 + 红线证据 | Go: relation type/self-loop/link 幂等/graph scoped edges/suggestion accept 并发(验证既有 FOR UPDATE 守卫)/ignore 去重; Frontend: dashboard/suggestions/reader smoke; 加 R1/R2/R3/R4/R5 gate 的最小证据脚本 | `go test ./internal/knowledge/...` 覆盖核心业务; 前端 typecheck 通过; R1/R2/R3/R4/R5 当前状态可被证据表复核 | P0-04,P0-06,P0-07 |
| ATLAS-P0-11 | source_uri 唯一性与多用户对齐（NEW, Gate 前置） | 将 `000066` 的全局 `UNIQUE(source_uri)` 改为 `(owner_id, source_uri)`, 或显式定义 carrier 跨用户共享语义并据此调整隔离 | 多用户可各自登记同一来源, 或明确文档化共享语义 | P0-03 |
| ATLAS-P0-12 | 产品策划书 Phase Gate ledger（NEW） | 建立 `task-aether-knowledge-system.md` 对齐表: 每个 Phase 的“已实现 / 未验证 / 未完成 / 红线状态 / 证据命令”; 修正“Phase MVP done”与“Phase gate passed”的措辞 | 接班者能一眼看出 P1/P2/P3 哪些只是 MVP, 哪些 gate 未证明; 后续不得无证据进入 P4/P5 | P0-08 |

### P1. Complete The Knowledge Creation Loop

| ID | Item | Fix | Acceptance criteria | Depends |
| --- | --- | --- | --- | --- |
| ATLAS-P1-01 | Reader 内嵌高亮 | 在 MarkdownPreview 渲染层按 TextPosition/TextQuote 做 non-destructive overlay | 标注后正文可见高亮; orphan/soft 状态颜色区分; 不破坏 markdown | 依赖锚定可靠性(见 §12 R-1) |
| ATLAS-P1-02 | 标注一键提炼 KP | Reader annotation card 增“提炼为 KP”; 可编辑 title/body/type/status/confidence/evidence role | 从一或多条 annotation 创建 KP, 自动关联 evidence | P0-01 |
| ATLAS-P1-03 | Annotation -> AI suggestion | 对选中 annotation 调 ai-service claim extraction, 写入 suggestion inbox（先可跑 stub, 质量随 P2-01 提升） | 一个选区可生成候选 KP, accept 后回到 KP 详情 | P0-05,P0-06 |
| ATLAS-P1-04 | KP 列表页 | 新增 `/atlas/kps`: 搜索、type/status/provenance/evidence-health 过滤、批量归档 | 不依赖图谱即可管理全部 KP | P0-02 |
| ATLAS-P1-05 | KP 编辑和归档 | KP 详情接通已有 `update/delete` API, 补编辑 title/body/type/status/confidence + 归档/恢复/删除 | KP 生命周期完整, mutation 有 toast 和错误态 | — |
| ATLAS-P1-06 | Relation 创建向导 | 目标 KP 搜索, relation type 带解释, 支持 rationale/body/evidence, 可从两 KP 或 annotation 发起 | 用户能理解 9 种关系, 建立关系时能绑定证据 | P0-07 |
| ATLAS-P1-07 | Atlas 全局搜索 | **Landing baseline 已落地**: keyword KP/Annotation/Carrier 聚合 + type/status/provenance/evidence filters；搜索页默认开启 semantic rerank，server-go 调 ai-service active-profile Atlas recall 后按 scope hydrate KP，并用 `searchScore/searchSource` 标记排序来源 | 从 dashboard 和 Graph 都能搜索定位 KP；`/atlas/search` 可语义重排 KP 结果且 AI 不可用时降级关键词 | P1-04,P2-04 |
| ATLAS-P1-08 | 控件统一 + 骨架屏（含红线合规） | 6 处原生 `<select>` 换成 styled Select/popover; 5 处 `Loader2` spinner 换骨架屏(CLAUDE.md UI 红线) | 下拉/键盘可访问性一致; `pnpm design-system:check` 0 error; 无 spinner | P0-01 |
| ATLAS-P1-09 | AetherHub Atlas scope | Agent chat 增 Atlas scope: selected KP / carrier / graph neighborhood; 回答引用 evidence | 能基于选中 KP 或局部图回答并跳转来源（先图邻域, 语义随 P2-05） | P0-07(evidence) |
| ATLAS-P1-10 | 使用手册 | 写 `docs/atlas-user-guide.md`: note->annotation->KP->relation->graph->AetherHub | 新用户可按手册完成完整闭环 | P1-02,P1-06 |
| ATLAS-P1-12 | Atlas 埋点/分析事件（NEW, 度量前置） | 记录 annotation_created / kp_from_annotation / suggestion_accept|reject / graph_search / aetherhub_atlas_answer(citation) 事件 | §11 指标可被真实计算 | P0-08 |

### P1. Graph UX Upgrade

| ID | Item | Fix | Acceptance criteria | Depends |
| --- | --- | --- | --- | --- |
| ATLAS-G1-01 | Local graph | KP 详情增 local graph tab, 支持 depth 1/2/3 | 从 KP 看上下游, depth 改变即时生效 | P0-04 |
| ATLAS-G1-02 | Zoom/pan/minimap | **Landing baseline 已落地**: `/atlas/graph` 使用自建 SVG viewport transform，支持工具栏放大/缩小/重置、滚轮缩放、拖拽平移、小地图点击定位，并限制 pan/zoom 边界避免图谱被完全拖离视窗 | 200 节点内可在当前 SVG 图上缩放/平移探索；后续若进入千节点级再评估 Sigma/Cytoscape 等渲染库 | 选型见 §13 R-决策 |
| ATLAS-G1-03 | Node/edge inspector | **Evidence-preview baseline 已落地**: 点击 `/atlas/graph` 节点/边打开右侧 inspector，显示元信息、evidence count、首条 scoped evidence quote、carrier/annotation source、degree、relation endpoints/body preview 和跳转动作；`GET /atlas/graph` 同步返回 KP/relation evidence preview maps | 不离开图谱即可理解节点和关系的证据依据；多证据浏览、Reader 跳转与更细 action 后续 polish | G1-02,P0-07 |
| ATLAS-G1-04 | Graph filters | **Landing baseline 已落地**: 时间窗口、provenance、confidence、KP/relation evidence health、orphan/hub filters；Graph API 返回 evidence-count maps 支撑证据健康过滤；图谱页可把当前过滤组合保存为 scope 内 localStorage 预设，并支持套用、刷新后恢复和删除 | 能回答“最近新增/AI 生成/缺证据”等治理问题；多人共享/服务端 filter presets 仍属后续协作 polish | G1-02 |
| ATLAS-G1-05 | Layout persistence | **Landing baseline 已落地**: 图谱页可保存当前可见节点坐标与 viewport 到 scoped localStorage，刷新后恢复布局和视图，也可重置布局 | 当前全局图刷新后可保持保存过的布局和缩放/平移状态；专题白板级布局仍属 A3-06 | G1-02 |
| ATLAS-G1-06 | Graph health metrics | 关系密度、孤立 KP、无 evidence KP/relation、hub 排行 | Dashboard 可见图谱健康状况 | P0-01,P1-12 |

### P2. Real AI And Retrieval

| ID | Item | Fix | Acceptance criteria | Depends |
| --- | --- | --- | --- | --- |
| ATLAS-P2-01 | LiteLLM claim extraction（含结构化 wrapper） | 在 `llm_router` 上建 structured-output(pydantic) 校验 + retry wrapper; 替换 `atlas.py` stub 为 task routing + JSON schema | 输出符合 schema; 校验失败自动重试; tokens/cost 记入 suggestion | C-7 wrapper |
| ATLAS-P2-02 | Batch carrier extraction | **Landing baseline 已落地**: `POST /atlas/carriers/:id/suggestions` 从 Markdown note、PDF/blog_post/web text layer 或 blog_post source 的整篇 rootText 有界抽取 KP suggestions 入 Inbox；Markdown/PDF/Web/Blog Post Reader 与 AI 写作页面新增入口 | note/PDF/blog post/Web carrier 可批量生成候选 KP，AI 产物仍不直写图谱；后台 job、进度和批量任务调度仍属完整 P2-02 后续 | P2-01 |
| ATLAS-P2-03 | Relation suggestion | 给新 KP 推荐 top-N 关系候选, 解释 type 和证据 | 新建 KP 后 inbox 出现可用 relation suggestions | P2-01 |
| ATLAS-P2-04 | KP embedding pipeline | **Landing baseline 已落地**: KP title/body/evidence 写 embedding; `000073` 增加 `embedding_profile_id/model_id/indexed_at` 和 dim bucket HNSW partial index; ai-service 内部 index route + server-go create/update/link/suggestion accept 异步触发; 复用 search profile 抽象 | 新建/更新/接受建议后的 KP 可进入语义召回；历史 KP 仍需 backfill/reindex | — |
| ATLAS-P2-05 | Atlas recall（语义复用 + 图邻域新建, 更正 C-5） | **Landing baseline 已落地**: (a) 复用 `llm_router.embed`+pgvector ANN+active profile 做 KP 语义召回; (b) 新建 relation 邻域召回（recursive CTE 图遍历）; (c) AetherHub 将最后一条 user message 作为 query, 融合 selected KP / semantic KP / Markdown carrier note chunks / evidence / relations；无选中 KP 时发送空 scope 触发自动语义召回；(d) `/atlas/search` 复用该 recall path 做 search-page semantic rerank | AetherHub selected/empty Atlas scope 可召回 KP + evidence + relations; 选中 `notes://{id}` Markdown carrier 时可复用 note chunk embedding; 搜索页可语义重排 KP；community/global GraphRAG 后续推进 | P2-04 |
| ATLAS-P2-07 | Eval harness | 建 claim/relation 建议评测集, 指标 precision/recall/NDCG/human accept rate; 本 PR 先落地固定语料 gate + explicit-model live gate, 后续继续扩展 prompt/model A/B 样本 | 切模型/改 prompt 前后可比较质量; 当前 gate 已能阻断 stub/无凭证伪通过 | P2-01,P1-12 |
| ATLAS-P2-08 | Cost budget | **Landing baseline 已落地**: ai-service `/v1/atlas/claims/preview` 复用 `usage_logger.estimate_tokens` 与 LlmRouter price context 估算单次 carrier extraction 成本；server-go `/atlas/carriers/:id/suggestions/preview` 返回 Reader 可展示的预算结果；生成请求透传 `maxCostUsd`，超阈值时阻止生成 | 用户在 Reader 生成前可看到本次预估费用；缺少全局价格配置会提示；超阈值不会创建建议 | P2-01 |
| ATLAS-P2-10 | 数据完整性硬化（NEW） | `proposed_kp_type` 加 CHECK(或 service 校验); `atlas_annotations.carrier_version_id` 加 partial FK index | 非法 kp_type 在 Create 即拒; re-anchor 查询不走 seq scan | — |
| ATLAS-P2-11 | D2 note_embeddings 策略闭环（NEW） | **Landing baseline 已落地**: `000074` 补 `embedding_dim/model_id/token_count`、profile+chunk 唯一约束与 768/1024/1536/3072 HNSW buckets; ai-service `NoteIndexerService` + `/v1/notes/{id}/index` 写入 active search profile note chunks; server-go note create/update/duplicate/title-summary edits 异步触发; Atlas recall 对 Markdown carrier `notes://{id}` 复用 note chunk context | `note_embeddings` 不再是死表; Atlas 语义召回的数据源、profile、重建策略有测试；历史 notes 回填/重建命令后续补齐 | P2-04 |

### P2. Multimodal Input Expansion

| ID | Item | Fix | Acceptance criteria | Depends |
| --- | --- | --- | --- | --- |
| ATLAS-M2-01 | PDF carrier v1 | PDF.js 文本层 + page rect selector + annotation sidebar | PDF 可标注, annotation 能跳回页码/位置 | P1-01 |
| ATLAS-M2-02 | Blog post carrier | **Reader baseline 已落地**: `blog_post` carrier 使用 `posts://{id}` source_uri, 按 owner/admin scope 读取 posts 表并持久化 text layer；migration `000075` 允许真实 `atlas_carriers.type='blog_post'` 行；AI 写作工作台可打开 `/atlas/reader/blog-post/:carrierId` 标注正文、删除标注、触发 annotation/full-text AI 建议，也可触发预算 preview + carrier KP 抽取 | 草稿/已发布文章可进入 Atlas carrier, 被标注, 并以 pending KP suggestions 进入 Inbox；公开博客知识面板和引用格式仍属后续 | P0-05 |
| ATLAS-M2-03 | Web clip carrier | **Reader baseline 已落地**: `POST /atlas/carriers/web` 保存网页 URL/title/Markdown 正文快照为 owner-scoped `web` carrier, 规范化 http(s) URL, 持久化 text layer；`/atlas` 提供 Web 快照入口并跳转 `/atlas/reader/web/:carrierId`；Web Reader 可标注正文、删除标注、触发 annotation/full-text AI 建议 | Web 正文可进入 Atlas carrier、被标注、并生成 pending KP suggestions；自动抓取/Readability UI 仍属后续 | P1-01 |
| ATLAS-M2-04 | Video/audio transcript carrier | **Manual transcript baseline 已落地**: `POST /atlas/carriers/media-transcript` 校验 media 类型为 video/audio，将手动转录 Markdown 持久化为 text layer；Transcript Reader 可标注 transcript、创建 TextQuote/TextPosition/Fragment selectors、从邻近 `[mm:ss]`/`[hh:mm:ss]` 时间戳生成媒体 `#t=` 跳转，并支持 annotation/full-text AI 建议与预算 preflight | 视频/音频可按手动 transcript 标注与抽 KP；自动 speech-to-text、逐段转录质量评估和更完整播放器联动仍属后续 | M2-03 |
| ATLAS-M2-05 | Media library integration | **PDF + AV transcript baseline 已落地**: 媒体详情页识别 PDF 后提供 `加入 Atlas`、`查看标注`、`抽取知识点`; 识别 video/audio 后提供 `Atlas Transcript` 文本框、`保存转录`、`查看转录`、`抽取知识点`; 两类入口均复用 carrier-level AI suggestion preview/generation 预算预检链路 | 上传 PDF 与手动转录音视频可从媒体库直接进 Atlas carrier、回到 Reader 标注、并生成 pending KP suggestions；图片统一媒体入口仍属后续多模态工作 | M2-01,M2-04 |

### P3. Knowledge Activation And Publishing

| ID | Item | Fix | Acceptance criteria | Depends |
| --- | --- | --- | --- | --- |
| ATLAS-P2-06 | GraphRAG-lite community（降级 P3, 更正 C-6） | **Python worker**（`leidenalg`/`python-louvain`）离线把图载入内存做社区聚类, 写 `kp_clusters` + community summary; 近期 global query 先用 degree/hub 主题分组替代 | Graph dashboard 可看主题社区; AetherHub 可做 global query | P2-04,P2-05 |
| ATLAS-A3-01 | FSRS review | KP/relation 进复习队列, recall card、evidence reveal、difficulty rating | Dashboard 显示今日复习, 复习更新 schedule | P1-05 |
| ATLAS-A3-02 | Writing assistant integration | **Evidence-citation baseline 已落地**: AI writing workspace 以当前标题/摘要/正文调用 `atlasService.search({ semantic:true, scope:'mine' })` 拉取相关 KP；Search KP 结果携带首条可访问 evidence quote；面板可插入内部 `/admin/atlas/kp/:id` 链接，也可插入公开安全的 evidence blockquote citation | 写文章时可复用 scoped Atlas KP 和首条 evidence；多证据选择、自动推荐和写作 agent 综合仍属后续 polish | P2-05 |
| ATLAS-A3-03 | Blog article knowledge panel | 前台文章显示关联 KP / 参考链 / 延伸阅读, 可配置公开范围 | 读者能看到文章背后的知识网络 | A3-04 |
| ATLAS-A3-04 | Public knowledge map | 选择性发布专题子图, 隐藏私有 evidence | AetherBlog 差异化展示能力 | P0-03,P0-11 |
| ATLAS-A3-05 | Export / import | Markdown/JSON/GraphML 导出, Obsidian/Tana/Readwise/Zotero 导入适配 | 用户不被锁定, 迁移成本低 | P1-04 |
| ATLAS-A3-06 | Whiteboard / topic board | KP 放入专题白板, 布局持久化, 支持 sections 和 cards | 类 Heptabase 的 sense-making 工作台 | G1-05 |

---

## 7. AetherBlog Integration Plan

### 7.1 Admin Notes
Current: `/atlas/reader/note/:noteId` 只能通过 URL 进入。
Target: Note detail/editor 增“Open in Atlas Reader”; 选中文本→创建 annotation→提炼 KP / AI 建议; Note 保存后按 carrier hash 触发 annotation migration 并提示迁移结果。

### 7.2 AetherHub Agent
Current: AetherHub 能选 KB, 但 Atlas graph 不参与对话。
Target: chat body 增 `atlasScope`(`kpIds`,`carrierIds`,`neighborhoodDepth`,`includeEvidence`); ai-service 构建 `AtlasContext`（KP 摘要、typed relations、evidence quote、source jump URL）; 回答必须展示 citation: KP id + evidence annotation + carrier source。

### 7.3 Search And Discovery
Current: Blog/Search/KB/Atlas 各自分散。
Target: Admin 全局搜索显示 Posts / Notes / KB chunks / KP / Relations; 前台 SearchPanel 可选是否展示 public KP; Related posts 可用 shared KP / relation path 推荐。

### 7.4 Media And Sources
Current: Carrier schema 支持多类型, 实现主要是 Markdown note。
Target: Media file detail → create carrier; PDF/video/audio/web 统一进 Atlas input stream; 每种 carrier 的 selector 与 jump-back 必须达标, 否则只允许 imported note, 不允许正式 evidence。

### 7.5 Blog Publishing
Current: Atlas admin-only。
Target: 文章编辑可绑定 KP; 文章页显示“知识链路”（本文主张、引用来源、反驳/支持关系）; Public 子图只发布经 review 的 KP, 隐藏 private annotation body。

---

## 8. Recommended Roadmap

> 原则: **所有 P0 进 Sprint 0**（修正原稿遗漏的 P0-02/06/07/11/12）; 每个 checklist ID 都出现在某个 Sprint 或 §10 Backlog; 依赖在前。Duration 假设 1 名工程师, P2 的 AI 质量项含固有不确定性。

### Sprint 0: Stabilize, De-risk, Stop Misleading UX
Duration: 1 周。
- ATLAS-P0-01 dashboard · P0-02 子页导航 · P0-04 graph scoped edges · P0-05 建议证据绑定 + demo 仅 dev · P0-06 ignore 去重 · P0-07 relation evidence API · P0-08 最小测试 + 红线证据 · P0-12 Phase Gate ledger · P2-10 数据完整性硬化。
- **Multi-user Gate（与上面并行, 开放非 ADMIN 前必须绿）**: P0-03 执行隔离 · P0-11 source_uri 对齐。
- Exit: `/atlas` 是真实入口且子页可达; 建议都可溯源、不重复; relation 可挂 evidence; graph 节点边一致; 核心安全有测试; 产品策划书 R1-R5 和 Phase 1-3 状态有 evidence ledger; Gate 项全绿或显式记录“尚未开放非 ADMIN”。

### Sprint 1: Make The Manual Loop Useful
Duration: 1.5-2 周。
- ATLAS-P1-01 内嵌高亮 · P1-02 annotation→KP · P1-04 KP 列表 · P1-05 KP 编辑/归档 · P1-06 relation 向导+evidence · P1-08 控件统一+骨架屏 · P1-12 埋点 · G1-01 local graph。
- Exit: 不用 AI 也能完成完整闭环; 每个 KP 和 relation 都可追溯 evidence; 设计系统 0 error 且无 spinner; 关键事件已埋点。

### Sprint 2: Real AI Suggestion Pipeline
Duration: 2-4 周。
- ATLAS-P2-01 结构化抽取(含 wrapper) · P1-03 annotation→AI suggestion · P2-03 relation suggestion · P2-02 批量抽取 · P2-07 eval harness · P2-08 cost budget。
- Exit: AI 建议有 schema 校验、质量指标、成本与去重; accept rate 可作为产品指标。当前 landing PR 已完成 schema/quality/live accept-rate 的 gate baseline, 批量抽取、成本预览和更大样本 prompt/model A/B 仍按后续路线图推进。

### Sprint 3: Graph Search And AetherHub Integration
Duration: 3-5 周。
- ATLAS-P2-04 KP embedding baseline · P2-05 selected/empty-scope atlas recall baseline · P2-11 D2 note_embeddings 策略闭环 · P1-07 全局搜索语义 rerank baseline · G1-02 zoom/pan/minimap baseline · G1-03 inspector baseline · G1-04 filters + saved filter presets baseline · G1-05 layout persistence baseline · G1-06 health metrics · P1-10 使用手册。
- Exit: 能对某 KP/子图/carrier 提问, 回答带 evidence citation 和跳转; 图谱可交互、可治理、布局稳定。

### Sprint 4: Multimodal And Publishing
Duration: 1-2 月。
- ATLAS-M2-01 PDF · M2-02 blog post carrier baseline · M2-03 web clip Reader baseline · M2-04 video/audio transcript baseline · M2-05 media 集成 · A3-02 writing assistant baseline · A3-03/A3-04 公开知识面板/地图原型(依赖 Gate 已开)。
- Exit: Atlas 从 admin 工具变成 AetherBlog 的内容组织与发布差异化能力。

---

## 9. Traceability Matrix（每个 ID 都有归宿）

| ID | Sprint | ID | Sprint | ID | Sprint |
| --- | --- | --- | --- | --- | --- |
| P0-01 | S0 | P1-05 | S1 | P2-04 | S3 |
| P0-02 | S0 | P1-06 | S1 | P2-05 | S3 |
| P0-03 | S0 (Gate) | P1-07 | S3 | P2-07 | S2 |
| P0-04 | S0 | P1-08 | S1 | P2-08 | S2 |
| P0-05 | S0 | P1-09 | S3 | P2-10 | S0 |
| P0-06 | S0 | P1-10 | S3 | P2-11 | S3 |
| P0-07 | S0 | P1-12 | S1 | M2-01 | S4 |
| P0-08 | S0 | G1-01 | S1 | M2-02 | S4 |
| P0-11 | S0 (Gate) | G1-02 | S3 | M2-03 | S4 |
| P0-12 | S0 | G1-03 | S3 | M2-04 | S4 |
| P1-01 | S1 | G1-04 | S3 | M2-05 | S4 |
| P1-02 | S1 | G1-05 | S3 | A3-02 | S4 |
| P1-03 | S2 | G1-06 | S3 | A3-03 | S4 |
| P1-04 | S1 | P2-01 | S2 | A3-04 | S4 |
| P2-02 | S2 | P2-03 | S2 | | |
| **Backlog / Deferred** | P2-06(community), AV automatic speech-to-text, image carrier, A3-01(FSRS), A3-05(export/import), A3-06(whiteboard) | | | | |

> Backlog 项为显式后移（非遗漏）: 依赖较深、或属长期生态能力, 待 S0-S4 验证产品价值后再排期。

---

## 10. 依赖与排序（关键链路）

```
P0-03 ──┐
P0-11 ──┴─▶ Multi-user Gate ─▶ A3-04 公开地图 ─▶ A3-03 文章知识面板
P0-04 ─▶ G1-01 ─▶ G1-02 ─▶ {G1-03,G1-04,G1-05}
P0-05 ─▶ P0-06 ─▶ P1-03 ─▶ (质量) P2-01
P0-07 ─▶ P1-06 ; P0-07 ─▶ P1-09(evidence 引用)
P2-01(+structured wrapper) ─▶ {P2-02,P2-03,P2-07,P2-08}
P2-04 KP embedding baseline ─▶ P2-05 selected-scope recall baseline ─▶ {P1-09 语义增强, A3-02 writing}
P2-11(D2 note embedding 策略) ─▶ {Markdown Carrier/notes 语义数据源, P2-06 community/global query}
P0-08 测试 ─▶ P0-12 Phase Gate ledger ─▶ 后续 Phase 进入/回退判断
P1-12 埋点 ─▶ §11 指标可计算
```

---

## 11. Metrics For Review（补“如何度量”使退出标准可验证）

| Metric | Definition | Data source / 埋点 | Target after P1 | Target after P2 |
| --- | --- | --- | --- | --- |
| Annotation→KP conversion | KP 化的 annotation / 全部 annotation | P1-12 `kp_from_annotation` 事件 + 固定测试语料(需先建, 见下) | ≥25% (test data) | ≥40% (with AI) |
| R1 anchoring recall | PDF/Markdown 版本迁移后 `anchored` 的 annotation / 全部 annotation | P0-08 固定语料 + A1-1/A1-2/A1-3 脚本; 结果写入 P0-12 ledger | ≥90% | ≥95% 或说明未进入多模态 |
| Relation density | typed relations / active KP | DB 聚合查询 | ≥0.6 | ≥1.2 |
| Evidence coverage | 有 ≥1 evidence 的 KP / active KP（排除显式用户概念） | DB 聚合(annotation_kp_links) | ≥90% | ≥95% |
| Relation evidence coverage | 有 ≥1 evidence 或 rationale 的 relation / active relations | DB 聚合(relation_evidence + rationale) | ≥70% | ≥90% |
| AI suggestion accept rate | accepted / generated | P1-12 `suggestion_accept|reject` 事件 | N/A | KP ≥50%, relation ≥35% |
| Graph exploration success | 用户 ≤30s 找到目标 KP/path | **人工可用性测试协议**(内部 N≥5, 录屏计时) | ≥80% | ≥90% |
| AetherHub grounded answer rate | 带 citation 的 Atlas 回答 / Atlas 回答 | P1-12 `aetherhub_atlas_answer(citation_count)` 事件 | N/A | ≥95% |
| Orphan KP ratio | 无 relation 的 KP / active KP | DB 聚合 | ≤35% | ≤20% |
| R4 performance budget | admin LCP / bundle / Graph 交互帧率 | Playwright trace + build stats + graph fps smoke; 结果写入 P0-12 ledger | LCP ≤2.5s, bundle ≤6MB | Graph 1000 nodes ≥30fps 或局部加载 |
| R5 no-regression gate | notes / KB / blog / AetherHub / Atlas 主路径 smoke | `./start.sh --gateway` 后按 §0.3 边界跑 smoke; CI 可逐步自动化 | 全部通过 | 全部通过 |

> 度量前置（否则退出标准不可验证, 闭环断裂）: (a) **P1-12 埋点**必须先落地; (b) 建一份 **固定测试语料**（≥3 篇代表性 note/post + 1 份 PDF + 1 个版本迁移样本）用于转化率、R1 与 eval; (c) Graph 探索成功率走**人工协议**, 不强行自动化; (d) P0-12 把每次 gate 结果记录成可审计证据, 不允许只写“已通过”。

---

## 12. Risks And Mitigations

| ID | Risk | 影响 | Mitigation |
| --- | --- | --- | --- |
| R-1 | 锚定算法仍不完整（`02-...md` 注明; 近期 commit 仍在改 reanchor/空间对齐） | P1-01 内嵌高亮可能漂移/orphan 误判 | 高亮区分 anchored/soft/orphan 三态视觉; 先对 anchored 渲染, soft/orphan 仅侧栏; 把锚定稳定性纳入 P0-08 测试 |
| R-2 | LLM 抽取质量不稳定 | P1-03/P2-01 产出噪音, accept rate 低 | 结构化 schema + 校验 + 重试; eval harness(P2-07) 卡门槛; 始终人工 accept |
| R-3 | 批量抽取成本失控 | P2-02 烧 token | 已有 Reader preflight cost preview + `maxCostUsd` 阈值拦截；完整后台 job 仍需默认小批量、进度与成本 rollup |
| R-4 | 图渲染选型反复 | G1-* 返工 | §13 列为显式 Open Decision, S3 前定 |
| R-5 | source_uri 全局唯一未对齐即开放多用户 | 跨用户碰撞 / 越权 | P0-11 作为 Gate 前置, 未绿不开放非 ADMIN |
| R-6 | 关系类型四处手工同步漂移 | Go/SQL/TS/Python 校验不一致 | 选定单一来源(建议 TS const 或 SQL)生成其余, 或加跨语言 contract test(见 §13) |
| R-7 | community/Leiden 过早投入 | 高成本低回报 | 降级 Backlog; 近期用 degree/hub 主题分组替代 |
| R-8 | 把 MVP 链路误当 Phase Gate 已通过 | 跳过 R1/R2/R3/R4/R5 证据, 后续功能堆在未证明基础上 | P0-12 gate ledger; Sprint exit 必须引用证据命令/数据 |
| R-9 | `note_embeddings` 继续作为死表/死 UI | Atlas recall 与 notes AI 占位分叉, 后续重复建索引 | 已通过 P2-11 landing baseline 恢复 worker并补 backfill 命令；剩余风险降为生产未执行 backfill |

---

## 13. Open Decisions Requiring Owner Input

1. **图渲染库**: 自建 viewport transform vs 引入 React Flow / Sigma.js / Cytoscape（影响 G1-02..05 工作量与包体积）。
2. **Carrier 归属语义**: carrier 是“每用户私有”还是“跨用户共享、标注按 author 私有”? 直接决定 P0-11 的 `source_uri` 方案。
3. **KP embedding profile**: 本 PR baseline 已决策为复用现有 `search_profiles`，并在 KP 行记录 `embedding_profile_id/model_id/indexed_at`；只有当 Atlas 需要独立重建节奏或独立模型治理时再评估 `atlas_embedding_profiles`。
4. **关系类型单一来源**: 选 TS const / SQL / 还是独立 schema 文件做生成源? 决定 R-6 落地方式。
5. **是否永不引入图数据库**: 维持 Postgres 邻接表(recursive CTE)上限是多少节点/深度? 触及上限时的退路。
6. **多用户开放时间点**: Multi-user Gate 何时开? 影响 P0-03/11 与 A3-03/04 的排期紧迫度。
7. **Phase Gate owner**: P0-12 ledger 由谁维护, 是进入每个 Sprint 的强制 checklist, 还是只在 release 前审计? 建议作为 Sprint exit gate。

---

## 14. Implementation Notes（已按本次评审更正）

- **不要替换四层模型** —— 它是当前设计最强的部分。
- **不要让 AI 直接写 KP/Relation** —— suggestion inbox 是硬不变量（accept 路径已做原子事务 + FOR UPDATE + RowsAffected, 保持之）。
- **不要把 MVP completion 写成 Phase Gate completion** —— `task-aether-knowledge-system.md` 的阶段门槛要求验收全绿、红线未触发、决策闭环; 当前 P1/P2/P3 只能按“已落地 MVP 子链路 + gate 待证明”处理。
- **不要现在就上图数据库** —— PostgreSQL 邻接表 + recursive CTE 足够, 直到 path/community 工作负载真实出现（见 §13 决策 5）。
- **不要先做公开图谱发布** —— 先过 Multi-user Gate（P0-03/11）、private evidence 与 review 流程。
- **召回基建复用要精确（更正 C-5）**: 复用 `llm_router.embed` + pgvector ANN + search profile 抽象做**语义召回**; 但 **relation 邻域召回是新的图遍历组件**（recursive CTE）, 不是 `kb_recall.py` 的 fork。`atlas_recall` = 语义召回(复用) + 图邻域召回(新建) 的融合, 不要笼统说“mirror kb_recall”。
- **结构化抽取需要 wrapper（更正 C-7）**: `llm_router` 不含 schema 校验 + 重试; P2-01 必须先建该 wrapper, 它同时服务 P2-03。
- **community/Leiden 后移（更正 C-6）**: 非 Postgres 原生, 需 Python worker 把图载入内存; 与“暂不做 community 工作负载”一致 —— 归 Backlog, 近期 global query 用 degree/hub 主题分组 + 预计算邻域。
- **关系类型单一来源**: 当前 Go/SQL/TS/Python 四处值一致但手工同步; 用生成或 contract test 固化（§13 决策 4）。
- **D2 已闭合为 landing baseline**: `note_embeddings` 不再作为死表保留；新建/更新 notes 会异步写 active search profile note chunks，Markdown Carrier recall 可复用 `notes://{id}` chunks，历史 KP/note 可通过 `scripts/atlas/reindex-embeddings.mjs` 补 missing/stale embeddings。后续只保留生产 backfill 运行证据与是否升级统一 `carrier_embeddings` 表的长期评估。
- **图渲染**: 小 smoke 用现有 SVG MVP 可接受; 交互密集的长期探索建议用成熟渲染器（§13 决策 1）。
- **红线合规**: 任何 Atlas UI 工作遵守 CLAUDE.md —— 无 spinner(用骨架屏)、不发明颜色、用共享 Select/Modal、`pnpm design-system:check` 保持 0 error; 新增 API/migration 同步 `docs/architecture.md` + `.claude/docs/`。

---

## 15. External Sources Checked

- Obsidian Graph View: https://obsidian.md/help/Plugins/Graph%2Bview
- Tana Supertags: https://tana.inc/docs/supertags
- Tana Fields: https://tana.inc/docs/fields
- Readwise Reader: https://docs.readwise.io/reader/docs
- Zotero PDF Reader and Note Editor: https://www.zotero.org/support/pdf_reader
- NotebookLM overview: https://support.google.com/notebooklm/answer/16164461?hl=en
- NotebookLM Mind Maps: https://support.google.com/notebooklm/answer/16212283?hl=en-GB
- Microsoft GraphRAG Query Engine: https://microsoft.github.io/graphrag/query/overview/
- Heptabase Deeplinks: https://support.heptabase.com/en/articles/11176386-how-to-use-deeplinks-in-heptabase
- Heptabase MCP: https://support.heptabase.com/en/articles/12679581-how-to-use-heptabase-mcp
- Anytype Types: https://doc.anytype.io/anytype-docs/getting-started/types
- W3C Web Annotation Data Model: https://www.w3.org/TR/annotation-model/

---

## 16. Cross-Worktree Iteration Log（第二轮, 2026-05-31）

本轮按“不同 worktree 上迭代”的要求, 对当时当前工作树和 6 个相关工作树做了抽样对照。为避免把本机绝对路径写进计划文档, 下表只保留 worktree 语义标签与 commit/ref。结论是: **同名 review 文件没有可合并的其他版本, 但关键 Atlas 缺口在多个 worktree 中一致出现**。因此 C-4/C-11/C-12 等判断不是当前未跟踪文档的孤立推断。2026-05-31 后续 landing baseline 已在 PR #745 当前分支修复 C-12；下表保留为当时的横向基线证据。

| Worktree / branch label | Ref | 同名 review 文件 | Atlas 入口页 | Schema / evidence 抽样 | `note_embeddings` 抽样 | 对本文影响 |
| --- | --- | --- | --- | --- | --- | --- |
| current `hotfix/types-tsconfig-self-contained` | `a222c7e7` | 存在 | Phase 0 占位 | `source_uri` 全局 UNIQUE; `atlas_relation_evidence` 仅建表 | 当时表存在但 server-go / ai-service 无 worker/code；PR #745 后续已补 P2-11 baseline | 本文主基线；C-12 已在后续补丁中 corrected |
| `codex/docs-current-capability-baseline` | `00bd0f4f` | 不存在 | Phase 0 占位 | 同 current | 同 current | 支持“当前能力文档不能当完成证明” |
| `codex/more-functional-audit` | `23cbc71e` | 不存在 | Phase 0 占位 | 同 current | 同 current | 支持高风险功能缺口仍未闭环 |
| `codex/recent-feature-audit-fixes` | `426295fd` | 不存在 | Phase 0 占位 | 同 current | 同 current | 支持近期修复未覆盖 Atlas 主缺口 |
| `codex/reconcile-local-main-20260528` | `b39b9273` | 不存在 | Phase 0 占位 | 同 current | 同 current | 支持与本地 main 对账时仍需保留这些 gate |
| `main` / v57 root fix worktree | `4a6a415e` | 不存在 | Phase 0 占位 | 同 current | 同 current | 支持 main-line 抽样同样存在缺口 |
| detached audit worktree | `4e42227d` | 不存在 | Phase 0 占位 | 同 current | 同 current | 支持独立 detached 基线同样收敛 |

边界说明:

- 本轮 cross-worktree 扫描只核验了本文最高风险的事实簇: 入口页状态、carrier 唯一性、多用户 gate、relation evidence 实现状态、D2 `note_embeddings` 策略、AI stub 与 Atlas UI 红线抽样。
- 它不能替代完整逐文件审计, 也不证明其他 worktree 没有局部修复; 但足够证明本文新增的产品策划书 gate 与 D2 债务不是某个分支特有问题。
- 因其他 worktree 没有同名 review 文档, 本轮没有进行文档三方合并; 只把一致的事实证据追加为 C-13 与本节迭代记录。

## 17. Verification Appendix（本次评审的代码证据基线, 2026-05-30 / cross-worktree refreshed 2026-05-31）

> 所有结论基于以下文件的直接核对。CORRECTED = 推翻/重写了原稿断言; NEW = 原稿未发现; 其余为 CONFIRMED。

| 主题 | 证据 | 结论 |
| --- | --- | --- |
| 入口页 Phase 0 占位 | `apps/admin/src/pages/atlas/AtlasPage.tsx:1,62,136` | CONFIRMED |
| Reader 无内嵌高亮 | `apps/admin/src/pages/atlas/MarkdownReaderPage.tsx:204-211,270` | CONFIRMED |
| Reader 无提炼 KP | `MarkdownReaderPage.tsx:89-196,312-329` | CONFIRMED |
| 标注 ≥3 selector | `apps/server-go/internal/knowledge/service/annotation_service.go:68-76`; `lib/selectors.ts:49-87` | CONFIRMED |
| KP 详情头注释过期/无编辑 UI | `KnowledgePointPage.tsx:1-10` vs `:200-221`; `atlasService.ts`(update/delete 未调用) | CONFIRMED |
| Graph SVG MVP / MAX_NODES=200 | `AtlasGraphPage.tsx:1-5,47,322-375` | CONFIRMED |
| Graph 边不按节点集过滤 | `kp_handler.go`(Graph 调 `rel.ListAll(limit)`); `relation_repo.go`(`WHERE deleted=false` only) | CONFIRMED |
| 权限隔离未执行 | `kp_repo.go`(`KPListFilter.AuthorID` 存在); `kp_handler.go`(ListKP/Graph 不填 AuthorID) | CONFIRMED |
| `content.atlas.admin` 已存在 | `migrations/000063_atlas_permissions.up.sql:17-18,26-31` | **CORRECTED (C-1)** |
| 建议可 unbound / 无 demo seeding | `suggestion_service.go:71-108`; `migrations/000065:45-48`(kp 仅需 title); `atlasService.ts` createSuggestion | **CORRECTED (C-2)** |
| ignore 仅 reject 写、create 不查 | `suggestion_service.go:71-108`(无 IsIgnored), `:276`(Reject 写), `:283-306`(fingerprint 已存在) | CONFIRMED + **CORRECTED 工作量 (C-3)** |
| source_uri 全局 UNIQUE 冲突多用户 | `migrations/000066_atlas_carrier_unique_source_uri.up.sql:12-13` | **NEW (C-4)** |
| relation evidence 表无实现 | `migrations/000064_atlas_kp_links.up.sql:35-47`; repo/service/handler 全无 | CONFIRMED |
| KP embedding 预留无索引 | `migrations/000062:175-176,212` | CONFIRMED |
| 9 关系类型 + self-loop | `model/knowledge_point.go:40-48`; `kp_service.go:207-209`; `000062:227-230` | CONFIRMED |
| accept 并发安全(已实现) | `suggestion_service.go:151-248` | CONFIRMED(原稿未点明已实现) |
| AI 是 stub | `ai-service/app/api/routes/atlas.py:10-14,72-80,111-115` | CONFIRMED |
| llm_router 无结构化校验/重试 | `ai-service/app/services/llm_router.py`(task 路由 + 成本, 无 schema 环) | **CORRECTED (C-7)** |
| kb_recall 仅向量单向召回 | `ai-service/app/services/kb_recall.py`; `vector_store.py` | **CORRECTED (C-5)** |
| 关系类型四处手工同步 | `knowledge_point.go:40-48`; `000062:227-230`; `atlas.ts:52-62`; `atlas.py:140-150` | CONFIRMED |
| 数据完整性小洞 | `000065:23`(kp_type 无 CHECK); `atlas_annotations.carrier_version_id` 无 index | **NEW** |
| spinner 红线违规 | `AtlasPage.tsx:159`; `MarkdownReaderPage.tsx:216`; `AtlasGraphPage.tsx:218`; `SuggestionsPage.tsx:161`; `KnowledgePointPage.tsx:185` | **NEW (C-10)** |
| 测试仅 anchoring | `internal/knowledge/pkg/anchoring/markdown_text_test.go`(唯一) | CONFIRMED |
| 子页导航单入口 | `apps/admin/src/App.tsx`(atlas 路由); `Sidebar.tsx`(仅 `/atlas` 一项) | CONFIRMED |
| 产品策划书 gate 未完整证明 | `docs/plan/task-aether-knowledge-system.md` 明确 phase gate; 完成日志保留 A1/A2/A3 未验证项 | **NEW (C-11)** |
| D2 note_embeddings worker 未闭环 | `000054` 建基础表; `000074` 补 profile/dim/model/token + HNSW; server-go note index client/service trigger + ai-service note indexer/route + Atlas note recall + historical backfill command 已落地 | **CORRECTED (P2-11 baseline)** |
| 跨 worktree 高风险事实收敛 | 7 个 worktree 抽样: review 文件仅 current 存在; Phase 0 入口、全局 `source_uri`、relation evidence 仅表、当时 `note_embeddings` 无 worker/code 均一致；PR #745 后续已修 C-12 | **NEW (C-13), C-12 now corrected** |
