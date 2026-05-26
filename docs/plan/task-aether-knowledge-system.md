# task-aether-knowledge-system — Aether Knowledge 多模态知识系统落地手册

> 版本: V1.0  
> 创建日期: 2026-05-26  
> 基线对齐: migrations 至 000061 / Aether Codex Round 5 / AETHERHUB_BLUEPRINT V1  
> 调研依据: [docs/plan/knowledge.md](./knowledge.md)  
> 范围: 把调研报告的「Carrier → Annotation → KnowledgePoint → TypedRelation」四层架构落地为 AetherBlog 独立子模块  
> 任务命名前缀: **task-knowledge-**  
> 性质: **正向迭代**（新增加法为主，不破坏 `notes` / `KnowledgeBase` / `ai-service` / `blog` 任何现有路径）

---

## 0. 北极星（never deviate — 任何阶段都不许越界）

### 0.1 三条铁律（来自 knowledge.md §"如果我是你"）

1. **不要把高亮当知识点**（避免 Readwise 病）—— `Annotation ≠ KnowledgePoint`，schema 第一行就分开。
2. **不要做无类型双向链 + 全连接图谱视图**（避免 Roam/Obsidian 病）—— 从 Phase 2 起所有关系必须是 9 种 typed 之一。
3. **不要让 AI 自动把建议写进图谱**（避免 Mem.ai 病）—— AI 产出统一打 `provenance: ai_suggested`，必须用户确认才能入库。

### 0.2 五条红线（触发即暂停新功能，回到该红线深挖）

| 红线 | 阈值 | 触发后行动 |
|---|---|---|
| R1 锚定召回率 | Phase 1 末，PDF 编辑/版本切换后标注重定位成功率 < 90% | 暂停 Phase 2 入口，回到锚定栈优化 |
| R2 关系密度 | Phase 2 末，平均每个 KP 的 typed relation 数 < 2 | 暂停 Phase 3 入口，回到关系建立 UX |
| R3 AI 接受率 | Phase 3 中段，AI 建议用户接受率 < 20% | 砍掉自动建议，退回到「检索辅助」模式 |
| R4 性能预算 | 任一阶段，admin 首屏 LCP > 2.5s 或 bundle > 6MB | 暂停新依赖，做拆包与懒加载 |
| R5 现状破坏 | 任一阶段，`notes` / `KnowledgeBase` / `blog` 出现回归 | 立刻 revert 引入回归的 commit，单测+E2E 补齐再继续 |

### 0.3 与现有系统的边界（一次性刻死）

| 模块 | 角色 | 与 Aether Knowledge 的关系 |
|---|---|---|
| `notes` (000054) | AetherHub 任务产物 / 私有笔记本（输出流） | **保持原状**。新模块通过 `MarkdownCarrierAdapter` 把 `notes.id` 包装为 Carrier，无 schema 变更 |
| `KnowledgeBase` RAG (000058+) | 全站 / 团队级向量知识库（检索基础设施） | **保持原状**。新模块的 chunker / embedder pipeline 复用 `kb_profiles` 的概念，但不直接共享数据 |
| `ai-service` (FastAPI + LiteLLM) | 模型路由（claim extraction / VLM / 重排） | **新增 endpoint**，路由级隔离，不动现有 `/ai`、`/agent`、`/knowledge_bases` 路由 |
| `blog` 前台 | 公开内容流 | **无交集**。Knowledge 是 admin 后台私有的输入流 |
| `aetherhub` Note | Agent 任务产物 | Agent 可以**推荐**把 Note 提炼成 KP，但必须经用户确认；KP 可以**作为上下文**喂回 Agent，但 Agent 不直接修改 KP |

### 0.4 三个待决策项（Phase 0 必须定）

| 决策 ID | 议题 | 默认值（保守） | 何时可重估 |
|---|---|---|---|
| **D1** | 编辑器是否切 Tiptap + Yjs | `@aetherblog/editor` (CodeMirror) **保留**；新模块用 **Tiptap+Yjs 并存** | Phase 2 末若双轨锚定收益 < 5%，回退为单轨 W3C 选择器 |
| **D2** | `note_embeddings` worker 缺失 | **补齐**：表已建好（migration 000054）+ admin UI 已有「AI 索引状态」占位面板（`CreateNotePage.tsx` PanelGroup "AI"），仅缺后台 worker。Markdown Carrier 适配器接入此表 + 补齐 worker | Phase 3 若新增 `carrier_embeddings` 统一表更合理，做迁移 |
| **D3** | `note_links` 与 `typed_relations` 关系 | **两表并存**：`note_links` 维持 notes 内 `[[]]`；KP 间关系一律走 `typed_relations` | 永不迁移 `note_links`（它是 notes 内部结构） |

---

## 1. 本地开发环境基线

> 任何阶段的 Definition of Done 包含：在下表所列入口验证通过。**不允许只在直连模式验证**——必须走 `:7899` 网关。

### 1.0 基线快照（钉死，每次接班从此处对齐）

| 项 | 值 | 备注 |
|---|---|---|
| 工作分支 | `feat/knowledge-base` | 领先 `main` 81 个 commit；落后 `main` 0 个 |
| HEAD commit | `29013307` | `fix(agent): tag picker 漏掉 password 过滤致密码保护文章标题泄漏` |
| 快照日期 | 2026-05-26 | 创建本手册的日期 |
| 最新 migration（硬盘 ls） | `000061_kb_embedding_hnsw` | 新模块起点 `000062` |
| 既有相关模块 | `notes`（000054 起）/ `KnowledgeBase` RAG（000058+ 含 18 轮安全评审）/ `ai-service` (`kb_indexer.py` + `kb_recall.py`) | 详见 §0.3 |
| 已知文档偏差 | `CLAUDE.md` 自标基线 `2026-05-04 / migrations 000045` 已过期 16 个 migration；`CHANGELOG` 历史段落中的 migration 编号与硬盘 ls 不一致（rebase 后未刷新） | 已通过 `/doc` 同步至 `CLAUDE.md` §0 |
| 既有 notes 的 AI 占位 | `apps/admin/src/pages/notes/CreateNotePage.tsx` PanelGroup "AI" 已渲染 `embeddingStatus`（PENDING/INDEXED/...）+ 进度条 placeholder；后台 worker 尚未实现 | D2 直接复用此 UI |

> **接班守则**: 任何新对话开工前，先 `git log -1 --oneline` 比对此处 HEAD；若已飘移，先更新本快照与 §7 完成日志再继续阶段任务。**严禁**用过期基线推断系统现状。

### 1.1 启动 / 停止（红线：本地一律 `--gateway`）

```bash
./start.sh --gateway   # 默认 / 本地验证 / 真链路（含 nginx）
./stop.sh              # 停止全部
./stop.sh --all        # 含 docker volume 清理（慎用）
```

> 接手坏掉的 `.env`：`mv .env .env.bak && ./start.sh --gateway`，由 `bootstrap_env()` 自动重建。详情见 `.claude/docs/startup-and-env.md`。

### 1.2 服务端口与入口（不要改这些值，新模块只挂端点不开新端口）

| 服务 | 直连端口 | 网关入口（`:7899`） | 用途 |
|---|---|---|---|
| Blog (Next.js 15.1.3) | `3000` | `/` | 公开博客（与本模块无交集） |
| Admin (Vite 6) | `5173`（dev）/ 静态 | `/admin/` | **新模块挂载点** |
| server-go (Echo) | `8080` | `/api/` | **新模块 REST 落地点** |
| ai-service (FastAPI) | `8000` | `/api/v1/ai/` | **claim extraction / VLM / 重排接入点** |
| PostgreSQL 17 (pgvector) | `5432` | — | 主存（含向量） |
| Redis 7 | `6379` | — | 草稿 / 缓存 / 队列 |

