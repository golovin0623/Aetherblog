# 01 · Schema 全表清单

> 涵盖 `apps/server-go/migrations/000001` 至 `000067` 累积形成的主要表。每张表给出字段、关键约束、引入版本与对应 Go 模型。

---

## 0. 索引图

```
用户/鉴权:    users, jwt_secrets
内容:         posts, categories, tags, post_tags, comments,
              notes, note_folders, note_tags, note_tag_links,
              note_links, note_embeddings
访问控制:     permissions, roles, role_permissions, user_roles,
              teams, team_members, content_shares
媒体:         media_files, media_folders, media_variants, media_versions,
              media_tags, media_file_tags, media_metadata, media_shares,
              media_sync_jobs, folder_permissions, storage_providers,
              attachments
AI 模型:      ai_providers, ai_models, ai_credentials, ai_task_types,
              ai_task_routing, ai_global_pricing
AI 检索:      post_embeddings, search_profiles, kb_embeddings
AI 埋点:      ai_usage_logs
Aether知识:   knowledge_bases, kb_profiles, kb_members, kb_files,
              atlas_carriers, atlas_carrier_versions,
              atlas_annotations, atlas_knowledge_points,
              atlas_typed_relations, atlas_ai_suggestions,
              atlas_ignored_suggestions
统计/审计:    visit_records, visit_daily_stats, daily_stats,
              sys_operation_log, activity_events
配置/外部:    site_settings, friend_links
工具:         schema_migrations  (golang-migrate 自管理)
视图:         v_published_posts, v_post_archives
```

> Go model 文件在 `apps/server-go/internal/model/`;Python ai-service 通过 raw SQL 直接读写,无 ORM 模型。

---

## 1. 用户与鉴权

### 1.1 `users` (000001)
**Go 模型**: `model/user.go::User`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `username` | VARCHAR(50) | UNIQUE NOT NULL | 登录名 |
| `email` | VARCHAR(100) | UNIQUE NOT NULL | |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt |
| `nickname` | VARCHAR(50) | nullable | |
| `avatar` | VARCHAR(500) | nullable | |
| `bio` | TEXT | nullable | |
| `role` | VARCHAR(20) | CHECK ∈ {ADMIN, AUTHOR, USER} | |
| `status` | VARCHAR(20) | CHECK ∈ {ACTIVE, INACTIVE, BANNED} | |
| `last_login_at` | TIMESTAMP | nullable | |
| `last_login_ip` | VARCHAR(50) | nullable | |
| `must_change_password` | BOOLEAN | DEFAULT FALSE | 首次登录强制改密 |
| `created_at`, `updated_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP, trigger 自动更新 | |

索引: `idx_users_username`, `idx_users_email`, `idx_users_status`。

### 1.2 `jwt_secrets` (000033)
> `migrations/000033_jwt_secrets.up.sql` 引入。VULN-152 后把 JWT 签名密钥从环境变量提升为 DB 管理,支持双 key 重叠验证。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `secret_value` | TEXT NOT NULL | 实际密钥(密文) |
| `status` | VARCHAR(16) CHECK ∈ {current, previous, retired} | |
| `created_at`, `promoted_at`, `demoted_at`, `retired_at`, `retires_at` | TIMESTAMPTZ | 状态机时间戳 |

部分唯一索引保证 `current` / `previous` 各最多一行:
```sql
CREATE UNIQUE INDEX uq_jwt_secrets_current  ON jwt_secrets(status) WHERE status = 'current';
CREATE UNIQUE INDEX uq_jwt_secrets_previous ON jwt_secrets(status) WHERE status = 'previous';
CREATE INDEX idx_jwt_secrets_retires_at ON jwt_secrets(status, retires_at);
```

应用侧 repo: `internal/repository/jwt_secret_repo.go`(BootstrapIfEmpty / Rotate / Promote 事务)。

---

## 2. 内容核心

### 2.1 `categories` (000001)
**Go 模型**: `model/category.go::Category`

主键 `id`;唯一 `slug`;自引用 `parent_id REFERENCES categories(id) ON DELETE SET NULL`;`post_count` 是缓存,trigger `trigger_update_post_counts` 维护。

索引: `idx_categories_slug`, `idx_categories_parent`, `idx_categories_sort_order`。

### 2.2 `tags` (000001)
`id`,`name`,`slug` UNIQUE,`color`,`post_count`(缓存)。索引 `idx_tags_slug`, `idx_tags_post_count DESC`。

### 2.3 `posts` (000001 + 多次扩展)
**Go 模型**: `model/post.go::Post`(含 35 个字段,演进版)

核心字段:
- `title`(VARCHAR 200)、`slug` UNIQUE、`content_markdown` TEXT、`content_html` TEXT。
- `summary` —— **000001 是 VARCHAR(500),000038/039 加宽到 VARCHAR(2000)**。
- `cover_image`、`status` CHECK ∈ {DRAFT, PUBLISHED, ARCHIVED, SCHEDULED}。
- 外键: `category_id → categories`,`author_id → users`(均 ON DELETE SET NULL)。
- 计数: `view_count`, `comment_count`, `like_count`, `word_count`, `reading_time`。
- 状态布尔: `is_pinned`, `pin_priority`(000003), `is_featured`, `is_hidden`(000027), `allow_comment`, `deleted`。
- SEO: `seo_title`(VARCHAR 200), `seo_description`(VARCHAR 300), `seo_keywords`(VARCHAR 200)。
- `embedding_status` CHECK ∈ {PENDING, INDEXED, FAILED}。
- 时间: `scheduled_at`, `published_at`, `created_at`, `updated_at`。
- VanBlog 迁入字段(000027):`is_hidden`, `source_key`, `legacy_author_name`, `legacy_visited_count`, `legacy_copyright`。
- `password` —— 文章密码(bcrypt 后存入)。

索引:
```
idx_posts_slug                        UNIQUE 由列约束自带
idx_posts_status
idx_posts_published_at (DESC)
idx_posts_category
idx_posts_author
idx_posts_deleted
idx_posts_embedding_status
idx_posts_pinned (is_pinned DESC, published_at DESC)
idx_posts_pin_priority (pin_priority DESC, published_at DESC)   -- 000003
idx_posts_scheduled WHERE scheduled_at IS NOT NULL
idx_posts_fulltext  GIN(to_tsvector('simple',
    left(title || ' ' || COALESCE(summary,'') || ' ' || COALESCE(content_markdown,''), 200000))) -- 000055
