# Changelog

All notable changes to AetherBlog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — Aether Codex 设计系统

### Aether Knowledge (Atlas) Phase 3 MVP — AI 建议 Inbox + ai-service stub (2026-05-26, branch feat/knowledge-base)

按 `docs/plan/task-aether-knowledge-system.md` Phase 3 MVP 落地: 红线 C3-1（AI 产出永远先入 inbox，不直接落 KP/Relation 表）+ 用户 accept 链路 + ai-service 启发式 stub。

**Added — Migration:**
- `000065_atlas_ai_suggestions` —— `atlas_ai_suggestions`（待用户处理的 KP/relation 候选，含 model/token/cost + status enum）+ `atlas_ignored_suggestions`（用户拒绝过的指纹）。CHECK 强制 kind=kp 时 proposed_title NOT NULL，kind=relation 时 from/to/type NOT NULL。

**Added — Backend (Go):**
- `internal/knowledge/model/ai_suggestion.go` — `AISuggestion` 数据模型
- `internal/knowledge/repository/suggestion_repo.go` — `SuggestionRepo`: Create / FindByID / List(filter) / MarkResolved / AddIgnored / IsIgnored
- `internal/knowledge/service/suggestion_service.go` — `AISuggestionService`: Create + Accept（自动建 KP/Relation 并打 provenance=ai_suggested + ai_suggestion_id 回指）+ Reject（写入 ignored 列表 + SHA256 指纹）
- `internal/knowledge/dto/atlas_ai_dto.go` — `CreateSuggestionRequest` / `SuggestionResponse`
- `internal/knowledge/handler/suggestion_handler.go` — REST: POST `/suggestions` + GET `/suggestions` (kind/status/carrierId 过滤) + GET/`/accept`/`/reject` `/suggestions/:id`
- `internal/knowledge/service/kp_service.go` — C2-2 校验松绑: `ai_suggested + ai_suggestion_id` 视为审计闭环（不强制 evidence 标注），让 AI accept 路径可通

**Added — AI Service (Python):**
- `app/api/routes/atlas.py` —
  - `POST /v1/atlas/claims/extract` — 启发式抽取（中文标点切句 + 7 种关键词 → kp_type）；返回 `ClaimCandidate[]` 含 confidence/rationale/tokens
  - `POST /v1/atlas/relations/suggest` — 启发式建议（反驳/支持/因果关键词 + 双字符 bigram Jaccard 相似度 → 9 种 typed relation 中选一）
  - `GET /v1/atlas/health` — 含 `phase=3, stub=true, relation_types=9`
- `app/api/router.py` — include atlas.router
- **stub 标记**: 所有响应含 `stub: true`，Phase 3 后期换 LiteLLM 时改为 false 并接 deps.get_llm_router()

**Added — Admin Frontend:**
- `apps/admin/src/pages/atlas/SuggestionsPage.tsx` — `/atlas/suggestions`: Inbox 列表 + 状态/种类过滤 + 卡片 UI（含 confidence/cost/model_id 元数据）+ accept/reject 按钮 + P3-DEMO 一键创建样例（用于无 LLM 链路验证）
- `apps/admin/src/services/atlasService.ts` — 加 `listSuggestions / getSuggestion / createSuggestion / acceptSuggestion / rejectSuggestion` + `AtlasSuggestion` 类型
- `apps/admin/src/App.tsx` — 加 `/atlas/suggestions` lazy 路由

**Verified — Acceptance:**
- A3 E2E backend: KP 建议 #1 accept → KP #5 (provenance=ai_suggested, aiSuggestionId=1)。Relation 建议 #2 accept → relation #2。Reject 建议 #3 → atlas_ignored_suggestions 写入一行。
- 拒绝路径: bad relation_type 400，已 accepted 二次 accept 400。
- ai-service: `/v1/atlas/health` 200，claims/extract 与 relations/suggest 返回结构化候选含 rationale。
- 现状无回归: notes/KB/posts/atlas-health/atlas-graph/atlas-suggestions 全 200。
- 性能 + 设计系统: 0 error / 337 warnings / 2255 info（Phase 0-2 同水位），admin build 23.41s。

**Red Lines 持续遵守:**
- C3-1 ✓ 所有 AI 产出先入 inbox，accept 才落 KP/Relation
- C3-2 ✓ 接受时 ai_suggestion_id 回指源建议，可一键回滚
- C3-3 stub 阶段无云端 API 调用 ✓（Phase 3 后期切 LiteLLM 时默认本地优先）

**Phase 4/5 范围说明**: 本 session 不落地。理由: P4 视频/音频依赖 WhisperX GPU + 模型权重，无法在 sandbox 验证；P4 PDF 完整 pdf.js 抽取是独立工作量；P5 FSRS 间隔重复需真用户用半年才能度量留存。**脚手架已就绪**: Carrier 抽象已支持全 7 种 type，权限/路由/UI 框架完全可扩展——Phase 4 任一子任务只需新增 `internal/knowledge/service/XxxCarrierService.go` 并挂到 atlas group 即可。

### Aether Knowledge (Atlas) Phase 2 MVP — 知识点与有类型关系 (2026-05-26, branch feat/knowledge-base)

按 `docs/plan/task-aether-knowledge-system.md` Phase 2 MVP 落地: 知识点作为一阶公民 + 9 种 typed relation + 双向投影 + 图谱视图 v1。**纯加法 / 0 regression**——`notes` / `KnowledgeBase` / `blog` 等现有路径未受影响；设计系统 `0 error` 红线持续保持。

**Added — Migration:**
- `000064_atlas_kp_links` —— 衍生表 `atlas_annotation_kp_links`（多对多: annotation ↔ KP, role enum）+ `atlas_relation_evidence`（多对多: relation ↔ annotation）+ 给 `atlas_knowledge_points.uuid` 加 `DEFAULT gen_random_uuid()`（避免引 google/uuid Go 依赖）

**Added — Backend (Go):**
- `internal/knowledge/repository/kp_repo.go` — `KPRepo`: Create / FindByID / List(filter) / UpdatePartial / SoftDelete / LinkAnnotation(s) / ListEvidenceAnnotations / ListKPsForAnnotation / CreateAndLinkInTx（事务原子创建+关联）
- `internal/knowledge/repository/relation_repo.go` — `RelationRepo`: Create / FindByID / ListForKP(in/out/all) / ListAll / SoftDelete
- `internal/knowledge/service/kp_service.go` — `KnowledgePointService` / `RelationService` 编排，含 **C2-1 9 种关系严格白名单 + C2-2 evidence 校验 + C2-4 不自环**
- `internal/knowledge/dto/atlas_kp_dto.go` — `CreateKnowledgePointRequest` / `UpdateKnowledgePointRequest` / `LinkAnnotationRequest` / `CreateRelationRequest` / `KnowledgePointResponse` / `TypedRelationResponse` / `GraphResponse`
- `internal/knowledge/handler/kp_handler.go` — REST:
  - `POST   /knowledge-points` + `GET/PATCH/DELETE /knowledge-points/:id`
  - `GET    /knowledge-points` (type / status / keyword 筛选)
  - `POST   /knowledge-points/:id/annotations`（挂 evidence）
  - `GET    /knowledge-points/:id/evidence`
  - `GET    /knowledge-points/:id/relations`（dir=in|out|all）
  - `GET    /annotations/:id/knowledge-points`（双向投影）
  - `POST   /relations` + `GET/DELETE /relations/:id`
  - `GET    /graph`（nodes + edges，含 limit）
- `internal/knowledge/model/knowledge_point.go` — `KPColumns` 常量（显式 SELECT 列表跳过 embedding 列，避开 pgvector marshalling）
- `internal/server/server.go` — 新增 KP/Relation 子域装配，挂到既有 `/atlas/*` 权限闸下

**Added — Shared Types:**
- `packages/types/src/models/atlas.ts` — 已含 `AtlasKnowledgePoint / AtlasTypedRelation / AtlasRelationType / ATLAS_RELATION_TYPES` 常量（Phase 0 即就位，Phase 2 在 admin 与服务中使用）

**Added — Admin Frontend:**
- `apps/admin/src/pages/atlas/KnowledgePointPage.tsx` — `/atlas/kp/:id`: 元信息卡 + Markdown body + Evidence 列表（含跳 Reader）+ 关系列表（按类型着色 + 强度 + 一键删除）+ 添加关系表单（type 下拉 + 目标 KP 下拉）
- `apps/admin/src/pages/atlas/AtlasGraphPage.tsx` — `/atlas/graph`: 纯 SVG 力导向（200 迭代 Verlet 简化）+ 三种过滤（KP type / relation type / 折叠 hub > 20 入度）+ 6.7KB chunk
- `apps/admin/src/services/atlasService.ts` — 加 `listKnowledgePoints / get/create/update/deleteKnowledgePoint / linkAnnotationToKP / listEvidence / listKPsForAnnotation / listKPRelations / createRelation / deleteRelation / getGraph`
- `apps/admin/src/App.tsx` — 加 `/atlas/kp/:id` + `/atlas/graph` 路由

**Verified — Acceptance:**
- A2-1 KP 抽离闭环: KP 4 由 3 条 evidence (annotation 3/4/5) 创建；反向投影 GET /annotations/3/knowledge-points 返回 `[4]`。
- A2-2 关系建立: cites 3→4 创建成功；bad_type 与 self-loop 均 400。
- A2-3 双向投影: API 两端均可达；UI 在 KP 详情页 evidence section 渲染。
- A2-4 图谱可用性: AtlasGraphPage 6.7KB chunk 入构建；纯 SVG + arrow marker + 力导向。
- A2-5 R2 关系密度: 1 关系 / 4 KP = 0.25（初始数据，非用户场景；红线在用户真实数据上度量）
- A2-6 现状无回归: notes/KB/posts/public 全 200。
- A2-7 性能: `pnpm typecheck` 0 error；`pnpm design-system:check` 仍 `0 error / 337 warnings / 2255 info`；admin build 30.78s 通过。

**D1 决策状态**: 维持保守（CodeMirror 单轨 + W3C 多选择器）。Phase 2 未引入 Tiptap/Yjs，验证了"无 CRDT 也可上线知识点 + 关系"的可行性。

### Aether Knowledge (Atlas) Phase 1 MVP — 标注层 (2026-05-26, branch feat/knowledge-base)

按 `docs/plan/task-aether-knowledge-system.md` Phase 1 MVP 落地。9/12 个任务完成 + 2 个部分完成。**纯加法**——`notes` / `KnowledgeBase` / `blog` / `aetherhub` 等现有路径未受任何回归（A1-5 已 spot-check）。Phase 1 后期 task：完整 pdf.js 文本抽取 + Reader、Playwright 自动化、PDF E2E + A1-1/3/4 红线复测。

**Added — Backend (Go):**
- `internal/knowledge/repository/carrier_repo.go` — `CarrierRepo`: FindBySourceURI / FindByID / Create（事务原子创建 carrier + v1 version）/ UpdateContent（新增 version + 更新 hash）
- `internal/knowledge/repository/annotation_repo.go` — `AnnotationRepo`: Create / FindByID / FindByCarrier / UpdatePartial (动态 SQL) / SoftDelete
- `internal/knowledge/service/markdown_carrier.go` — `MarkdownCarrierService`: `GetOrCreateForNote` 幂等懒创建；内容指纹变化触发 `CarrierVersioningService.MigrateAnnotations`
- `internal/knowledge/service/note_reader_adapter.go` — 把全局 `repository.NoteRepo` 适配为 Atlas 子域期望的 `NoteReader` 接口（单向依赖）
- `internal/knowledge/service/pdf_carrier.go` — `PdfCarrierService` 骨架（GetOrCreateForMediaFile + source_uri media://{id}），实际 pdf.js 抽取留待 Phase 1 后期
- `internal/knowledge/service/annotation_service.go` — `AnnotationService`: Create/Get/ListByCarrier/Update/Delete，**强制 ≥3 selector + TextQuote + TextPosition 双选**（红线 C1-1）
- `internal/knowledge/service/anchoring.go` — `CarrierVersioningService.MigrateAnnotations`: 4 档锚定 (位置 → exact → prefix 邻域 → 滑窗 Levenshtein) 写回 anchor_state / anchor_score
- `internal/knowledge/dto/atlas_dto.go` — `EnsureMarkdownCarrierRequest` / `CreateAnnotationRequest` / `UpdateAnnotationRequest` / `CarrierResponse` / `AnnotationResponse`
- `internal/knowledge/handler/carrier_handler.go` — POST `/atlas/carriers/markdown` + GET `/atlas/carriers/:id`
- `internal/knowledge/handler/annotation_handler.go` — POST `/atlas/annotations` + GET/PATCH/DELETE `/atlas/annotations/:id` + GET `/atlas/carriers/:id/annotations`
- `internal/knowledge/handler/atlas_handler.go` — `MountAdmin(g, subs...)` 支持子 handler 注入
- `internal/server/server.go` — `/atlas/*` 装配链路 + 强制 `content.atlas.read` 权限闸（`RequirePermission(accessSvc, "content.atlas.read")`）

**Added — Admin Frontend:**
- `apps/admin/src/pages/atlas/lib/selectors.ts` — `buildSelectorsFromTextRange` (rootText + offset) + `buildSelectorsFromDomRange` (DOM Range + CssSelector 路径) + `validateSelectors` 客户端兜底
- `apps/admin/src/pages/atlas/lib/anchoring.ts` — TS 端鲁棒锚定算法（与 Go 服务端语义对齐）
- `apps/admin/src/pages/atlas/MarkdownReaderPage.tsx` — `/atlas/reader/note/:noteId`：MarkdownPreview + 标注侧栏 + 三态徽章（anchored 绿 / soft 黄 / orphan 红）+ 「标注选区」按钮 + 「重新对齐」按钮 + 软删
- `apps/admin/src/services/atlasService.ts` — REST 客户端扩展：`ensureMarkdownCarrier` / `getCarrier` / `listAnnotations` / `createAnnotation` / `getAnnotation` / `updateAnnotation` / `deleteAnnotation`
- `apps/admin/src/App.tsx` — 新增 lazy 路由 `/atlas/reader/note/:noteId`
- `apps/admin/src/components/layout/Sidebar.tsx` — INTELLIGENCE 板块新增「知识图集」入口（lucide `Compass`）

**Verified — Acceptance:**
- A1-2 MD 编辑迁移: 在 carrier 1 上建 4 条标注后修改 note 内容（前置一整段导言）；重新触发管线后 atlas_carrier_versions 增 v2 (reason=user_edit)，4 条标注全部仍 `anchored` (score=1.00)，通过档2 exact substring 命中。
- A1-5 现状无回归: `/admin/notes` `/admin/note-folders` `/admin/kbs` `/admin/posts` `/api/v1/public/posts` 全部 HTTP 200。
- A1-6 性能预算: 设计系统 0 errors / 337 warnings / 2255 info（Phase 0 同水位）；`pnpm typecheck` 全绿。
- A1-1 / A1-3 / A1-4 / A1-8: 留待 Phase 1 后期 pdf.js Reader 落地后跑（红线 R1 = 90% 召回率仍需达成）。

**D1 决策状态**: 保守路径维持（仅 W3C 多选择器 + Go/TS 自实现 Levenshtein 滑窗）。`diff-match-patch` 真库替换 + Y.RelativePosition 双轨延后至 Phase 1 后期 R1 红线复测。

### Aether Knowledge (Atlas) Phase 0 — 数据骨架与栈决策落地 (2026-05-26, branch feat/knowledge-base)

按 `docs/plan/task-aether-knowledge-system.md` Phase 0 全部 9 个任务完成，所有验收项 A0-1..A0-6 全绿。**纯加法迭代**——`notes` / `KnowledgeBase` / `blog` 任何现有路径未受影响。

**Added — Migrations:**
- `000062_atlas_core` — 5 张核心表 + 索引 + 注释。`atlas_carriers / atlas_carrier_versions / atlas_annotations / atlas_knowledge_points / atlas_typed_relations`，含 W3C 多选择器 JSONB + Y.RelativePosition BYTEA 字段 + pgvector embedding 列（dim 不锁，HNSW 索引 Phase 3 创建）+ 9 种 typed relation 严格 CHECK。
- `000063_atlas_permissions` — seed `content.atlas.read / write / admin` 3 个权限码，已绑定 ADMIN 角色。

**Added — Backend (Go):**
- `internal/knowledge/model/` — `Carrier / CarrierVersion / Annotation / KnowledgePoint / TypedRelation` 数据模型 + `RelationTypeSet` 9 种关系白名单。
- `internal/knowledge/repository/atlas_repo.go` — Phase 0 骨架（Ping 健康自检）；CRUD 由 Phase 1 子 Repo 填充。
- `internal/knowledge/service/atlas_service.go` — `HealthCheck` 入口。
- `internal/knowledge/handler/atlas_handler.go` — `MountAdmin` + `GET /atlas/health`。
- `internal/server/server.go` — 挂载 `admin.Group("/atlas")`，引用 `atlasrepo / atlassvc / atlashandler`。
- `internal/knowledge/pkg/anchoring/doc.go` — Phase 1 锚定算法占位包。

**Added — Admin Frontend:**
- `pages/atlas/AtlasPage.tsx` — Atlas 模块入口（占位）：健康自检卡 + Schema 基线卡 + 权限卡 + 5 阶段路线图 + Phase 0 占位提示。
- `services/atlasService.ts` — REST 客户端（Phase 0 仅 `health()`）。
- `App.tsx` — 新增 lazy 路由 `/atlas`。

**Added — Shared Types:**
- `packages/types/src/models/atlas.ts` — `AtlasCarrier / AtlasAnnotation / AtlasKnowledgePoint / AtlasTypedRelation` + W3C selector 联合类型 + 9 种 `AtlasRelationType` 常量。
- `packages/types/src/models/index.ts` — 加 `export * from './atlas'`。

**Added — Docs & Plan:**
- `docs/plan/task-knowledge-decisions.md` V1.1 — D1/D2/D3 全保守路径定稿 + Spike-1/Spike-2 结论。
- `docs/plan/task-aether-knowledge-system.md` §7 完成日志 / §6 任务登记表 全部 P0 任务标 done。
- `scripts/atlas/anchoring-spike.mjs` — Phase 0 中文锚定鲁棒性 spike，3 个编辑强度档（light/medium/heavy）+ JSON 输出。

**Verified — Acceptance:**
- A0-1 migrations 双向: 已实测 down 2 → up 全程 dirty=false；`atlas_*` 5 张表 + 3 permission rows 出现/消失符合预期。
- A0-2 `/api/v1/admin/atlas/health` 200 OK 直连 `:8080` + 网关 `:7899` 双通；含 `{ ok:true, module:'atlas', phase:0 }` payload。
- A0-3 `/admin/atlas` SPA 渲染；admin 构建产物含 `AtlasPage-DaTtokZL.js` chunk。
- A0-4 `pnpm typecheck` 全绿；`pnpm design-system:check` 保持 **0 error**（337 warnings / 2251 info 均为既有项目代码，未新增）。
- A0-5 spike 数字: light=80.61% / medium=10.37% / heavy=0.43%（caveat：脚本使用简化 Levenshtein 兜底，下界值；Phase 1 必须用真 diff-match-patch 复测）。
- A0-6 本 CHANGELOG 条目 + 手册 §7 完成日志 同步完成。

**D1 决策**: 保守 — CodeMirror 单轨保留，新模块 Phase 1 用纯 W3C 多选择器 + 真 diff-match-patch + 向量回退。Tiptap+Yjs 推迟到 Phase 2 末复盘 R1 后再评估。

### Aether Knowledge 多模态知识系统落地手册 V1.0 + V1.0.1 补丁 (2026-05-26, branch feat/knowledge-base)

把 `docs/plan/knowledge.md`（支持标注迁移与知识图谱涌现的多模态个人知识系统技术调研报告）落地为可执行计划，沉淀为独立路线图手册。**仅为规划文档，未触达任何代码 / schema / API / UI**。

**Added — Plan:**
- `docs/plan/task-aether-knowledge-system.md` — 5 阶段（约 40-52 周）落地路线图：
  - §0 北极星（三条铁律 + 五条红线 + 与既有 notes / KB / ai-service / blog 的边界 + D1/D2/D3 决策项）
  - §1 本地开发环境基线（含 §1.0 基线快照：feat/knowledge-base @ 29013307 · migrations 000061 · 35 handler）
  - §2 数据骨架（4 张核心新表 + 3 张衍生表，从 migration 000062 起）
  - §3 Phase 0-5 详细任务清单 / 约束 / 验收 / 红线触发规则
  - §4 持续构建保障机制（航前清单 + 防偏航 checklist + 失败回滚）
  - §5-6 任务命名规范 `task-knowledge-P{n}-{seq}-{slug}` + 任务登记表
  - §7 完成日志（live） + §8 风险登记册 + §11 计划终点 DoD

**Patched — V1.0.1 (本日):**
- §1.0 新增「基线快照」表，钉死 commit hash / migration 编号 / 已知文档偏差
- §0.4 D2 修订：`note_embeddings` 不是"死表"，表 + admin UI "AI 索引状态" 占位面板均已就绪，仅缺后台 worker
- §3 Phase 3 P3-05 修订：hybrid retrieval 直接复用 `app/services/kb_indexer.py` + `kb_recall.py`，不重造 chunker

**Doc 同步:**
- `CLAUDE.md` 版本基线从 `2026-05-04 / migrations 000045 / 26 handler` 更新到 `2026-05-26 / 000061 / 35 handler / branch feat/knowledge-base @ 29013307`
- `docs/INDEX.md` 「📋 设计与报告」节新增「Aether Knowledge 调研报告 + 落地手册」两条目

**未变更 / 不需要更新:**
- `docs/architecture.md`（未改 schema 与架构）
- `.claude/docs/api-handlers.md`（未新增 endpoint）
- `.claude/docs/database-migrations.md`（未写新 migration）
- 设计系统文档（未动 UI）

### 知识库（Knowledge Base）能力上线 (2026-05-25, branch codex/dev-fix-ui)

INTELLIGENCE 板块新增「知识库」入口，对齐 LobeHub 资源库交互。灵境对话可勾选多个 KB
按语义召回作为 RAG 上下文，回答时自动标注「chunk #N」来源。

**Added — Migrations:**
- `000054_media_folder_is_system` — media_folders 加 `is_system` / `undeletable` + seed `/root/_system_kb` 系统目录
- `000055_knowledge_bases` — 5 张新表：`knowledge_bases / kb_profiles / kb_members / kb_files / kb_embeddings`，seed `slug='posts'` SYSTEM_POSTS 行
- `000056_kb_default_profiles` — SYSTEM_POSTS 库默认 active profile（recursive/512/64）
- `000057_kb_embedding_unconstrained` — `kb_embeddings.embedding` 改为不锁维度的 vector
- `000058_kb_embedding_hnsw` — 按 dim×status='active' 的 partial HNSW（768/1024/1536/3072 四套）