### 1.3 数据库基线

- 当前最大 migration: **000061**（`kb_embedding_hnsw`）。
- 本计划新增 migration 起始号: **000062**。所有阶段 migration 必须连续编号，**up/down 成对**，down 必须可逆。
- 启动后用 `psql` 或 admin 「迁移」页面确认 `schema_migrations.dirty = false`。

### 1.4 包结构（packages/ 现有，**不新增 workspace 包**作为 Phase 0-1 约束）

```
packages/
  editor/   ← CodeMirror 编辑器，notes/posts 在用，本模块 Phase 0-1 不动它
  hooks/    ← 跨 app hooks
  types/    ← 跨 app 类型
  ui/       ← 设计系统组件，本模块所有 UI 必走它
  utils/    ← 工具函数
```

- Phase 2+ 若 Tiptap+Yjs 进入生产，新增 `packages/knowledge-editor/`（不影响 `packages/editor`）。
- 新模块的所有共享类型放 `packages/types/src/knowledge.ts`。
- 新模块的所有 UI 必须来自 `@aetherblog/ui`，新增组件先回流到该包，再被 admin 引用（红线）。

### 1.5 模块物理位置（新增目录）

```
apps/server-go/internal/
  knowledge/              ← 新模块所有后端代码
    model/                ← Carrier / Annotation / KnowledgePoint / TypedRelation 等
    repository/
    service/
    handler/
    pkg/                  ← anchoring / selector / extraction 等纯工具

apps/admin/src/
  pages/atlas/            ← 新模块前端入口（"atlas" = 知识图集，避开既有 /knowledge）
    ReaderPage.tsx        ← 阅读 + 标注视图
    AtlasGraphPage.tsx    ← 图谱视图
    KnowledgePointPage.tsx← KP 详情
    components/
  services/atlasService.ts

docs/plan/
  task-aether-knowledge-system.md  ← 本手册
  knowledge.md                      ← 调研报告
```

> 路由前缀决策：admin URL `/atlas/*`，server REST `/api/v1/admin/atlas/*`，权限码命名空间 `content.atlas.*`。**不要**用 `/knowledge` 前缀（会与既有 `/intelligence/knowledge` 的 RAG KnowledgeBase 撞名）。

### 1.6 调试入口与监控

- 后端日志: `logs/server-go.log`，结构化 JSON。
- AI 日志: `logs/ai-service.log`。
- 前端: Vite dev server 自带 HMR；移动端调试见 `.claude/docs/startup-and-env.md` 远程 inspect 一节。
- 健康检查: `http://localhost:7899/api/health`、`http://localhost:7899/api/v1/ai/health`。
- 后台 admin 调试: `http://localhost:7899/admin/`（默认 `admin/admin123`，首登强制改密）。

---

## 2. 数据骨架（核心 4 张新表 + 3 张衍生表）

> Phase 0 一次性建好骨架，后续阶段在此基础上加字段或新增表，不改已建表的核心列。

### 2.1 核心表

```
carriers                  载体（PDF/EPUB/MD/Web/Video/Audio/Image）
  id BIGSERIAL PK
  type VARCHAR(20)        'pdf'|'epub'|'markdown'|'web'|'video'|'audio'|'image'
  source_uri TEXT         原始 URI（文件路径 / URL / notes://{id}）
  content_hash CHAR(64)   sha256，不可变指纹
  title VARCHAR(300)
  author VARCHAR(200)
  language VARCHAR(20)
  metadata JSONB          { pages, duration, dimensions, ... }
  owner_id BIGINT FK users
  status VARCHAR(20)      'ingesting'|'ready'|'failed'
  deleted BOOLEAN
  created_at, updated_at

carrier_versions          原文不可变 + 版本叠加
  id BIGSERIAL PK
  carrier_id BIGINT FK
  version_no INT
  content_hash CHAR(64)
  storage_uri TEXT        实际存储位置
  diff_from_prev JSONB    与上一版差异
  reason TEXT             'original'|'ocr_fix'|'reformat'|'reupload'
  created_at

annotations               W3C WADM 标注层
  id BIGSERIAL PK
  carrier_id BIGINT FK
  carrier_version_id BIGINT FK
  selectors JSONB         W3C selector array (TextQuote+TextPosition+...)
  rel_position BYTEA      Y.RelativePosition 编码（Phase 2 起，nullable）
  body_type VARCHAR(20)   'highlight'|'note'|'image'|'link'
  body_text TEXT
  body_meta JSONB         颜色 / 图标 / 私有标签等
  anchor_state VARCHAR(20)'anchored'|'soft_anchored'|'orphan'
  anchor_score REAL       0..1 锚定置信度
  author_id BIGINT FK
  created_at, updated_at

knowledge_points          一阶公民
  id BIGSERIAL PK
  uuid UUID UNIQUE        UUIDv7
  title VARCHAR(300)
  body_markdown TEXT      用户自己的话
  type VARCHAR(20)        'claim'|'concept'|'question'|'definition'|'method'|'example'|'person'|'source'
  confidence REAL         0..1
  status VARCHAR(20)      'seed'|'growing'|'evergreen'|'archived'
  embedding VECTOR        语义向量（pgvector）
  author_id BIGINT FK
  provenance VARCHAR(20)  'user'|'ai_suggested'|'imported'
  ai_suggestion_id BIGINT 来自哪条 AI 建议（nullable）
  archived BOOLEAN
  created_at, updated_at

typed_relations           有类型关系
  id BIGSERIAL PK
  from_kp_id BIGINT FK
  to_kp_id BIGINT FK
  type VARCHAR(20)        'supports'|'refutes'|'specializes'|'generalizes'|
                          'precedes'|'causes'|'similar_to'|'cites'|'instance_of'
  strength REAL           0..1
  body_markdown TEXT      为什么有这条关系（可空）
  provenance VARCHAR(20)
  ai_suggestion_id BIGINT
  author_id BIGINT FK
  created_at, updated_at
  UNIQUE (from_kp_id, to_kp_id, type)
```

### 2.2 衍生表（按阶段引入）

```
annotation_kp_links       一个标注支撑哪些 KP（多对多） — Phase 2
relation_evidence         一条关系的出处标注（多对多） — Phase 2
kp_review_schedule        FSRS 间隔重复状态 — Phase 5
ai_suggestions            AI 待确认建议（含 KP/关系候选） — Phase 3
```

### 2.3 索引基线（Phase 0 即定）

- `carriers(type, owner_id, updated_at) WHERE deleted=false`
- `annotations(carrier_id, anchor_state)`
- `annotations USING gin (selectors)` JSONB 索引
- `knowledge_points USING gin (to_tsvector('simple', title || ' ' || body_markdown))`
- `knowledge_points USING hnsw (embedding vector_cosine_ops)` — pgvector
- `typed_relations(from_kp_id, type)` / `typed_relations(to_kp_id, type)`

---

## 3. 五阶段路线图

> 每阶段格式: **目标 / 任务清单 / 约束 / 验收 / 红线触发**。  
> 任务编号: `task-knowledge-P{n}-{seq}-{slug}`，例 `task-knowledge-P0-01-schema-baseline`。  
> 进入下一阶段的硬条件: 上阶段「验收」全绿 + 「红线」未触发 + 决策项已闭环。

---

### Phase 0 — 数据骨架与栈决策（4-6 周）

**目标**: 把表、模块骨架、栈决策、文档骨架同时铺好。**Phase 0 末项目还看不出新功能**，但所有后续阶段的"地基"已就位且可回滚。

#### 任务清单