idx_posts_source_key UNIQUE WHERE source_key IS NOT NULL          -- 000027
idx_posts_hidden_status (is_hidden, status, published_at DESC)    -- 000027
```

> **`v_published_posts` 视图依赖 `posts.*`** —— 修改任何列类型必须先 `DROP VIEW`(参见 000038 → 000039 的故事)。

### 2.4 `post_tags` (000001)
关联表,组合主键 `(post_id, tag_id)`,均 `ON DELETE CASCADE`,`created_at` 时间戳。索引 `idx_post_tags_tag`(反查标签下文章)。

### 2.5 没有 `post_versions` / `post_categories`(多对多)
> 仓库实际未引入 `post_versions` 表(文档体系里偶尔提及,但 migration 里没有);文章只走 markdown + 编辑器自带历史(前端 `useEditorHistory`)。`post_categories` 同样未引入 —— 文章 ↔ 分类是 1:n(`posts.category_id`),不是 n:n。

### 2.6 Notes 智能笔记 (000054 + 000055)

后台私有内容域,不是 `posts` 的子类型,也不会进入前台公开路由。

核心表:
- `note_folders`: 私有笔记文件夹树,`parent_id` 自引用,`deleted=false` 条件索引。
- `note_tags` / `note_tag_links`: 独立于文章 `tags` 的笔记标签体系。
- `notes`: `title`, `content_markdown`, `summary`, `folder_id`, `author_id`, `source_type`, `source_meta`, pinned/favorite/archive/delete 状态,`embedding_status`。
- `note_links`: 笔记内双链,保存 `source_note_id`,可选 `target_note_id`,以及 `target_title/link_text/position`。
- `note_embeddings`: 笔记向量 chunk,关联 `search_profiles`,字段含 `chunk_text`, `parent_text`, `embedding vector`, `embedding_dim`, `model_id`, `token_count`, `status`, `error_message`；000074 追加 profile/dim 过滤索引与 768/1024/1536/3072 HNSW partial index。

000055 将 `idx_notes_fulltext` 与 `idx_posts_fulltext` 都改为 `left(..., 200000)` 后再生成 `tsvector`,避免 PostgreSQL 对超长 tsvector 抛 `SQLSTATE 54000`。

---

## 3. 评论

### 3.1 `comments` (000001 + 000004)
**Go 模型**: `model/comment.go::Comment`

字段: `id`, `post_id`(FK), `parent_id`(自引用,二级回复), `nickname`, `email`, `website`, `avatar`, `content` TEXT, `status` CHECK, `ip`, `user_agent`, `is_admin`, `like_count`。

`status` CHECK 历史:
- 000001:`{PENDING, APPROVED, REJECTED, SPAM}`
- 000004:补 `DELETED`(`migrations/000004_fix_comment_status_constraint.up.sql`)

索引:`idx_comments_post`, `idx_comments_parent`, `idx_comments_status`, `idx_comments_created`(DESC)。

---

## 4. 媒体存储

### 4.1 `media_files` (000001 + 后续多次扩展)
**Go 模型**: `model/media.go::MediaFile`(40+ 字段,跨 Phase 1-4)

基础(000001):`filename`, `original_name`, `file_path`, `file_url`, `file_size`, `mime_type`, `file_type` CHECK ∈ {IMAGE, VIDEO, AUDIO, DOCUMENT, OTHER}, `storage_type` CHECK, `width`, `height`, `alt_text`, `uploader_id`。

增量字段:
- 000007:`folder_id BIGINT REFERENCES media_folders(id)`
- 000009:`storage_provider_id`, `cdn_url`(支持自定义 provider 与 CDN 加速)
- 000010:`blurhash`, `exif_data JSONB`, `ai_labels JSONB`(GIN `idx_media_files_ai_labels`)
- 000011:`current_version`, `is_archived`, `archived_at`, `archived_by`
- 000012:`deleted`, `deleted_at`(软删除)
- 000043:`sync_status` ∈ {NONE, PENDING, SYNCING, SYNCED, FAILED}, `backup_provider_id`, `backup_url`, `backup_at`, `backup_error`(本地→云镜像备份)

CHECK 演进:
- `chk_media_storage_type`: 000001 `{LOCAL, MINIO, COS, OSS, S3}` → **000042 加 R2**。
- `chk_media_sync_status`: 000043 引入。

索引:`idx_media_files_uploader/type/created/folder/storage_provider/ai_labels/archived/deleted`,`idx_media_files_sync_status WHERE sync_status != 'NONE'`(性能索引,避免大表全扫)。

### 4.2 `media_folders` (000007)
**Go 模型**: `model/media.go::MediaFolder`

物化路径(Materialised Path)实现树形:`path VARCHAR(1000) UNIQUE`(如 `/root/photos/2024`),`depth INT`,`parent_id` 自引用 ON DELETE CASCADE。

权限可见性:`visibility` CHECK ∈ {PRIVATE, TEAM, PUBLIC}。

特殊行: id=1 是预创建的 `Root` 文件夹(`SELECT setval('media_folders_id_seq', 1, true)` 重置序列)。

索引:`idx_media_folders_parent/path/owner/visibility/created_at`。

### 4.3 `media_variants` (000010 + 000042)
缩略图 / WEBP / AVIF 等图像变体。字段:`media_file_id`, `variant_type` CHECK ∈ {THUMBNAIL, SMALL, MEDIUM, LARGE, WEBP, AVIF, ORIGINAL}, `file_path`, `file_url`, `file_size`, `width`, `height`, `format`, `quality`。

唯一约束 `uq_media_variant (media_file_id, variant_type)` —— 同一文件每种变体最多一行。

000042 加 `storage_provider_id` —— S3 模式下缩略图与主文件保持同源,删除时按 provider 反查统一清理。

### 4.4 `media_versions` (000011)
**Go 模型**: `model/media_version.go::MediaVersion`

字段:`media_file_id`, `version_number`, `file_path`, `file_url`, `file_size`, `change_description`, `created_by`。唯一约束 `(media_file_id, version_number)`。

### 4.5 `media_tags` / `media_file_tags` / `media_metadata` (000008)
- `media_tags`: 与文章 `tags` 表分离;字段含 `category` CHECK ∈ {CUSTOM, AI_DETECTED, SYSTEM}。Seed 4 个系统标签:重要/草稿/已发布/存档。
- `media_file_tags`: 关联表,组合主键 `(media_file_id, tag_id)`,带 `tagged_at`/`tagged_by`/`source` CHECK ∈ {MANUAL, AI_AUTO, AI_SUGGESTED}。
- `media_metadata`: 自定义 KV(`media_file_id, meta_key, meta_value, meta_type` CHECK)。`uq_media_metadata (media_file_id, meta_key)` 保证一文件一键不重复。

### 4.6 `media_shares` (000011)
**Go 模型**: `model/media_share.go::MediaShare`

字段:`share_token` UNIQUE 64 字节,`media_file_id` 与 `folder_id` **二选一**(CHECK `chk_share_target` 强制),`share_type` ∈ {FILE, FOLDER},`access_type` ∈ {VIEW, DOWNLOAD},`access_count`, `max_access_count`, `password_hash`, `expires_at`。

### 4.7 `folder_permissions` (000011)
**Go 模型**: `model/folder_permission.go::FolderPermission`

字段:`folder_id`, `user_id`, `permission_level` CHECK ∈ {VIEW, UPLOAD, EDIT, DELETE, ADMIN},`granted_by`, `granted_at`, `expires_at`。唯一约束 `(folder_id, user_id)` —— 同一用户对一文件夹只一行。

### 4.8 `storage_providers` (000009 + 000042)
**Go 模型**: `model/media.go::StorageProvider`

字段:`name` UNIQUE,`provider_type` CHECK,`config_json` TEXT(序列化的 provider 配置),`is_default`, `is_enabled`, `priority`。

`chk_provider_type` 演进:`{LOCAL, S3, MINIO, OSS, COS}` → **000042 加 R2**。

Seed:`Local Storage`(`provider_type=LOCAL`, `config_json={"basePath":"./uploads","urlPrefix":"/uploads"}`)。

### 4.9 `media_sync_jobs` (000043)
**Go 模型**: `model/media.go::MediaSyncJob`

字段:`media_id`, `target_provider_id`, `status` CHECK ∈ {PENDING, RUNNING, SUCCEEDED, FAILED}, `attempt`, `last_error`, `started_at`, `finished_at`。

索引 `idx_media_sync_jobs_status_created`(workr 拣表),`idx_media_sync_jobs_media_id`(按文件反查任务)。

### 4.10 `attachments` (000001)
独立于 media_files,文章下载附件用。字段:`post_id`, `filename`, `original_name`, `storage_type` CHECK ∈ {LOCAL, TENCENT_COS, ALIYUN_OSS, MINIO, AWS_S3}, `storage_path`, `file_size`, `mime_type`, `download_count`, `encryption_key`, `uploader_id`。

> 注意:`attachments.storage_type` 的字面量与 `media_files.storage_type` **不一致**(`TENCENT_COS` vs `COS`)。这是早期遗留;实际媒体一律走 `media_files`,attachments 在前端无入口。

---

## 5. AI 模型注册

### 5.1 `ai_providers` (000017)
字段:`code` UNIQUE,`name`, `display_name`, `api_type` CHECK ∈ {openai_compat, anthropic, google, azure, custom},`base_url`, `doc_url`, `icon`, `is_enabled`, `priority`, `capabilities JSONB`, `config_schema JSONB`。

历史扩展:000020 backfill 旧库缺失列;000026 重新种入 50+ 内置供应商。

### 5.2 `ai_models` (000017 + 000018 + 000021)
字段:`provider_id` FK ON DELETE CASCADE,`model_id`, `display_name`, `model_type` CHECK,`context_window`, `max_output_tokens`, `input_cost_per_1k`, `output_cost_per_1k`(DECIMAL 12,8),`capabilities JSONB`, `is_enabled`。

唯一约束 `uq_ai_models_provider_model (provider_id, model_id)`。

`chk_ai_model_type` 演进:
- 000017: `{chat, embedding, image, audio, reasoning, tts, stt, realtime, text2video, text2music}`
- 000021: 加 `code`, `completion`(支持 LiteLLM 拉到 whisper-1 等 stt 模型)

### 5.3 `ai_credentials` (000017)
字段:`user_id` 可空(系统级),`provider_id` FK,`name`, `api_key_encrypted TEXT`(应用层 Fernet),`api_key_hint VARCHAR(20)`(显示用脱敏),`base_url_override`, `extra_config JSONB`, `is_default`, `is_enabled`, `last_used_at`, `last_error`。

### 5.4 `ai_task_types` (000017 + 000019)
**Go 模型**: `model/ai.go::AITaskType`(JSONB 列 `config_schema` 被有意排除)

字段:`code` UNIQUE,`name`, `description`, `default_model_type`, `default_temperature DECIMAL(3,2)`, `default_max_tokens`, `config_schema JSONB`, `prompt_template TEXT`。

Seed 7 类(000019):`summary, tags, titles, polish, outline, embedding, qa`;000017 早期加 `translate`。

`prompt_template` 历史:000019 初版宽松 → 000038/039 强约束改写 → 000040 `tags` 加 `{existing_tags}` 占位符。

### 5.5 `ai_task_routing` (000017 + 000019)
字段:`user_id` 可空(NULL = 系统默认),`task_type_id` FK,`primary_model_id`, `fallback_model_id`, `credential_id`, `config_override JSONB`, `prompt_template TEXT`(管理员后台覆盖,优先于 task_types.prompt_template),`is_enabled`。

唯一约束 `uq_ai_task_routing_user_task UNIQUE NULLS NOT DISTINCT (user_id, task_type_id)` —— PG15+ 语法。

### 5.6 `ai_usage_logs` (000016 + 000023 + 000025 + 000030)
字段累积:
- 000016: `id`, `user_id`, `endpoint`, `model`, `request_chars`, `response_chars`, `tokens_in`, `tokens_out`, `latency_ms`, `success`, `cached`, `error_code`, `request_id`, `created_at`。
- 000023: 加 `task_type`, `provider_code`, `model_id`, `total_tokens`, `estimated_cost NUMERIC(16,8)`。
- 000024: 加宽 `model VARCHAR(128)`, `error_code VARCHAR(128)`。
- 000025: NOT NULL + DEFAULT 固化数值类字段。
- 000030: 加 `cost_archive_status` CHECK ∈ {pending, archived, failed}, `cost_archive_amount`, `cost_archived_at`, `cost_archive_error`。

索引:`idx_ai_usage_logs_created_at DESC`、`idx_ai_usage_logs_user/endpoint`、`idx_ai_usage_logs_task_created/model_created/provider_created`(全 DESC)、`idx_ai_usage_logs_success_created`、`idx_ai_usage_logs_cost_archive_status_created`。

### 5.7 `ai_global_pricing` (000047)

全局模型价格基准表,按 `model_id` 唯一,用于 Admin Global Pricing 页批量维护同名模型价格。

字段:`model_id`, `display_name`, `currency`, `input_cost_per_1m`, `output_cost_per_1m`, `cached_input_cost_per_1m`, `pricing JSONB`, `notes`, timestamps。

注意:它不是 Go analytics 的直接事实源。ai-service apply/sync 把全局价格写回 `ai_models` 后,后续用量成本才会按新价格计算;已归档历史成本不会自动重算。

---

## 6. AI 检索与向量

### 6.1 `post_embeddings` (000034 → 000041 → 000044)
**核心字段(累积)**:
| 字段 | 类型 | 引入 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL PK | 000034 | |
| `post_id` | BIGINT FK ON DELETE CASCADE | 000034 | |
| `model_id` | VARCHAR(120) NOT NULL | 000034 | |
| `dim` | INT CHECK (>0 AND ≤ 4096) | 000034 | |
| `embedding` | `vector` (变长) | 000034 | pgvector 0.7+ |
| `status` | VARCHAR(20) CHECK ∈ {active, shadow, deprecated} | 000034 | |
| `indexed_at` | TIMESTAMPTZ | 000034 | |
| `profile_id` | BIGINT FK → search_profiles ON DELETE CASCADE NOT NULL | 000041 | |
| `chunk_index` | INT NOT NULL DEFAULT 0 | 000041 | |
| `chunk_text` | TEXT | 000041 | 切片原文,旧行 NULL |
| `parent_text` | TEXT | 000044 | 仅 parent_child chunker |
| `chunk_hash` | VARCHAR(64) | 000056 | chunk_text + parent_text 的稳定指纹,用于断点续跑 |
| `chunk_count` | INT | 000056 | 同一 post/profile 下当前切分总块数 |

唯一约束演进:
- 000034: `UNIQUE (post_id, model_id)` —— 单文档单向量。
- 000041: 删除上面,改 `UNIQUE (post_id, profile_id, chunk_index)` —— 多 chunk 并存。

索引:
```
idx_post_emb_1536_active   HNSW (embedding::vector(1536))   WHERE dim=1536 AND status='active'
idx_post_emb_3072_active   HNSW (embedding::halfvec(3072))  WHERE dim=3072 AND status='active'
idx_post_emb_post_status   (post_id, status)
idx_post_emb_model_status  (model_id, status)
idx_post_emb_profile_status (profile_id, status)            -- 000041
```

### 6.2 `search_profiles` (000041)
字段:
- `id` BIGSERIAL PK
- `code` VARCHAR(64) UNIQUE
- `name` VARCHAR(120) NOT NULL
- `description` TEXT
- `model_id` VARCHAR(120) NOT NULL
- `chunker_kind` VARCHAR(32) CHECK ∈ {recursive, fixed, markdown, qa, parent_child}
- `chunk_size_tokens` INT CHECK (>0 AND ≤ 8192) DEFAULT 512
- `chunk_overlap_tokens` INT CHECK (≥ 0) DEFAULT 64
- 表级 CHECK `chunk_overlap_tokens < chunk_size_tokens`
- `status` CHECK ∈ {active, shadow, deprecated} DEFAULT 'shadow'
- `created_at`, `updated_at` TIMESTAMPTZ

部分唯一索引:`uq_search_profiles_one_active ON ((1)) WHERE status = 'active'` —— 同一时刻最多一行 active。

Seed: `code='default', name='默认 · 递归 Markdown 切片', chunker_kind='recursive', chunk_size=512, overlap=64, status='active'`,model_id 来源:`site_settings.search.active_embedding_model` → `ai_task_routing.embedding` → `text-embedding-3-large`。

### 6.3 已废弃 `post_vectors` (000015 → 000034 DROP)
`vector(1536)` 锁死维度,000034 替换为 `post_embeddings`,DROP TABLE。`post_vectors` 同样移除了 `search_similar_posts(...)` SQL 函数。

### 6.4 Knowledge Base 表组 (000057-000061)

KB 是 Agent/RAG 的资料库子系统,文件物理存储复用媒体系统目录 `/root/_system_kb`。

表与关键约束:
- `knowledge_bases`: `slug` 唯一,`kind IN ('CUSTOM','SYSTEM_POSTS')`,owner/folder/active_profile 关联,统计缓存字段 `file_count/chunk_count/vectorized_count/failed_count/total_tokens`。000067 会在历史 ledger 跳过 KB schema 时幂等补齐最终表结构、索引、FK 与 SYSTEM_POSTS 默认 profile。
- `kb_profiles`: 每个 KB 的 model/chunker/chunk_size/overlap/top_k/threshold 配置;`UNIQUE (kb_id, code)`;partial unique `uq_kb_profile_one_active` 保证每 KB 最多一个 active profile。
- `kb_members`: `principal_type IN ('USER','TEAM','ROLE')`,权限四级 `VIEW/USE/EDIT/MANAGE`,唯一 `(kb_id, principal_type, principal_id)`。
- `kb_files`: CUSTOM 引用 `media_files`,SYSTEM_POSTS 引用 `posts`,用 CHECK 保证二者互斥;`vector_status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','STALE')`。
- `kb_embeddings`: `(kb_file_id, profile_id, chunk_index)` 唯一;000060 把 `embedding` 改为不锁维度 `vector`;000061 为 1536/3072/1024/768 active 行加 partial HNSW。