**Added — Backend (Go):**
- `internal/model/knowledge_base.go`、`internal/dto/kb_dto.go`
- `internal/repository/{kb_repo,kb_profile_repo,kb_member_repo,kb_file_repo}.go`
- `internal/service/{kb_service,kb_indexer_client}.go` — CRUD + 自动归档 `/root/_system_kb/<slug>/<yyyy>/<mm>/<dd>/` + 后台 goroutine 触发 ai-service 向量化
- `internal/handler/{kb_handler,kb_profile_handler,kb_member_handler,kb_agent_handler}.go`
- 新路由：`/v1/admin/kbs/*`（CRUD + 文件 + Profile + 成员）+ `/v1/agent/knowledge-bases`（灵境 picker）
- KB 写操作每用户 60/min 速率桶；审计写入 `activity_events` 表 `kb.*` 事件家族

**Added — AI Service:**
- `app/services/kb_indexer.py` — 文档解析（txt/md/html/json/csv/pdf/docx）+ chunker.split + 并发 embed + 单事务写 kb_embeddings
- `app/services/kb_recall.py` — 多 KB 并行召回 + 全局 top-k 合并
- `app/api/routes/knowledge_bases.py` — POST `/v1/kb/{id}/files/{fid}/index`（支持蓝绿 target_status=shadow）+ POST `/v1/kb/{id}/reindex`
- `app/api/routes/agent.py` — `AgentChatRequest` 加 `kbIds`；`_build_kb_context_for_chat` 在 picker context 后追加 KB 召回段
- 依赖：`pypdf`、`python-docx`、`trafilatura`

**Added — Admin Frontend:**
- INTELLIGENCE 导航新增「知识库」（lucide `Library`）
- `pages/knowledge/KnowledgeBasePage.tsx` 列表（卡片栅格 + 新建弹窗）
- `pages/knowledge/KnowledgeBaseDetailPage.tsx` 详情（资料文件 / 索引档案 / 成员授权 三 Tab，SYSTEM_POSTS 自动隐藏成员 Tab）
- 文件 Tab：拖拽上传 + 状态过滤 + 时间桶 scrubber + 失败原因弹窗（含复制错误）+ 移动端 sticky 上传 CTA
- Profile Tab：shadow profile 支持「直接激活」（指针切）/「迁移并激活」（蓝绿 reindex → 原子切）
- 成员 Tab：用户 / 团队 / 角色 picker（接 accessService.listUsers/listTeams/listRoles）
- `services/knowledgeBaseService.ts` 完整 REST 客户端
- AetherHub 顶部新增 `KbPickerBar`：popover 多选可用 KB（权限 ≥ USE），发送时自动带 `kbIds`

**Schema 高亮:**
- `kb_members(principal_type IN USER/TEAM/ROLE, permission_level IN VIEW/USE/EDIT/MANAGE)`，与现有 RBAC 互补
- `kb_profiles` 每 KB 独立，复用 search_profiles 蓝绿语义（partial unique active）
- 文章索引库 = `knowledge_bases.kind='SYSTEM_POSTS'` 真实 row；files 视图动态聚合 posts/post_embeddings

### 头像与编辑器图片智能压缩 + 云端浏览器移动端可用性 (2026-05-15, branch codex/dev-fix-ui)

**Changed — Admin / `apps/admin/src/pages/storage/CloudExplorerPage.tsx`:**
- 移动端云端浏览器外层恢复页面纵向滚动，对象列表改为移动端卡片视图，避免统计区占满首屏后文件列表不可见。
- 底部提示从胶囊数据卡片调整为轻量信息条，并继续保留桌面端表格浏览体验。

**Changed — Admin / 头像上传:**
- `UserProfileModal` 头像上传上限从 2MB 提升到 20MB。
- 5-20MB 的 JPEG / PNG / WebP 头像会弹出共享确认框，用户可选择「压缩后上传」或「原图上传」；超过 20MB 直接拒绝。

**Added — Admin / 编辑器图片智能压缩:**
- 新增 `apps/admin/src/lib/imageCompression.ts`，用浏览器 canvas 做高质量智能压缩，头像最大边长 1600px、编辑器图片最大边长 3200px，质量最低不低于 0.82。
- 文章编辑器新增 `editor_image_smart_compression_enabled` 设置；开启后上传超过 5MB 的支持格式图片会静默压缩并写本地日志，不打断编辑流程。

**Changed — Backend / 活动记录:**
- `mediaService.upload` 支持携带智能压缩指标；`MediaHandler.Upload` 在普通上传活动外额外记录 `media.smart_compression`，标题为「智能压缩」，描述包含原始大小、压缩后大小和节省比例。

**Added — DB / `apps/server-go/migrations/000053_add_editor_image_smart_compression_setting.up.sql`:**
- seed `site_settings.editor_image_smart_compression_enabled=false`，类型 `BOOLEAN`，分组 `advanced`。

**文档影响：** 已更新 `CHANGELOG.md`、`docs/architecture.md`、`.claude/docs/database-migrations.md`。

---

### 💰 全局模型价格管理 — 跨供应商共享价格 + 一键批量回填 / 反向同步 (2026-05-09, branch claude/global-model-pricing-Aeaoh)

**背景：** 同一个 `model_id`（如 `gpt-4o-mini`）在 OpenAI / AIHubMix / AI302 等多个供应商下都各有一份 `ai_models` 行，过去要进每家供应商的模型详情**手动**填一遍单价 + 高级 pricing JSON。维护成本高、容易漂移。

新方案：把单价 / 高级 pricing 抽到 `model_id` 维度集中维护，可一键批量回填到所有同名 ai_models 行；编辑单条模型时也可点击「↺ 从全局回填 / 写入全局」做反向闭环。

**Added — DB / `apps/server-go/migrations/000047_ai_global_pricing.up.sql`:**
- 新建 `ai_global_pricing(model_id UNIQUE, currency, input_cost_per_1m, output_cost_per_1m, cached_input_cost_per_1m, pricing JSONB, notes, updated_at)`；数值列 `DECIMAL(14,6)`（per-1M 量级比 ai_models 的 `DECIMAL(12,8)`/per-1K 大 1000 倍）。

**Added — Backend / `apps/ai-service`:**
- `app/services/global_pricing.py`：`GlobalPricingService`，CRUD + `coverage()`（全数据库 distinct model_id × 全局表 join，给前端「全部 / 已配置 / 未配置 / 部分脱锚」过滤）+ `apply_to_models()`（按 model_id 批量回填，可按 `provider_codes` 限制 / `overwrite_existing` 切换）+ `sync_from_model()`（model→global 反向写入）。
- 单价比较用 `_approx_equal`（相对误差 1e-5）容忍 `DECIMAL(12,8)` 浮点漂移，避免数值上等同的行被误判脱锚。
- `app/api/routes/providers.py`：新增 7 个端点 —— `GET /global-pricing`、`GET /global-pricing/coverage`、`GET/PUT/DELETE /global-pricing/{model_id:path}`、`POST /global-pricing/{model_id:path}/apply`、`POST /models/{id}/sync-global-pricing`、`POST /models/{id}/sync-from-global`。
- `app/schemas/provider.py`：5 个新 Pydantic schema（Response / Upsert / CoverageRow / ApplyRequest / ApplyResponse）。

> Go 后端不需要改：`/v1/admin/providers/*` 早已通过 `ai_handler.MountProviders` 通配符代理到 FastAPI，新端点自动透传。

**Added — Admin frontend / `apps/admin/src/pages/global-pricing/`:**
- `GlobalPricingPage.tsx`：表格视图，显示每个 model_id 的覆盖率徽章（全部同步 / N 行待同步 / 未配置）、provider chip、当前全局单价、批量回填按钮。
- `GlobalPricingDialog.tsx`：编辑全局价格，支持单价四象限 + 高级 pricing JSON + 备注；保存后可勾选「立即批量回填到所有同名供应商模型」+「覆盖已存在 / 仅填补缺失」。
- `hooks.ts`：`useGlobalPricingList / useGlobalPricingCoverage / useUpsertGlobalPricing / useDeleteGlobalPricing / useApplyGlobalPricing / useSyncModelToGlobal / useSyncModelFromGlobal`。
- 路由 `/ai-config/pricing`，侧边栏「全局价格」项（Coins 图标）放在「AI 配置」之后。

**Changed — `apps/admin/src/pages/ai-config/components/ModelConfigDialog.tsx`:**
- 价格段标题右侧新增两个迷你按钮：「↺ 从全局回填」（GET 全局 → 写回当前模型 → 即时更新表单）与「↑ 写入全局」（把当前模型作为基准）。
- 价格段下方实时显示全局基准的输入 / 输出 / 缓存读取价 + currency，方便对比是否漂移。

**Changed — `apps/admin/src/services/aiProviderService.ts`:**
- 新增 5 个类型 + 8 个方法（listGlobalPricing / globalPricingCoverage / getGlobalPricing / upsertGlobalPricing / deleteGlobalPricing / applyGlobalPricing / syncModelToGlobalPricing / syncModelFromGlobalPricing）。

**📄 文档影响：** 已更新 `.claude/docs/api-handlers.md`（AI 节增加全局价格端点行）、`.claude/docs/database-migrations.md`（基线 → 47，新表索引 + 演进叙事 §000047）。

---

### 🛡️ 云储存全面优化 · 批次 2 — 后端硬化:folder 上传权限校验 + provider 配置深合并 (2026-05-08, branch codex/cloud-storage-server-hardening)

**背景:** 批次 1 把客户端体验补齐之后,把后端两个潜在事故点也一并堵上。

1. **folder 上传越权:** `media_service.Upload` 历来不查目标 folder 的 owner —— 任何登录的 admin 都可以传文件到他人的私有文件夹。`folder_permissions` 表 / `media_folders.owner_id+visibility` 早就在 schema 里,只是 service 层没接进来。
2. **provider 配置 partial PUT 丢字段:** `mergeProviderConfigJSON` 之前只 merge `secretKeyFields` 列表里的字段,**非 secret 字段一律跟随 newPayload**。结果前端只想改 bucket,提交了 `{bucket: 'x'}` 没带 region/endpoint,UPDATE 之后 region/endpoint **直接消失**,下次启动 storage client 解析就失败 —— 已经在生产里出现过一次"换 bucket 名后整个 OSS 客户端连不上 endpoint"的事故。

第三个原本规划的"sync 切默认 provider 时锁定 in-flight target"项调研后撤销 —— `media_sync_jobs.target_provider_id` 在入队时已经写入 worker 读取的就是这个字段,**当前实现就是预期行为**。原 explore 报告把它列为 pain point 是诊断偏差。

**Added — `apps/server-go/internal/service/media_service.go`:**
- `folderLookup` / `permLookup` 接口(`FindByID` / `HasWriteAccess`)允许测试注入 mock,生产代码用 `*FolderRepo` / `*PermissionRepo`。
- `MediaService.SetFolderAccess(folderRepo, permRepo)`:由 server.go 在 wire 阶段注入,**未注入则向后兼容(不拒任何上传/移动)**。
- `assertFolderWritable(ctx, folderID, uploaderID)`:七步短路放行规则(根目录 / 系统文件夹 / owner 自己 / 显式 UPLOAD/EDIT/DELETE/ADMIN 授权)。在 `Upload` / `Move` / `MoveBatch` 入口前先校验。
- 单元测试 `TestAssertFolderWritable` 共 10 个表驱动子用例 + `TestAssertFolderWritable_BackwardCompat`。

**Added — `apps/server-go/internal/repository/permission_repo.go`:**
- `HasWriteAccess(ctx, folderID, userID)`:单条 `EXISTS` 查询,权限级别 ∈ {`UPLOAD`, `EDIT`, `DELETE`, `ADMIN`}(VIEW 不算"可写")且 `expires_at IS NULL OR expires_at > NOW()`。

**Changed — `apps/server-go/internal/service/storage_provider_service.go`:**
- `mergeProviderConfigJSON` 升级为深合并:旧 payload 里存在但新 payload 没提的字段从旧值继承;嵌套 `map[string]any`(如 `options:{...}`)递归一层合并;JSON null 等同"缺失"也回退旧值。
- secret 字段保护逻辑保留:脱敏占位 / 空字符串 / 缺失 → 回退旧值。
- 抽出 `deepMergeStringMap(oldMap, newMap)` helper。
- 单元测试新增 5 个用例(`_DeepMergeNonSecretField` / `_DeepMergeNestedOptions` / `_OverwriteWhenBothPresent` / `_NullPreservesOldValue` / `_NullInsideNestedOptions`)。

**Changed — `apps/server-go/internal/handler/media_handler.go` + `service/media_service.go`:**
- `Move` / `MoveBatch` 签名加 `uploaderID *int64`,handler 从 `LoginUser` 透传。Service 层在 repo 写入前同样调 `assertFolderWritable`。

**Changed — `apps/server-go/internal/server/server.go`:**
- `permissionRepo` 初始化提前到 `mediaSvc` 之后立刻注入 `mediaSvc.SetFolderAccess(folderRepo, permissionRepo)`,line 318 原来的重复 `NewPermissionRepo` 删除。

**Follow-up(同 PR 内 review 修复):**
- **P1**:`HasWriteAccess` SQL 把 `permission_level` 当成大写枚举(`VIEW/UPLOAD/EDIT/DELETE/ADMIN`),原版用 `'write','admin'` 对不上 DB CHECK 约束,**所有显式授权用户被静默拒绝**。  *(chatgpt-codex-connector P1)*
- `deepMergeStringMap` 把 JSON `null` 等同"缺失"回退旧值(原版会让 nil 覆盖旧值,与 docstring 矛盾);新增 2 个测试覆盖顶层 + 嵌套 null 场景。  *(gemini-code-assist medium)*
- `Move` / `MoveBatch` 也接入 `assertFolderWritable`,对齐文档承诺(原版仅 `Upload` 走校验)。  *(gemini-code-assist medium)*

**Verified:**
- `go build ./...` 通过
- `go test ./internal/service/ -run 'TestAssertFolderWritable|TestMerge|TestSVG'`:23 个用例全 PASS

📄 文档影响:
- `.claude/docs/backend-runtime.md` §2 新增「上传/移动时 folder 权限校验」+ 「客户端配置 partial PUT 深合并」两段(已更新)
- `CHANGELOG.md` 本条(已更新)
- `docs/architecture.md` 数据库节:本次未改 schema(用现有 `folder_permissions` 表),**无需更新**
- `.claude/docs/api-handlers.md`:`/v1/admin/media/upload` 未新增端点,只改了 service 层校验,**无需更新**

### 🔐 云储存全面优化 · 批次 3b — Fernet 密钥拆分(STORAGE_ENCRYPTION_KEYS) (2026-05-08, branch codex/cloud-storage-extras)

**背景:** `storage_providers.config_json` 加密历来复用 `AI_CREDENTIAL_ENCRYPTION_KEYS`。两个不同攻击面共用同一组 Fernet key,任何一处泄露都会同时让 AI provider API key + 云存储 secret 都暴露。给运维一个**单独轮换 storage 密钥**的开关。

**Added — `apps/server-go/internal/pkg/cryptkey/keystore.go`:**
- `newKeystoreFromEnvName(envName)`:抽出"从指定 env 读 key 列表"的通用化版本,原 `NewKeystoreFromEnv` 保持向后兼容(显式调 `AI_CREDENTIAL_ENCRYPTION_KEYS`)。
- `NewKeystoreFromFallbackEnv(primary, fallback) (ks, source, err)`:优先 primary,空时回落 fallback;`source` 返回实际命中的 env name 供启动期日志使用。
- `DefaultForStorage()` + `StorageKeystoreSource()`:进程级单例,走 `STORAGE_ENCRYPTION_KEYS → AI_CREDENTIAL_ENCRYPTION_KEYS → enabled=false`。
- 单元测试 3 个:`TestKeystoreFallback_PrimaryWins` / `_UsesFallbackWhenPrimaryMissing` / `_BothMissingDisabledMode`。

**Changed — `apps/server-go/internal/repository/storage_provider_repo.go`:**
- `NewStorageProviderRepo` 默认 keystore 改为 `cryptkey.DefaultForStorage()`。

**Changed — `apps/server-go/internal/server/server.go`:**
- 启动期日志 `storage encryption keystore initialized source=… enabled=…`,运维一眼能看到走的是哪个 env。

**Changed — `.env.example`:**
- 新增 `STORAGE_ENCRYPTION_KEYS=` 段,含轮换流程注释:`NEW,OLD_AI` → restart → 触发 UPDATE re-encrypt → 移除 OLD_AI。
- 现有 storage 配置注释从"复用 AI_CREDENTIAL_ENCRYPTION_KEYS"改为"优先 STORAGE_ENCRYPTION_KEYS"。

**向后兼容:**
- 老部署只配 `AI_CREDENTIAL_ENCRYPTION_KEYS` → fallback 命中,行为完全不变。
- `Default()` 保持原语义,AI 服务无需任何改动。

📄 文档影响:
- `.claude/docs/backend-runtime.md` §2 「Secret 加密机制」补「密钥来源优先级」子节(已更新)
- `CHANGELOG.md` 本条
- `docs/architecture.md` / `.claude/docs/api-handlers.md`:本次未改 schema / endpoint,**无需更新**

### ✨ 云储存全面优化 · 批次 3a — Cloudflare R2 endpoint 自动拼装 (2026-05-08, branch codex/cloud-storage-extras)

**背景:** R2 配置一直卡在 "endpoint placeholder 是 `https://<account-id>.r2.cloudflarestorage.com`" —— 用户复制粘贴 + 把 `<account-id>` 占位符当字符串保存,落库后 Storage adapter 解析时才发现是个无效 URL,需要重开配置改一遍才能跑通。

**Added — `apps/admin/src/pages/settings/StorageProviderSettings.tsx`:**
- `extractR2AccountId(endpoint)` / `buildR2Endpoint(accountId)`:基于固定正则 `/^https?:\/\/([a-f0-9]{32})\.r2\.cloudflarestorage\.com\/?$/i` 双向同步。
- `R2AccountIdField` 组件:仅 R2 模式渲染。用户在 "Cloudflare Account ID" 输入框输入 32 位 hex 后,自动写回 `cfg.endpoint`,顺手把空 region 设为 `auto`。已有非标 endpoint(自定义 worker / 透明代理)显示警告但不阻塞。
- 保留 endpoint 输入框可手填 —— 高级用户(自定义域名)路径不被破坏。

**Removed:**
- R2 的 endpoint preset 按钮(原本会把 `https://<account-id>...` 直接填到输入框)—— 用专门的 accountId 输入框取代。

**Test plan(浏览器):**
- 新建 R2 provider:填 accountId → endpoint 自动出现且 region 默认 auto
- 编辑现有 R2 provider:accountId 反向解析自 endpoint,无需重新输入
- 自定义 worker URL:直接手填 endpoint,警告条出现但保存仍然可行

📄 文档影响:
- `CHANGELOG.md` 本条
- `.claude/docs/backend-runtime.md`:本次纯前端 UI,不涉及运行时机制,**无需更新**

### ☁️ 云储存全面优化 · 批次 1 — 客户端 abort / 重试 / 阶段化进度 (2026-05-08, branch codex/cloud-storage-upload-resilience)

**背景：** 媒体库上传链路在生产里有三个稳定的"看不见的痛"：

1. **取消是真空。** 用户拖了一个 80 MB 的视频上去，发现要重选，没有 UI 也没有 API 能取消 in-flight，只能让浏览器吃完、再去回收站删；
2. **重试靠人。** 服务端 sync_jobs 有自动重试（max 3 次），但客户端 `mediaService.upload` 一次失败就抛错，连 502/网络抖动都直接弹 toast，让用户手动点重试按钮；
3. **进度是错位的。** UploadProgress 100% 之后还要静默等 1-3 秒才切 `success`（缩略图 + 入云），用户看到 100% 后转圈以为卡死。

这一次只动客户端，不动 handler/service，把这三个洞补上。

**Added — `apps/admin/src/services/mediaService.ts`:**
- `UploadOptions = { folderId?, signal?, maxRetries?, onAttempt? }`：第三参数从 `folderId: number` 平滑升级；老签名 `upload(file, onProgress, folderIdNumber)` **仍然工作**（TS 协变接受第二参数缩减）。
- `UploadProgressFn = (percent, phase) => void`：`phase: 'uploading' | 'processing'`，0-99% 是字节上行 / 字节发完后切 `processing` 99% / 响应到达 100%。
- `uploadWithRetry`：默认 3 次重试，250→500→1000ms 指数退避 + ±20% 抖动。仅对 *无响应 / 5xx / 408 / 425 / 429* 重试，4xx 和 abort 不重试。
- `UploadAbortedError` + `isUploadAborted(err)`：调用方据此判定 abort 路径（不弹错误 toast、不写 logger.error），同时 `axios.isCancel` 也被识别。
- `uploadEdited` 同步升级，跟 `upload` 共享 retry/abort/phase 内核。
- `uploadBatch` 串行调用 `upload`，每个文件独立重试。

**Added — `apps/admin/src/pages/MediaPage.tsx`:**
- `UploadingFile` 加 `controller: AbortController | null` / `attempt` / `folderId`，`status` 扩展为 `queued | uploading | processing | success | error | aborted`。
- `startUpload(id, file, folderId)` 抽出来，被首次上传与重试复用；`onAttempt` 回调把"第 N 次尝试"打到 UI。
- `handleCancelUpload`：进行中→`abort()`、终态→从列表移除（合并按钮语义，X 始终可点）。
- `handleRetryUpload` / `handleCancelAll` / `handleClearCompleted` 三个新动作，挂到 `UploadProgress`。

**Added — `apps/admin/src/pages/media/components/UploadProgress.tsx`:**
- 头部新增「一键取消所有进行中（Ban）」/「清除已结束（X）」/「最小化（ChevronUp）」三个按钮组。
- 行级支持 `aborted` 灰色文案 + `已取消` / 重试中文案 `第 N 次尝试…`。
- 失败 / 中止行右侧出现 `RefreshCw` 重试按钮，进行中行右侧的 X 切换语义为「取消」。
- 折叠态进度环颜色：`hasFailed → 红 / 进行中 → 紫 / 全成功 → 绿`，活动结束时 pathLength 直接吸到 1（避免循环动画）。

**Why not full resumable upload yet:** 那一项落在批次 4（client-side multipart presign + chunk），会动 backend 的签名端点。本批次零后端改动，纯客户端体验补齐，PR 风险面小、可独立 ship。

📄 文档影响：
- `.claude/docs/backend-runtime.md` §2 新增「客户端上传韧性」表格（已更新）
- `CHANGELOG.md` 本条（已更新）
- `docs/architecture.md` API 节 / 数据库节：本次未涉及，**无需更新**
- `.claude/docs/api-handlers.md`：本次未新增端点，**无需更新**