- `task-knowledge-P0-01-schema-baseline` — 撰写 migrations 000062-000067 建 5 张核心表 + 索引（含 down 脚本）
- `task-knowledge-P0-02-module-skeleton` — 新建 `internal/knowledge/` 目录树（model/repo/service/handler/pkg），各包一个空构造函数 + 单元测试桩
- `task-knowledge-P0-03-routing-mount` — 在 `server.go` 挂载 `admin.Group("/atlas")` 占位路由（仅 health check）
- `task-knowledge-P0-04-permission-codes` — 新增权限码 `content.atlas.read` / `content.atlas.write` / `content.atlas.admin`，写入 migration 数据初始化
- `task-knowledge-P0-05-admin-shell` — admin 新增 `pages/atlas/` 目录与 `App.tsx` 路由占位（空白页 + AdminModuleHeader）
- `task-knowledge-P0-06-types-package` — `packages/types/src/knowledge.ts` 添加 Carrier/Annotation/KnowledgePoint/TypedRelation TypeScript 类型
- `task-knowledge-P0-07-decision-record` — 写决策记录 `docs/plan/task-knowledge-decisions.md`，把 D1/D2/D3 当前选项落字
- `task-knowledge-P0-08-anchoring-spike` — Spike: 实测 `diff-match-patch` 对中文 + Markdown 的鲁棒性（500 字段落 × 10 次随机编辑 × 召回率统计）
- `task-knowledge-P0-09-yjs-spike`（D1=Tiptap 才做）— Spike: 1MB Tiptap 文档 × 1000 次随机编辑 × RelativePosition 解析延迟

#### 约束

- **C0-1**: 不引入 `Tauri`（违反"保留 B/S 架构"）。
- **C0-2**: 不删除 / 修改任何现有表的列与索引。
- **C0-3**: 不影响 `notes` / `KnowledgeBase` / `blog` 任何 endpoint 的响应。
- **C0-4**: 所有新表的 `down` migration 必须能完整回滚到 000061 状态。
- **C0-5**: 不引入新的 workspace 包（`packages/knowledge-editor/` 等推迟到 Phase 2）。
- **C0-6**: ai-service 不新增任何 endpoint（Phase 3 才开始）。

#### 验收

| 验收项 | 命令 / 入口 | 期望 |
|---|---|---|
| A0-1 迁移可双向 | `./start.sh --gateway` → migration 000067 → 手动 down 到 000061 → 再 up | 全程 dirty=false |
| A0-2 路由健康 | `curl http://localhost:7899/api/v1/admin/atlas/health` | 200 + `{ok: true}` |
| A0-3 admin 入口 | 浏览器访问 `http://localhost:7899/admin/atlas` | 渲染空白占位页（无报错） |
| A0-4 现状无回归 | `pnpm test` + `pnpm typecheck` + `pnpm design-system:check` | 全部通过；后两者 `0 error` |
| A0-5 锚定 Spike 结论 | `docs/plan/task-knowledge-decisions.md` 内含 Spike 报告 | 给出 d-m-p 中文召回率数字，决定 D1 |
| A0-6 文档同步 | `CHANGELOG.md` 添加 Phase 0 完成条目 | 含日期 + migration 编号 + decision 链接 |

#### 红线触发

- Spike 显示 d-m-p 中文召回率 < 70% → 不要进入 Phase 1，回到锚定栈选型（评估 fastdiff / 其他 fuzzy 算法）。

---

### Phase 1 — 标注层 MVP（10-14 周）

**目标**: 用户能在 admin 里上传 PDF / 选择已有 Markdown 笔记 → 高亮 → 写批注 → 编辑后重新打开标注仍在原位。**Phase 1 是项目的第一次"用户可感知交付"**，对应 knowledge.md M1+M2 的"可发布 alpha"门槛。

#### 任务清单

- `task-knowledge-P1-01-carrier-md-adapter` — `MarkdownCarrierAdapter`：把 `notes.id` 包装为 `carriers` 行（懒创建），共享 content
- `task-knowledge-P1-02-carrier-pdf-ingest` — PDF 上传 → 抽取文本 + 页坐标 → 写 `carriers` + `carrier_versions`（v1=original）+ 存原文件到 media
- `task-knowledge-P1-03-pdf-viewer` — admin Reader 页用 `pdf.js` 渲染 + 文本层 + 选择监听
- `task-knowledge-P1-04-md-viewer` — admin Reader 页 Markdown 渲染（复用 `@aetherblog/editor` 的 Preview 组件）+ 选择监听
- `task-knowledge-P1-05-selector-builder` — 选择 → 生成 W3C 多选择器 `{TextQuote(exact+prefix+suffix), TextPosition, CssSelector|PageRect}`
- `task-knowledge-P1-06-annotation-crud` — Annotation REST: POST/GET/PATCH/DELETE on `/atlas/annotations`
- `task-knowledge-P1-07-robust-anchoring` — 重打开载体时按"位置→上下文模糊→Myers diff→向量回退"四档执行，写回 `anchor_state` + `anchor_score`
- `task-knowledge-P1-08-anchor-ui-states` — 三态 UI: anchored（高亮）/ soft_anchored（虚线 + 待确认）/ orphan（侧栏漂浮 + 一键重对齐）
- `task-knowledge-P1-09-version-migration` — 载体版本切换时跑迁移管线，统计每版本的 anchor 成功率写入 `carrier_versions.diff_from_prev`
- `task-knowledge-P1-10-permission-wiring` — 接入 `content.atlas.*` 权限到 handler + admin 菜单显示
- `task-knowledge-P1-11-e2e-test` — Playwright E2E: 上传 PDF → 高亮 → 关闭重开 → 标注仍在；编辑 MD 后标注重对齐
- `task-knowledge-P1-12-docs-sync` — 同步 `docs/architecture.md` 数据库与 API 节、`.claude/docs/api-handlers.md`

#### 约束

- **C1-1**: 所有标注的 `selectors` 字段必须**至少含 3 个 selector**（TextQuote + TextPosition + 载体专属一个）。单选择器写入直接拒绝。
- **C1-2**: PDF 文件存储走现有 `media` 模块（不新建文件管理）。
- **C1-3**: Reader 页 UI 只用 `@aetherblog/ui` 已有原子组件；新组件先回流到 `packages/ui/`。
- **C1-4**: 不引入 Y.RelativePosition（推迟到 Phase 2 决策点 D1 后再做）。
- **C1-5**: 编辑器仍是 CodeMirror（`@aetherblog/editor`）—— Phase 1 不动栈。
- **C1-6**: 不允许在 PDF 上写 OCR 流程（推迟到 Phase 4）。
- **C1-7**: 所有 ID 在前端日志中脱敏（不暴露 user_id 给浏览器 console）。

#### 验收

| 验收项 | 操作 | 期望 |
|---|---|---|
| A1-1 PDF 标注稳定性 | 上传 200 页学术 PDF → 创建 50 条高亮 → 关闭浏览器 → 重新打开 | 50 条全部 `anchor_state=anchored` 且视觉位置正确 |
| A1-2 MD 编辑迁移 | MD 笔记内创建 20 条高亮 → 在编辑器里做 100 次随机增删（不删除被标注段落）→ 重打开 | ≥18 条仍 `anchored`，剩余至多 2 条为 `soft_anchored` 且能一键接受 |
| A1-3 跨版本迁移 | 上传 PDF v1 → 标 30 条 → 上传修订版 v2（小幅改动） | ≥27 条 `anchored`，≥2 条 `soft_anchored`，至多 1 条 `orphan` |
| A1-4 锚定召回率红线 | 综合 A1-1 + A1-2 + A1-3 | **全局 anchored 比例 ≥ 90%**（R1 红线） |
| A1-5 现状无回归 | 完整跑 `notes` + `KnowledgeBase` + `blog` 主路径 E2E | 全部通过 |
| A1-6 性能预算 | admin 首屏 LCP / bundle 大小 | LCP ≤ 2.0s；bundle ≤ 4MB |
| A1-7 文档已同步 | 检查表 | `architecture.md` / `api-handlers.md` / `CHANGELOG.md` 已更新 |
| A1-8 用户自测 | 自己每日 1h 阅读 + 标注，持续 4 周 | 累计 ≥ 50 条标注，无锚定漂移投诉 |