回滚风险:000058 down 会级联删除 KB 数据;000060 down 会删除非 3072 维 embeddings 后再改回 `vector(3072)`。

### 6.5 Atlas / Aether Knowledge 表组 (000062-000066)

Atlas 将材料抽象为 Carrier,在 Carrier 上创建 Annotation,再把 Annotation 提炼为 KnowledgePoint 与 TypedRelation。AI 只写 suggestion inbox,accept 后才写正式图谱表。

核心表:
- `atlas_carriers`: source type/uri/title/content_hash 元数据;000066 对 `source_uri` 加唯一约束,避免并发首次打开同一 note 产生重复 carrier。
- `atlas_carrier_versions`: carrier 内容版本,用于 annotation anchor 迁移。
- `atlas_annotations`: W3C selectors、quote/position/context 与 `anchor_state`。
- `atlas_knowledge_points`: 一阶知识点,带 `uuid`,kind/status/confidence/source 维度。
- `atlas_typed_relations`: subject/object KP 之间的有类型关系。
- `atlas_annotation_kp_links` / `atlas_relation_evidence`: annotation 与 KP/relation 的证据多对多表。
- `atlas_ai_suggestions` / `atlas_ignored_suggestions`: AI 候选 inbox 与忽略指纹。

000063 同步 seed `content.atlas.read/write/admin` 权限并默认授给 ADMIN。当前 Atlas 主要是模块级 RBAC;一旦授予普通用户,还需要复核行级 owner/author 范围。

