# 数据库迁移历史 — 演进叙事与自愈机制

> **何时读：** 新建迁移之前；排查 `schema_migrations dirty` 状态；理解某张关键表（`jwt_secrets`、`post_embeddings`、`media_sync_jobs` 等）的来历；调试部署期 migration 失败。
>
> 文件路径：`apps/server-go/migrations/`。文件名即历史，本文档补充**迁移之间的因果关系**和踩坑故事。

---

## 当前基线

- **总数：** 69
- **最新：** `000069_agent_workflow_full_iteration`（补齐智能编排 runtime 元数据、治理、审批、限流、eval、marketplace、human input、cowork handoff 与 notifications 边界）
- **次新：** `000068_agent_workflow_run_simulated`（为智能编排 run 增加 `simulated` 标记，显式区分真实运行与模拟执行）

---

## 关键表索引

| 表 | 引入版本 | 用途 |
| --- | --- | --- |
| `ai_credentials` | 000020-000028 | AI provider 凭据（Fernet 加密） |
| `ai_task_types` | 000020-000028 | AI 任务类型注册表 |
| `ai_task_routing` | 000020-000028 | AI 任务 → provider/model 路由 |
| `activity_events` | 000020-000028 | 活动事件流 |
| `jwt_secrets` | 000033 | JWT 签名密钥定时轮换（current/previous/retired 三态） |
| `post_embeddings` | 000034 | 版本化向量存储（替代 `post_vectors`） |
| `media_sync_jobs` | 000043 | 存量本地文件入云任务队列 |
| `search_profiles` | 000041 | Chunking 策略 + 模型 + 切片参数四元组绑定，蓝绿翻转扩展到全 RAG pipeline |
| `post_embeddings.parent_text` | 000044 | parent_child chunker 父段原文（其他 chunker_kind 为 NULL） |
| `ai_global_pricing` | 000047 | 按 `model_id` 索引的跨供应商共享价格基准；UI「全局价格」页 + 单条模型详情「↺ 从全局回填 / 写入全局」 |
| `agent_workflows` / `agent_workflow_runs` / `agent_workflow_node_logs` | 000052 / 000068 / 000069 | 智能编排画布、运行实例与节点 trace；000068 增加 run `simulated` 标记，000069 增加治理与全量运行元数据 |

---

## VanBlog 迁移字段（在 `posts` 表上）

`is_hidden` / `source_key` / `legacy_author_name` / `legacy_visited_count` / `legacy_copyright`。

详细机制见 `backend-runtime.md` §5。

---

## 迁移演进叙事（000029 起）

### 000029 · `add_font_family_setting`
为 site_settings 加字体族配置。

### 000030 · `add_ai_cost_archives`
AI 成本归档表，配合 `stats_handler` 的 `ai-cost-archive` 端点。

### 000031 · `search_config`
为检索功能 seed `site_settings` 配置项。

### 000032 · `search_index_timeout`
检索索引超时配置。

### 000033 · `jwt_secrets`
DB 管理的定时轮换签名密钥，三态 `current / previous / retired`。详见 `backend-runtime.md` §1。

### 000034 · `versioned_post_embeddings`
**架构升级：** `post_vectors` 废弃 → `post_embeddings` 版本化存储。
- 变长 vector 列 + partial HNSW 按 `dim × status=active` 分桶
- `site_settings.search.active_embedding_model` 作为活跃模型指针
- 换模型 = INSERT 新行 + 翻转指针，**不动 schema**

### 000035 · `fix_legacy_post_embeddings`
000034 在存量部署上 `CREATE TABLE IF NOT EXISTS` **静默跳过**导致 schema 半成品的第一轮修复。

### 000036 · `post_embeddings_repair`
等价于 000035 的幂等修复 —— 配合 `deploy.sh` 对 "v34 dirty → force 35" 的自愈，确保无论迁移链是否被 dirty 卡住都能落到版本化 schema。

### 000037 · `heal_active_embedding_pointer`
治愈 000034/000036 seed 默认值 `'text-embedding-3-small'` 与实际 `ai_task_routing.embedding` 背离导致 `site_settings.search.active_embedding_model` 变孤儿指针的存量问题。