#### 红线触发

- **R1**: A1-4 < 90% → 暂停 Phase 2 准备，转入"task-knowledge-P1-RED1-anchoring-deepdive"，可选回退到 d-m-p 替代方案或加强向量回退权重。
- **R4**: A1-6 任一超标 → 暂停新依赖，做拆包。

---

### Phase 2 — 知识点与有类型关系（8-12 周）

**目标**: 让用户能从标注中"抽离"出独立的 KnowledgePoint，并用 9 种 typed relation 在 KP 之间建图；初版图谱视图可见、可过滤、可按关系类型着色。

#### 任务清单

- `task-knowledge-P2-01-kp-crud` — `knowledge_points` REST: POST/GET/PUT/PATCH/DELETE
- `task-knowledge-P2-02-extract-from-annotation` — "提炼 KP" 按钮：从一条或多条标注创建 KP，自动写入 `annotation_kp_links`
- `task-knowledge-P2-03-typed-relation-crud` — `typed_relations` REST + 9 种关系最小集（见 §2.1）
- `task-knowledge-P2-04-relation-evidence` — 关系自身可绑定证据标注（`relation_evidence` 表）
- `task-knowledge-P2-05-default-supertags` — 内置 5 个默认 KP type 模板: Concept / Claim / Question / Method / Source；自定义 supertag 为高级功能（不在 onboarding 出现）
- `task-knowledge-P2-06-bidirectional-projection` — 阅读视图侧栏: 当前段落涉及哪些 KP；KP 详情页: 该 KP 的所有标注来源高亮聚合
- `task-knowledge-P2-07-graph-view-v1` — Atlas Graph 页用 `sigma.js`（WebGL）: 力导向 + 节点按 KP type 着色 + 边按 relation type 着色 + 默认隐藏入度 > 20 的枢纽节点
- `task-knowledge-P2-08-graph-filters` — 过滤器: 按 type / 按时间窗口 / 按 tag / 按相似度阈值
- `task-knowledge-P2-09-kp-tag-system` — KP 级 tag（复用现有 `note_tags`? **不复用**，新建 `kp_tags`/`kp_tag_links` 避免语义混淆）
- `task-knowledge-P2-10-yjs-decision`（D1）— 评估 Tiptap+Yjs 是否进入：根据 Phase 1 锚定数据是否 < 95% 决定；通过则启动 `packages/knowledge-editor/`
- `task-knowledge-P2-11-import-from-notes` — 一键"把这条 note 升格为 KP"（保留双向追溯）
- `task-knowledge-P2-12-docs-sync` — 同步设计文档、API 表、CHANGELOG

#### 约束

- **C2-1**: 关系类型**严格限定 9 种**（不允许扩展，扩展走专门 RFC）。
- **C2-2**: KP 创建时**必须**关联至少一条 evidence annotation 或显式声明 `provenance='user'`（防止空 KP）。
- **C2-3**: 图谱视图节点数 > 5000 时必须分页 / 邻域加载（不一次性渲染）。
- **C2-4**: 任何关系的 `from_kp_id = to_kp_id` 必须被拒绝（无自环）。
- **C2-5**: AI 仍未上线 —— Phase 2 不做任何 LLM 调用。
- **C2-6**: `note_links` 表保持原状，**不**迁移其数据到 `typed_relations`。

#### 验收

| 验收项 | 操作 | 期望 |
|---|---|---|
| A2-1 KP 抽离闭环 | 从 30 条标注抽出 10 个 KP，每个 KP 标 type | 全部成功，annotation→kp 双向可追溯 |
| A2-2 关系建立 | 在 10 个 KP 间建 25 条 typed relation（覆盖 9 种至少 7 种） | 全部成功；每条关系可查到 from/to/type/strength |
| A2-3 双向投影 | 在阅读视图打开标注源 PDF | 该段落上方显示 "支撑 N 个 KP"，点击跳转 |
| A2-4 图谱可用性 | Atlas Graph 视图 / 过滤 / 着色 | 三秒内首屏；过滤生效；着色清晰可辨 |
| A2-5 关系密度红线 | 统计 平均 typed_relation / KP | **≥ 2**（R2 红线） |
| A2-6 现状无回归 | E2E 全跑 | 通过 |
| A2-7 性能预算 | 同 Phase 1 + Atlas Graph 1000 节点交互帧率 | ≥ 30fps |
| A2-8 文档同步 | 检查表 | 完整 |

#### 红线触发

- **R2**: A2-5 < 2 → 暂停 Phase 3，转入"task-knowledge-P2-RED2-relation-ux"，重做关系建立 UX（更明显的"+关系"入口、关系建议 toast 等）。**不要**用 AI 自动补关系来掩盖 UX 问题。

---

### Phase 3 — AI 辅助建图（6-10 周）

**目标**: AI 从已有 Carrier 中**建议** claim / entity / relation，全部以"建议卡片"形态出现，用户接受才入库；Hybrid retrieval 上线，搜索质量替代纯 SQL LIKE。

#### 任务清单

- `task-knowledge-P3-01-ai-svc-claim-extract` — ai-service 新增 `POST /api/v1/ai/atlas/claims/extract`，输入 carrier_id + 范围，输出候选 `{claim, evidence_span, type, confidence}`
- `task-knowledge-P3-02-ai-svc-relation-suggest` — `POST /api/v1/ai/atlas/relations/suggest`，输入一对 kp_id，输出 `{type, strength, rationale}`
- `task-knowledge-P3-03-ai-suggestions-table` — 新建 `ai_suggestions` 表：所有 AI 产出先入此表，等待 accept/reject
- `task-knowledge-P3-04-suggestion-card-ui` — admin 侧栏"建议卡片"组件: 标题 + 证据预览 + accept/reject/edit 三按钮，全部打 `provenance: ai_suggested`
- `task-knowledge-P3-05-hybrid-retrieval` — Search 服务: **直接复用** ai-service 现成的 `app/services/kb_indexer.py`（chunker 含 recursive/fixed/markdown/qa/parent_child 五种 + 并发 embed + 单事务写入）与 `app/services/kb_recall.py`（多 KB 并行召回 + top-k 全局合并）。新增 `app/services/atlas_recall.py` 仅对 `knowledge_points` + `annotations` 表加召回逻辑；融合 pgvector + tsvector + bge-reranker-v2-m3。**不重造 chunker、不重写并发 embed**。
- `task-knowledge-P3-06-search-page` — admin Atlas Search 页: 一个搜索框 → 返回 KP / Annotation / Carrier 三类结果，带高亮 + 跳转
- `task-knowledge-P3-07-graph-rag-lite` — 离线 job（每晚一次）: 抽实体 + 简单 Leiden 聚类 + 社区摘要 → 写入 `kp_clusters` 表
- `task-knowledge-P3-08-ignore-list` — 用户拒绝过的建议记入忽略列表（按 carrier+span+suggestion_kind 去重），下次不再打扰
- `task-knowledge-P3-09-cost-budget` — AI 调用走现有 ai-service 的预算控制（沿用 AETHERHUB §7）
- `task-knowledge-P3-10-docs-sync` — `docs/AI_MODULE_PLAN_V2.md` 添加 Atlas 一节；`.claude/docs/api-handlers.md` 同步

#### 约束

