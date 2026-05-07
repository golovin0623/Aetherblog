# 数据库迁移历史 — 演进叙事与自愈机制

> **何时读：** 新建迁移之前；排查 `schema_migrations dirty` 状态；理解某张关键表（`jwt_secrets`、`post_embeddings`、`media_sync_jobs` 等）的来历；调试部署期 migration 失败。
>
> 文件路径：`apps/server-go/migrations/`。文件名即历史，本文档补充**迁移之间的因果关系**和踩坑故事。

---

## 当前基线

- **总数：** 46
- **最新：** `000046_activity_event_category_security`（`activity_events.event_category` 白名单扩展到 8 类，新增 `security`，配合 AI 模块 / JWT 轮换审计落库）
- **次新：** `000045_default_post_page_size_to_9`（默认每页文章数 10 → 9，配合 3 列网格无尾行单卡）

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

---

## 部署期 migration 自愈机制

`ops/webhook/deploy.sh` 的预部署 migration 步骤包含 **"dirty self-heal table"**：

| dirty 版本 | 自愈动作 |
| --- | --- |
| v34 dirty | `migrate force 35` → 让 035/036 接力补完版本化 schema |
| v38 dirty | `migrate force 38` → 让 039 接管 widen_summary 与 prompt 重写 |

此机制确保**生产环境部署不会因为历史 dirty 状态而卡死**。新增 dirty 自愈条目时同步更新 `deploy.sh` 与本表。