策略：
- 指针无匹配 active 行时 → 对齐到 `post_embeddings` 行数最多的模型
- 全空时 → 清空指针，让 ai-service 走 `llm_router` fallback
- 配合 `providers.update_routing` 的**蓝绿安全同步钩子**确保路由与指针一致

### 000038 · `improve_ai_prompts`（**有故事的一版**）
重写 7 个 `ai_task_types` 默认 prompt 为强约束版本：
- `summary` 强制单段，不分点不问答
- `tags` / `titles` 输出 JSON 数组
- `polish` 禁止改事实，只调表达
- `outline` 严格按 `{depth}` / `{style}` 输出 Markdown
- `translate` 保留 Markdown 与专有名词
- `qa` 限制只能基于参考内容

**该 migration 在生产必然失败：** 同时试图把 `posts.summary` 列宽 `VARCHAR(500)→VARCHAR(2000)`，但 `v_published_posts` 用 `SELECT p.*` 引用了 `summary`，PostgreSQL 抛 `0A000`，整个 migration 事务回滚 → `schema_migrations` 标 v38 dirty。

### 000039 · `widen_summary_with_view`
修复 000038 留下的 v38 dirty：
1. `DROP VIEW v_published_posts`
2. 重做 7 条 `UPDATE ai_task_types`（因为 038 整体回滚）
3. `ALTER COLUMN summary TYPE VARCHAR(2000)`
4. `CREATE OR REPLACE VIEW v_published_posts`

配合 `deploy.sh` 对 "v38 dirty → force 38" 的自愈，让 039 接管 038 没做完的工作。

### 000040 · `tags_existing_aware_prompt`
重写 `tags` prompt 接受 `{existing_tags}` 占位符，让模型在生成标签时优先在【现有标签库】中精确匹配 (`matches`)，仅在覆盖不到时才补充新建议 (`suggestions`)。

输出 `{matches: [{name, reason?}], suggestions: [...]}` 结构化 JSON。
路由层 `_parse_tags_structured` 对应做"严格 JSON 优先 → 扁平数组兜底 → 幻觉 match 降级 → match 名字归一化到库内规范大小写"四级解析。
缓存 key 加入 `existing_tags` 签名防止标签库变更后命中陈旧分桶。

详见 `backend-runtime.md` §3 「`tags` 端点的『现有标签库』机制」。

### 000041 · `search_profiles`（**蓝绿协议 v2**）
把 000034 的版本化维度（仅 `model_id`）推广到 `(chunker_kind, model_id, chunk_size_tokens, overlap_tokens)` 四元组：
- 新建 `search_profiles` 表（`code` 唯一、`status` ∈ active/shadow/deprecated/archived、`chunker_kind` ∈ recursive/fixed/markdown/qa/parent_child）。
- `post_embeddings` 加 `profile_id` + `chunk_index` + `chunk_text` 三列；存量 1:1 行整体归到默认 profile（chunk_index=0、chunk_text=NULL）。
- 翻转流程同 000034：shadow reindex → 一条事务里翻转三处指针（profile.status × 旧/新 + `site_settings.search.active_profile_code`）。
- partial HNSW 索引仍按 `dim × status='active'` 分桶，profile 维度通过 `profile_id` 过滤。

详见 `architecture.md`「Search Profiles」节与 SearchConfigPage `ProfileManagementSection`。

### 000042 · `align_storage_provider_types`
把 `storage_providers.provider_type` 与 `media_files.storage_type` CHECK 约束扩展到 **R2**（原本只允许 LOCAL/S3/MINIO/OSS/COS，但 `factory.go` 早就接受 R2，造成创建 R2 provider / 上传 R2 文件失败 —— **VULN-fix**）。
同时给 `media_variants` 加 `storage_provider_id`，缩略图与主文件保持同源。

### 000043 · `add_media_sync`
Phase 4 同步备份字段 + `media_sync_jobs` 表。详见 `backend-runtime.md` §2 「存量文件入云」。

### 000044 · `post_embedding_parent_text`（follow-up to 000041）
给 `post_embeddings` 加 `parent_text TEXT`：parent_child chunker 把 post 切成 child（小，高精度召回） + parent（大，高上下文回显），父段原文存这一列。其他 chunker_kind 为 NULL。

PG 17 上 `ADD COLUMN IF NOT EXISTS` 是 instant DDL（不重写表），即便 `post_embeddings` 已有几百万行也不会触发长锁。父段长度由 `search_profiles.chunk_size_tokens × 4` 经验值决定，固化在 `chunker.py::_split_parent_child`。