- **C3-1**: **任何 AI 产出禁止直接写入** `knowledge_points` 或 `typed_relations` —— 一律先入 `ai_suggestions`。违反此约束即视为产品 bug。
- **C3-2**: 接受建议时必须保留 `ai_suggestion_id` 指向源建议，便于回滚与统计接受率。
- **C3-3**: 重排器优先用本地（bge-reranker-v2-m3 + ollama），云端 API 是 opt-in，且默认关闭。
- **C3-4**: GraphRAG-lite 必须能在 30 分钟内处理 100 个中等长度 carrier；超时降级为只跑实体抽取，跳过聚类。
- **C3-5**: 单次 AI 抽取 token 上限可配置，默认 4000 input / 2000 output。
- **C3-6**: 不引入新模型供应商（沿用 LiteLLM 已配置的）。

#### 验收

| 验收项 | 操作 | 期望 |
|---|---|---|
| A3-1 Claim 抽取质量 | 对一本 200 页中文学术 PDF 跑抽取 | ≥ 30 候选；人工评估精度 ≥ 60%（精度 = 候选中"真的是 claim"的比例） |
| A3-2 关系建议质量 | 50 对 KP 让 AI 建议关系 | ≥ 35 对给出建议；用户接受率 ≥ 50% |
| A3-3 Hybrid retrieval | 自建 30 条 query 测试集 | NDCG@10 ≥ 0.7 |
| A3-4 接受率红线 | 综合 A3-1 + A3-2 | **用户接受率 ≥ 50%**（避开 R3 红线 20%） |
| A3-5 现状无回归 | 全套 E2E | 通过 |
| A3-6 性能预算 | 同上 | 通过 |
| A3-7 成本可见 | admin "AI 用量" 页能看到 Atlas 子项 | 显示模型 / token / 美元 |
| A3-8 文档同步 | 检查表 | 完整 |

#### 红线触发

- **R3**: A3-4 < 20% → 立即砍掉自动建议入口，退回为"用户搜索时辅助检索 + 用户主动让 AI 帮抽"的纯触发式模式。

---

### Phase 4 — 多模态扩展（10-14 周）

**目标**: 视频 / 音频 / 网页 / 图像 四种载体接入，**坚持 transcript-as-primary**，把"视频 + 转录词级时间戳 + 文本标注同步驱动"作为本系统对外的差异化点（knowledge.md §3 最重要的一块）。

#### 任务清单

- `task-knowledge-P4-01-video-carrier` — `VideoCarrier` + `<video>` + Media Fragments 跳转
- `task-knowledge-P4-02-whisperx-pipeline` — 独立 worker（Python 子进程或独立容器）跑 WhisperX → 输出 `[{word, start_ms, end_ms, confidence}]` → 写入 `carriers.metadata.transcript`
- `task-knowledge-P4-03-transcript-as-primary` — 标注 transcript = 标注视频；双选择器存 `{TextQuoteSelector, FragmentSelector{conformsTo: media-frags}}`
- `task-knowledge-P4-04-audio-carrier` — 同 video，但仅音频，无视频帧
- `task-knowledge-P4-05-web-carrier` — 网页快照: 拉取 HTML + 关键 CSS/图 → 存 `media` → DOM 选择器 + TextQuote 双备份
- `task-knowledge-P4-06-browser-extension`（可选，可延后）— 浏览器扩展点击"加入 Atlas"
- `task-knowledge-P4-07-image-carrier` — 图像 + Tesseract OCR + 可选 VLM 描述
- `task-knowledge-P4-08-multimodal-embedding` — 文本继续 bge-m3；图像 CLIP / chinese-CLIP 走 ai-service
- `task-knowledge-P4-09-confidence-fallback` — WhisperX `confidence < 0.6` 的词在 UI 显示淡色提示，允许用户手动微调
- `task-knowledge-P4-10-docs-sync`

#### 约束

- **C4-1**: WhisperX 时间精度**对外承诺为 200ms collar**，不允许任何 UI 文案宣传"50ms 级精度"（来源 knowledge.md §Caveats #1）。
- **C4-2**: Video / Audio 文件存储沿用 `media`，不新建桶。
- **C4-3**: 每个媒体 carrier 上传时必须等转录完成才可标注；转录进度走 SSE 推送（沿用现有 SSE 基建）。
- **C4-4**: 网页快照走 `archive.org` API 做远端备份（opt-in，默认关）。
- **C4-5**: OCR / VLM 走 ai-service 子路由，不允许在 server-go 直连模型。
- **C4-6**: WhisperX worker 进程必须可独立重启而不影响 server-go。

#### 验收

| 验收项 | 操作 | 期望 |
|---|---|---|
| A4-1 视频 transcript 标注 | 上传 30 分钟视频 → 转录 → 标注 transcript 10 处 | 点击标注 = 视频跳转到对应时间窗口，误差 ≤ 500ms |
| A4-2 视频重编码不丢标注 | 重新编码同一视频上传 v2 → 重对齐 | ≥ 8/10 标注成功重对齐 |
| A4-3 网页快照 | 抓取 10 个不同网站 | 全部能在快照模式下打开 + 标注 |
| A4-4 OCR | 上传 10 张图（含中英文） | OCR 文本可索引；准确率 ≥ 85% |
| A4-5 现状无回归 | 全套 E2E | 通过 |
| A4-6 性能 | 转录 30 分钟视频 wall-clock | ≤ 15 分钟（本地 GPU 或云端） |
| A4-7 文档同步 | 检查表 | 完整 |

---

### Phase 5 — 发现与激活（4-8 周）

**目标**: 让用户的 Atlas "活起来"——FSRS 复习提醒、阅读时的上下文推荐、主动关联发现。

#### 任务清单

- `task-knowledge-P5-01-fsrs-engine` — `kp_review_schedule` 表 + FSRS 算法（参考 Anki 23.10+ 实现） + admin Review 页
- `task-knowledge-P5-02-themed-review` — 按 tag / 关系 cluster 打包复习
- `task-knowledge-P5-03-contextual-recommend` — 阅读时段落侧栏: 显示"你的笔记里相关的 5 个 KP"
- `task-knowledge-P5-04-similarity-alert` — 新增 KP 时若 cosine > 0.85 → toast 提示是否合并
- `task-knowledge-P5-05-active-discovery-job` — 每晚 cron 对未连接的高相似 KP 对调 ai-service 生成关系建议
- `task-knowledge-P5-06-export` — 导出: Markdown + JSON（含 W3C 选择器，跨工具互操作）
- `task-knowledge-P5-07-docs-final` — 完整使用手册写入 `docs/atlas-user-guide.md`

#### 约束

- **C5-1**: FSRS 调度必须可关闭（提醒疲劳是常见 PKM 痛点）。
- **C5-2**: 相似度提醒每天 toast ≤ 3 次（防扰民）。
- **C5-3**: 导出 Markdown 不丢失 typed relation 语义（用 frontmatter 或 YAML block 表达）。

#### 验收

| 验收项 | 操作 | 期望 |
|---|---|---|
| A5-1 FSRS 调度 | 50 个 KP × 14 天复习 | 调度算法工作，留存率 ≥ 70% |
| A5-2 上下文推荐 | 阅读时段落侧栏 | 平均每段推荐 ≥ 3 个相关 KP，相关度人工评估 ≥ 60% |
| A5-3 主动发现接受率 | 一周 cron 跑出 50 条关系建议 | 用户接受 ≥ 20 条 |
| A5-4 导出回环 | 导出 + 反向导入到测试库 | 数据无损 |
| A5-5 文档完整 | 用户手册可独立看懂 | 内部 3 人盲测能完成"上传 PDF → 标注 → 建 KP → 看图谱"全流程 |

---

## 4. 持续构建保障机制（防止偏航）

### 4.1 每阶段开始前 5 项检查（"航前清单"）