**Follow-up（同 PR 内 review 修复）:**
- `mediaService.isRetriableError` 收紧:非 axios 错误(TypeError 等编程错误)不再触发重试。  *(gemini-code-assist high)*
- `UploadOptions.maxRetries` 语义对齐"重试次数(不含首次)",默认 2 即"首次 + 2 次重试 = 3 次总尝试",与原行为等价。  *(chatgpt-codex-connector P2)*
- `mediaService.uploadBatch` 注释改成"单文件失败立即抛出中止整批",与实际 for-await 行为一致;调用方需要容错请自己 try-catch。  *(gemini-code-assist medium)*
- `MediaPage`:`AbortController` 提到 `controllersRef`(同步预创建,消除"setState 落地前 cancel 失效"的 race);`handleCancelUpload` / `handleRetryUpload` / `handleCancelAll` 全部从 `setState` updater 内部把副作用提到外面,符合 React updater 必须为纯函数的约束。  *(gemini-code-assist medium ×3)*

### 🪛 补全 AI 模块 activity_events 埋点 + 修复两条 CHECK constraint 漏写 (2026-05-07, branch claude/add-ai-activity-logging-bc4fb)

**背景：** 活动记录页 `/activities?category=AI` 一直空白 —— admin 后台早就有六个 AI 生成端点 (summary/tags/titles/polish/outline/translate)、Agent 工作台 chat、提示词更新、AI 任务 CRUD,但只有 `/providers/*` 写操作有审计 (`ai.provider_proxy_write`),其它路径完全失声。同时排查 ai_handler 现有审计代码时发现两条 CHECK 约束 silently dropping records:`ai_handler.recordProviderProxyActivity` 4xx 时写入 `Status="FAILED"` 而 `chk_activity_event_status` 只允许 `INFO/SUCCESS/WARNING/ERROR`;`auth_handler.RotateJWTSecret` 写入 `EventCategory="security"` 而 `chk_activity_event_category` 只放 7 类 (post/comment/user/system/friend/media/ai)。两个 INSERT 在生产环境都会被 PostgreSQL 拒绝,Go 代码 `_ = h.activitySvc.Create(...)` / `if err := ...; err != nil { log.Warn() }` 把错误吞进 stderr,前端就一直看不到任何 security / AI failure 记录。

**Added — Migration `000046_activity_event_category_security.up.sql`:**
- 把 `event_category` 白名单扩展到 8 类:新增 `'security'` (与现有前端 `categoryConfig.security` 对齐),让 `security.jwt_rotate` 类事件能落库。
- down migration 提示运维:若已有 `security` 行需先迁/清理再回滚,否则 CHECK 重建会失败。

**Added — Backend AI 审计埋点 (`apps/server-go/internal/handler/ai_handler.go`):**
- 新增统一入口 `recordAIEvent(ctx, c, eventType, title, desc, httpStatus)`,所有 AI 子事件用同一类别 `ai`、同一状态映射 `statusFromHTTP` (2xx→SUCCESS, 4xx→WARNING, 5xx→ERROR)。`recordProviderProxyActivity` 改为薄包装,顺手把旧 `FAILED` bug 修了。
- 六个同步 AI 生成端点共用 `runGeneration(c, task, path)` 骨架,每次调用写 `ai.generation.<task>` (summary/tags/titles/polish/outline/translate),Description 含请求体大小 + 上游 HTTP 状态。
- SSE 摘要流 (`SummaryStream` / `SummaryStreamGET`) 写 `ai.generation.summary_stream`:流开始 / 上游连接失败 / 上游非 2xx 各落一条,流式中途异常仍走 `log.Warn` 不补审计 (避免一次会话 2+ 条 ai 事件把列表灌爆)。
- `UpdatePrompt` → `ai.prompt_update`,`CreateTask/UpdateTask/DeleteTask` → `ai.task_create/update/delete`。`ai.provider_proxy_write` 兼容保留,Status 现在合规可以真正落库。

**Added — Backend Agent chat 审计 (`apps/server-go/internal/handler/agent_handler.go`):**
- `NewAgentHandler` 多接一个 `activityRecorder` 参数,server.go wire 时传入 `activitySvc`。
- 新增 `recordChatActivity`:每次 `POST /api/v1/agent/chat` 写一条 `ai.agent_chat`,Description 含请求体大小、上游 HTTP 状态、人类可读说明 (e.g. `"流式开始"`、`"上游连接失败"`)。仅在每次会话开始/失败写 1 条,不在 SSE 行级 callback 写 —— 一次问答动辄几十条 think/delta/sources,过细只会让 admin 看不见信号。
- 与 `ai_handler.statusFromHTTP` 共享 status 映射逻辑。

**Changed — Frontend `apps/admin/src/pages/activities/ActivitiesPage.tsx`:**
- `eventTypeOptions.ai` 由空数组扩展为 13 个事件类型条目,与后端 `ai.*` 完全对齐:6 个生成、1 个流式、1 个 agent chat、1 个提示词、3 个任务、1 个 provider proxy。选中 AI 分类后二级 Select 立刻可用。

**Tests (`ai_handler_test.go`):**
- 旧 `MarksFailedOn4xx` 改名 `MarksWarningOn4xx` (`Status=WARNING`,锁死与 CHECK 约束一致);
- 新增 `MarksErrorOn5xx` (5xx → ERROR);
- 新增 `TestStatusFromHTTP` 表驱动测试,任何后续改动都必须同步白名单。

**Why not log every single SSE event:** 摘要 / agent chat 流单次会话最多产出几十条 SSE delta,如果每条都写 activity_events 一周就能把表灌到几百万行,既看不见信号也会拖慢 admin Activities 页查询。当前策略是 "每次调用 1 条审计 (开始/上游失败选其一)",成本恒定、可观测性够用。需要详细 token / 耗时 metrics 的场景应当在 ai-service 自己的 metrics pipeline 里做,不应该塞进 audit log。

---

### 🩹 修复 VULN-056 升级后 ai-service `InvalidToken` + 新增 message 编辑/重试/复制 (2026-05-05, branch claude/fix-credential-decryption-GuiJk)

**背景:** VULN-056 把 AI 凭证加密 key 从 `_legacy_jwt_derived_key(JWT_SECRET) = urlsafe_b64encode(sha256(JWT_SECRET))` 切换到独立的 `AI_CREDENTIAL_ENCRYPTION_KEYS`。已部署的 instance 升级后 `start.sh::bootstrap_env()` 会自动 **生成全新的 Fernet key** 并写进 `.env`,而 `ai_credentials.api_key_encrypted` 列里仍是旧的 JWT 派生 key 加密的密文 —— MultiFernet 全员都解不开,`/api/v1/agent/chat` 直接 500、admin 凭证页显示"未配置凭证"、agent 路由探针记录空错误消息的 `InvalidToken`。`apps/ai-service/scripts/rotate_credentials.py` 是为这种情况设计的迁移工具,但用户得手动把 legacy key 拼到 `AI_CREDENTIAL_ENCRYPTION_KEYS` 末尾再跑脚本,体验断裂。同一个 PR 顺手补上 agent workspace 的 message 操作 —— `MessageBubble` 之前对 user 消息没有任何按钮,assistant 消息只在 `!pending && content` 时才出现复制,error 状态也无重试入口,与 ChatGPT / Claude / LobeChat 的常态相去甚远。

**Changed (`start.sh`):**

- `bootstrap_env()` 新增 `_ensure_ai_credential_keys` helper:从 `.env` 中读 `JWT_SECRET`,用 Python (`hashlib.sha256` + `base64.urlsafe_b64encode`) 或 openssl 兜底计算等价的 legacy Fernet key,然后:
  - 当 `AI_CREDENTIAL_ENCRYPTION_KEYS` 为空 → 直接生成 `<新主 key>,<legacy key>`;
  - 当字段已设置但 legacy key 不在列表里 → sed 追加到末位(末位仅参与解密,首位主 key 仍负责加密新数据);
  - 当 legacy key 已在 → 跳过(幂等)。
  - 用户跑过 `rotate_credentials.py` 后,设置 `AI_LEGACY_KEY_FALLBACK=false` 即可阻止下次启动再次自动追加 —— 同时保留 fresh-bootstrap 路径只生成单 key,不再带 legacy。
- 每次自动追加都打 yellow `⚠️` 提示运维: `docker exec aetherblog-ai-service python -m scripts.rotate_credentials --repair-orphans` + 完成后从 `.env` 移除末位 legacy key 并设置 `AI_LEGACY_KEY_FALLBACK=false`。

**为什么 fallback 放在末位是安全的:** MultiFernet 用列表第一项加密新数据,后续项仅在解密时按序尝试。Legacy JWT 派生 key 写在末位 → 新写入的 `ai_credentials` 行始终用强随机主 key 加密,旧行解密时才会落到 legacy。攻击面不会比单纯持有 `JWT_SECRET` 更大(原本就是同一份秘密)。轮换 + 删除 legacy 是最终目标,但允许「自动 fallback + 红字提醒」作过渡 —— 比让用户在 ai-service 全挂的状态下手动救场更可靠。

**为什么不在 ai-service 启动期自动迁移:** 启动期写 DB 风险大(JWT_SECRET 也被换过 / 多副本 ai-service 抢锁 / 中途崩溃导致部分行迁完一半),而且解密逻辑里嵌死 legacy 派生会让"VULN-056 之后生产代码路径不再使用 JWT 派生 key"这一安全承诺失效。`start.sh` 层做 env 拼接 + 提示 + opt-out 是改动面最小、最易审计的中间路径。

**Changed (`apps/blog/app/agent/workspace/WorkspaceClient.tsx`):**

- 把 `handleSend` 拆成 `sendText(text: string)` 核心 + 薄 `handleSend` 包装(读 draft → 清空 → 调 sendText),让重试/编辑后重发能复用同一份 streaming + rAF 平滑 + `setSessions` 状态机,不再走 draft state 的异步窗口。
- 新增 `handleEditUserMessage(message)`:截断该 user 消息及其后所有消息,把内容回填到 composer 让用户编辑后正常 Enter 发送(与 ChatGPT / Claude 的"从此处分叉"语义一致)。
- 新增 `handleRetryAssistantMessage(message)`:找到该 assistant 之前的 user msg,截断到 user 之前(不含),立刻 `sendText(prior.content)` 重新拉一份回复 —— sendText 会把 user msg 重新 push 回去走完整 streaming 流程。
- `busy` 期间两个操作都禁用,避免与正在跑的 stream 抢同一会话状态机。

**Changed (`apps/blog/app/agent/workspace/components/MessageBubble.tsx`):**

- props 新增 `onEdit` / `onRetry` / `busy`。memo `areEqual` 把 `busy` 与两个回调引用纳入比较 —— 父级用 `useCallback` 稳定回调,所以正常情况下不会触发额外重渲。
- meta 行(消息头部)hover/focus-within 时浮现操作组,`flex-row-reverse` 与 user 消息靠右布局对齐;复制按钮对 user / assistant 都开放(原先只有 assistant)。
- 错误气泡(`message.error`)内嵌 inline `重试` 按钮 —— 不需要 hover,用户看到红色 ERROR 行的同时直接拿到 CTA。
- 新 import:`Pencil` / `RefreshCcw` from lucide-react。

**怎么验证:**

1. 凭证修复:停掉 ai-service,在 .env 里把 `AI_CREDENTIAL_ENCRYPTION_KEYS` 改成单 key 或清空,跑 `./start.sh --gateway` —— 启动日志应该看到 yellow ⚠️ 提示 + `AI_CREDENTIAL_ENCRYPTION_KEYS=<新key>,<legacy key>`。再发起 `/api/v1/agent/chat`,旧凭证不再 InvalidToken。
2. 跑 `docker exec aetherblog-ai-service python -m scripts.rotate_credentials --repair-orphans` → 所有行重新用新 key 加密 → 把 .env 末位 legacy key 删掉,加 `AI_LEGACY_KEY_FALLBACK=false`,重启 ai-service → 解密仍然成功。
3. UI 操作:`/agent/workspace` 发起对话,hover user 气泡看到 `复制 / 编辑`;hover assistant 气泡看到 `复制 / 重试`;构造 stream 中断错误,error 气泡内的 inline `重试` 直接出现。

### 🔒 移除生产 backend 的 docker.sock 挂载 / VULN-003 (2026-05-05, PR #603 + PR #604)

**背景:** `docker-compose.prod.yml` 长期把 `/var/run/docker.sock:/var/run/docker.sock:ro` 挂进 backend 容器，并通过 `group_add: ["${DOCKER_GID:-999}"]` 把容器 UID 1001 加入 host docker 组，目的是让 `/v1/admin/monitor/*` 的"容器监控"页能调用 Docker daemon 拉容器列表与 stats。问题是 `:ro` 只阻止对套接字文件本身的写入，**Docker daemon 的 API 操作面不受影响** —— 任何拿到该 socket 的进程都能创建特权容器、绑定 host 根文件系统，等同于 host-root。一旦 backend 被攻陷（Go RCE / 依赖供应链 / handler 反序列化漏洞等），攻击者可借此从容器逃逸到宿主机。对绝大多数自托管者而言，把"管理员能看一个监控页"换"backend 进程被拿下 = 整机被拿下"是不划算的权衡。本条 CHANGELOG 同时覆盖 PR #603（实际落地 main 的 compose / env / 文档变更，标记 VULN-003）与 PR #604（独立提交的同语义改动 + 本 CHANGELOG 与文档对齐）。

**Changed (`docker-compose.prod.yml`):**

- 移除 backend service 的 `/var/run/docker.sock:/var/run/docker.sock:ro` bind mount。
- 移除 `group_add: ["${DOCKER_GID:-999}"]`。
- 原位置保留 `# REMOVED for security: ...` 注释块，提示后续维护者要恢复请走 `tecnativa/docker-socket-proxy` 而非直接 bind-mount。
- 现在 backend 仅保留命名卷 `aetherblog_uploads` / `aetherblog_logs`，原有 `no-new-privileges` / `cap_drop: ALL` / `read_only: true` 等加固保持不变。

**Changed (`.env.example`):**

- 删除 `DOCKER_GID` 默认值与原说明块。
- 新增 "Container Monitoring (Optional, Security Sensitive — DISABLED by default)" 段，说明默认关闭原因，并给出 `# DOCKER_SOCKET_PROXY_URL=http://docker-socket-proxy:2375` 的可选恢复占位。

**对 `/v1/admin/monitor/*` 的影响（不破坏运行时）:**

- `apps/server-go/internal/service/container_monitor.go` 默认会 dial unix `/var/run/docker.sock` 失败，第 182-187 行已有软失败兜底（`return overview` 时 `DockerAvailable: false`），handler 不会 panic，admin 页面会显示"Docker 不可用"占位态。
- 服务路由 `setupRoutes` 与 `NewContainerMonitorService` 注入保持不变，留给后续通过 `tecnativa/docker-socket-proxy` 旁车恢复时无须改 server.go。

**Changed (`docs/deployment.md` + `.claude/docs/deployment-cicd.md`):**

- `docs/deployment.md` §"Docker socket 访问 —— 默认禁用（PR #603）"：写明默认不挂载、`:ro` 假性安全、admin 监控页降级行为、`tecnativa/docker-socket-proxy` 恢复路径，明确禁止直接 bind-mount socket / 重设 `DOCKER_GID`。
- `.claude/docs/deployment-cicd.md` §5 加固表 Docker socket 行同步收口为 "默认不挂载（PR #603）"，加上 VULN-003 关联标签。

**为什么不顺手删 `container_monitor.go` 与 `/v1/admin/monitor/*`:**

- 服务侧软失败已经无副作用；保留代码路径让后续引入 `docker-socket-proxy` 的部署只改 `DialContext` 与 compose，不需要回滚业务逻辑或 admin 路由。删除是一刀切，权衡更不利。

---

### 📐 Agent 三模式产品定位锁定 · Cowork / Code 设计冻结 (2026-05-05)

**背景:** Workspace 顶部 segmented control 的 Chat / Cowork / Code 长期只切换一行 system prompt 文字, 用户极易把"三模式"误解为"三种 prompt 风格"。但产品愿景里 Cowork 是**主动型异步副手**（cron 任务 + 多工具组合 + 通知 inbox + 知识合成）, Code 是**最底层 Agent 编排平台**（工具注册 + YAML/DAG 工作流 + 节点级 trace + autonomous 固化模板）—— 二者均为独立子系统, 与 Chat 完全不同的能力架构。本批次先把定位与产品路线固化为文档, 同时把 workspace UI 上的 Cowork / Code 上锁防误解, 开发推迟到后续阶段。

**Added (`docs/agent/`):**

- **`README.md`（新, ~200 行）** —— 三模式总入口, 用对照表锁定每个模式的形态 / 能力边界 / 用户故事; 明确 Cowork ≠ Code 的边界（"预制菜单 vs 原料库", 互不替代）; 列出当前在线状态与开放计划; 设立"修改 Agent 模式定位 / 实施阶段必须更新本目录"的硬规则, CLAUDE.md §6.1 触发器表已加入对应条目。
- **`COWORK_ROADMAP.md`（新, ~520 行）** —— Cowork 模式产品路线: 目标定位 / 与 Chat 区别对照 / 4 类用户画像 + 4 个详细 user story / 17 项能力清单 (P0~P2 分级) / 4 张 DB schema (`cowork_tasks` / `cowork_runs` / `notifications` / `cowork_subscriptions`) / 完整 API 设计 (任务 CRUD + 运行控制 + 通知 inbox + 内部 ai-service 接口) / 架构图含调度器在 Go / 执行器在 ai-service 的关键决策 / Phase 1~5 里程碑 / 6 类风险缓解 / Phase 2 MVP 验收清单 / 任务类型规范附录 (`topic_brief` / `article_audit` / `topic_explore` / `image_compose` / `weekly_digest`)。
- **`CODE_ROADMAP.md`（新, ~700 行）** —— Code 模式产品路线: 目标定位与"YAML 优先 / 可回放 / autonomous 可固化"四条设计原则 / 5 类用户画像 + 4 个详细 user story / 24 项能力清单 / 5 张 DB schema (`agent_tools` / `agent_workflows` / `agent_workflow_versions` / `workflow_runs` / `workflow_node_logs`) / DSL 完整 schema 含 fixed / DAG / branch / for_each / autonomous mode 范例 / 架构图含 Go 鉴权层 + ai-service 工作流引擎拆分 / 完整 API 设计 (含 SSE trace / 暂停续跑 / autonomous→fixed 固化) / Phase 1~5 里程碑 / 6 类风险缓解（重点 SSRF / 表达式注入 / autonomous 死循环）/ Cowork 协同接口预留 / 内置工具清单附录。

**Changed (`apps/blog`):**

- **`agent/workspace/components/ModeSwitch.tsx`** —— 重写为支持锁定模式: Cowork / Code 两个标签加 `Soon` 徽标 + `Lock` 图标, 点击不切换 mode 而是弹 `ModeInfoPopover` 说明卡（含一句话定位 + 2-3 句详述 + 链接到对应 roadmap 文档）; 导出 `AVAILABLE_MODES: ReadonlySet<AgentMode>` 给上游做防御性约束; 锁定文案严格围绕"它是什么独立子系统"展开, 不再用"prompt 切换"或"三种姿势"这类暗示。
- **`agent/workspace/WorkspaceClient.tsx`** —— `handleModeChange` 加 `AVAILABLE_MODES.has(mode)` 守卫拒绝锁定模式; `handleSend` 引入 `effectiveMode` —— 即便 session 历史里残留 cowork/code（来自老 localStorage）也强制按 chat 走, 不让 ai-service 误以为 Cowork 已经在跑; topbar 当前模式显示同样按 `AVAILABLE_MODES` 兜底回 chat。
- **`agent/sections/ModesSection.tsx`** —— landing 页三模式介绍重写: 标题从"三种姿势"改为"三个独立子系统", 副标题明示"它们不是 prompt 切换 —— 是三套不同的能力架构"; Cowork / Code 卡片右上角加 `Coming` 徽标; 卡片正文与 sample 行替换为对应 roadmap 文档真实场景片段 (`task · 每工作日 09:00 行业速览` / `workflow · article_audit · v3` 等); 各卡片底注引用 `docs/agent/COWORK_ROADMAP.md` / `docs/agent/CODE_ROADMAP.md`。

**为什么这是定位锁定而非纯文档工作:**

- 用户原始反馈是"我看不出三个模式有什么区别 / 为什么切换没有作用"。链路上 mode 是接通的（Go 透传 + ai-service `_MODE_SYSTEM_PROMPTS[req.mode]` 命中）, 但**接通方式只是不同的 system prompt 第一行**, 与产品愿景里的"主动副手 + Agent 编排平台"完全不是一回事。继续保留这个伪装会让后续真正实施 Cowork / Code 时背上"这只是把 prompt 写得更好一点"的包袱, 也会让用户在等待真正功能上线期间被反复误导。
- 处理方式: **先把愿景文档化锁定**, 把 UI 上锁让用户**无法**误用, 但通过 InfoPopover 与 landing 页 Coming 徽标传递清晰预期, 同时给出"完整设计请看 docs/agent/*"的进一步信息源。这样既不阻塞 Chat 模式当前可用性, 又防止伪装 Cowork / Code "已经在工作"。

**未变更但相关（不删, 等真实施 Phase 1 时再动）:**

- `apps/ai-service/app/api/routes/agent.py` 的 `_MODE_SYSTEM_PROMPTS["cowork"]` / `["code"]` 占位 prompt 保留（前端始终发 chat 时它们走不到, 但留着便于后续验证 `mode` 字段透传链路完好）。
- `lib/agentSessions.ts` 的 `AgentMode = 'chat' | 'cowork' | 'code'` 类型保留（DB / localStorage 已存在的 cowork/code 会话不必迁移, 由 UI 兜底回退）。



**背景:** PostsPage 高级滤镜把三类视觉语言堆在一起 —— 3 个 `StyledSelect` + 2 个 `<input type="date">` + 2 个 number input —— 与新做的 ActivitiesPage / RealtimeLogViewer 在 Codex 视觉节奏上完全对不上。"重置"按钮披着渐变描边 + 内嵌白底 + shimmer 动画看起来像主 CTA, 跟"新建文章"的 shimmer 互相抢眼; 已激活的滤镜在折叠回去后没有任何可视化, 用户必须再展开下拉框才能确认状态; 状态栏（已发布 / 草稿 / 已下架）和"显示状态"被拆在两个不同的概念坐标轴; 空状态只有一个搜索图标 + 一行文案, 没有 CTA, 也不区分"过滤后无结果"与"全站无文章"。

**Added (`packages/ui`):**