> **历史小坑：** 该 migration 一开始误编号为 000042（与同期开发的 align_storage 撞号），最终在 `10a116f9 fix(db): renumber parent text migration` 重编为 000044。生产无影响（开发分支隔离）。

### 000045 · `default_post_page_size_to_9`
**配置 seed 调整**，非 schema 变更。

`/posts` 文章列表"最新发布"网格在 lg 断点是 `grid-cols-3`；000013 写入的初始默认 `'10'` 会出现 3+3+3+1 末行单卡。改为 `9` 后 3 行整齐。

策略（**不修改 000013，严守 migration 不可变约定**）：
- 045 作为默认值变更的唯一路径，覆盖两类部署：
  - **全新安装**：000013 先 INSERT `'10'`，045 再 `UPDATE ... WHERE setting_value = '10'` → `'9'`，幂等。最终命中 `'9'`。
  - **存量部署（默认值未改）**：当前 `'10'`，跑 045 后变 `'9'`。
- 已自定义为 5 / 12 / 其他值的实例完全不动（WHERE 不命中）。

> ⚠️ down 已知不对称：如果某实例在 045 之前就被站长手动设成 `'9'`，045 up 不动它，但 045 down 会把它退回 `'10'` —— 默认值类 migration 在没有 audit table 的前提下无法严格逆。down.sql 头部注释里写明了，回滚 045 后请手动校对该项。

### 000046 · `activity_event_category_security`

**约束放宽**，非 schema 变更。

把 `activity_events.event_category` 的 CHECK 白名单从 7 类扩展到 8 类（新增 `'security'`）。背景：

- 000022 创建表时把 `security` 漏在白名单外，但 `auth_handler.go::RotateJWTSecret` 一直直接写 `EventCategory="security"`、前端 `ActivitiesPage` 的 `categoryConfig.security` 也已展示「安全」分类。生产环境每次 JWT 轮换都因 `chk_activity_event_category` 静默失败 —— Go 侧 `_ = h.activitySvc.Create(...)` / `log.Warn()` 把 PostgreSQL 错误吞掉，前端永远拿不到这条审计。
- 同期补全的 AI 模块审计 (`ai.generation.*` / `ai.agent_chat` / `ai.prompt_update` / `ai.task_*`) 仍归类 `'ai'`（已在白名单），不需要再加新分类。

> ⚠️ 回滚提示：若线上已有 `event_category='security'` 的行，down.sql 会因为 CHECK 重建失败。回滚前需先 `DELETE FROM activity_events WHERE event_category = 'security'` 或把这些行迁到 `'system'`。

### 000047 · `ai_global_pricing`

**新表**，配合「全局模型价格」UI 闭环：

- 同一个 `model_id`（如 `gpt-4o-mini`）在 OpenAI / AIHubMix / AI302 等多家 provider 下都有一份独立的 `ai_models` 行，过去要逐个手动维护单价。
- 新表用 `model_id` 字符串作为 `UNIQUE` 索引，存 `currency` / `input_cost_per_1m` / `output_cost_per_1m` / `cached_input_cost_per_1m` + `pricing` JSONB（容纳 `audioInput` 等扩展键 + `units[]`）。
- 数值列用 `DECIMAL(14,6)` —— 比 `ai_models.input_cost_per_1k` 的 `DECIMAL(12,8)` 多 2 位整数位，因为单价单位是 1M tokens（per-1M 比 per-1K 数量级大 1000 倍）。

API 路径 `/v1/admin/providers/global-pricing/*` 由 Go ai_handler 透明代理到 FastAPI ai-service（`apps/ai-service/app/services/global_pricing.py`）。详见 `api-handlers.md` AI 节。

> 「批量回填 / 反向同步」核心算法在 `_sync_model_pricing_capabilities`（`provider_registry.py`）—— 复用 model 与 global 两侧统一的 pricing 规范化路径，避免「单价填了但 pricing.units 还停在旧值」这类漂移。

### 000048 · `add_backup_verification`

对象存储 Phase 5：给 `media_files.sync_status` 加 `MISSING`、新增 `last_verified_at` 与 due-time 索引，并 seed `storage.verify.auto_enabled` / `storage.verify.interval_seconds`，让备份完整性校验能区分「已备份但云端对象被删」。