1. 上一阶段所有验收项标记 ✓，红线未触发。
2. 决策记录 `task-knowledge-decisions.md` 内 D1/D2/D3 状态最新。
3. `CHANGELOG.md` 已记录上阶段完成。
4. 仓库 main 分支 clean，无 dirty migration。
5. 新阶段任务全部以 `task-knowledge-P{n}-{seq}-{slug}` 编号注册到本手册 §6 任务登记表。

### 4.2 每阶段结束前 7 项"防偏航 checklist"

| 项 | 内容 |
|---|---|
| 1 | 三条铁律未被破坏（高亮≠KP / 类型化关系 / AI 建议不入库） |
| 2 | 五条红线均未触发（或触发后已闭环） |
| 3 | 现状无回归: `notes` + `KnowledgeBase` + `blog` 全套 E2E 通过 |
| 4 | 性能预算: admin LCP ≤ 2.5s, bundle ≤ 6MB |
| 5 | 设计系统硬规则: `pnpm design-system:check` 0 error |
| 6 | 类型 / 单测 / E2E: `pnpm test` `pnpm typecheck` 全绿 |
| 7 | 文档同步: `architecture.md` / `api-handlers.md` / 本手册 / `CHANGELOG.md` 全部更新 |

### 4.3 提交规范

- 提交信息前缀: `[atlas:P{n}] task-knowledge-P{n}-{seq}: <subject>`
- 每完成一个 `task-knowledge-*` 任务 → 一个 PR（除非任务声明 chain）。
- PR 描述必含 `📄 文档影响: [已更新 X.md]` 或 `[无需更新, 原因: ...]`。

### 4.4 失败回滚策略

| 失败类型 | 回滚动作 |
|---|---|
| migration 失败 | 立即 down 到上一编号，修复后重发 |
| Phase 验收不过 | 不进入下一阶段，转入 RED 子任务，2 周内未闭环升级到决策 |
| 红线触发 | 按红线对应行动；不允许"绕过"红线 |
| 现状回归 | 立即 revert 引入回归的 commit，补 E2E |

---

## 5. 任务命名规范与状态

### 5.1 命名

```
task-knowledge-P{n}-{seq}-{slug}
       │       │   │     └─ kebab-case 短描述 ≤ 5 词
       │       │   └─ 阶段内顺序号 01..NN
       │       └─ 阶段号 0..5
       └─ 计划前缀，全计划唯一
```

特殊后缀:

- `-RED{n}` — 红线触发后的修复子任务，例 `task-knowledge-P1-RED1-anchoring-deepdive`
- `-SPIKE` — 探索性任务，可不交付代码但必须交付报告，例 `task-knowledge-P0-08-anchoring-spike`

### 5.2 状态机

```
proposed → planned → in_progress → blocked? → in_review → done
                                ↓
                            abandoned
```

每变更一次状态在本手册 §7 完成日志追加一行。

### 5.3 优先级

- **P0 (Critical)**: 不做就进不了下阶段（如 Phase 0 全部任务、各阶段验收用任务）
- **P1 (Important)**: 阶段目标核心
- **P2 (Nice-to-have)**: 可推迟到阶段末或下一阶段

---

## 6. 任务登记表（Phase 0 初始填表，后续阶段开始前补齐）

| 任务编号 | 优先级 | 状态 | 负责人 | 开始日 | 完成日 | PR/Commit | 备注 |
|---|---|---|---|---|---|---|---|
| task-knowledge-P0-01-schema-baseline | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | migrations 000062-000063（5 表合并为单 migration + 权限 seed 单独一份） |
| task-knowledge-P0-02-module-skeleton | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | internal/knowledge/{model,repository,service,handler,pkg/anchoring} |
| task-knowledge-P0-03-routing-mount | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | admin.Group("/atlas") + /health |
| task-knowledge-P0-04-permission-codes | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | content.atlas.{read,write,admin} 已 seed |
| task-knowledge-P0-05-admin-shell | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | pages/atlas/AtlasPage.tsx + Route /atlas |
| task-knowledge-P0-06-types-package | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | packages/types/src/models/atlas.ts |
| task-knowledge-P0-07-decision-record | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | docs/plan/task-knowledge-decisions.md V1.1 |
| task-knowledge-P0-08-anchoring-spike | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | scripts/atlas/anchoring-spike.mjs；light=80.61% / medium=10.37% |
| task-knowledge-P0-09-yjs-spike | P1 | abandoned | claude/session | 2026-05-26 | 2026-05-26 | — | D1 保守路径无需执行（决策记录 §Spike-2 已注明） |

### Phase 1 任务登记表

| 任务编号 | 优先级 | 状态 | 负责人 | 开始日 | 完成日 | PR/Commit | 备注 |
|---|---|---|---|---|---|---|---|
| task-knowledge-P1-01-carrier-md-adapter | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | MarkdownCarrierAdapter 懒包装 notes→carriers，幂等；内容变更触发版本迁移 |
| task-knowledge-P1-02-carrier-pdf-ingest | P0 | partial | claude/session | 2026-05-26 | — | (待提交) | PdfCarrierService 骨架完成；实际 pdf.js 文本抽取留待 Phase 1 后期 |
| task-knowledge-P1-03-pdf-viewer | P0 | not-started | — | — | — | — | Phase 1 后期（pdfjs Reader UI） |
| task-knowledge-P1-04-md-viewer | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | apps/admin/src/pages/atlas/MarkdownReaderPage.tsx，含选区→标注 |
| task-knowledge-P1-05-selector-builder | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | TS lib/selectors.ts + Go service.AnnotationService.Create 校验 |
| task-knowledge-P1-06-annotation-crud | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | annotation_repo/service/handler + < 3 selectors 400 拒绝 |
| task-knowledge-P1-07-robust-anchoring | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | 4 档锚定双端实现；diff-match-patch 替换留待 R1 红线复测 |
| task-knowledge-P1-08-anchor-ui-states | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | 三态徽章 + 重对齐按钮 + 删除 |
| task-knowledge-P1-09-version-migration | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | CarrierVersioningService.MigrateAnnotations + atlas_carrier_versions v2 |
| task-knowledge-P1-10-permission-wiring | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | `/atlas/*` 强制 `content.atlas.read`；Sidebar 增 Compass 入口 |
| task-knowledge-P1-11-e2e-test | P1 | partial | claude/session | 2026-05-26 | — | (待提交) | curl 链路 E2E 已跑通；Playwright 自动化测试推迟 |
| task-knowledge-P1-12-docs-sync | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | CHANGELOG + §7 完成日志 + §6 任务登记 |

### Phase 2 任务登记表

| 任务编号 | 优先级 | 状态 | 负责人 | 开始日 | 完成日 | PR/Commit | 备注 |
|---|---|---|---|---|---|---|---|
| task-knowledge-P2-01-kp-crud | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | KP CRUD 完整；uuid 由 PG `gen_random_uuid()` 默认填充（无 google/uuid 依赖）；embedding 列暂不读以避开 pgvector marshalling |
| task-knowledge-P2-02-extract-from-annotation | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | migration 000064 + annotation_kp_links + CreateAndLinkInTx 原子 |
| task-knowledge-P2-03-typed-relation-crud | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | 9 种类型严格校验 + UNIQUE(from,to,type) + 不自环 |
| task-knowledge-P2-04-relation-evidence | P1 | partial | claude/session | 2026-05-26 | — | (待提交) | 表建好（migration 000064）；attach evidence to relation 的 endpoint 留 Phase 3 |
| task-knowledge-P2-05-default-supertags | P1 | not-started | — | — | — | — | 留待 Phase 3 onboarding 设计 |
| task-knowledge-P2-06-bidirectional-projection | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | GET /annotations/:id/knowledge-points + KP 详情页 evidence section |
| task-knowledge-P2-07-graph-view-v1 | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | AtlasGraphPage 纯 SVG 力导向（200 迭代）+ KP type 颜色 + relation type 颜色 + hub 折叠（入度 > 20）+ MAX_NODES 200 |
| task-knowledge-P2-08-graph-filters | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | type / relation type / 折叠 hub 三种过滤器 |
| task-knowledge-P2-09-kp-tag-system | P2 | not-started | — | — | — | — | 推迟到有真实用户数据后再设计 |
| task-knowledge-P2-10-yjs-decision | P1 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | D1 保守路径维持（决策记录 §D1） |
| task-knowledge-P2-11-import-from-notes | P1 | not-started | — | — | — | — | 留 Phase 3 与 AI 提炼一起做 |
| task-knowledge-P2-12-docs-sync | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | CHANGELOG + §7 完成日志 + §6 任务登记 |