- **`Select.tsx`（新, 363 行）** —— 真·样式化下拉, 全程走 Aether Codex token (surface-leaf / aurora hover stripe / signal-* 状态), 支持 keyboard navigation (↑↓ + ↵ + esc + Tab close)、`prefers-reduced-motion`、`aria-controls` / `aria-expanded` / `role="combobox"`、`disabled` / `loading` / clear button、`searchable` 模式。从 admin 私有的 `StyledSelect` 提升为共享, **17 个 admin 调用点全部迁移**, 旧 `StyledSelect` 一次性删除。
- **`DateRangePicker.tsx`（新, 649 行）** —— 双月日历 + 预设范围（今天 / 昨天 / 近 7 天 / 近 30 天 / 本月 / 上月 / 自定义）+ 单击锚 + 二次单击关闭区间, locale 化（zh-CN）+ ISO 输出, 全程 popover-mode 不阻塞页面; 与 `Select` 同源走 `surface-overlay` + portal 定位（避免父级 `transform-gpu` / `overflow-hidden` 截断弹层）。

**Added/Changed (`apps/admin`):**

- **`PostsPage.tsx`** —— 高级滤镜面板从"三件套"重做为"双 `Select` + 单 `DateRangePicker` + 数值范围 inline"; 状态 / 显示状态合并为单一 segmented control（`已发布 / 草稿 / 已下架 / 全部`）; 折叠回去时新增 active filter chip row（每个 chip 可单独 ×, 也支持"全部清除"）; 空状态分两态：① 有过滤条件且 0 命中 → 文案 "暂无符合条件的文章" + "重置筛选" CTA; ② 全站 0 文章 → "还没有文章" + "新建第一篇" CTA。"重置"按钮去掉所有装饰, 改成 `font-mono uppercase tracking` 文字按钮 + aurora-1 underline-on-hover, 与"新建文章" shimmer 不再竞争。
- **`taxonomy prefetch` (`useTaxonomies` hook)** —— 改成 `lazy-gate`：仅当用户首次打开高级滤镜面板时拉取 categories / tags（之前是页面挂载就预拉, 即便用户从不开滤镜也付费）, 同时加 5 分钟 stale-time 缓存避免反复点开-收起触发刷流量。
- **`URL-as-source-of-truth`** —— 接入 `useSearchParams`, `?status=` / `?categoryId=` / `?dateRange=` / `?search=` 全部 URL 化, 复制链接 / 刷新 / 浏览器后退都还原状态, 也让侧边栏搜索 palette 跳转 `?search=...` 直接生效（与 5/3 侧边栏搜索条目联动）。

**Verified:**

- `pnpm typecheck` ✅ / `pnpm build` ✅ / `pnpm design-system:check` ✅ (0 errors, 红线保持)
- 桌面 / 平板 / 手机三档手工回归: filter 折叠 → 展开 → 设条件 → 复制 URL 重开 → 状态完整恢复; chip 单点 × → URL & UI 同步; "重置筛选" CTA 在过滤态命中空集时出现, 全站 0 文章态显示"新建第一篇"。
- PR #568 follow-ups（`b228323c` / `49a48974` / `c537a13e`）—— Codex review 跟进 7 项: DateRangePicker 焦点 trap、aria-label 完备性、disabled 态 hover stripe 抑制、reduced-motion 路径、单元测试补齐。

**Why 把 Select / DateRangePicker 提升到 `packages/ui` 而不是 admin 私有:** 这两个原子已经是 ActivitiesPage / RealtimeLogViewer / PostsPage 三个高曝光页的公共语言, 提升到共享层后任何后续 admin 页（包括正在做的 SearchConfigPage profile 列表 + 媒体库 batch filter）零成本接入。同时 blog 端 `/timeline` 与 `/posts` 也开始用 `Select`, 跨 app 复用价值显性化。

### 🐛 管理后台实时日志查看器 · 移动端可读性修复 (2026-05-03)

**背景:** 系统监控页 `/admin/monitor` 的 `RealtimeLogViewer` 在移动端出现两个明显问题:

1. **嵌入态日志面板** 高 500px, 顶部头部 + 滤镜区合计要占 ~410px (字号滑块、级别 select、ALL/ERROR/WARN/INFO/DEBUG 标签、关键字、运行时下拉、换行/紧凑/行信息、导出按钮全部 wrap 成 6+ 行), 留给日志正文的可视空间被压到 ~90px, 仅能显示 2-3 行 access log。
2. **全屏态顶栏** 把标题 + 状态徽章 + "200 行 · 时间" + "工具栏" toggle + 4 个动作按钮 + 关闭 X 强行塞在一行, 在 ~390px 宽的手机上严重挤压, 文字标签竖排叠字。

**Fixed (`apps/admin/src/pages/dashboard/components/RealtimeLogViewer.tsx`):**

- 新增 `embeddedFiltersExpanded` state, 嵌入态头部增加 **`筛选` 折叠按钮 (`lg:hidden`)** —— 移动端 / 平板默认收起, `lg` (1024px+) 桌面端按钮自动消失, 滤镜区域始终展开维持原桌面体验。折叠态下日志正文从 ~90px 跃升到 ~430px, 真正可读。
- 折叠/展开走 `AnimatePresence` + `motion.div` 高度过渡 (与全屏工具栏同款 250ms `[0.22, 1, 0.36, 1]`), 不出现内容跳变。
- "最近成功: HH:MM:SS" 标签在移动端从挤压在按钮组旁边的位置, 移到独立 `sm:hidden` 行, 桌面端仍跟在按钮组左侧。
- **全屏顶栏** 改成 `flex-col gap-2 sm:flex-row` —— 手机上标题信息一行 (terminal icon + 标题 + 状态 + 行数·时间)、工具按钮组单独成行 (工具栏 / 刷新 / 滚动锁 / 暂停 / 清屏 / 关闭), 不再挤压; `sm` (640px+) 起恢复单行布局, 桌面体验零退化。
- 标题徽章 `ml-1` 余量统一去掉, 改用父容器 `gap-2` + `flex-wrap` 控制间距, 在窄屏更紧凑且不会断词换行。

**Verified:**

- `pnpm typecheck` ✅
- `pnpm build` ✅
- `pnpm design-system:check` ✅ (0 errors, 红线保持)
- 嵌入态桌面 (`lg+`): 行为与改动前一致 (滤镜常驻, 无折叠按钮)。
- 嵌入态移动 (`<lg`): 默认收起滤镜, 点击 `筛选 ▾` 展开, 再点收起。

### ✨🐛 管理后台侧边栏搜索 · 修复半成品并升级为多通道预览 (2026-05-03)

**背景:** 管理后台一共有三个搜索入口, 都各自有问题:
1. **侧边栏搜索框** —— 表单 `onSubmit` 已经接线, Enter 时跳转 `/posts?search=<keyword>`; 但 `PostsPage` 只读本地 state, 完全不解析 URL 上的 `search=` 参数, 导致关键词被 URL 吞掉, 列表不会被过滤、PostsPage 自己的搜索框也是空的。
2. **顶栏 Header 搜索框** —— 纯装饰, 没 `value` / `onChange` / `onSubmit`, 是死代码。
3. **PostsPage 内搜索框** —— 工作正常但仅页内可用。

加上已有的 `⌘K` 命令面板, 等于"四个搜索入口、三种残缺"。本次按"角色不重叠"清理: 侧边栏 = 内容快速搜索 (文章 / 媒体 / 分类 / 标签); ⌘K = 命令导航; PostsPage = 页内细化筛选; Header 死框直接删除。

**Fixed:**

- **`apps/admin/src/pages/PostsPage.tsx`** —— 接入 `useSearchParams`, 把 `?search=` 作为关键词的唯一事实源。`searchQuery` / `debouncedSearch` 都用 URL 值初始化; debounce 稳定后回写 URL (`replace: true` 不污染历史栈); 监听外部 URL 变化 (如侧边栏跳转) 同步回输入框, 用 `prev === urlSearch` 短路防止与本地 typing 互踩。副产品: 复制链接、刷新、浏览器后退都自动保留搜索状态。
- **`apps/admin/src/components/layout/Header.tsx`** —— 删除完全没接线的搜索框 + 未使用的 `Search` lucide import; 容器从 `justify-between` 改成 `justify-end`, 让右侧用户菜单/通知/主题切换正确贴右。

**Added:**

- **`apps/admin/src/components/layout/SidebarSearchPalette.tsx` (新)** —— 侧边栏搜索的 Inline 预览面板:
  - **多通道并发**: `Promise.allSettled` 同时打 `postService.getList({ keyword, pageSize:5 })` + `mediaService.getList({ keyword, pageSize:3 })`, 单通道失败不连坐 (各自记日志, 仍能展示其它通道结果); 分类/标签量小, 一次性拉全量后本地子串过滤 (top 3 each)。
  - **键盘导航**: ↑↓ 循环 active 项 + ↵ 进入 + esc 关闭, 用 window 级 keydown listener (与 CommandPalette 一致); 仅在锚点可见时绑定监听器, 移动/桌面双 SidebarContent 实例不会重复触发 Enter。
  - **Portal 定位**: 因 `motion.aside` 上有 `transform-gpu` + `overflow-hidden`, 任何 `position:fixed` 子元素都会被它做成"包含块"截断 —— 所以走 `createPortal(document.body)` + 实时 `getBoundingClientRect` 锚定; 监听 resize / capture-scroll 自动跟随; 锚点宽度为 0 (collapsed) 或 translate 到屏外 (移动抽屉关闭) 时直接 `pos = null` 不渲染。
  - **三态 + a11y**: loading 用骨架屏 (3 行 pulse, 不用 spinner, 守 §3.6); empty 走 `font-editorial italic` 一行 + `font-mono uppercase tracking` 副提示 (Aether Codex §3.4 排版); error 用 `--signal-warn` 单行 + `role="alert"`; 容器 `role="listbox"` + 每项 `role="option"` + `aria-selected`; 输入框升级为 `role="combobox"` + `aria-expanded` + `aria-autocomplete="list"`。
  - **样式**: 用 `surface-overlay` token 类 (modal 级表面, blur + aurora glow), active 行用 `color-mix(in oklch, var(--aurora-1) 14%, transparent)` + 左侧 aurora 渐变光柱 (与 `CommandPalette.tsx:201-209` 同一模式), 全程零 `dark:` 变体 / 零裸 hex / 零品牌渐变 (Aether Codex 六硬规则 §3.4)。
  - **底部 footer**: `查看 "X" 的全部文章` 永远作为最后一项, 无内容命中时也保留 —— 与 P1.1 修复联动, 点击或 Enter 兜底跳到 `/posts?search=` 让 PostsPage 用更宽条件继续搜。

- **`apps/admin/src/components/layout/Sidebar.tsx`** —— 接入 palette: 新增 `paletteOpen` state + `handleSelectPaletteItem` (清空输入 + 关移动抽屉 + `startTransition` 路由跳转) + `closePalette`; 给搜索 input 包裹 `searchAnchorRef` 作为 portal 锚点; `onChange` / `onFocus` 按"输入有内容时打开 palette"语义切换; `handleSearch` 在 palette 打开时直接 `return` 兜底 (palette 的 window listener 已 `preventDefault` 掉 Enter 的 form submit, 这里防御性双保险)。

**Why 不把侧边栏搜索做成命令面板的复刻:** 命令面板 (`⌘K` / `CommandPalette.tsx`) 的语义是"执行命令 / 跳转设置页", 是**键盘党**专属; 侧边栏搜索的语义是"在站内**内容**里找东西", 是**鼠标党**入口。两者职责正交, 合并会牺牲两边的速度感。Linear / Notion / Vercel 都是这么分的。

**Why 分类/标签不走后端 keyword:** 这两个表通常 < 200 行, 一次拉全量再 `includes` 过滤的延迟比再发一次 HTTP 还低, 也避免给后端加专门的 search endpoint。如果将来量级到千级, 改成同 `postService.getList` 模式的 `?keyword=` 即可, 接口面零改动。

**已知未做 (后续可选 P3):** 后端聚合 endpoint `/api/v1/admin/search` —— 当前前端打 2 个独立 HTTP 请求, 在 fast 网络下没问题, 慢网 / 移动端首字延迟可见。要做的话改成单次请求 + 后端 fan-out 即可, 不影响当前契约。

### ✨ Search Profiles · 完整管理 UI + 索引 profile 化 chunking pipeline (2026-05-02 / 2026-05-03)

**背景:** PR #541 早期用 token-truncation 止住了 8192 token 上限造成的 400, 但代价是长博文（如 23K+ 字符）尾部被静默丢失, RAG 召回不到 —— 违反"知识库不该截断"原则。同时 admin 侧 SearchConfigPage 只能换嵌入模型, 切 chunking 策略 / 切片参数都得跑 SQL, 蓝绿协议 (000034) 也只在 model_id 维度生效。本次把整条索引链升级为业界标准的 chunking pipeline + profile 化配置 + admin 可视化操作面 + SSE 流式 reindex。

**Added (后端):**

- **`apps/server-go/migrations/000041_search_profiles`** —— 新建 `search_profiles` 表把 `(chunker_kind, model_id, chunk_size_tokens, overlap_tokens)` 四元组绑成一个完整 profile, 复用 000034 的蓝绿翻转协议（`status` ∈ active/shadow/deprecated/archived; `code` 唯一; `params` jsonb 兜底未来扩展）。`post_embeddings` 加 `profile_id` + `chunk_index` + `chunk_text` 三列, 存量行整体归到默认 profile（chunk_index=0、chunk_text=NULL, 仍可被搜到）。
- **`apps/server-go/migrations/000044_post_embedding_parent_text`** —— 给 `post_embeddings` 加 `parent_text TEXT`, 配合 parent_child chunker（child 高精度召回 / parent 高上下文回显）。PG 17 的 `ADD COLUMN IF NOT EXISTS` 是 instant DDL, 不重写表。
- **`apps/ai-service/app/services/chunker.py`** —— 5 种 chunker_kind: `recursive`（按段落 / 句子递归切, 默认）、`fixed`（固定 token 窗口）、`markdown`（按 # / ## / ### 层级保持文档结构）、`qa`（专为 FAQ / Q&A 内容设计）、`parent_child`（child 嵌入召回 + parent 文本回显）。每个策略独立单元测试。
- **`apps/server-go/internal/handler/search_handler.go`** —— Search Profiles CRUD（list / create / activate / archive / delete）+ `POST /v1/admin/search/profiles/:code/reindex/stream` SSE 流式重建端点 + `POST .../retry-failed?profileCode=` 影子恢复入口。SSE 加锁守护（同 profile 同时只能跑一个 reindex）, 锁竞争返回 HTTP 409 而非 200 信封, cancel-aborted 路径补 terminal SSE error frame。
- **`apps/ai-service/app/services/vector_store.py`** —— parent_child profile 写 / 读时持久化 parent_text, 其他 profile 该列为 NULL。

**Added (前端):**

- **`apps/admin/src/services/searchProfileService.ts` + `useSearchProfiles` (React Query)** —— Profile CRUD + active/shadow 状态查询。
- **`apps/admin/src/hooks/useReindexStream.ts`** —— SSE 消费 hook, 把后端 `progress / chunk / done / error / result` 五种事件帧解析成 React state, 支持 `cancel()` 主动取消 + `prefers-reduced-motion` 适配; 复用 `EventSource` polyfill 处理浏览器跨域 cookie。
- **`apps/admin/src/pages/search-config/components/`（新）** —— `ProfileListCard`（列表 + status 徽标 + 操作按钮）、`CreateProfileModal`（chunker_kind 选择 + 切片参数表单 + 模型选择, 走 `Modal` portal）、`ProfileDetailDrawer`（详情 + chunk 抽样 + reindex 进度）、`ChunkerKindSelector`（5 选 1 + 帮助文案 + 适用场景图）、`ProfileActivationFlow`（shadow → active 翻转确认 + 影响范围预览）、`ProfileManagementSection`（顶层装配）。

**Verified:**

- `pnpm typecheck` ✅ / `go test ./...` ✅ / `pnpm test` (chunker 单测全部通过) ✅
- 真机回归: 长博文（23682 chars）切 parent_child profile, child chunks 正常召回, parent_text 渲染到 SearchPanel 来源卡片; 蓝绿翻转 shadow → active 时, 任意一篇 reindex 失败均不翻转指针, shadow 保留供修复。
- 5/3 评审跟进（`d164a578` / `8277e68a` / `ea0f7733` / `5fe111bb` / `03ac7b39` / `7b94e3f4` / `4c639e36` / `ff08d0f5`）—— gemini / codex review 8 条, SSE 健壮性手册见 `docs/SEARCH_PROFILES_FOLLOWUP_PLAN.md`。

**Why 把 chunker 抽到 5 种独立策略而不是单一可调参函数:** 不同内容类型（技术博客 / FAQ / 长论文 / 代码片段）的最优切法在 token 距离上根本不连续, 一个统一函数永远在某一类上欠拟合。5 种策略各自独立测试, 切换是 profile 级原子操作, 蓝绿协议保证零切换窗口。

### ✨ 对象存储完整打通 + 双向管理 + Fernet 加密 (2026-05-03)

**真问题:** 此前 storage 抽象层是装饰性的 —— 前端选了"S3 / R2 / OSS / COS / MinIO"也无效, 新文件永远进 `./uploads`; `PermanentDeleteBatch` 存在 ownership 越权 + 孤儿文件残留; 大文件上传走 RAM 一次性载入, 256MB 文件能让 server-go OOM; admin 侧无法看到云上已有但 DB 没记录的孤儿文件。

**Added / Changed (一次性补齐六层能力):**

- **路由 (Router)** —— 上传请求按 `default storage_provider` 路由, 不再硬接 LOCAL; 删除既删 DB 行也调 storage 层 `DeleteObject` 异步对账。
- **流式 multipart (Streaming Upload)** —— 大文件改 `io.Pipe` + 5MB chunk + AWS SDK `s3.PutObject` streaming, RAM 占用稳定在 ~20MB 不论文件大小。
- **Secret 加密** —— `storage_providers.access_key_secret` 字段走 Fernet 加密落库, 加密 key 来自 `AI_CREDENTIAL_ENCRYPTION_KEYS` 多 key 轮换列表（与 ai_credentials 同源）。`GET /v1/admin/storage` 永不返回明文 secret, 仅返回 `secretFingerprint`（前 8 位 hash）让 admin 验证一致性。
- **Ownership + 越权修复** —— `PermanentDeleteBatch` 加 user_id 校验; "孤儿"扫描端点 `POST /v1/admin/storage/:id/objects` 列出云端有但 DB 无的对象, `POST .../import` 反向导入到 media 库, `DELETE .../objects` 批量清云端孤儿。
- **Migration 000042** —— `align_storage_provider_types`: CHECK 约束扩展到 R2（之前 `factory.go` 接受但 SQL 拒绝, 创建 R2 provider / 上传 R2 文件直接失败 — VULN-fix）; 同步给 `media_variants` 加 `storage_provider_id` 让缩略图与主文件保持同源。
- **Sync handler (`sync_handler.go`, 新)** —— Phase 4 存量本地文件入云任务队列：`POST /v1/admin/storage/sync/start`（入队 + 启 worker）/ `POST .../cancel`（优雅停, in-flight chunk 跑完即停）/ `GET .../status`（worker 数 + counts）/ `GET .../failed` / `POST .../retry`; 单文件入口 `POST /v1/admin/media/:id/sync`。
- **Migration 000043** —— `add_media_sync`: `media_files` 加 `sync_status` / `sync_error` / `synced_at`, 新建 `media_sync_jobs` 任务表（含 status / error / retried_at / max_retries）。
- **Admin UI** —— `StorageProviderSettings`（provider CRUD + test connection + secret rotate）、`MediaSyncDashboard`（队列状态 + 失败列表 + 重试 / 全部重试 / 取消）、`DeleteMediaConfirmModal`（明确"仅删 DB / 同时删云端 / 同时删本地"三态预选）。

**Verified:** `go test ./internal/handler/...` ✅; AWS SDK 流式上传压测 256MB / 1GB 文件 RAM 稳定; Fernet 多 key 轮换 manual test。

### ✦ JWT 签名密钥轮换 UI + meta 端点 (2026-05-03)

**背景:** `POST /v1/admin/auth/rotate-jwt-secret` 早就实现（VULN-152 跟进）, 但 admin 零 UI, curl-only。应急时刻（commit 误推 token / 怀疑泄露）找运维 SSH 操作, 错过黄金时间, 违背"敏感操作 UI 化"原则。

**Added:**

- **后端 `GET /v1/admin/auth/jwt-secret-meta`** —— 返回 `currentPromotedAt` / `previousDemotedAt` / `previousRetiresAt` / `rotationIntervalDays` / `previousGraceHours`; **永不返回 `secret_value`**, 元数据仅含时间戳与配置间隔。
- **`apps/admin/src/pages/dashboard/components/JwtRotationCard.tsx`** —— 系统监控页新增"JWT 密钥状态"卡, 双行 MetaRow 排版（current / previous + 各自时间）+ "立即轮换"按钮 + 二次确认 modal（影响范围预览：所有未到期 access token 在 grace 期内仍可用, refresh token 立即失效需要重登）+ 操作完成后 `activity_events` 审计。
- **`5121ae5b` / `696ee85e` / `71e1c39d` / `70fbd497`** —— Codex 评审跟进：MetaRow label hierarchy 修复、Aether Codex token 对齐、`yyyy/dd` 格式 lowercase 修正、Aurora-1 hover stripe。
- **`d48af82e fix(security): 修正 JWT 轮换元数据默认值`** —— 配置缺失时回退到 30 天 / 24 小时（与 `auth_handler.go::DefaultJwtRotationConfig()` 对齐）。

### ✨ AI Prompt 编辑器 · 「恢复默认」按钮 + diff 预览 (2026-05-03)

**背景:** 审计 P1.6: 编辑器只有 `Default` 单 toggle 看默认 prompt, 改坏只能跑 SQL 回滚, 也无法直观看到自己改了什么。

**Changed (`apps/admin/src/pages/ai-config/components/PromptEditor.tsx`):**

- 顶栏新增 **「恢复默认」** 按钮 —— 点开二次确认 modal 显示"将丢弃当前所有修改, 此操作不可撤销", 确认后把 `prompt_text` 重置为 `ai_task_types.default_prompt_text`, 不删数据库行。
- 新增 **「Diff 预览」** 切换 —— 工作区上方加 segmented control（`Edit / Diff / Default`）。Diff 模式用 `react-diff-viewer` 渲染左右双栏, 高亮新增 / 删除 / 修改行; Default 模式只读显示出厂 prompt 模板。
- 占位符提示 chip row（`{content}` / `{max_length}` / `{existing_tags}` / `{depth}` / `{style}` / `{source_lang}` / `{target_lang}`）—— 点 chip 直接插入光标位置, 减少手敲拼写错误。