### 000049 · `add_storage_sync_target`

把「新上传主存储」与「备份同步目标」拆开：新增 `site_settings.storage.sync.target_provider_id`，避免 LOCAL 主存储场景下默认 provider 无法同时表达备份目标。

### 000050 · `add_theme_visual_color_settings`

为 Aether Codex 视觉光源增加 `theme_visual_color_mode` / `theme_visual_color_light` / `theme_visual_color_dark` 三个 `site_settings` 种子值。

### 000051 · `user_team_rbac`

新增可扩展 RBAC / 团队 / 内容共享授权表：`permissions`、`roles`、`role_permissions`、`user_roles`、`teams`、`team_members` 以及文章、媒体、文件夹共享相关边界。

### 000052 · `agent_workflow_canvas`

为后台「智能体编排」提供持久化基础：connector / tool / agent / workflow / version / run / step / trace 等表，并用 `secret_ref` 与变量分离，避免真实密钥下发前端。

### 000053 · `add_editor_image_smart_compression_setting`

**配置 seed，非 schema 变更。**

新增 `site_settings.editor_image_smart_compression_enabled`，默认 `false`、类型 `BOOLEAN`、分组 `advanced`。开启后 admin 文章编辑器上传超过 5MB 的 JPEG / PNG / WebP 图片时会在浏览器端自动智能压缩，上传成功后额外记录 `media.smart_compression` 活动，描述里写入原大小、压缩后大小与节省比例。

### 000054 · `media_folder_is_system`

媒体文件夹加 `is_system / undeletable` 两列。`is_system=TRUE` 的目录在 `/admin/media` 与文件夹树默认过滤掉；`undeletable=TRUE` 拒绝 DELETE。同时 seed `/root/_system_kb` 系统目录（用作知识库归档根）并把 root 目录标记为 undeletable。

### 000055 · `knowledge_bases`

知识库核心 schema，新建 5 张表：`knowledge_bases / kb_profiles / kb_members / kb_files / kb_embeddings`。详见 `CHANGELOG.md` 同期条目。同时 seed `slug='posts'` 的 SYSTEM_POSTS row 作为「文章索引库」。

### 000056 · `kb_default_profiles`

为 SYSTEM_POSTS 库 seed 默认 active profile（recursive/512/64，model 从 site_settings → ai_task_routing → 兜底 text-embedding-3-large 推导）。CUSTOM 库的默认 profile 由 KBService.Create 应用层创建。

### 000057 · `kb_embedding_unconstrained`

把 `kb_embeddings.embedding` 从 `vector(3072)` 改为不锁维度的 `vector`，对齐 post_embeddings 模式。首版 000055 误设硬约束导致 4096 维（Qwen / bge-m3 等）模型直接失败，本 migration 修复并兼容任意 dim。

### 000058 · `kb_embedding_hnsw`

按 dim × status='active' 创建 partial HNSW 索引：768 / 1024 / 1536 使用 vector_cosine_ops；3072 必须走 halfvec_cosine_ops（pgvector HNSW vector 上限 2000，halfvec 上限 4000）。> 4000 维当前 pgvector 不支持 HNSW，召回退化为顺序扫描；建议改用主流维度。

> ⚠️ **编号已变更（commit `8a70196`）：** 上述 KB 区块（本节标题里的 `000054`～`000058`）后来被整体 **+3** 重新编号为磁盘上的 `000057`～`000061`（`000057_media_folder_is_system` / `000058_knowledge_bases` / `000059_kb_default_profiles` / `000060_kb_embedding_unconstrained` / `000061_kb_embedding_hnsw`），为 Notes（000054）等迁移让位。**golang-migrate 只按整数版本判断是否已应用、对同槽位文件内容变化无感知** —— 见下方 000067。

### 000067 · `kb_schema_repair`

**幂等前向修复迁移。** 修复 commit `8a70196` 的 KB 区块 +3 重编号引发的生产事故：槽位 `000058` 的内容从旧 `kb_embedding_hnsw`（建索引）变成 `knowledge_bases`（建表），任何 version ledger 已越过 58 或 backend 镜像被带外更新（绕过 `deploy.sh` 的 pre-deploy `migrate up`）的环境，新槽位 58 的建表语句永不执行 → admin `/api/v1/admin/kbs`（`kb_repo.go` ListAll）报 `relation "knowledge_bases" does not exist`。