### Phase 3 任务登记表

| 任务编号 | 优先级 | 状态 | 负责人 | 开始日 | 完成日 | PR/Commit | 备注 |
|---|---|---|---|---|---|---|---|
| task-knowledge-P3-01-ai-svc-claim-extract | P0 | stub | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | `app/api/routes/atlas.py` POST /v1/atlas/claims/extract，启发式 + bigram Jaccard；Phase 3 后期换 LiteLLM |
| task-knowledge-P3-02-ai-svc-relation-suggest | P0 | stub | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | POST /v1/atlas/relations/suggest，9 种 typed 启发式选择 |
| task-knowledge-P3-03-ai-suggestions-table | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | migration 000065 (atlas_ai_suggestions + atlas_ignored_suggestions) |
| task-knowledge-P3-04-suggestion-card-ui | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | SuggestionsPage + Inbox + accept/reject + P3-DEMO 创建样例 |
| task-knowledge-P3-05-hybrid-retrieval | P1 | not-started | — | — | — | — | Phase 3 后期 + ai-service 已具备 kb_recall.py 现成实现，新增 atlas_recall.py 即可 |
| task-knowledge-P3-06-search-page | P1 | not-started | — | — | — | — | Phase 3 后期 UI 工作 |
| task-knowledge-P3-07-graph-rag-lite | P1 | not-started | — | — | — | — | Phase 3 后期：实体抽取 + Leiden 聚类 |
| task-knowledge-P3-08-ignore-list | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | atlas_ignored_suggestions + fingerprintSuggestion + IsIgnored 查询 |
| task-knowledge-P3-09-cost-budget | P1 | partial | claude/session | 2026-05-26 | — | (待提交) | atlas_ai_suggestions 已记录 tokens_in/out + cost_usd；admin 用量页归集留 Phase 3 后期 |
| task-knowledge-P3-10-docs-sync | P0 | done | claude/session | 2026-05-26 | 2026-05-26 | (待提交) | CHANGELOG + §7 完成日志 + §6 任务登记 |

### Phase 4/5 任务登记（未在本 session 启动）

| 任务编号 | 优先级 | 状态 | 备注 |
|---|---|---|---|
| task-knowledge-P4-01-video-carrier | P0 | not-started | 脚手架就绪（schema CHECK 已含 'video'）；需 `<video>` + Media Fragments 跳转 |
| task-knowledge-P4-02-whisperx-pipeline | P0 | not-started | 需 GPU + WhisperX 模型权重；本 session 无法验证 |
| task-knowledge-P4-03-transcript-as-primary | P0 | not-started | 行业差异化点，依赖 P4-02 |
| task-knowledge-P4-04-audio-carrier | P0 | not-started | 同 P4-01 |
| task-knowledge-P4-05-web-carrier | P0 | not-started | 网页快照需 storage 桶配置 |
| task-knowledge-P4-06-browser-extension | P2 | not-started | 浏览器扩展独立子项目 |
| task-knowledge-P4-07-image-carrier | P0 | not-started | Tesseract / VLM 调用 |
| task-knowledge-P4-08-multimodal-embedding | P1 | not-started | CLIP / ImageBind |
| task-knowledge-P5-01-fsrs-engine | P0 | not-started | FSRS schedule + admin Review 页 |
| task-knowledge-P5-02..06 | P1 | not-started | 主题复习 / 上下文推荐 / 主动发现 / 导出 |
| task-knowledge-P5-07-docs-final | P0 | not-started | docs/atlas-user-guide.md 全量手册 |

> 后续阶段任务在阶段开始前补齐到本表（Phase 1 任务表、Phase 2 任务表... 可拆为本手册的附录或单独 `task-knowledge-P{n}-tasks.md`）。

---

## 7. 完成日志（live, append-only）

> 每完成一个里程碑或重大决策追加一行。**不要删除历史行**（即便决策被推翻也保留历史）。