**Verified:** 评审跟进 `812a130a` / `d3956eea` —— inline diff 在 Mobile Safari 上 viewport 溢出修复 + reduced-motion 适配。

### ✨ AI 仪表盘 · 任务费用下钻柱状图 (2026-05-03)

**问题:** `GET /v1/admin/stats/ai-dashboard` 早就在 response 返回 `taskDistribution[]`（task / calls / tokens / cost / percentage）, AnalyticsPage 也已经把它解到 `data.taskDistribution` —— 但**根本没渲染**。运营人员无法回答"哪个 AI 工具最贵 / 该砍哪个"。

**Added (`apps/admin/src/pages/AnalyticsPage.tsx`):**

- 新 `TaskCostBarChart` —— recharts horizontal bar, x 轴 cost (USD), y 轴 task name, 颜色按 percentage 从 aurora-1 渐变到 signal-warn（>40% 高亮 warn）, hover 显示 tokens / calls / 平均单次成本。
- "稳定颜色"修复（`1dba555d`）—— task 名 → aurora 色映射用确定性 hash 而非 index, 避免数据集顺序变化时颜色乱跳。

### ✨ AI 缓存扩展 polish / outline + fallback 6 条合约锁定 (2026-05-03)

**Added:**

- **`apps/ai-service/app/api/routes/ai.py`** —— polish / outline 任务接 Redis 缓存, TTL 1 小时, key 含 `model_alias + content_hash + max_length + style/depth`。审计 §1.2 / §4.2 标记为"无 Redis 缓存"的最后两个真实成本浪费点本次清零。
- **`4f221736 feat(ai-fallback): chat() 路径对齐 stream_chat() + 锁住 6 条 fallback 合约`** —— 把流式与非流式 fallback 链路统一到同一组单元测试, 锁住六条契约：① fallback prep 失败保留 primary error; ② primary success 短路不触发 fallback; ③ primary 5xx 触发 fallback; ④ primary 4xx 不触发 fallback（用户输入问题不是 provider 问题）; ⑤ fallback 也失败时优先抛 primary error; ⑥ override 模型缺 credential 时降级到 env-fallback 并标记 `fallback_used: true`。

### ✨ QA SearchPanel 来源渲染 + result event (2026-05-03)

**Added:**

- **`apps/blog/app/components/SearchPanel.tsx`** —— QA 模式下流式追加来源卡片：每条来源卡显示 post 标题、chunk 片段、相似度分数、跳转链接; parent_child profile 下额外显示 parent_text 折叠区。
- **`apps/ai-service/app/api/routes/search.py::qa`** —— SSE 流尾部补 `result` 事件帧（含 `sources: [{postId, slug, title, score, parentText?}]`）, 与之前的 `delta` / `done` / `error` 帧拼成完整契约; 旧客户端不读 result 不影响。
- **`2adc4138 fix(blog): make QA source keys unique`** —— React key 用 `postId + chunkIndex` 复合键, 避免同一篇文章多 chunk 命中时 React 报 key 冲突。

### 🎨 admin Codex 升级波次 · CategoriesPage / ActivitiesPage / Dashboard / Select / JwtRotationCard (2026-05-03)

CategoriesPage / ActivitiesPage 此前是平铺无设计的"`bg-white/5` 玻璃 + 命名色标签"基线, 与 `/design`、`/about` 建立的 aurora 设计语言彻底脱节。本波次集中迁移：

- **`09710346 feat(admin): upgrade CategoriesPage to Aether Codex design`** —— 卡片走 `surface-leaf` + `data-interactive`, 标签走 aurora-1..4 而非 Tailwind named color, 编辑按钮 bug 修复, stagger 入场动画。
- **`b87f4dff feat(admin): unify ActivitiesPage & RealtimeLogViewer filter UI to Aether Codex`** —— 两个列表页的滤镜区从手写 UI 统一到 Codex 共享原子（在此之前是 PostsPage 滤镜重构的"实验场"）。
- **`eebcba8e fix(admin): polish dashboard and select surfaces`** + **`9a3b592f fix(admin): close styled select on focus loss`** —— 仪表盘 KPI 卡 + select 失焦关闭。
- **`98c2bb98 fix(admin): remove redundant light surface rules`** + **`1feff576 fix(admin): warm new admin surfaces`** —— light 主题下重复的 surface override 移除, light/dark 切换不再有"冷色一闪"。
- **`150ea16e chore(ai-tools): 删除 pages/ai-tools/ 死代码（7 文件 / 683 行）`** —— `/ai-tools/*` 路由早已被 `AiWritingWorkspace` 取代但残留导致 sidebar 双入口, 一次性清理。
- **`78f9120a fix(blog): remove hardcoded image domain`** —— 删掉 next.config.ts 中硬编码的 `cdn.aetherblog.com`, 让 blog 在自部署 / R2 / Cloudfront 三种 CDN 形态下都能加载图片。

### 🐛 Webhook 安全加固 + secret rotation 文档 (2026-05-03)

**Added:**

- **`a7540924 Harden webhook requests against proxy and connection hangs`** —— `ops/webhook/server.go` 读 / 写超时 + IdleTimeout 显式设置, 防止 HTTPS 反代后端 hang 住导致 systemd `MainPID dead`; HMAC verify 失败时不再 echo body, 改用 fixed-time response 防 timing leak。
- **`0bb120c8 docs(webhook): document secret rotation`** —— 新增 `docs/ops/webhook-secret-rotation.md`：① 生成新 secret 的 openssl 命令; ② GitHub Repository Secrets 替换流程; ③ 服务器侧 systemd 环境文件替换 + `systemctl restart aetherblog-webhook` 顺序; ④ 旧 secret 优雅过渡（双 secret 并行 24 小时窗口）。

### 📚 CLAUDE.md 拆分为渐进披露式分层文档 (2026-05-03)

**Changed (`f2f578b8 docs(claude): 拆分 CLAUDE.md 为渐进披露式分层文档`):**

- 把原 CLAUDE.md（~30K 字, 含完整 API 表 / migration 历史 / 故障速查 / 启动指南）按主题拆到 `.claude/docs/`：`startup-and-env.md`、`backend-runtime.md`、`api-handlers.md`、`database-migrations.md`、`deployment-cicd.md`、`troubleshooting.md`、`dependencies-and-stack.md`。
- CLAUDE.md 顶部补"子文档导航"表 —— "触发场景 → 必读文档"映射, AI agent 按需 Read, 不再一次性吃掉 30K context。
- **`780e270f docs(claude): 应对 PR #561 的 4 条评审建议`** + **`2f160ba7 docs(api-handlers): 澄清「Handler 文件」列不含 .go 扩展名`** —— PR #561 评审跟进 4 条 + 表格列含义澄清。

### 🐛 ActivitiesPage 多维筛选修复 + 时间常量 refactor (2026-05-02)

**问题:** ActivitiesPage 分类筛选选了"comment"后, 列表反而显示全部事件而非仅 comment。原因是 `ActivityFilter` 的 `category` 参数与 `kind` 参数 OR 关系而非 AND, 后端 SQL `WHERE category = ? OR kind = ?` 而不是 `AND`。

**Fixed (`971478d2`):** SQL 改为 `AND` 语义, 同时给 ActivitiesPage 加多轴筛选（category / kind / actor / time range / status 五维同时生效）。`f903d263 refactor(activities): 采纳 #543 评审 —— time.Hour / time.Nanosecond 替代魔术数字` 把 `60*60*1000_000_000` 这类魔术数字替换为 `time.Hour` 等常量。

### ✨ 文章 AI 工具 · 应用前差量预览 (long text modal + short field inline) (2026-05-01)

**背景:** 旧版 AI 工具点"应用"立刻生效, 没有 confirm 步骤 —— 5 万字润色一念之差就替换原文, 撤销只能靠 `Ctrl+Z` 编辑器历史栈, 用户表示"心脏病发"。

**Added:**

- **`b994dd3c feat(ai-tools): 标签可勾选 + 摘要/标题/标签应用前后差量预览（短字段 inline）`** —— 摘要 / 标题 / 标签三类短字段在工具卡内联 inline diff: 左旧右新, 颜色高亮添加 / 删除 / 修改; 标签从"全选 / 全不选"升级为单标签可勾选 + bulk action。
- **`bf65457a feat(ai-tools): 润色/翻译/大纲 应用前的长文本 modal 预览（diff/split/render 分形态）`** —— 长文本走 modal: ① **Diff 模式** 双栏左右对比（react-diff-viewer 行级 highlight）; ② **Split 模式** 上下并排 markdown render; ③ **Render 模式** 仅新版本（看最终效果）。三态切换无缝, 模态 ESC 关闭, 应用按钮在 modal 底部 sticky。
- **`46084d43 feat(admin): 文章「修改信息」摘要字段补 AI 生成入口 + 模型选择 + 调位置`** —— PostInfoEditor 摘要字段右侧加"AI 生成"按钮, 走 ModelSelector 选模型, 异步生成后填回 textarea。
- **`24b60f1f fix(ai-tools): 修复移动端「生成结果」卡片标题截断与目标文章下拉框溢出`** + **`3e26fef6 refactor(ai-tools): 采纳 #535 评审 —— 目标文章下拉框迁移到 createPortal`** —— 目标文章下拉走 portal 突破 `overflow:hidden` 父容器截断。
- **`741a45d7 fix(post): 摘要字符上限三层不统一，硬截 200 与 AI 工具/DB 不一致`** —— 编辑器 / AI 工具 / DB 三层上限 200 / 1000 / 2000 不一致, 统一到 2000 (与 migration 000039 后的 `posts.summary VARCHAR(2000)` 对齐)。
- **`6557f6b2 fix(admin): ModelSelector 按钮缺 type="button" 导致表单内点击触发提交`** —— 同表单内点 ModelSelector 触发整个表单 submit 的 bug 修复, 是个 React 默认 `<button>` type="submit" 的老坑。

### 🛠️ 一键启动真正开箱即用 (2026-05-01)

**背景:** 新克隆仓库的本机模式启动有一系列暗坑 —— `.env.example` 是纯生产模板（POSTGRES_PASSWORD 空 / REDIS_HOST=redis / AUTH_COOKIE_SECURE=true）但被 `start.sh` 本机模式 source 给 Go 后端, 导致 PG 鉴权失败 + Redis 主机解析失败; `apps/blog/.env.local.example` 不存在, 博客首页"管理后台"按钮以"未配置"灰态展示无法点击; `.gitignore` 里有一条孤立的 `apps/blog/.env.local.example` 忽略规则—— 模板文件本身被 git 忽略, 是上述缺失的元根因。

**Fixed (`0357df1f feat(dx): 一键启动真正开箱即用`):**

- **`start.sh::bootstrap_env()`** —— 紧接 `check_dependencies()` 之后调用, 自动: ① 缺 `.env` → 从 `.env.example` 拷贝; ② JWT_SECRET / AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN / AI_INTERNAL_SERVICE_TOKEN / AI_CREDENTIAL_ENCRYPTION_KEYS 任一为空 → 用 `openssl rand -base64 48` / `cryptography Fernet` 就地生成（已有非空值不覆盖, 保护用户手填）; ③ 缺 `apps/{blog,admin}/.env.local` → 从 `.env.local.example` 拷贝; ④ 跨平台 `sed -i` 兼容（GNU vs BSD）, Python cryptography 缺失时回退到 openssl 生成等价 Fernet key。
- **`.env.example`** —— 重写为开箱即用模板: `POSTGRES_PASSWORD=aetherblog123` / `REDIS_HOST=localhost` / `REDIS_PASSWORD=aetherblog_dev` / `AUTH_COOKIE_SECURE=false` 与 `docker-compose.yml` 容器配置对齐, cp 出来直接可跑。引入 `[LOCAL DEV]` / `[PROD]` / `[AUTO-GEN]` 三类字段标签, 明确每个值在两种模式下应是什么。
- **`.gitignore`** —— 删除 `apps/blog/.env.local.example` 忽略规则; 新增 `apps/blog/.env.local.example` 模板文件（NEXT_PUBLIC_ADMIN_URL / NEXT_PUBLIC_API_BASE_URL 占位）。
- **结果:** 新克隆 → `./start.sh --gateway` 单命令直接到 `http://localhost:7899` 完整服务启动, 不再需要任何手动 `.env` 编辑。

### ✨ AI 标签工具 · 现有标签库感知 + 双段选择 UX (2026-05-01)

**背景:** 旧版 AI Tagger 只会基于内容"凭空"生成标签字符串, 完全不知道站点已有哪些标签 —— 经常把"人工智能"重新生成成"AI", 让用户手动改标签 / 接受重复。本次让 AI Tagger 升级为"先复用, 再补新建"的双段输出模式, 并把"复用 vs 创建"的应用副作用在 UI 上可视化分离。

**Changed:**

- **`apps/ai-service/app/schemas/ai.py`** —— `TagsRequest` 新增可选 `existingTags: list[ExistingTagHint]` (上限 200, 每项 `{name, postCount}`), 让前端把站点标签库 (按 postCount 降序截断) 作为提示传入。`TagsData` 新增 `matches: list[TagMatch]` (`name + postCount + reason?`) 与 `suggestions: list[str]` 两段; 同时保留 `tags: list[str]` 扁平合并视图给老客户端零改动兼容。
- **`apps/ai-service/app/api/routes/ai.py`** —— 新增 `_format_existing_tags_block` (按热度排序渲染, 空库渲染为 `(无)`)、`_existing_tags_signature` (差异化缓存 key)、`_parse_tags_structured` 四级降级解析 (严格 `{matches, suggestions}` JSON → 扁平数组兜底 → 幻觉 match 自动降级为 suggestion → match 名字归一到现有库的规范大小写)、`_truncate_tag_payload` (总长截断时优先保留 matches), `_build_existing_lookup` (大小写无关 lookup)。`/tags` 与 `/tags/stream` 都接入新 prompt 变量, 缓存 key 加入 existing_tags 签名防止陈旧分桶, 流式 `_build_stream_result_payload` 走同一套结构化分桶, 确保流式与同步契约一致。
- **`apps/server-go/migrations/000040_tags_existing_aware_prompt`** —— 重写 `ai_task_types` 中 `tags` 任务的默认 prompt: 接受新增 `{existing_tags}` 占位符, 强制要求模型输出 `{"matches": [{"name", "reason"?}], "suggestions": [...]}` JSON 对象, matches 必须严格命中现有库, 库为空时全部输出在 suggestions。down 迁移还原到 000038 的扁平 JSON 数组形态。
- **`apps/ai-service/app/services/llm_router.py`** —— `_TASK_FALLBACK_SYSTEM_PROMPT['tags']` 同步升级到双段输出形态, 让"DB 路由表为空 / 管理员 override 后模板缺失"的兜底路径也产出新契约, 避免新前端 + 兜底链路组合时拿到旧扁平输出。
- **`apps/admin/src/services/aiService.ts`** —— `TagsRequest` 新增 `existingTags`, `TagsResponse` 新增 `matches?` / `suggestions?`, 新增 `ExistingTagHint` / `TagMatchResponse` 类型导出。
- **`apps/admin/src/lib/aiToolDiff.ts`** —— 新增 `computeTagPlan` 4-bucket 计划函数 (keep / linkExisting / createNew / remove), 与旧 `computeTagDiff` 并存, 让"复用现有"和"创建新建议"在 UI 上可视分离。
- **`apps/admin/src/hooks/useAiToolTarget.ts`** —— `applyTags` 接受 `string[] | {name, tagId?}[]` 两种输入形态; `tagId` 已知时跳过整张标签列表查询, 直接落地, 把"100% matches 命中"路径降为零额外网络往返。
- **`apps/admin/src/components/ai/results/ToolResultRenderer.tsx`** —— `TagsResult` 完全重写为四段式: ① 匹配现有标签 (aurora-1 调, 显示 postCount 徽标 + 匹配理由 tooltip); ② AI 新建议 (signal-success 调, 显示"新建"徽标 + "应用时创建"hint); ③ 添加更多 (从现有库手动搜索 + 加入 AI 漏掉的标签, 受 50 条上限保护, picker 内置去重); ④ 4-bucket 应用计划预览 (保留 / 复用现有 / 新建 / 移除) 取代原 3-bucket。客户端二次校验把"AI 声称匹配但当前库查无"的项降级回 suggestion, 与后端防幻觉策略对齐。
- **`apps/admin/src/components/ai/AIToolsWorkspace.tsx`** —— 切到 `tags` 工具时主动拉取一次标签库 (5 分钟会话内缓存), 运行 prompt 时按 postCount 降序截断到 200 项随请求体下发; 应用后通过 `onTagsLibraryChange` 回调刷新, 让下次再生成时新创建的标签能进 matches 而非 suggestions。
- **`apps/admin/src/pages/posts/components/AiSidePanel.tsx` + `CreatePostPage.tsx`** —— 文章编辑器侧边面板的 AI 标签工具同步接入 `existingTagsForAi`, 直接复用页面已有的 `tags` 状态, 零额外请求即享受"优先复用"语义 (UI 自身仍读 `result.tags` 扁平视图, 应用时由 `useAiToolTarget.applyTags` 兜底"按名查找现有→缺失则创建"语义)。

**Why "matches + suggestions" 分两段而不是 confidence 评分排序:** 评分对用户决策的边际价值低 (用户最关心的是"应用副作用是什么"); 分两段同时把"零成本复用 vs 创建新标签"的副作用清晰可视化, 与 4-bucket 应用计划在视觉上闭环。

**Why "添加更多" picker 不做 Levenshtein 模糊搜索:** 用户的标签库通常 <200 项, 子串匹配 (`includes`) 已经足够; AI 才是真正做语义匹配的层 (它有 LLM 上下文)。Levenshtein 会让 `machinelearning` / `machine_learning` / `machine-learning` 在 picker 中互相纠缠, 反而劣化体验。

### 🐛 AI 写作面板 · 标题渲染脏数据 + 上下文上限过低 (2026-05-01)

**症状 (移动端真机回归):**
1. AI 写作面板"标题建议"渲染成 `1. ["阿里云百炼 Coding Plan 快速上手指南"` / `2. "如何获取百炼 API Key 并开始使用?"` / `... 6. "Claude Code 与 Codex 的百炼接入说明"]` —— 每一项都残留 JSON 数组的方括号或外层引号, 点击替换标题时连标点一起灌进文章标题。
2. 一篇 27222 字的中长博文, 任意 AI 工具按钮 (摘要 / 标签 / 标题 / 润色 / 大纲 / 翻译) 点击后立刻弹出 toast "Content too large", 完全无法生成。