本迁移用 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `pg_constraint` 守卫 FK / `ON CONFLICT` 把 000058+000059+000060+000061 收敛后的 KB 最终 schema 幂等重建：缺失则补齐，已正确迁移则全程 no-op（`embedding` 列直接建为不锁维度 `vector`，索引复用 000061 的维度桶 partial HNSW）。`down` 为空（`SELECT 1;`）—— KB 表生命周期归 000058 等的 down，回退一步不应误删整套数据。

### 000068 · `agent_workflow_run_simulated`

为 `agent_workflow_runs` 增加 `simulated BOOLEAN NOT NULL DEFAULT FALSE`。背景是智能编排 Phase 0 诚实化：前端默认真实运行，只有用户显式选择「模拟」时才传 `simulateExternal=true`；后端把该选择持久化到 run history，published slug invoke 强制按真实运行创建 run，避免外部调用把模拟成功误解为真实执行能力。迁移会把历史未知 run 保守回填为 `simulated=true`，新 run 由服务层显式写入真实/模拟模式。

> 注：本 migration 原始编号为 000067，因与 main 的 `000067_kb_schema_repair` 整数版本冲突，整体顺延 +1 改为 000068（`000068_agent_workflow_full_iteration` 顺延为 000069）。

### 000069 · `agent_workflow_full_iteration`

为智能编排全量产品迭代补齐运行与治理边界：

- `agent_workflow_runs` 增加 retry/resume/cancel/source/redaction/budget/error/canonicalized workflow 字段。
- `agent_workflow_node_logs` 增加 `metadata_json`，承载 tokens/source/tool metadata。
- `agent_schedules` 增加 `missed_run_policy` 与 `last_error`；`agent_publications` 增加 `trusted_internal_only`。
- 新增 `agent_workflow_approvals`、`agent_publication_invocations`、`agent_workflow_eval_cases`、`agent_workflow_marketplace_items`、`agent_workflow_error_bindings`、`agent_workflow_human_inputs`、`agent_cowork_tasks`、`agent_workflow_notifications`。
- Seed Article Audit、SEO and Tags、Knowledge Base Sweep 三个 marketplace/template 条目，供后台模板库和内容入口复用。

---

### 000080 · `music_hall_skin`

为音乐大厅接入「作用域皮肤系统」补齐站点默认配置（前台访客可本地覆盖,见 `packages/ui/src/styles/music-skin.css`）。对单行 `music_settings`（id=1）追加 4 列：

- `skin_mode VARCHAR(20) NOT NULL DEFAULT 'preset'`（`preset` | `custom`）
- `skin_preset VARCHAR(40) NOT NULL DEFAULT 'crimson'`（预设 id,见 `MUSIC_SKIN_PRESETS`）
- `skin_color_light VARCHAR(32)` / `skin_color_dark VARCHAR(32)`（自定义模式的亮/暗光源种子,可空）

全部 `ADD COLUMN IF NOT EXISTS`,幂等、单事务安全;NOT NULL 列带 DEFAULT,存量行自动回填,升级后视觉零变化。down 用 `DROP COLUMN IF EXISTS`。公开接口 `GET /v1/public/music/player` 与后台 `GET/PUT /v1/admin/music/settings` 的 payload 同步新增这 4 个字段（`MusicPlayerVO` / `MusicSettingsVO` / `MusicSettingsRequest`）。

---

### 000081 · `qa_document_workflow`