---

## 7. 统计与审计

### 7.1 `visit_records` (000001 + 000006)
**Go 模型**: `model/analytics.go::VisitRecord`

字段:`page_url`, `page_title`, `visitor_hash`(指纹), `ip`, `country`, `region`, `city`, `user_agent`, `device_type`, `browser`, `os`, `referer`, `session_id`, `duration`, `is_bot`(000006)。

索引:`idx_visit_records_post/visitor/created/date`(`DATE(created_at)` 表达式索引)。

### 7.2 `visit_daily_stats` (000006)
日聚合表:`stat_date UNIQUE`, `pv`, `uv`, `new_visitors`, `bot_visits`, `country_stats JSONB`。

### 7.3 `daily_stats` (000001)
全站日报表:`stat_date UNIQUE`, `pv`, `uv`, `new_posts`, `new_comments`, `post_views/country_stats/device_stats/browser_stats/referer_stats JSONB`, `avg_duration`。

### 7.4 `sys_operation_log` (000001)
后台操作审计:`user_id`, `username`, `module`, `operation_type`, `method`, `request_url`, `request_params`, `response_data`, `ip`, `user_agent`, `cost_time`, `status` CHECK ∈ {SUCCESS, FAILED}, `error_message`。

### 7.5 `activity_events` (000022 + 000046)
**Go 模型**: `model/analytics.go::ActivityEvent`(JSONB `metadata` 被有意排除)