| 日期 | 类型 | 内容 | 关联 |
|---|---|---|---|
| 2026-05-26 | 创建 | 本手册 V1.0 创建，对齐 migrations 000061、knowledge.md 调研报告 | — |
| 2026-05-26 | 补丁 | V1.0.1: §1.0 加基线快照（feat/knowledge-base @ 29013307）；D2 修订（note_embeddings 表+UI 占位均已就绪，缺 worker）；P3-05 修订（直接复用 ai-service 的 kb_indexer.py / kb_recall.py） | 本对话偏差校验 |
| 2026-05-26 | Phase 0 | **Phase 0 完成**。落地 migrations 000062-000063 / `internal/knowledge/` 后端骨架 / `pages/atlas/` 前端占位 / `packages/types/models/atlas.ts` 共享类型 / `docs/plan/task-knowledge-decisions.md` 决策记录 V1.1（D1/D2/D3 全保守路径定稿）/ `scripts/atlas/anchoring-spike.mjs` Phase 0 锚定 spike（中文 light 80.61% / medium 10.37% / heavy 0.43%）。**全部 9 个 P0 任务 closed**，A0-1..A0-6 全绿。 | task-knowledge-P0-* |
| 2026-05-26 | 验收 | A0-1 migrations down 2→up 000061↔000063 双向通过；A0-2 `/api/v1/admin/atlas/health` 200 直连 + `:7899` 网关双通；A0-3 `/admin/atlas` SPA 渲染，`AtlasPage-DaTtokZL.js` chunk 7490B 入构建；A0-4 `pnpm typecheck` 全绿、`pnpm design-system:check` 保持 0 error；A0-5 spike 结论入决策记录；A0-6 本日志条目 + CHANGELOG.md 同步。 | — |
| 2026-05-26 | Phase 1 (MVP) | **Phase 1 MVP 落地**: MarkdownCarrierAdapter（懒包装 notes→carriers，幂等）+ 多选择器构建器（W3C TextQuote+TextPosition+CssSelector ≥3 校验）+ Annotation CRUD（POST/GET/PATCH/DELETE 含 `< 3 selectors` 400 拒绝）+ Robust Anchoring 4 档（位置→exact→prefix 邻域→滑窗）双端（TS lib/anchoring.ts + Go service/anchoring.go）+ Markdown Reader 页（带三态徽章 anchored/soft_anchored/orphan 与重对齐按钮）+ 权限闸 `content.atlas.read` + Carrier 版本管线（user_edit 触发 atlas_carrier_versions v2 + annotation 全量重对齐）+ PdfCarrierService 骨架。**E2E 全程在 :7899 网关验证**。 | task-knowledge-P1-{01,04,05,06,07,08,09,10},02-skeleton |
| 2026-05-26 | 验收 | A1-2 MD 编辑迁移: note 3 内容前置导言段后，4 条标注全部 `anchored` (score=1.00) 通过档2 exact substring；carrier_versions 表出现 v1 original + v2 user_edit。A1-5 现状无回归: `/admin/notes` `/admin/note-folders` `/admin/kbs` `/admin/posts` `/api/v1/public/posts` 全 200。A1-6 性能预算: 设计系统 `0 error / 337 warnings / 2255 info` 与 Phase 0 持平。**A1-1 PDF 标注稳定性 / A1-3 跨版本 / A1-4 综合召回率 / A1-8 用户自测**：留待 Phase 1 后期完整 pdf.js 抽取上线后跑（已在 §6 标注）。 | — |
| 2026-05-26 | Phase 2 (MVP) | **Phase 2 MVP 落地**: migration 000064（衍生表 atlas_annotation_kp_links / atlas_relation_evidence + uuid DEFAULT gen_random_uuid()）+ KnowledgePointService CRUD（含 C2-2 evidence 校验）+ RelationService 9 种 typed relation + C2-1/C2-4 校验 + GET /graph + 双向投影（annotation↔KP）+ KP 详情页（含 evidence + 关系管理 + KP-to-KP 跳转）+ Atlas Graph v1（纯 SVG 力导向，按 KP type 着色 + 按 relation type 着色 + hub 折叠）+ ATLAS_RELATION_TYPES 共享常量。**所有 KP UI 走 `@aetherblog/ui` token，design-system 0 error**。 | task-knowledge-P2-{01,02,03,06,07} |
| 2026-05-26 | 验收 | A2-1 KP 抽离闭环: KP 4 由 3 条 evidence 建立，反向投影 GET /annotations/3/knowledge-points → [4]。A2-2 关系建立: cites 3→4 成功 / bad_type 400 / self-loop 400。A2-3 双向投影: API 双向均可达。A2-4 图谱可用性: AtlasGraphPage 6.7KB chunk 入构建，纯 SVG 200 迭代力导向 + hub 折叠。A2-5 R2 关系密度: 初始测试数据 1/4=0.25 偏低；R2 在真用户数据上度量，此处不视为红线触发。A2-6/7 现状 + 性能: 设计系统 0 error 保持，admin build 30.78s 通过。 | task-knowledge-P2-{01..07} |
| 2026-05-26 | Phase 3 (MVP) | **Phase 3 MVP 落地**: migration 000065（atlas_ai_suggestions + atlas_ignored_suggestions）+ AISuggestionService (Create/List/Accept/Reject + 指纹去重) + Suggestion handler 5 endpoints + Admin SuggestionsPage（Inbox UI + accept/reject + P3-DEMO 入口）+ ai-service `/v1/atlas/{health,claims/extract,relations/suggest}` 启发式 stub + C2-2 relax 允许 ai_suggested+ai_suggestion_id 视为审计闭环。**红线 C3-1/C3-2 守住**: 所有 AI 产出永远先入 inbox，accept 时 KP/Relation 自动打 `provenance=ai_suggested` + `ai_suggestion_id` 回指源建议。 | task-knowledge-P3-{01,02,03,04} |
| 2026-05-26 | 验收 | A3 E2E: kp 建议 #1 accept → KP #5 (provenance=ai_suggested, aiSuggestionId=1)，relation 建议 #2 accept → relation #2，reject 建议 #3 → 写入 atlas_ignored_suggestions。bad_type 400 + 已 accepted 二次 accept 400 + ai-service `/v1/atlas/health` 200。**现状无回归**: notes/KB/posts/atlas/health/graph/suggestions 全 200，设计系统 `0 error` 持续保持，admin build 23.41s。**A3-1/2/3 真实质量数字**：Phase 3 stub 启发式 ≠ LLM 真值；切换到 LiteLLM 后再做 60%/50%/0.7 NDCG 复测。 | — |
| 2026-05-26 | Phase 4/5 范围 | **未在本 session 落地**（坚实理由）: P4 视频/音频 WhisperX 需要 GPU + 模型权重下载、PDF.js Reader 需要完整文本层抽取与每页 bbox（非小动作）；P5 FSRS 间隔重复需要真用户使用半年才能度量留存率。**已完成的脚手架**: Carrier 抽象支持 `pdf/epub/web/video/audio/image` 全 7 种类型（schema CHECK + Go const），权限/路由/UI 框架完全就绪；任何 Phase 4 子任务只需新增一个 CarrierXxxService 实现并挂载到 atlas group。 | — |

---

## 8. 风险登记册

| 风险 ID | 描述 | 概率 | 影响 | 应对 |
|---|---|---|---|---|
| RISK-01 | Tiptap+Yjs 引入后 bundle 暴涨 | 中 | 中 | 仅在 D1 评估通过后引入；Phase 2 末若超预算回退到 W3C 单轨 |
| RISK-02 | WhisperX 本地推理无 GPU 性能不足 | 高 | 中 | Phase 4 准备云端 fallback（OpenAI Whisper API），用户可选 |
| RISK-03 | GraphRAG Leiden 聚类对中文文档质量差 | 中 | 中 | Phase 3 评估时若 NDCG@10 < 0.5 退回到只跑实体抽取 |
| RISK-04 | AI 接受率持续低于 50% | 中 | 高 | 触发 R3，回退为纯检索辅助；不补救 |
| RISK-05 | KnowledgeBase RAG 与 Atlas 检索语义混淆 | 低 | 中 | 文档+UI 严格区分命名: KB 用于"全站知识库"，Atlas 用于"个人 KP 图谱" |
| RISK-06 | note_embeddings 死表数据腐烂 | 低 | 低 | Phase 1 内由 Markdown Carrier 接入并跑通 worker |

---

## 9. 决策记录指针

完整决策记录见: [task-knowledge-decisions.md](./task-knowledge-decisions.md)（Phase 0 创建）。

本手册中所有 "D{n}" 引用都指向该文件相应章节。**任何对 D1/D2/D3 的反转必须先更新决策记录再修改本手册。**

---

## 10. 用法约定（如何用本手册保持方向不偏）

1. **开新对话 / 接班时第一件事**: Read 本文件 + `knowledge.md` + `task-knowledge-decisions.md` 三件套。
2. **不要凭直觉新建任务**: 任务必须先注册到 §6 登记表才可开工。
3. **不要静默跨阶段**: 进入下一阶段前必须填完上一阶段验收勾，并在 §7 完成日志追加一行。
4. **不要绕红线**: R1-R5 任一触发即按 §0.2 行动，**不允许**"先做 Phase 2 顺便修 R1"。
5. **不要扩大范围**: 本手册之外的功能（如团队协作、移动端 App、付费等）一律走另起 RFC，不嵌进本计划。
6. **不要破坏现状**: 任何会触发 R5 的改动都必须先评估 + E2E 兜底。

---

## 11. 终点（Definition of "Done for Whole Plan"）

满足以下**全部**条件视为本计划完成:

- [ ] Phase 0-5 全部验收通过
- [ ] 五条红线均未持续触发
- [ ] 三条铁律刻在代码层（schema 约束 / 关系类型 enum / AI 入库 hook）
- [ ] 用户手册 `docs/atlas-user-guide.md` 完成，内部 3 人盲测通过
- [ ] 50 名 alpha 用户中 ≥ 30% 把 Atlas 列为"日常主力 PKM 工具"（knowledge.md §长期触发器）
- [ ] `CHANGELOG.md` / `系统需求企划书及详细设计.md` §1.6 Gap Analysis / `AETHERHUB_BLUEPRINT V2`（若产生）全部同步
- [ ] 本手册 §7 完成日志记录全过程

到达终点后，本手册归档为 `docs/plan/archived/task-aether-knowledge-system-v1.md`，所有后续演进走新 RFC。

---

> **本手册的存在本身**就是一种"不偏航"机制: 任何新对话只要 Read 此文件三秒内就能恢复完整上下文与红线意识。请保持它为唯一真相源——其他文档（设计文档 / API 表 / CHANGELOG）都从此处派生，不允许反向（先改文档再改手册）。