试卷智能拆题闭环（契约 `docs/features/qa-document-workflow.md`）。取空号 000081（当前最大 000080 +1，**不顺移**已合并迁移）。新建 9 张表，全部 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`，单事务安全、可重放幂等：

- `qa_documents`（文档主记录 + 14 态状态机 `status` CHECK + `split_granularity` + `current_version`，软删 `deleted`）
- `qa_document_jobs`（异步流水线任务，`stage`/`status` CHECK + `idempotency_key` 唯一约束保证不重复入队 + attempt/max + payload/log/error）
- `qa_document_versions`（Canonical Tree 整树快照 `tree_json` jsonb + `source`，`(document_id, version_no)` 唯一）
- `qa_doc_blocks`（树节点镜像，自引用 `parent_id` + `stable_key` + `bbox` jsonb，`(version_id, stable_key)` 唯一）
- `qa_annotations`（校对标注，8 类 `annotation_type` CHECK）
- `qa_patches`（Agent Patch Proposal，`operations` jsonb，`base_version` FK）
- `qa_document_diffs`（合并 Diff，`diff` jsonb + `has_conflict`）
- `qa_questions`（审批发布后的正式题库，带 `source_block_ids` 溯源 + `version_no`）
- `qa_audit_logs`（状态迁移/人工动作审计）

down 按依赖逆序 `DROP TABLE IF EXISTS`。无 dirty 自愈条目（纯新增表，重放幂等；若失败 fail-closed 中止部署即可，不会误伤存量数据）。

---

### 000082 · `team_chat`

团队聊天 / 私聊（Phase 1 MVP）。取空号 000082（当前最大 000081 +1，**不顺移**已合并迁移）。建立在 `teams` / `team_members`（000051）之上，新建 4 张表，全部 `CREATE TABLE IF NOT EXISTS` + `CREATE [UNIQUE] INDEX IF NOT EXISTS`，单事务安全、可重放幂等：

- `chat_conversations`（会话，`kind` CHECK [TEAM/DIRECT/GROUP] + `team_id` FK + `dm_key`；部分唯一索引：TEAM 每团队一条 `uq_chat_conv_team`、DIRECT 每对用户一条 `uq_chat_conv_dm`）
- `chat_conversation_members`（成员，`member_role` CHECK 含 **`AGENT` 预留** + `last_read_message_id` 已读位点，PK `(conversation_id, user_id)`）
- `chat_messages`（消息，`sender_type` CHECK [USER/**AGENT**/**SYSTEM** 预留] + `message_type` CHECK [TEXT/IMAGE/FILE/VOICE/SYSTEM] + 附件字段 + `attachment_meta` jsonb + `reply_to_id` 自引用 + `client_msg_id` 幂等；`(conversation_id, client_msg_id)` 部分唯一索引去重重发）
- `chat_user_settings`（用户聊天皮肤偏好：`theme_skin` / `bubble_style` / `font_family` / `accent_color` / `preferences` jsonb）

down 按依赖逆序 `DROP TABLE IF EXISTS`。无 dirty 自愈条目（纯新增表，重放幂等；失败 fail-closed 中止部署）。

---

## 部署期 migration 自愈机制

`ops/webhook/deploy.sh` 的预部署 migration 步骤包含 **"dirty self-heal table"**：

| dirty 版本 | 自愈动作 |
| --- | --- |
| v34 dirty | `migrate force 35` → 让 035/036 接力补完版本化 schema |
| v38 dirty | `migrate force 38` → 让 039 接管 widen_summary 与 prompt 重写 |
| v57 dirty | **条件式**：先探 `knowledge_bases` 是否存在 → 仅当**确认不存在**时 `migrate force 56` 重放整条 KB 链（058 建表 + 059/060/061/067 幂等收敛）；表已存在 / 探测失败则**拒绝自愈**、保持 fail-closed 中止交人工 |

此机制确保**生产环境部署不会因为历史 dirty 状态而卡死**。新增 dirty 自愈条目时同步更新 `deploy.sh` 与本表。

> ⚠️ **v57 与 v34/v38 的关键区别：** v34/v38 是无条件 `force`（重放路径全幂等）；v57 后面紧跟的 `000058_knowledge_bases` 是**裸 `CREATE TABLE`（非幂等）**，所以 `deploy.sh` 在 force 前会用 `_probe_knowledge_bases_exists`（`SELECT to_regclass('public.knowledge_bases')`）探测 —— 只有表**确认不存在**（即文档记录的"漏建"生产状态）才 `force 56`；表已存在时盲目重放会 `already exists` 再次 dirty，因此该分支**主动拒绝自愈**，沿用 fail-closed。`000057_media_folder_is_system` 本身已改为按 `path='/root'` 定位真实根目录，避免历史库 root id 不是 1 时重放触发 `media_folders_parent_id_fkey` (`23503`)。

> ⚠️ **fail-closed 是特性不是 bug：** 只有上表登记的版本会被自动 `force`，**其他任何 dirty 版本一律中止部署**（webhook 返回 500、CI deploy 步骤红）。这是为了不把"需要人工判断的真实迁移故障"误 heal 成绿部署。遇到未登记 dirty 时，必须先人工查清生产真实 schema 再决定 force 目标 —— 见下方 v57 事故复盘。

---

## 事故复盘：v57 dirty 卡死部署（2026-05-26）

**现象：** webhook deploy 在 pre-deploy migration 步骤报 `version: 57, dirty: true` → `migrate up: Dirty database version 57. Fix and force version.` → 自愈表不含 v57 → `did not match the known self-heal signature, aborting deploy` → webhook 500 → CI 红。

**直接原因：** 生产 `schema_migrations` 停在 v57 且 dirty=true；`deploy.sh` 自愈表只认 v34/v38，未登记 v57，按 fail-closed 设计中止部署。

**根因：** commit `8a70196`（`fix(kb): CI 修复…`）为解决与上游 `000054_create_notes` 的撞号，把 KB 区块 `000054-000058` 整体 **+3 重命名**为 `000057-000061`（纯 rename，内容不变）。但 **golang-migrate 只认整数版本** —— 已按旧号 54-58 部署过的生产库，ledger 整数与重编号后磁盘文件内容当场错位：同一槽位文件内容变了却不会重跑，连锁出 dirty / `knowledge_bases` 漏建（000067 即为此补救）等问题。**违反的是「迁移文件不可变」铁律**（见 `CLAUDE.md` §3.8）。

**为何不能盲目自愈 / `force 56; up`：** 槽位 57（`media_folder_is_system`）虽幂等，但 058（`knowledge_bases`）用的是裸 `CREATE TABLE`（**非幂等**），在已建表的库上重跑会 `relation already exists` 再次 dirty。所以 force 目标必须匹配生产**真实 schema**，不能照搬。

**自动恢复（已落地 `deploy.sh`）：** `_try_heal_known_dirty` 的 `57)` 分支会先用 `_probe_knowledge_bases_exists`（`SELECT to_regclass('public.knowledge_bases')`）探测真实 schema —— **仅当 `knowledge_bases` 确认不存在**（即本次事故的"漏建"状态）才 `force 56` 并让 `up` 重放整条 KB 链（058 建表 + 059/060/061/067 幂等收敛 + 062-066 Atlas 首次创建）。这覆盖了下面 runbook 的第 2 步第一种情形，下次 webhook 部署即可自动解开、CI 转绿，无需人工 force。**表已存在或探测失败时该分支主动拒绝自愈**，仍走 fail-closed 中止，需按下方 runbook 人工处理。

**二次故障补丁（同日）：** 首次加入 v57 自愈后，生产重放 000057 暴露出旧 migration 硬编码 `parent_id=1` 的隐患：历史库里 `/root` 的实际 id 漂移，导致 `_system_kb` 插入时报 `media_folders_parent_id_fkey (23503)`。当前 000057 已改为补 `uq_folder_path`、确保 `/root` 存在，并用 `WITH root_folder AS (...)` 把 `_system_kb.parent_id` 指向真实 `/root` 行。

**人工恢复（探测失败 / `knowledge_bases` 已存在等 deploy.sh 拒绝自愈的情形，需有生产 DB 访问的人执行）：**
1. 进生产库查实况：`SELECT version, dirty FROM schema_migrations;` + 抽查关键对象是否存在（`\d media_folders` 看 `is_system`、`\dt knowledge_bases` 等）。
2. 据实况选 force 目标：
   - 若 `media_folders.is_system` **不存在** → `migrate force 56`，让 `up` 重跑幂等的 57 把列补上，再继续。
   - 若 57 的列**已存在**（只是 dirty 标记残留）→ `migrate force 57`，让 `up` 从 58 继续；但需先确认 `knowledge_bases` 等表是否已建，避免撞 058 裸 `CREATE TABLE`。已建则继续 force 跳过已应用的版本，直到落到真正缺失的版本。
   - 收尾：`up` 会一路跑到 000067（幂等 KB 修复）兜底收敛 KB schema。
3. 确认 `dirty=false` 且 backend 健康检查通过后重新触发部署。

> **教训沉淀：** 撞号永远取下一个空号，绝不顺移已合并迁移（`CLAUDE.md` §3.8 已升级为最高红线）。