字段:`event_type` VARCHAR(50)(如 `POST_PUBLISH`, `COMMENT_NEW`),`event_category` CHECK,`title`, `description`, `metadata JSONB`, `user_id`, `ip`, `status` CHECK ∈ {INFO, SUCCESS, WARNING, ERROR}。

`chk_activity_event_category` 演进:
- 000022:`{post, comment, user, system, friend, media, ai}`
- 000046:加 `security`(JWT 轮换审计 / 鉴权事件)

索引:全部基础维度都建了(`type/category/created DESC/user/status`)。

---

## 8. 配置 / 外部

### 8.1 `site_settings` (000001 + 000013/014/029/031/032/043/044/045)
**Go 模型**: `model/site_setting.go::SiteSetting`

字段:`setting_key` UNIQUE, `setting_value` TEXT, `setting_type` CHECK ∈ {STRING, NUMBER, BOOLEAN, JSON, TEXT}, `group_name`, `description`。

Group 命名空间(逐 migration 添加):
- `general`: site_name, site_description, site_url, footer_*, icp_number, welcome_*
- `author`: author_name/avatar/bio/github/twitter/email, social_links(JSON, 000014)
- `comment`: comment_enabled, comment_audit
- `storage`: storage_type, storage.sync.auto_enabled(000043)
- `ai`: ai_enabled, ai_provider
- `appearance`: theme_primary_color, enable_dark_mode, show_banner, post_page_size(000013→000045 改默认 9), custom_css, font_family(000029), theme_primary_color_light/dark
- `seo`: seo_robots, enable_sitemap, baidu/google_analytics_id
- `social`: social_github/twitter/linkedin/weibo
- `advanced`: enable_registrations, upload_max_size
- `search`(000031/032/034/041): keyword_enabled, semantic_enabled, ai_qa_enabled, anon_search_rate_per_min, anon_qa_rate_per_min, auto_index_on_publish, index_post_timeout_sec, active_embedding_model, active_profile_code

