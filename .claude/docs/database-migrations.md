# 数据库迁移历史 — 演进叙事与自愈机制

> **何时读：** 新建迁移之前；排查 `schema_migrations dirty` 状态；理解某张关键表（`jwt_secrets`、`post_embeddings`、`media_sync_jobs` 等）的来历；调试部署期 migration 失败。
>
> 文件路径：`apps/server-go/migrations/`。文件名即历史，本文档补充**迁移之间的因果关系**和踩坑故事。

---

## 当前基线

- **总数：** 43
- **最新：** `000043_add_media_sync`（Phase 4 同步备份字段 + `media_sync_jobs` 表）
- **次新：** `000042_align_storage_provider_types`

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

### 000041 · （略，参见 SQL 文件本身）

### 000042 · `align_storage_provider_types`
把 `storage_providers.provider_type` 与 `media_files.storage_type` CHECK 约束扩展到 **R2**（原本只允许 LOCAL/S3/MINIO/OSS/COS，但 `factory.go` 早就接受 R2，造成创建 R2 provider / 上传 R2 文件失败 —— **VULN-fix**）。
同时给 `media_variants` 加 `storage_provider_id`，缩略图与主文件保持同源。

### 000043 · `add_media_sync`
Phase 4 同步备份字段 + `media_sync_jobs` 表。详见 `backend-runtime.md` §2 「存量文件入云」。

---

## 部署期 migration 自愈机制

`ops/webhook/deploy.sh` 的预部署 migration 步骤包含 **"dirty self-heal table"**：

| dirty 版本 | 自愈动作 |
| --- | --- |
| v34 dirty | `migrate force 35` → 让 035/036 接力补完版本化 schema |
| v38 dirty | `migrate force 38` → 让 039 接管 widen_summary 与 prompt 重写 |

此机制确保**生产环境部署不会因为历史 dirty 状态而卡死**。新增 dirty 自愈条目时同步更新 `deploy.sh` 与本表。