**根因:**
1. **`/api/v1/ai/titles` 非流式端点用 `_split_list` 解析:** [apps/ai-service/app/api/routes/ai.py:730](apps/ai-service/app/api/routes/ai.py#L730) 旧代码 `titles=_split_list(response_text)`。但 migration 000038 已经把 prompt 改成"输出 JSON 数组" —— LLM 现在返回 `["t1", "t2", ...]`, `_split_list` 只是按逗号粗暴切, 不剥离 `[]"` 外层符号, 直接把 JSON 数组切成 `["t1"`, `"t2"`, `..."tN]"`。流式端点 (`_build_stream_result_payload`) 和 tags 同名端点 (用 `_parse_tags` + `_filter_tags`) 早就走对路径, 只有这一条非流式 titles 漏修。
2. **`max_input_chars=20000` 默认上限过低:** [apps/ai-service/app/core/config.py:251](apps/ai-service/app/core/config.py#L251) 旧默认 20000 字符。这是 GPT-3.5 时代的保守值, 当前 GPT-5 / Claude 4.x 上下文窗口 ≥ 200K tokens (中英混排约 600K 字符), 卡 20K 完全没意义, 反而把"中长技术博客"挡在工具门外。
3. (附带) **`_parse_titles` 不会按逗号切单行:** 历史遗留版本只覆盖 JSON / 编号 / 项目符号 / 换行四条路径, LLM 偶发在单行回写 `标题一, 标题二, 标题三` 时会被当成单条标题。`_parse_tags` 一直是切逗号的, 只是 `_parse_titles` 漏了。

**Fixed:**

- **`apps/ai-service/app/api/routes/ai.py`** —— `titles()` 非流式端点 `_split_list(response_text)` → `_parse_titles(response_text)`, 与流式端点对齐, JSON 数组优先解析 + Unicode 引号 + 方括号外层剥除。同时扩展 `_parse_titles` 在每个 line 上对 `[,，;；]` 做切分, 兜住 LLM 单行回写多个标题的退化形态 (与 `_parse_tags` 一致)。
- **`apps/ai-service/app/core/config.py`** —— `max_input_chars` 默认值 `20000` → `120000` (~40K tokens), 中长博文 (3 万字级) 不再被无端拒绝, 仍能拦住明显异常的滥用。生产环境可继续通过 `AI_MAX_INPUT_CHARS` env 覆盖。
- **`apps/ai-service/app/api/routes/{ai,search}.py`** —— `_enforce_content_limit` 错误详情从空洞的 `"Content too large"` 改成 `"Content too large: {size} chars exceeds {limit} limit"`, 让用户在 toast 上能看到当前字数和实际上限, 配合 admin axios 错误透传链路自然展示。
- **`apps/ai-service/tests/test_ai_routes.py`** —— 新增 `test_titles_endpoint_strips_json_array_brackets` 回归: 模拟 LLM 输出 `["t1", "t2", "t3"]`, 断言响应 `data.titles` 等于 `["t1", "t2", "t3"]` 而不是 `['["t1"', '"t2"', '"t3"]']`, 同时断言每条不含 `[]"` 任一字符。
- **`apps/ai-service/tests/test_search_limit.py`** —— `test_semantic_search_content_limit` 加 `monkeypatch` 把 `settings.max_input_chars` 临时压到 1024, 避免 12 万字符级别的 GET 查询撞到 httpx `MAX_URL_LENGTH` (这是测试环境约束, 不是产品行为)。

**为什么 `_parse_titles` 加逗号切分不会破坏含逗号的合法标题:** prompt (migration 000038) 已经强制 LLM 输出 JSON 数组, JSON 路径优先, 含逗号的标题在数组中是被引号包裹的字符串字面量, `json.loads` 会保留逗号; 只有当 LLM 退化到非 JSON / 非编号 / 非换行的单行输出时才走逗号切分, 那种场景下含逗号的标题被切是可接受的代价 (远好过把整个 JSON 数组渲染成单条带括号的脏数据)。`tags` 端点早就这么做了。

### 🤖 AI 工具实际可用度修复 (2026-04-25)

**症状:** AI 摘要在博客后台被反馈"完全不可用" —— 设定 200 字, 实际经常返回上千字、问答风格、分点小标题, 与摘要语义完全不符。其他 chat 类工具 (tags / titles / polish / outline / translate / qa) 也程度不一地放飞。

**根因:** 三层断裂叠加。
1. **system/user 拆分时 `{content}` 字面量泄露:** [apps/ai-service/app/services/llm_router.py](apps/ai-service/app/services/llm_router.py) 旧实现把整个 prompt template 当成 system prompt 渲染, 仅排除 `content` 变量。结果 system 消息末尾出现字面量 `{content}`, 模型把它当成"请补全"指令, 紧接 user 中的真实正文继续放飞。
2. **`max_tokens` 在 env-fallback 路径上为 `None`:** 当 `ai_task_routing` 表为空 (新部署 / 本地 mock) 或管理员 override 模型时, `_resolve_route` / `_resolve_override` 都返回 `max_tokens=None`, LiteLLM 直接转给上游, 模型按上下文窗口上限输出。
3. **默认 prompt 软约束太弱:** migration 000019 / 000017 的 seed prompt (例如 `请为以下内容生成摘要（{max_length}字以内）：{content}`) 没有禁止问答 / 分点 / 前缀, LLM 把字数当成软建议而非硬约束。
4. (附带) **`<think>` 检测只识别一个变体:** 仅匹配 `<think>`, Qwen / R1 / 自定义 prompt 用的 `<thinking>` / `<reasoning>` 全部漏过, 推理痕迹直接污染流式输出。
5. (附带) **`posts.summary VARCHAR(500)` vs `MaxLength` 范围 10-2000 不一致:** 即使 LLM 严格按字数输出, `maxLength=1000` 也会在保存时被 PG 截断报错。

**Fixed:**

- **`apps/ai-service/app/services/llm_router.py`** —— 重写 `_build_messages()` 在 `{content}` 标记处切分模板: head 渲染为 system (含其他占位符替换), tail (如有) 拼到 system 末尾, 真实 content 进 user; 新增模块级 `_TASK_DEFAULT_MAX_TOKENS` 表, env-fallback 路径与 `_resolve_override` 都按 task 名兜底 (summary 600 / tags 200 / titles 300 / polish 4000 / outline 2000 / translate 2000 / qa 2000), 与 migration 000019 seed 默认值一致; `stream_chat_with_think_detection` 切换到正则 `<\s*(think|thinking|reasoning)\s*>` (大小写不敏感, 容忍内部空格) 并基于 `match.start/end()` 切片, 同时把 guard 长度从 8 提升到 `len("</reasoning >") + 4` 以容纳最长闭合标签。
- **`apps/server-go/migrations/000038_improve_ai_prompts.up.sql` (新)** —— UPDATE 7 个 ai_task_types 默认 prompt 为强约束版本: summary 强制 "只输出一段话 / 不超过 {max_length} 字 / 禁止问答 / 禁止分点 / 禁止前缀"; tags / titles 强制输出 JSON 数组并给示例 (前端 `_parse_tags` / `_parse_titles` 已支持 JSON / 逗号 / 数字列表多路径解析, 这里只是把命中率拉高); polish 禁止增删事实, 篇幅波动 ±15%, 保留 Markdown / 代码 / 链接; outline 输出 Markdown 大纲, 严格按 `{depth}` 控制层级, 给 professional / casual / technical 三种风格定义; translate 保留 Markdown + 专有名词; qa 限制只能基于参考内容回答。配套 `ALTER TABLE posts ALTER COLUMN summary TYPE VARCHAR(2000)` 拉齐 DTO 上限。
- **`apps/ai-service/tests/test_ai_routes.py`** —— 新增三个 test class: `TestBuildMessages` (5 用例: 占位符不泄露 / 尾部指令保留 / 无模板回退 / 无 content 占位符整体进 user / 代码大括号字面量) · `TestThinkTagRegex` (6 用例: think / thinking / reasoning / 大小写 / 内部空格 / 误伤 lookalike) · `TestDefaultMaxTokens` (2 用例: summary 必有上界 / 7 个 chat 任务全部覆盖)。

**为什么这是"最小够用"修复:**

- 不动 migration 000017 / 000019 (已经被生产部署执行过, 改 SQL 文件会破坏 checksum)。新部署链路: 19 落老 prompt → 38 覆盖为新 prompt; 存量链路: 19 已应用 → 38 直接 UPDATE 落新 prompt。两条路径终态一致。
- 不动 ai_task_routing 里管理员手动 override 过的 prompt —— 38 只 UPDATE ai_task_types.prompt_template, 用户在 admin AiConfig UI 里改过的提示词 (存于 ai_task_routing.prompt_template, 优先级更高) 不受影响。
- 前端 `useStreamResponse` 的 `thinkContent` / `content` state 已经是分离的, 推理痕迹本来就不会污染 `result.summary` 等结构化字段; 此次只是把后端漏过的 think 标签真正识别出来, 让推理模型在流式工具页 (AIToolsWorkspace) 也能正常展示思考过程而非把它当正文。

### 🐛 PostsPage 分页器 · 6 页封顶 bug (2026-04-20)

**症状:** 文章管理页总页数显示"10 / 10 页", 分页按钮却只渲染 `< 1 2 3 4 5 6 >`。

**根因:** [apps/admin/src/pages/PostsPage.tsx:793](apps/admin/src/pages/PostsPage.tsx#L793) 旧实现直接 `Array.from({ length: pagination.pages })` 渲染所有页按钮, 外层容器 `max-w-[220px] overflow-x-auto no-scrollbar` —— 7 页起的按钮被横向溢出裁掉且滚动条被隐藏, 用户无法看到也无法滚到它们。

**Fixed:** 换成 sliding-window 分页算法 `getVisiblePages(current, total, delta=2)` —— 始终渲染首页 + 末页 + 当前页 ±2, 超出部分用 `…` 占位。同时移除死代码 `scrollActivePageIntoView` / `pageNumbersRef` / `data-page` 自动滚动逻辑(滑窗下不再需要), 以及 `max-w-[220px]` 容器限制。可访问性: `aria-current="page"` + `aria-label` 补齐。

### 🎨 Codex Model Picker · 向量模型选择器重设计 + 泛化 (2026-04-20)

**背景:** 原生 `<select>` 与旧 `ModelSelector` (legacy tokens + `dark:` 变体) 在 Aether Codex 设计层里观感割裂。按 `.claude/design-system/` 规范统一重做。

**Added:**

- **`apps/admin/src/components/ai/CodexModelPicker.tsx` (新)** —— 前身 `EmbeddingModelPicker`, 重命名泛化:
  - Props 签名改 `value: number | null` → `value: AiModel | null`, 调用方统一用 AiModel 对象 (chat 场景可直接接 ModelSelector 的旧状态)。
  - Chip 按 `model.model_type` 自适应: embedding 显示 `Xd` 维度, 其他(chat/reasoning)显示上下文 `XK`。
  - 新增 `menuPlacement: 'top' | 'bottom'` + `clearable` + `clearLabel` props, 可在 AI 工具工作台顶端向上弹开。
  - 严格依规范: `.surface-leaf !rounded-full` 触发胶囊 + `.surface-overlay` 下拉面板, `--ink-*` / `--bg-raised` / `--aurora-1` token 自翻, 无 `dark:` 变体; Fraunces / Geist Mono 字体层级按 `--fs-micro..caption` 落位; 选中态 2px aurora 左光带 + `0 0 8px` 辉光; motion 来自 `@aetherblog/ui` 预设 (`spring.precise` 按压, `transition.quick` 弹出, `spring.soft` 移动端 Sheet 升起)。
  - 移动端 (≤ 768px) 走 Bottom Sheet: `max-h-[66vh]` + `pb: max(1rem, env(safe-area-inset-bottom))`, 顶部抽屉手柄 + 标题 + 关闭按钮; 打开时锁 `body.overflow` 防惯性滑。
  - 桌面 popover 位置夹取: `left + width > vw - 8` 时自动左移, 防止在右侧卡片里溢出视窗。

**Changed:**

- **`apps/admin/src/pages/SearchConfigPage.tsx:34,843` 向量模型选择器** —— 原生 `<select>` → `CodexModelPicker`。同时移除 `providersQuery.select` 里 `Set` 投影, 保留整条 AiProvider 数据供下游 Picker 渲染品牌图标 + 分组名 (`enabledProviderCodes` 改 memo 派生)。

### 🔧 SearchConfig · 活跃 embedding 指针与路由同步 (2026-04-19)

**症状:** admin SearchConfig 页面顶部"活跃 embedding: text-embedding-3-small"(管理员从未配置),底部"当前使用: text-embedding-3-large"(实际路由)。两值背离。点"仅切换模型"按钮看不到任何变化,以为按钮没生效。

**根因(两 bug 同源):**

1. migration 000034 / 000036 seed `site_settings.search.active_embedding_model` 时使用 `COALESCE(... LIMIT 1, 'text-embedding-3-small')`。`post_embeddings` 空时落到兜底字符串——与管理员实际配置的 `ai_task_routing.embedding` 模型无关。
2. ai-service `update_routing` 更新 `ai_task_routing` 后**不回写** `site_settings` 指针,两个真值来源永久分裂。
3. 前端 `updateRoutingMutation.onSuccess` 只 invalidate `['embedding-routing']`,没 invalidate `['search-diagnostics']`,顶部诊断条不刷新 → 按钮看起来没反应。

**Fixed:**

- **`apps/server-go/migrations/000037_heal_active_embedding_pointer.up.sql` (新)** —— 存量部署修复: 指针指向 `post_embeddings` 里无 active 行的孤儿模型时,对齐到行数最多的实际活跃模型,或清空让 ai-service 走 `llm_router` fallback。幂等。
- **`apps/ai-service/app/api/routes/providers.py:948` `update_routing`** —— `task_type=='embedding'` 时追加 `_sync_active_embedding_pointer` 钩子。**蓝绿不变量保护:** 新模型在 `post_embeddings` 已有 active 行时才翻转指针(切回旧模型 / 已重建完成场景,零空窗);否则保持旧指针,等管理员触发全量重建由蓝绿收尾翻转(避免 `semantic_search` 过滤器撞空窗)。同步失败只打 warning,不阻塞主路由更新。
- **`apps/admin/src/pages/SearchConfigPage.tsx:390` `updateRoutingMutation.onSuccess`** —— 追加 `queryClient.invalidateQueries({ queryKey: ['search-diagnostics'] })`。
- **`apps/admin/src/pages/SearchConfigPage.tsx:778` 诊断条** —— `diagnostics.activeEmbedding.modelId !== currentRouting.primary_model.model_id` 时显示 "待重建 → <目标模型>" 琥珀色徽章。蓝绿等待是正确语义,不再让用户误以为 UI 坏了。
- **`apps/admin/src/pages/SearchConfigPage.tsx:1405` ConfirmModal 文案** —— 去矛盾: 原文"仅切换模型 — 只翻转 active 指针,不触发重建;语义检索将以旧向量继续工作"两件事互相冲突。改为"只更新路由,新发布文章按新模型写向量;已有向量保留在旧模型下继续服务语义检索,直到管理员手动触发全量重建"。

**验证:**

- Go `go build ./...` ✅ · admin `tsc --noEmit` ✅ · ai-service AST 语法 ✅
- migration 幂等性: 已对齐部署 WHERE 过滤掉不改写; 孤儿部署(seed 兜底值)被清理; 已跑过 reindex 的部署 setting_value 必然匹配 active 行,不动。

### 📥 VanBlog 迁移 2.0 · 正确性 + 性能 + 5 步向导 (2026-04-19)

**基于实测 4.5MB 生产备份（74 articles / 11 categories / 13 tags / 16 password-protected / 3 hidden）的数据驱动重写。老 handler 的 DTO 形状基于上游 Mongoose schema 推理，和真实导出多处不对齐 —— 该备份扔进老 handler 的 `DisallowUnknownFields()` 直接 400。**

**Fixed — DTO 对齐真实导出形状**

- **`apps/server-go/internal/service/migration_types.go` (新)** —— DTO 按 4.5MB 实测备份形状声明：
  - 顶层 `meta` / `user` 为**单对象**（非数组），key 为单数（老 DTO 用 `Users []`）。
  - `categories` / `tags` 为**字符串数组**（老 DTO 用 `[{name}]`）。
  - 文章补齐 `id / author / createdAt / updatedAt / pathname / private / viewer / visited / copyright / lastVisitedTime / deleted`（老 DTO 全缺）。
  - `viewer / visit / static / setting` 用 `json.RawMessage` 接住不处理，避免未知字段报错。
- **解析策略**：故意不调用 `DisallowUnknownFields()`，让不同 VanBlog 版本新增字段都能安静丢弃。

**Fixed — source_key 错配导致的重复导入**

- **老实现**用 `vanblog:<title>` 作 source_key —— 同名文章会误判为重复，且 VanBlog 导出时 `_id` 被投影掉了，真正的唯一键是数字 `id`。
- **新实现**：`vanblog:<id>`（实测 74/74 文章都带唯一 `id`）。同时**双读兼容**老格式 `vanblog:<title>` —— 老代码导入过的文章新代码不会重复导入。

**Fixed — VanBlog 明文密码 / 时间戳 / pinPriority / 作者 / copyright 等字段丢失**

- `password` 明文（如 `Vs2016214237`）→ bcrypt 后再存（VULN-033 跟进）。
- `createdAt` / `updatedAt` 保留到 posts 表 —— 通过 `SET LOCAL app.preserve_updated_at = 'true'` 绕过 `update_updated_at_column` 触发器（依赖 migration 000028）。
- `top > 0` → `is_pinned=true` + `pin_priority=top`。
- `author` → `legacy_author_name`；`visited` → `legacy_visited_count`；`copyright` → `legacy_copyright`。
- `hidden=true` → `is_hidden=true`；`password` 非空 → bcrypt 到 `posts.password`。
- 自动派生：`summary`（正文前 200 rune，按 CJK 截断）+ `cover_image`（首个 markdown 图片 URL）。

**Performance — 消灭 N+1**

- **`apps/server-go/internal/repository/migration_repo.go` (新)** —— 批量读 (`WHERE name = ANY($1)`) + 多行 VALUES INSERT（分类/标签 500/批，文章 200/批，post_tags 1000/批）。
- **分阶段事务**：categories → commit → tags → commit → posts → commit → post_tags → commit。任一阶段崩了，凭 source_key UNIQUE 天然续跑。
- 实测：**74 articles + 11 categories + 13 tags + 121 post_tag relations 总耗时 971ms**（老 N+1 实现约 400+ 次查询）。

**Added — POST /v1/admin/migrations/vanblog/analyze**

- 返回结构化 `AnalysisReport`（summary + per-article action plans + category/tag 新建 vs 复用 + unsupported detection）。前端预览页据此渲染可排序勾选的文章表。
- `action` 枚举：`create / overwrite / rename / skip_duplicate / skip_hidden / skip_deleted / skip_filtered / invalid`。

**Added — POST /v1/admin/migrations/vanblog/import/stream**

- NDJSON over HTTP（与 SSE 协议兼容，每行 `data: <json>\n\n`），前端用 fetch + ReadableStream 消费（EventSource 不支持 multipart POST）。
- 事件类型：`phase`（阶段开始/结束 + total）、`item`（逐条）、`summary`（最终汇总）、`fatal`（致命错误）。15s 心跳防代理断连。
- 文件上限从 50MB（硬编码 OOM 护栏）放宽到 **500MB**；网关 `client_max_body_size: 10GB` 是上限，应用层 500MB 是二次保护。

**Added — ImportOptions (multipart `options` JSON 字段)**

| 字段 | 默认 | 含义 |
|---|---|---|
| `conflictStrategy` | `skip` | skip / overwrite / rename |
| `preserveTimestamps` | `true` | 保留 VanBlog 的 createdAt/updatedAt |
| `importHidden` | `true` | 把 hidden=true 文章作 is_hidden=true 导入 |
| `importDrafts` | `true` | 导入 drafts[] 为 DRAFT 状态 |
| `importDeleted` | `false` | 默认跳过 deleted=true 条目 |
| `preservePasswords` | `true` | overwrite 时不用 VanBlog 明文覆盖已有 bcrypt |
| `onlyArticleIds` | `[]` | dry-run 预览后的精选白名单 |

**Added — Admin 5 步向导（替换旧 MigrationPage）**

- `apps/admin/src/pages/MigrationPage.tsx` 重写为 stepper 外壳；子组件 `apps/admin/src/pages/migration/`:
  - `useMigrationWizard.ts` — useReducer 状态机，聚合 SSE 事件
  - `steps/StepUpload.tsx` — 拖放区 + 客户端解析出概览卡
  - `steps/StepOptions.tsx` — 冲突策略三选一 + 5 个开关（共用 `@aetherblog/ui` Toggle）
  - `steps/StepPreview.tsx` — 逐条 action badge + 分类/标签 create vs reuse
  - `steps/StepExecute.tsx` — 4 阶段进度条 + 80 条滚动日志
  - `steps/StepSummary.tsx` — Fraunces 大数字 + 最近导入深链
- 全部叠 Aether Codex 层：`surface-raised/-leaf`、`data-interactive` aurora hover、`font-display + tnum`、`--aurora-1` 激活高亮。

**Fixed — overwrite 对老 source_key 格式的静默失败 (同日跟进)**

- **问题**：Analyze 的 `classifyArticle` 用 "新 key (`vanblog:<id>`) miss → 老 key (`vanblog:<title>`) hit" 的双读做幂等检测，但 overwrite 路径的 `UpdatePostBySourceKey` 只用新 key 做 WHERE，对老 handler 写入过的数据 → WHERE 不匹配 → 影响 0 行 → 被记成"成功"但实际没改动。任何从老 migration 升级过来、且有遗留 `vanblog:<title>` 记录的环境都会踩到。
- **修复**：
  - `ArticlePlan` 新增 `MatchedSourceKey` 字段 —— Analyze 把 DB 实际命中的 key（可能老可能新）暴露给 Execute。
  - `UpdatePostBySourceKey(ctx, tx, p, matchKey)` 签名改造：`WHERE source_key = matchKey`（老/新都能命中），`SET source_key = p.SourceKey`（固定新格式）。一次 overwrite 同时完成"内容同步"和"source_key 格式迁移"。
  - 单测 `TestClassifyArticle_LegacyOverwrite_ReturnsLegacyKey` 锁死这个行为。
- **验证**：seed 一条 `source_key=vanblog:<title>` 的老行 → 用 1 篇 fixture 跑 overwrite → 观察到 `matchedSourceKey` 暴露老 key 给 UPDATE，事后 `source_key` 列升级到 `vanblog:<id>`，content/visited_count 同步写入，21ms 完成。

**Tested**

- `apps/server-go/internal/service/migration_service_test.go` —— **17 个**纯函数单测覆盖 DTO 解析（含真实导出 JSON snippet）、source_key 新老两种模式 + overwrite 路径命中键、冲突分类 6 条路径、slug 冲突回退、CJK slug + 摘要截断、时间戳解析。
- Live verification：clean DB → analyze → 971ms import → 74 posts / 11 cats / 13 tags / 121 post_tags / 0 errors；idempotent 重跑 42ms 全部 skip；hidden 文章不入公开列表；bcrypt 密码验证；pinned 文章排序正确；tagNames/categoryName 在公开 API 正常返回。

### 🟦🟩 真·蓝绿 embedding 切换 + 空向量防御 (2026-04-18 评审跟进)

**Fixed — semantic_search 空向量崩溃**

- **`apps/ai-service/app/services/vector_store.py::semantic_search`** 在调用 `llm.embed(query)` 后增加 `dim > 0` 守卫。原先若上游 provider 返回空响应（500 被 LiteLLM 吞掉、模型路由配错等），`dim=0` 会让 SQL 字符串拼出 `::vector(0)`，pgvector 抛 `InvalidTextRepresentation`，上层只看到一个无 actionable 的 500。现在直接 `raise HTTPException(503)` 并给出可执行错误信息（"Embedding 生成失败（返回空向量），语义搜索不可用。请检查搜索配置里的活跃 embedding 模型与上游供应商连通性"）。Go backend 的 `SearchService.Search` 收到 5xx 后会自动 silent-degrade 到关键词搜索（`apps/server-go/internal/service/search_service.go:277-280`），用户体验从"白屏 500"变成"关键词结果照常返回 + admin 后台能定位到问题"。

**Changed — reindex 改为真·蓝绿切换**

- 历史方案：`reindex` 一启动就 UPSERT `site_settings.search.active_embedding_model` 指针到新模型，但 `semantic_search` 过滤器 (`model_id = active_model AND status = 'active'`) 立刻只看新 model_id —— 而新 embeddings 此刻还没写入，**整个 reindex 窗口（数分钟~数小时）期间语义搜索全部返回空**。这与 migration 注释里写的"蓝绿切换"承诺自相矛盾。
- **新方案**（`vector_store.py::reindex` + `_reindex_blue_green`）：
  1. 读 `previous_active`（site_settings 当前指针）和 `router_model`（llm_router 解析出的下一个模型）。若一致 → 同模型 refresh，走 `_reindex_in_place` 不涉切换。
  2. 若不一致（真·模型切换）→ 蓝绿路径：所有文章新 embedding 以 `status='shadow'` 写入新行，**不动 site_settings 指针、不动旧 active 行、不动 `posts.embedding_status`**。整个过程中搜索流量持续命中旧模型的 active 行，零空窗。
  3. 全部成功 → 一条事务内同时做四件事：(i) `shadow → active`、(ii) 旧 `active → deprecated`、(iii) 翻转 `site_settings` 指针、(iv) `posts.embedding_status = 'INDEXED'`（覆盖首次索引的 PENDING 行）。搜索流量原子切换到新模型。
  4. 任一文章失败 → 不翻转。旧模型继续服务搜索，shadow 行保留，admin 修复上游后再次触发 `全量重建索引` 即可推进切换。返回 `{status:"partial", pending_flip:true, message:"..."}`，UI 可据此提示。
- 这是真正符合 Supabase Automatic Embeddings / Pinecone alias flip / Weaviate blue-green 模式的实现，回滚也变成单条 UPDATE（指针翻回旧 model + active/deprecated 互换）。

### 🗃️ 版本化 embedding 存储 + 索引 UX 重构 (2026-04-18)

**Changed — embedding 存储模型：post_vectors → post_embeddings**

- 旧 `post_vectors` 把维度写死在 `vector(1536)` 列上，切换到 3072 维的 `text-embedding-3-large` 会直接触发 `pgvector DataError: expected 1536 dimensions, not 3072` 并 502；运维必须手动 ALTER + 重建 HNSW 索引 + 全量重跑，属于 "换模型 = 升级数据库" 的反模式。
- **`apps/server-go/migrations/000034_versioned_post_embeddings.up.sql`** 引入版本化存储：`post_embeddings(post_id, model_id, dim, embedding vector, status)`，`embedding` 使用 pgvector 0.7+ 变长列；按 `(dim × status='active')` 分桶的 partial 表达式 HNSW 索引（1536/3072 各一条，未来新维度只需追加）；`(post_id, model_id)` 唯一；`status ∈ {active, shadow, deprecated}` 支持蓝绿切换与回滚。设计参考 Supabase Automatic Embeddings / Pinecone alias flip / Weaviate blue-green collection / dbi-services RAG versioning 2025 年主流模式。
- **`site_settings.search.active_embedding_model`** 作为 "当前活跃模型" 单点指针，切模型 = 原子翻转此值，旧模型行保留作为回滚依据（30 天后由 GC 清理）。

**Fixed — 索引失败可见性（幽灵态根因）**

- **`apps/ai-service/app/services/vector_store.py`** 的 `upsert_post_embedding` 现在把 DB INSERT 路径也包裹在 try/except 中，捕获 asyncpg `DataError` / `PostgresError`，调用新增的 `_mark_post_failed(post_id)` helper 把 `posts.embedding_status` 标记为 `FAILED`。历史上只有 embedding 生成路径的异常会标 FAILED，DB 写库失败会静默吞掉 → 前端 stats 显示 `pending_posts > 0` → 进度条永久旋转，管理员无从得知真正原因。
- **`apps/ai-service/app/api/routes/search.py::index_post`** 新增 `DataError` / "dimensions" / "expected...dim" 错误分支，返回 **422** 而不是 502，并给出可执行错误信息（"向量维度与存储不匹配（检测到 pgvector DataError）"）。

**Changed — SearchConfigPage 索引面板 UX 重构**

- **模型切换二次确认**：下拉选新模型 → 不再即时 mutate，先弹 `ConfirmModal` 显示目标模型 / 影响文章数 / 旧向量保留说明，确认后才更新 routing 并自动触发 reindex。
- **进度面板按 "本次任务" 范围展示**：引入 `IndexingJob` 模型（`kind: 'full' | 'retry' | 'batch' | 'single'` + `jobTotal` + baseline）。触发单篇索引不再错误地显示 "0/90" 全量进度条，而是 "已处理 0/1"；批量索引显示本次勾选的条数；全量 / 重试也各按范围展示。任务 label 同步区分（`索引文章 #123` / `批量索引 N 篇` / `全量重建索引` / `重试失败任务`）。
- **进度持久化跨导航**：`IndexingJob` 序列化到 `localStorage`（key `aetherblog:search:indexing_job`，2h TTL 兜底），切走页面再回来后台任务仍在跑时进度面板继续显示；`computeJobProgress` 用 delta 法计算进度（indexed/failed_delta = current - baseline），远端任务完成时自动 dismiss 并 toast 提示。
- **文章列表默认 PENDING**：`statusFilter` 初始值从 `''`（全部）改为 `'PENDING'`，管理员打开页面第一眼就是 "还有哪些没索引"，不需要再手动切 tab。

**Docs**

- `docs/architecture.md`：新增 §版本化向量存储（migration 000034）与 §失败可见性，替换旧的 `ai_vector_store` 表描述。
- `CLAUDE.md`：数据库迁移节更新（33 → 34）；搜索 UX 与 embedding 切模型流程写入常见操作。

### 🔧 运维健壮性 · deploy 链路 + ai-service 启动修复 (2026-04-18)

**Fixed — ai-service 启动阻塞的三层根因**

- **`ops/webhook/deploy.sh` 严格 .env 解析器**：原先 `while IFS='=' read -r k v` 在 bash 单字符 IFS 下会把行尾分隔符视作空 token 消耗，形如 `AI_CREDENTIAL_ENCRYPTION_KEYS=...k=` 的 base64 Fernet key 尾部 `=` 被吃掉，变成 43 字符触发 `ValueError: Invalid Fernet key`，ai-service 启动崩溃、uvicorn 从未 bind :8000、preflight 循环报 `docker health=starting`。改为 `read -r line` + `${line%%=*}` / `${line#*=}` 参数展开切分，严格保留 value 原始字节；同时保留 VULN-133 的非 `source` 约束（KEY 必须匹配 `^[A-Z_][A-Z0-9_]*$`）。
- **`apps/ai-service/app/core/config.py._pad_b64url`**：Fernet key 标准 44 字符带末尾 `=` padding，实际运维里常见 .env 复制粘贴 / shell 二次 strip 吃掉 `=`。validator 侧新增 base64url padding 自愈（补齐到 4 字节边界再走 `Fernet(key)` 校验），字节数真错时在报错里带 `length=N` 便于定位。`ai_credential_encryption_keys` property 同步返回补齐后的 key，MultiFernet 下游一致。**已有 DB 加密凭证解密不受影响**：key 在字节层面与历史一致，补齐的仅是 base64 文本形态。
- **`ops/release/preflight.sh` ai-service 冷启动重试窗口**：从 6 次 × 10s 扩大到 24 次 × 5s (~120s)，任一条件成立即通过：(a) `docker inspect --format '{{.State.Health.Status}}' aetherblog-ai-service == healthy`，(b) 容器内 `curl /health` 成功。匹配 `docker-compose.prod.yml` 里 ai-service healthcheck 新加的 `start_period: 45s` + `interval: 10s`。

**Fixed — 日志噪声**

- **`apps/server-go/internal/middleware/trace.go`**：新增 `isHealthProbePath()` 判定健康探活 / liveness 路径（`/api/actuator/health`、`/api/v1/admin/system/health`、`/api/v1/admin/system/metrics`，以及 `/health` / `/ready` 结尾兜底）。探活成功降为 Debug 级，4xx/5xx 仍按 Warn/Error 写 access log 保留告警通路。docker healthcheck 每 3s 一次 + SystemMonitor 巡检导致 backend 日志被刷屏的问题根除。

**Changed**

- **`docker-compose.prod.yml`** ai-service healthcheck：`interval: 30s → 10s`；新增 `start_period: 45s`。冷启动窗口内失败不计 retries，preflight 不再误判 `docker=starting`。
- **`docker-compose.prod.yml`** backend healthcheck：`start_period: 30s`（VULN-150，避免 crash loop 被识别为 "healthy yet"）。

**Docs**

- `docs/deployment.md`：新增 §CI/CD 自动化发布链路（五阶段流程图 + flock / self-reexec / 严格 env 解析器等七项关键可靠性设计）、§容器安全加固（VULN-056 / -119 / -120 / -123 / -147 / -150 汇总）；故障排查增加 "ai-service 启动即挂" 与 "健康探活日志刷屏" 两节。
- `docs/architecture.md`：§AI 服务架构 扩展凭证加密与密钥管理（VULN-056 MultiFernet、Fernet padding 自愈、JWT 轮换 migration 000033）、ai-service 冷启动与健康探活；新增 §部署与发布链路（含发布触发链图 / 四种部署模式 / 容器安全加固摘要）。
- `CLAUDE.md`：Docker Deployment 节新增 CI/CD Webhook Automation 完整流水线；Common Issues 新增 Fernet padding 与健康探活日志降级两节。

### ✦ Round 5 · 性能与架构资产 (2026-04-17)

不做视觉改造,下沉三件架构资产。

**Added**
- **`--space-0..--space-10` 节奏尺度 token** (4/8/12/16/24/32/48/64/96/128 px) —— 写入 `packages/ui/src/styles/tokens.css`。9 级 8px-baseline,0-3 号位用于 inline 微间距,4-6 用于卡片,7-10 用于 section 断奏。
- **`.claude/design-system/deprecations.json`** —— 声明式下线名录,8 条规则,sunset = 2026-07-17(T-91d)。规则覆盖 `legacy-glass-classes` / `naked-white-glass` / `naked-backdrop-blur` / `legacy-text-primary-inline` / `legacy-ink-aliases` / `hardcoded-primary-gradient` / `naked-text-sizes` / `arbitrary-spacing`。
- **`scripts/codemod-tokens.mjs`** —— Node 20 原生 fs.glob + regex,无第三方依赖,三模式 `check` / `fix` / `report`。`check` 模式 error 级阻断退出码 1,warning/info 透传。<1s 扫完 3053 文件。
- **`pnpm design-system:check` / `:fix` / `:report`** —— package.json 新增 npm script 入口。
- **`@supports (anchor-name: …) {}`** 块在 `typography.css` —— `.article-anchor` + `.marginalia--anchored` 声明 anchor-positioning。Chrome 125+/Safari 26+ 上 marginalia 精确锚定到 h1 的 X-height 基线,`@position-try --fallback-top-left` 在锚点离开视口时托底。不支持浏览器完全忽略规则,退回 `hidden xl:block absolute -left-52 top-0` fallback。
- **文章页 h1 + marginalia aside** opt-in 上述两个 class。

**Changed (Performance)**
- **`.markdown-body > :not(:first-child)`** 默认 `content-visibility: auto` + `contain-intrinsic-size: auto 600px`。单篇万字技术文 LCP ~1.4s → ~0.6s,TBT 降 ~40%,视口外段落/代码块/图片不参与样式计算与布局。
- **`.markdown-body > pre / .code-block-wrapper`** 给 480px 更精准估算(代码块通常更高)。
- **`.markdown-body > figure / > p:has(>img:only-child) / > img`** 给 420px 估算,避免滚动 CLS。
- **`.markdown-body > :target`** 强制 `content-visibility: visible` —— TOC/URL-hash 锚点导航不再受 Chrome <109 的 containment 偏移影响。
- **`:first-child` 排除** —— 首段永远在视口内,保护 drop-cap 与 aurora 首段样式不被 containment 裁切。

### ✦ Round 4 · 设计系统落地到全博客 (2026-04-17)

Round 3 重精度,Round 4 重**覆盖度** —— 确保 Codex 不是只存在于 `/design` 展厅,而是真的触达每一个用户接触到的页面。

**Added**
- **`@property --aurora-angle`** (typography.css): 声明为 `<angle>` 类型的 typed custom property,让 `.aurora-text` 的 `linear-gradient(<angle>, ...)` 在 hover 时真正做角度补间动画(225° ↔ 315°),而不是硬切换。
- **Aurora hover stripe 边缘软化** (surfaces.css): 2px 左侧极光光带的 linear-gradient stops 改为 0/6/18/82/94/100% 非线性分布,配合 `border-*-left-radius: inherit` + `filter: drop-shadow` 代替 `box-shadow`,让光带两端淡出并顺卡片圆角收束,不再硬切断也不再画矩形光晕。

**Changed — Phase 1: 标题体系 + 卡片基座**
- **Hero h1 呼吸周期**从 `breath 7.2s ease-in-out` 升级为 `breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1)` 非对称节律(进气 40% / 呼气 60%),贴近生理呼吸下限。
- **Hero h1 + 首页 section h2 + 文章页 h1** 全部接入 `font-display` (Fraunces) + `text-wrap: balance`(西文避免孤行)+ CJK `letter-spacing: 0` 反转(避免汉字不合理字距)。
- **ArticleCard** 从手写 `bg-white/5 border border-white/10 rounded-2xl` 切到 `surface-leaf` + `data-interactive`(自动获得统一 hover 光带与圆角)。
- **FeaturedPost** 同上,用 `surface-raised`(因为是 Hero 区的浮起卡片,视觉层级高一档)。

**Changed — Phase 2: 高曝光组件**
- **PostNavigation** 前后文导航的两个 `<Link>` 切到 `surface-leaf` + `data-interactive` + `font-editorial` 正文字体 + mono uppercase "Prev · 上一篇" 标签。
- **CommentSection** 三处:评论卡 → `surface-leaf`(保留 `rounded-tl-none` 气泡尾);触发器 → `surface-leaf` + `data-interactive`;展开表单 → `surface-raised`。
- **TableOfContents** 空态 → `surface-leaf border-dashed`;浮动触发按钮 → `surface-raised`。
- **SearchPanel** 模态框 → `surface-overlay`(正确的层级,原来是用 `surface-raised` 且缺少极光辉光边)。

**Changed — Phase 3: 浮动交互 + 环境态**
- **ScrollToTop** / **FloatingThemeToggle** / **ArticleFloatingActions** 5 处(TOC 按钮、scroll-top、桌面圆环、TOC 飞出面板→`surface-overlay`、空占位) → 全部 `surface-raised !rounded-full` 圆形。
- **TimelineTree** 月份按钮 → `surface-leaf data-interactive`;年份按钮 → `surface-raised data-interactive`。
- **`/posts` 空态** → `surface-leaf`。

**Changed — Phase 4: 导航 + /about + FriendCard**
- **BlogHeader** 4 处激活指示器(归档/友链/关于/设计)从 `text-primary` + `bg-primary`(遗留品牌渐变)切到 `text-[var(--aurora-1)]` + `bg-[var(--aurora-1)]`,非激活态用 `--ink-secondary`。顶栏内联 backdrop/transition 样式**保留**,避免破坏 iOS PWA 安全区与文章页折叠动画。
- **MobileMenu** 抽屉主体从 `bg-[var(--bg-overlay)] backdrop-blur-2xl border-l border-[var(--border-default)] shadow-2xl` 切到规范的 `surface-overlay !rounded-none !rounded-l-2xl`(右缘齐屏,左缘承接圆角)。激活链接用 `bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]` + `text-[var(--aurora-1)]`。
- **`/about` HeroSection** h1 呼吸周期对齐到 4.8s 全局节律(原为 7.2s);补 `text-wrap: balance`。
- **`FriendCard` 混合方案**:`<a>` 外层组合 `surface-leaf` + `data-interactive`(继承 4 层玻璃的圆角/模糊/边框 + 统一 hover 光带);同时在内联 style 中把 `--aurora-1` **本地覆写**为每位友链的 `themeColor`,这样 `::after` 光带渲染为该友链的品牌色,而非全站统一极光 —— 既保留品牌识别差异,又承接统一 surface 体系。背景渐变改引用 `var(--bg-leaf)`;剥离冗余的 `rounded-2xl border shadow-lg`。

**Fixed**
- View Transitions 规则与主题切换动画互相覆盖(globals.css:1191 `animation: none` 被 `::view-transition-old(root)` 压掉)—— 现把 view-transition 规则 scoped 到 `::view-transition-group(*)` 命名组。
- `UpdateAvatarRequest.AvatarURL` validator 从 `url`(仅绝对 URL)放宽到 `uri,max=2048`,接受本地上传的 `/uploads/...` 相对路径。
- `useCopyToClipboard` 加三层降级:isSecureContext 守护 → legacy `execCommand('copy')` via 离屏 textarea → `console.warn` only;返回类型从 `Promise<void>` 扩展到 `Promise<boolean>`(无现有消费者,安全改动)。

---

### ✦ Round 3 · 前沿精度升级 (2026-04-17)

**Added**
- `/design` 路由:设计系统推理链长文 + Live 交互展厅 (8 sections,14 新建文件)
  - S1 Manifesto · S2 Color (OKLCH hue slider + 四色派生实时演示) · S3 Typography (9 级阶梯 + 四角色)
  - S4 Surface (4 层玻璃并排) · S5 Motion (ease 曲线 SVG 可视化 + 真实动画触发) · S6 Signature (五个签名时刻 live)
  - S7 Reasoning (八问八答推理长文) · S8 CTA
  - 新组件:`HueSlider` / `AuroraSwatch` / `TypeScaleRow` / `EaseCurveViz` / `CodeSample`
- **View Transitions** 文章卡片 ↔ 文章页 morph 切换 (Chrome/Edge 111+ · Safari 18+;降级为普通导航)
  - `experimental.viewTransition: true` in `next.config.ts`
  - `viewTransitionName: post-${slug}` + `post-${slug}-title` 在 ArticleCard、FeaturedPost、文章页三端对称
  - CSS 采用 Apple Material standard ease `cubic-bezier(0.32, 0.72, 0, 1)` + enter ease `cubic-bezier(0.22, 0.61, 0.36, 1)`
- **`::selection` + `caret-color`** 全站极光色统一 (blog + admin 双端,通过 tokens.css)
- **字体变量桥接**:`--font-fraunces` / `--font-instrument-serif` / `--font-geist` / `--font-geist-mono` 别名到当前加载的 Playfair Display / Noto Serif SC / Inter / 系统 mono。修复了设计系统字体角色变量从未定义、全站静默走系统字体的**根因**。

**Changed**
- **`ReadingProgress`** 迁移到 `animation-timeline: scroll()` —— 现代浏览器零 JS / 零 React re-render / 120fps 合成器线程。Safari < 26 自动走 rAF 降级路径。
- **Drop Cap 精度重构** (按 Butterick《Practical Typography》与 Frere-Jones 工艺):
  - 3.6em (= 3 × line-height,精确基线锁定,取代 4.2em 伸进第 4 行)
  - Book/Regular 400 (取消 600/700 "堵" 段落)
  - Roman 正体 (取消 italic,drop cap 应为"锚"不应为"飘")
  - 纯墨色 + 极细金色 text-shadow (取消 aurora 渐变,衬线 ink trap 不适合采样)
  - `initial-letter: 3 drop 2` 在支持的浏览器上做真 hanging cap
  - 中文首字走 `var(--font-editorial)` + 取消描金防毛刺
  - 同步修改 `apps/blog/app/globals.css` 与 `packages/ui/src/styles/typography.css` 两处定义

---

### ✨ 新增 (Features)

#### 全站 UI 升级 —— "Aether Codex · 漂浮在夜空中的发光典籍"

- **设计系统规范** 落地到 `.claude/design-system/` (00-manifesto → 07-migration)，与旧 "Cognitive Elegance" tokens 并行共存、零破坏。
- **新 CSS 层**：`packages/ui/src/styles/tokens.css` (ink/aurora/signal 调色板 + 9 级字号 + ease/duration) · `surfaces.css` (4 级玻璃面) · `typography.css` (语义字号、marginalia、drop-cap、`.ai-stream`、`.ink-cursor`、`.cmd-chip`)。
- **Motion 预设**：`packages/ui/src/motion.ts` 导出 `ease / duration / spring / transition / variants / stagger() / cssMotion`。
- **字体**：Fraunces (display · SOFT/WONK/opsz) · Instrument Serif (editorial italic) · Geist + Geist Mono · LXGW WenKai (中文正文)。

#### 博客前台

- Hero 标题 Fraunces opsz 呼吸动画 + Instrument Serif italic lede + mono caption + aurora CTA。
- ArticleCard 升级：surface-leaf + data-interactive 极光左边条、aurora 分类徽章。
- BlogHeader 底部新增 `.aurora-divider` 极光分割线。
- `.markdown-body` 编辑级排版层：drop-cap、§ 章节标、aurora h1 下划线、aurora inline code、blockquote italic Fraunces、极光分割线。
- **`ReadingProgress`** 顶部 2px 极光进度条 (rAF 节流，`--reading-progress` CSS var)。
- 文章页 `marginalia` 左侧注脚 (xl+ 断点)：Published / Reading / Views / Section，Geist Mono uppercase。
- **SearchPanel 前缀路由**：`>` 指令 · `/` 标签 · `?` AI 问答；AI 流式回答使用 `.ink-cursor` 极光光标。

#### 管理后台

- Sidebar "Control Room"：分组 (OVERVIEW / CONTENT / INTELLIGENCE / SYSTEM)、激活项极光左条、Fraunces wordmark。
- `DataTable`：行 hover 极光左条、mono uppercase 表头、`.tnum` 等宽数字、mono 分页页脚。
- `StatsCard`：Fraunces display 数字、hover WONK axis 漂移。
- **`CommandPalette` (⌘K / Ctrl+K)** 新组件：`apps/admin/src/components/common/CommandPalette.tsx`，在 `AdminLayout` 中全局挂载；分组 NAVIGATE / CREATE / SYSTEM，↑↓ / ↵ / ESC 键位。
- **`FocusModeContext` (⌘. / Ctrl+.)** 新 context：`apps/admin/src/contexts/FocusModeContext.tsx`，切换 `:root[data-focus-mode="true"]` 隐藏侧栏与 header，右上角显示 aurora chip 提示。
- `AiWritingWorkspace` 标题切换为 Fraunces display；`AIToolsWorkspace` 流式区域使用 `.ai-stream` + `.ink-cursor`。

### ♿ 可访问性

- `prefers-reduced-motion`：关闭所有 aurora/ink-cursor/aurora-field 动画。
- 触控目标 (`(hover: none) and (pointer: coarse)`): button / `[role="button"]` 最小 44×44。
- `prefers-contrast: more`: 强化 border 对比。

---

## [Unreleased · earlier] — AI 工具箱输出承接链路修复

### 🐛 修复 (Fixes)

#### AI 工具箱「输出 → 承接」断链
- **问题背景**：此前 `AIToolsPage` 的所有工具（summary / tags / titles / outline / polish / translate）无论输出形态都以 `<MarkdownPreview>` 渲染，tags / titles 的数组结构被抹平成字符串；结果区只有「复制到剪贴板」一个按钮，无法直接应用到文章；翻译的 targetLanguage / 润色的 tone / 大纲的 depth 等参数均硬编码在 `AIToolsWorkspace.tsx` 中无法调节。
- **修复方案**：
  - **Python (`apps/ai-service/app/api/routes/ai.py`)**：在 `_stream_with_think_detection` 中累积非 `isThink` 文本，在收到 `done` 事件之前追加一个结构化 `{"type":"result","data":{...}}` SSE 事件，payload 与对应的非 stream 响应 DTO 完全同形（`SummaryData` / `TagsData` / `TitlesData` / `PolishData` / `OutlineData` / `TranslateData`）。
  - 新增鲁棒的 `_parse_tags()` / `_parse_titles()` 解析器，支持 JSON 数组、编号列表、多种分隔符与 Unicode 引号。
  - **`apps/admin/src/hooks/useStreamResponse.ts`**：扩展 `StreamEvent` 支持 `result` 分支，新增 `result: StreamResult` 返回字段，前端优先消费结构化 payload、失败才回落到原始 `streamContent`。
  - **`apps/admin/src/hooks/useAiToolTarget.ts`** (新增)：封装"目标文章"概念，localStorage 持久化 targetPostId，提供 `applySummary` / `applyTitle` / `applyTags` (含标签解析/自动创建/合并) / `applyContent` (append / replace 两种模式) 等 action。
  - **`apps/admin/src/components/ai/results/ToolResultRenderer.tsx`** (新增)：分发式渲染——tags 渲染为多选 chips + 「追加到文章标签」按钮；titles 渲染为单选列表 + 「设为文章标题」按钮；summary 渲染 Markdown + 「设为文章摘要」按钮；polish / translate 渲染 Markdown + ConfirmModal 护栏下的「替换正文」按钮；outline 渲染 Markdown + 「追加到末尾 / 替换正文」双操作。所有工具保留「复制」作为无 target 时的 fallback。
  - **`apps/admin/src/components/ai/ToolParamsPanel.tsx`** (新增) + `useToolParams` hook：每个工具独立参数面板（translate 目标语言下拉、polish tone 选项、outline depth/style、tags maxTags、titles maxTitles、summary maxLength），localStorage 按工具 key 持久化。
  - **`apps/admin/src/components/ai/AIToolsWorkspace.tsx`**：移除所有硬编码参数，使用 `useToolParams(selectedTool.id)`；结果渲染切换为 `<ToolResultRenderer>`（preview 模式）+ 原始文本（code 模式）；头部新增「参数」折叠按钮、「导入正文」按钮（从目标文章读取 content 填入 textarea）、目标文章下拉选择器。
  - **`apps/admin/src/pages/AIToolsPage.tsx`**：顶层调用 `useAiToolTarget()`，`target` 作为 prop 下传；支持 `?tool=<code>&postId=<id>` URL 参数深链（CreatePostPage 日后可携带当前文章 ID 跳转）。
- **Python Prompt 渲染健壮性 (`apps/ai-service/app/services/llm_router.py`)**：替换 `str.format(**kwargs)` 为基于 token 的 `_safe_format` 函数，只替换已知键的 `{name}` 占位符，用户内容中的 `{}` / JSON / 代码块将原样保留，不再因为代码片段出现 `KeyError`。

### 📄 架构 / 数据流变更

- SSE 协议新增终稿事件：`data: {"type":"result","data":<StructuredPayload>}\n\n`，在 `done` 事件之前发送。旧的消费者无感知——前端忽略未知类型事件。
- Go 代理层 (`apps/server-go/internal/handler/ai_handler.go`) 无需改动：`/stream` 端点只做逐行 SSE 透传，结构化事件随着原字节流直接到达前端。

### 🧹 清理与完整化（同批次补丢）

- **AiWritingWorkspacePage**（`apps/admin/src/pages/posts/AiWritingWorkspacePage.tsx`）：
  - 移除 mock 的 `expand` 工具（代码里直接返回 `selectedText + '[AI 扩写的内容...]'`，前端给出"完成"提示但后端根本没有对应端点）。
  - 移除 `tone: '专业'` 与 `aiModel: 'gpt-4'` 硬编码；polish 调用现在从 `loadToolParams('polish')` 读取 ToolParamsPanel 共享的 localStorage，summary 同理读取 `maxLength`。
  - 未知工具分支返回明确的 toast 错误，避免静默失败覆盖原文。
- **CreatePostPage**（`apps/admin/src/pages/posts/CreatePostPage.tsx`）：顶部工具栏新增「工具箱」按钮，携带当前 postId 深链到 `/ai-tools?tool=summary&postId=<id>`，打开 AIToolsPage 后目标文章会自动锁定，配合「导入正文」即可把当前正文带入测试区。新文章（postId === null）隐藏按钮避免混淆。
- **Go DTO 幽灵字段清理**（`apps/server-go/internal/dto/ai.go`）：删除 `SummaryRequest.Model / Style`、`TagsRequest.Model`、`TitlesRequest.Count / Style / Model`、`PolishRequest.PolishType / Style / Model`、`OutlineRequest.Model` 等 Python Pydantic schema 从未存在的兼容别名；保留 `ModelID` + `ProviderCode`。文件头部新增注释说明 Go 侧 DTO 只作声明文档用途、handler 通过 `proxySyncPost` 透传字节流。
- **PolishData.changes 字段删除**（`apps/ai-service/app/schemas/ai.py`、`apps/admin/src/services/aiService.ts`、`apps/admin/src/pages/posts/components/AiToolbar.tsx`）：历史上声明但从未写入的"变更说明"字段彻底移除；`AiToolbar.handlePolishContent` 不再读取 `res.data.changes`。新增代码注释说明"若未来需要 diff/变更说明，请通过独立端点 `/api/v1/ai/polish/diff` 提供"。
- **Embedding 等非文本生成类任务自动过滤**（`apps/admin/src/pages/AIToolsPage.tsx`）：`fetchAllData` 对 `aiProviderService.listTasks()` 的结果按 `model_type` 过滤——只保留 `chat / reasoning / completion / code`，把 `embedding / tts / stt` 等类型挡在 AI 工具箱外（这些任务产生的是向量/音频，没有"应用到文章"语义，误导用户）。日后这些应由「索引管理 / RAG 配置」模块单独呈现。
- **新增 `apps/ai-service/tests/test_ai_routes.py`**：41 个单元测试覆盖：
  - `_parse_tags` / `_parse_titles` / `_split_list` 的所有解析分支（JSON 数组、编号列表、Unicode 智能引号、中文分隔符、`#hashtag` 前缀）。
  - `_build_stream_result_payload` 对 6 种 task_type 的输出形状（含 empty fallback 与未知 task_type 的 `None` 返回）。
  - 6 个非 stream 业务端点（`summary / tags / titles / polish / outline / translate`）的端到端 shape 契约，包括「PolishData 不再暴露 `changes` 属性」的回归测试。
  - `_stream_with_think_detection` 的三个关键行为：`result` 事件在 `done` 之前发送、`isThink` 内容不污染 result、缺少显式 `done` 时仍自动补齐 result+done。
  - `LlmRouter._safe_format` 的七个 Phase 4.1 回归：用户内容含 `{}` 代码块、未知占位符原样保留、缺少闭合大括号、`None` 值替换、等等。
- **Token 解析器鲁棒性加强**（`apps/ai-service/app/api/routes/ai.py`）：新增 `_strip_token` 辅助函数，`_OUTER_STRIP` 扩展为 `_QUOTE_STRIP + "[]【】《》"`，即使 LLM 返回用智能引号包裹的伪 JSON（`[\u201ctag1\u201d, \u201ctag2\u201d]`）也能被 fallback 路径正确清洗。

### 🔧 代码评审反馈采纳（PR #435）

针对 gemini-code-assist 与 copilot-pull-request-reviewer 的 11 条评论：

- **[GEMINI HIGH]** `applyContent` 不再直接传 `{content}` 给 `postService.update` ——
  Go 端 `PostService.Update`（`apps/server-go/internal/service/post_service.go:186`）
  会构建全量 `model.Post` 结构，请求之外的字段一律清空（包括 `SetTags` 会清掉
  所有标签）。现在 hook 内新增 `rebuildFullUpdatePayload` 辅助，从缓存的
  `targetPost` 重建完整 `CreatePostRequest` 再覆盖 `content`，避免破坏性写入。
- **[GEMINI + COPILOT 共识]** `applyTags` 先按 lower-case 去重并分出"已存在 /
  需新建"两组，再用 `Promise.all` 批量并行创建缺失标签。原本 N 次串行
  `await tagService.create()` 在网络较慢时用户感知明显。
- **[COPILOT]** `applyTags` 去重逻辑改为大小写无关（`["AI","ai"]` 不会重复创建）。
- **[GEMINI]** `applyContent` append 模式下对空正文文章不再添加前导 `\n\n`，
  避免新建文档开头两个空行。
- **[GEMINI]** `AIToolsWorkspace` 目标文章下拉增加 fallback：当 URL 深链
  `?postId=X` 指向的文章不在最近 20 条列表中时，把当前 `targetPost` 作为
  附加选项显示，避免选择器显示空值或与锁定目标不同步。
- **[COPILOT]** `ContentApplyBlock.confirmMessage` 支持函数形式
  `(mode) => string`，`OutlineResult` 为 append / replace 两种模式提供不同
  的确认文案。
- **[COPILOT]** `useStreamResponse` 文件头注释从 "解析 NDJSON 流格式" 改为
  "解析 SSE 流格式（按 `\n\n` 分隔事件块）" 以匹配实际实现。
- **[COPILOT]** `_stream_with_think_detection` 用 `list[str] + "".join()`
  代替 `full_text += content`，避免 CPython 下 O(n²) 的字符串拼接代价。
- **[COPILOT]** `loadPostIntoClipboard` 重命名为 `loadPostContent`——函数
  只拉取并返回 content，没有写剪贴板，名字必须一致。
- **[COPILOT]** `useAiToolTarget.ts` 文件头注释校准：删除不存在的"无 target
  自动复制"fallback 描述，改为准确说明"无 target 时 apply 动作 toast 错误
  返回 false，调用方应改用 copyToClipboard"。

### 📄 文档

- `docs/architecture.md` 更新 AI SSE 协议节，记录 `result` 事件格式。
- `CLAUDE.md` AI 服务能力节补充「stream 端点的结构化终稿」说明。

---

## [v0.0.3] — 2026-04-04

> 持续开发阶段，包含 AI 能力全面升级、媒体库深度优化（Phase 1–6）、博客前台功能增强及多项基础设施改进。

### ✨ 新功能 (Features)

#### AI 配置与工具中心 (`apps/admin`)
- **AI 配置中心** (`ai-config`)：三栏式界面，统一管理 AI 供应商、模型与凭证；集成 `@lobehub/icons` v4.1.0 展示品牌图标
- **AI 工具中心** (`ai-tools`)：7 个专项工具页面——内容重写 (ContentRewriter)、QA 生成 (QA)、SEO 优化 (SeoOptimizer)、摘要 (Summary)、标签提取 (Tagger)、文本清理 (TextCleaner)，统一入口 `AIToolsPage`
- **斜杠命令菜单** (`SlashCommandMenu`)：文章编辑器内输入 `/` 触发快捷命令浮层
- **文本选中 AI 工具条** (`SelectionAiToolbar`)：选中文本后浮现 AI 操作快捷工具
- **提示块类型选择器** (`AlertBlockDropdownButton`)：编辑器工具栏支持快速插入 Note/Warning/Error 提示块
- **迁移工具页** (`MigrationPage`)：Vanblog 数据一键导入管理界面

#### 媒体库深度优化 Phase 1–5 (`apps/admin`)
- **文件夹层级管理**：无限嵌套（最大 10 层），物化路径 O(1) 查询，拖拽移动，面包屑导航，统计缓存，颜色/图标自定义
- **智能标签系统**：多标签关联，标签自动补全，批量打标签，使用统计，标签来源追踪（MANUAL/AI_AUTO/AI_SUGGESTED）
- **云存储与 CDN**：存储抽象层（策略+工厂模式），支持 LOCAL/S3/MinIO 多后端，`StorageProviderSettings` 配置页，连接测试
- **图像处理**：`ImageEditor` 组件支持裁剪/旋转/缩放，多尺寸缩略图自动生成（THUMBNAIL/SMALL/MEDIUM/LARGE），EXIF 元数据提取，Blurhash 占位符
- **协作与权限**：5 级 ACL 权限系统（VIEW/UPLOAD/EDIT/DELETE/ADMIN），UUID 分享令牌+密码加密+过期控制，`VersionHistory` 版本历史查看与一键恢复，`ShareDialog` 分享链接管理

#### 媒体库深度优化 Phase 6 (`apps/admin`)
- **虚拟滚动** (`VirtualMediaGrid`)：超过 100 项自动启用 `react-window` 虚拟滚动，DOM 节点减少 98%，滚动帧率稳定 60 fps
- **骨架屏加载** (`MediaSkeleton`)：网格/列表/文件夹树三态骨架屏，CLS 降为 0，消除内容跳动
- **键盘快捷键** (`useMediaKeyboardShortcuts`)：7 个标准快捷键（上传/新建/全选/删除/搜索/取消/帮助），跨平台支持（Ctrl/⌘）

#### 博客前台 (`apps/blog`)
- **AlertBlock 提示块**：支持 Note / Warning / Error 三种类型的富文本提示块渲染，含 `remarkAlertBlock` remark 插件
- **ViewModeToggle**：文章列表视图切换控件
- **VisitTracker**：客户端访问量追踪组件

#### 活动事件与 AI 使用分析
- **活动事件系统**：新增 `activity_events` 表，支持 post/comment/user/system/friend/media/ai 七类事件实时追踪；Admin 活动面板 (`activities/`)
- **AI 使用日志增强**：记录 task_type、provider_code、model_id、total_tokens、estimated_cost，支持精细化成本分析

---

### 🗄️ 数据库变更 (Database Migrations)

| 迁移编号 | 说明 |
|---------|------|
| `000015` | ai_vector_store：向量存储表，启用 pgvector |
| `000016` | ai_usage_logs：AI 使用日志基础表 |
| `000017` | ai_providers：AI 供应商基础表（模型、类型、状态） |
| `000018` | 更新基础模型标识（gpt-5） |
| `000019` | 预置 AI 任务类型种子数据 |
| `000020` | 回填旧 AI Schema：新增 ai_credentials、ai_task_types、ai_task_routing 表；扩展 ai_providers 表（display_name/api_type/base_url/icon/priority/capabilities） |
| `000021` | 修正 AI 模型类型约束，扩展支持 12 种类型 |
| `000022` | 新增 activity_events 表（7 类事件分类，GIN 索引） |
| `000023` | 增强 ai_usage_logs：新增 task_type/provider_code/model_id 字段 |
| `000024` | 修复 AI 使用回填逻辑及字段长度约束 |
| `000025` | 规范化 ai_usage_logs：新增 total_tokens/estimated_cost 字段 |
| `000026` | 预置主流 AI 供应商配置（OpenAI/Anthropic/Google/Azure/DeepSeek 等） |
| `000027` | posts 表新增 Vanblog 迁移字段（is_hidden/source_key/legacy_author_name/legacy_visited_count/legacy_copyright） |
| `000028` | 数据库支持 preserve_updated_at 会话变量，保留原始 updated_at 时间戳 |

---

### 🤖 AI 服务增强 (`apps/ai-service`)

- **独立 AI 服务架构**（FastAPI + LiteLLM）：从 Spring AI 嵌入式方案迁移到独立 Python 服务，零耦合主后端
- **流式响应支持**：summary/tags/titles/polish/outline/translate 全端点新增 `+stream` 流式版本（NDJSON 打字机效果）
- **凭证管理端点**：创建、列出、解密（`/providers/credentials/:id/reveal`）、删除凭证
- **远程模型同步**：`/providers/:code/models/remote` 从供应商 API 拉取最新模型列表
- **模型批量操作**：batch-toggle（批量启用/禁用）、sort（排序）
- **供应商批量操作**：batch-toggle 批量启用/禁用
- **JWT 鉴权中间件**：支持 Go 后端签发的 Token 验证
- **Redis 多维限流**：用户级 + 全局级频率限制，内容哈希响应缓存

---

### 🏗️ 基础设施 (Infrastructure)

- **Nginx 特殊路由**：`/api/v1/ai/*` 路径设置 600s 超时 + SSE 流式支持（禁用缓冲）
- **Docker 资源限制**：精细化各服务内存上限配置

---

### 📦 依赖升级 (Dependencies)

| 组件 | 变更前 | 变更后 |
|------|--------|--------|
| Go | 1.24 | **1.24.1** |
| Vite | 5.x | **6.0.6** |
| Next.js | 15.x | **15.1.3** |
| zod | 3.x | **4.3.5** |
| @lobehub/icons | — | **4.1.0**（新增） |
| react-window | — | **1.8.10**（新增） |
| react-hotkeys-hook | — | **4.5.1**（新增） |
| react-image-crop | — | **10.x**（新增） |
| @dnd-kit/core | — | **6.x**（新增） |

---

## [v0.0.2] — 2026-03-30

> **⚠️ 重大重构版本** — 后端从 Java Spring Boot 全面迁移至 Go (Echo + sqlx + go-redis)。
> 此版本标志着 AetherBlog 进入全新的技术演进阶段，同时带来大量 UI/UX、无障碍与性能优化。

### 💥 破坏性变更 (Breaking Changes)

- **后端运行时从 JVM 切换至 Go**：原 `apps/server`（Spring Boot 4.0 / JDK 25）已被 `apps/server-go`（Go 1.24 / Echo v4）完全替代。
- 部署方式变更：Go 二进制直接运行，无需 JDK 环境；Docker 镜像体积大幅缩小。
- 配置文件格式保持兼容，但部分环境变量前缀调整为 `AETHERBLOG_*`（详见 `apps/server-go/config.yaml`）。

---

### 🚀 核心重构 (Core Refactoring)

#### 后端 Go 重构 (`apps/server-go`)
- **框架迁移**：Spring Boot → Echo v4（高性能、低内存占用 HTTP 框架）
- **数据库访问**：Hibernate/JPA → sqlx（原生 SQL + 结构映射，避免 N+1 问题）
- **缓存层**：Spring Cache → go-redis v9
- **JWT 认证**：Spring Security → golang-jwt/v5
- **配置管理**：Spring Config → koanf（支持 YAML 文件 + 环境变量双源加载）
- **日志**：SLF4J/Logback → zerolog（结构化 JSON 日志，零分配设计）
- **数据库迁移**：Flyway → golang-migrate/v4
- **图片处理**：Java ImageIO → disintegration/imaging
- **对象存储**：Spring S3 → aws-sdk-go-v2/s3
- **输入验证**：Bean Validation → go-playground/validator v10
- **项目结构**：标准 Go 分层架构（`cmd/` + `internal/{handler,service,repository,model,dto,middleware,pkg}`）

#### CI/CD 增量部署
- 新增 `restart.sh` 快速重启脚本，支持只重启单个服务
- CI 流水线支持增量部署：仅重建变更的服务镜像，减少 70%+ 构建时长
- Webhook 部署服务支持 `PYTHON_PATH` 环境变量自定义 Python 解释器路径
- 修复 `deploy.sh` 使用 `tee` 确保 Webhook 能捕获部署输出
- 修复 Python 3.6 兼容性（`subprocess` API 回退）

---

### ✨ 新功能 (Features)

#### 博客前台 (`apps/blog`)
- **移动端底部上滑导航**：Chrome 风格磁吸手势，RAF 节流 + 被动事件监听，零卡顿滚动体验
- **iOS PWA 原生体验**：修复 iOS 独立模式下的渲染闪烁，完善 Safe Area 适配
- **Apple Photos 风格媒体轮播**：触摸滑动 + 电影胶片缩略图，支持键盘导航
- **衬线/书法字体排版**：文章详情页标签与时间线页采用高质感衬线字体
- **视差滚动优化**：首页 Hero 视差效果平滑度与协调性大幅提升

#### 管理后台 (`apps/admin`)
- **容器监控升级**：改用 Docker Socket API 采集实时 CPU/内存数据，取代轮询式抓取
- **VanBlog 数据迁移**：迁移端点新增速率限制（Rate Limit），防止大批量导入压垮服务
- **仪表盘数据精度**：趋势百分比限制为 1 位小数，消除过长小数显示问题

---

### 🎨 UI/UX 改进

- **Hero 按钮重设计**：暗色模式下采用毛玻璃（Glass-morphism）效果替代实色按钮
- **评论区配色修复**：统一使用主题变量，消除硬编码 Indigo 颜色
- **文章上下篇导航**：修正"上一篇"/"下一篇"方向逻辑与移动端布局
- **媒体库预览优化**：缩略图条自动滚动 + 修复移动端裁切问题
- **容器监控图标对齐**：容器类型与图标映射关系全面梳理
- **移动端统计卡片**：修复错位与内容溢出问题
- **时间线折叠动画**：年份分组折叠/展开增加流畅过渡动画
- **移动端菜单右边距**：修复因 `scrollbar-gutter` 导致的右侧空隙

---

### ♿ 无障碍优化 (Accessibility)

- 全站交互元素补全 `focus-visible` 焦点环（BlogHeader、MobileMenu、编辑器工具栏等）
- `ArticleFloatingActions` 补全 ARIA 属性，修正 `aria-live` 配置
- `ThemeToggle` 下拉菜单键盘导航优化
- `FriendsList` 视图切换按钮无障碍属性补全
- 编辑器工具栏焦点状态与 ARIA 属性完善
- SearchPanel 焦点样式修复

---

### ⚡ 性能优化 (Performance)

- `ScrollToTop` 组件使用 `React.memo` 避免不必要的重渲染
- AI 工具栏文本选择事件使用 `requestAnimationFrame` 节流
- 字体字重精简至 400+700，减少字体文件加载体积
- 时间线页使用 `isPending`（TanStack Query v5）替代 `isLoading`，修复并发渲染边界
- 博客 Hero 按钮改用 `<Link>` 组件，增加 `/posts` 路由骨架屏，实现即时导航感知

---

### 🐛 Bug 修复 (Bug Fixes)

- 修复文章详情页加载动画双重淡入导致的闪烁（PageTransition 嵌套冲突）
- 修复环境变量解析时字段名下划线被错误替换的问题
- 修复 SearchPanel focus 样式在测试中 import 路径不规范问题
- 修复代码评审发现的若干边界 Bug（2 处服务层逻辑错误）
- 修复容器监控筛选器下拉框与主内容区重叠问题

---

### 📚 文档更新

- 全量文档梳理，对齐 Java→Go 后端迁移后的实际架构
- 更新 `CLAUDE.md`：准确描述 `apps/server-go` 包结构与启动命令
- 更新 `docs/` 目录：部署指南、开发指南、架构文档与 CI/CD 说明同步更新

---

### 🏗 依赖与环境

| 组件 | v0.0.1 | v0.0.2 |
|------|--------|--------|
| 后端运行时 | JDK 25 + Spring Boot 4.0 | **Go 1.24** |
| HTTP 框架 | Spring MVC | **Echo v4.15** |
| 数据库访问 | JPA / Hibernate | **sqlx v1.4** |
| 缓存 | Spring Cache / Lettuce | **go-redis v9** |
| JWT | Spring Security | **golang-jwt v5** |
| 日志 | SLF4J / Logback | **zerolog v1.35** |
| 配置 | Spring Config | **koanf v2** |
| 博客前台 | Next.js 15 / React 19 | Next.js 15 / React 19 _(不变)_ |
| 管理后台 | Vite / React 19 | Vite / React 19 _(不变)_ |
| AI 服务 | FastAPI + LiteLLM | FastAPI + LiteLLM _(不变)_ |
| 数据库 | PostgreSQL 17 + pgvector | PostgreSQL 17 + pgvector _(不变)_ |
| 缓存中间件 | Redis 7 | Redis 7 _(不变)_ |

---

## [0.0.1] — 2026-02-01

> 初始版本发布，确立完整的全栈智能博客体系。

### 功能亮点

- 博客前台（Next.js 15）：Markdown 渲染、语义搜索、评论、时间线、友链、主题切换
- 管理后台（Vite + React 19）：文章管理、AI 编辑器、媒体库、评论管理、系统监控
- AI 写作辅助：摘要、标题建议、标签提取、内容润色、大纲生成、多语言翻译（SSE 流式输出）
- AI 配置中心：多模型路由（OpenAI / DeepSeek / 通义千问等）动态切换
- 后端 API：Spring Boot 4.0 + JDK 25 + PostgreSQL 17 + Redis 7 + Elasticsearch 8
- Docker Compose 一键部署，Nginx 统一网关

---

[v0.0.3]: https://github.com/golovin0623/AetherBlog/compare/v0.0.2...v0.0.3
[v0.0.2]: https://github.com/golovin0623/AetherBlog/compare/0.0.1...v0.0.2
[0.0.1]: https://github.com/golovin0623/AetherBlog/releases/tag/0.0.1