### 8.2 `friend_links` (000001)
字段:`name`, `url`, `logo`, `description`, `email`, `rss_url`, `theme_color`, `is_online`, `last_check_at`, `sort_order`, `visible`。Seed 6 个默认链接(Google / GitHub / OpenAI / Apple / Microsoft / 百度)。

### 8.3 `prompt_templates` (000001)
独立的 prompt 模板表,与 `ai_task_types.prompt_template` 不同 — 这张表设计上给前端"自定义 prompt 库"用,目前生产无写入流量,前端无入口。字段含 `category`, `active`, `is_system`, `usage_count`。

---

## 9. 工具与视图

### 9.1 `schema_migrations` (golang-migrate 自管理)
两列:`version BIGINT`, `dirty BOOLEAN`。`migrate up/down/force` 直接读写。dirty=true 时所有 migration 操作被拒绝(除 `force`)。

### 9.2 视图 `v_published_posts` (000001 + 000039)
```sql
CREATE OR REPLACE VIEW v_published_posts AS
SELECT
    p.*,
    u.username  AS author_username,
    u.nickname  AS author_nickname,
    u.avatar    AS author_avatar,
    c.name      AS category_name,
    c.slug      AS category_slug
FROM posts p
LEFT JOIN users u      ON p.author_id  = u.id
LEFT JOIN categories c ON p.category_id = c.id
WHERE p.status = 'PUBLISHED' AND p.deleted = FALSE;
```
`SELECT p.*` 让 `summary` 加宽(000038→000039)必须先 `DROP VIEW`。

### 9.3 视图 `v_post_archives` (000001)
按年月聚合发布文章数:
```sql
SELECT EXTRACT(YEAR FROM published_at)::INT AS year,
       EXTRACT(MONTH FROM published_at)::INT AS month,
       COUNT(*) AS post_count
FROM posts
WHERE status='PUBLISHED' AND deleted=FALSE
GROUP BY year, month ORDER BY year DESC, month DESC;
```

### 9.4 触发器
- `update_updated_at_column()`: 通用 BEFORE UPDATE,000028 加旁路 `app.preserve_updated_at`(供 VanBlog 导入保留原 updated_at)。
- `update_post_counts()`: AFTER INSERT/UPDATE/DELETE ON posts,同步 `categories.post_count`。
- `update_*_updated_at`: posts/users/categories/tags/comments/friend_links/site_settings/prompt_templates/daily_stats/post_vectors(已删)/ai_providers/ai_models/ai_credentials/ai_task_routing 各挂一份。

---

## 10. 字段类型选型注释

- `BIGSERIAL` 主键 —— 给所有非 ai_* 早期表;`ai_credentials/ai_task_types/ai_task_routing` 在 backfill 时一度是 `SERIAL`,在 000017 重写时升级为 BIGSERIAL。
- `VARCHAR(N)` 而非 `TEXT` —— 早期 schema 偏好显式上限(`title 200`, `slug 200`, `summary 500→2000`, `model_id 120`);只有真正长文本字段(`content_markdown`, `description`, `prompt_template`)用 TEXT。VARCHAR(N) 在 PG 内部存储与 TEXT 等价,加宽是 catalog-only DDL,O(1)。
- `TIMESTAMP` vs `TIMESTAMPTZ` —— 历史不一致:早期表用 `TIMESTAMP`(无时区), `jwt_secrets` / `post_embeddings` / `search_profiles` / `daily_stats` 等新表用 `TIMESTAMPTZ`。应用层全部按 UTC 写入,显示时本地化。
- `JSONB` —— 用于 `config_*`, `metadata`, `capabilities`, `*_stats`, `ai_labels`, `exif_data`, `extra_config`;均带 `DEFAULT '{}'::jsonb` 或 nullable。GIN 索引仅在 `media_files.ai_labels` 上。
- `DECIMAL(12,8)` 用于 AI 模型单价(`input_cost_per_1k`),`NUMERIC(16,8)` 用于已落地的成本快照 —— 防止浮点累计误差。
- `vector` / `halfvec` —— 仅在 `post_embeddings.embedding` 单列;变长,维度从应用层 `dim` 列携带元数据。
