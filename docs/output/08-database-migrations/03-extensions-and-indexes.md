# 03 · 扩展与索引清单

> 主题:启用了哪些 PG 扩展、各张表的索引清单、向量索引的 partial / 表达式策略、tsvector 全文索引、JSONB GIN 索引。
>
> 引用 migration:`apps/server-go/migrations/000001_init_schema.up.sql` 起,跨多条 migration。

---

## 1. PostgreSQL 扩展

### 1.1 `vector` (pgvector)
- 启用位置:`migrations/000001_init_schema.up.sql:11`,后续 `000015 / 000034 / 000035 / 000036` 均带 `CREATE EXTENSION IF NOT EXISTS vector`(幂等)。
- 版本要求:**≥ 0.7**(为支持变长 `vector` 列、`halfvec`、`halfvec_cosine_ops` 算子族)。
- 类型:
  - `vector(N)`:N ≤ 2000 维(HNSW 硬上限);Aether 使用 N=1536(text-embedding-3-small)。
  - `halfvec(N)`:N ≤ 4000 维;Aether 使用 N=3072(text-embedding-3-large)。
- 算子族:
  - `vector_cosine_ops` —— cos 距离(`<=>`)
  - `halfvec_cosine_ops` —— halfvec 上的 cos 距离

### 1.2 `uuid-ossp`
- 启用位置:`init_schema.up.sql:12`。
- 当前未实际使用 — 所有主键都是 `BIGSERIAL`。留作后续 distributed UUID 扩展点(VanBlog 导入 `source_key` 早期考虑过用 UUID,最终用 `VARCHAR(128)` 保留外部 ID)。

### 1.3 `pgcrypto`
- 启用位置:`init_schema.up.sql:13`。
- 当前未实际使用 — `ai_credentials.api_key_encrypted` 由应用层 Fernet 加密(`apps/server-go/internal/service/ai/credential_codec.go`),不依赖 `pgcrypto`。`gen_random_uuid()` / `crypt()` 均无引用。

### 1.4 未启用但常被讨论的扩展
- `pg_trgm`:模糊匹配 / 中文相似度。Aether 关键词检索走 `tsvector`(simple 配置不分词,中文按字节切),没有引入 trgm。
- `pgaudit`:审计;Aether 走 `activity_events` + `sys_operation_log` 自管理。
- `pg_stat_statements`:性能;生产可加但不是 schema 的一部分。

---

## 2. 向量索引(pgvector HNSW)

### 2.1 `post_embeddings` 上的 partial HNSW

```sql
-- 1536 维 active(text-embedding-3-small / ada-002)
CREATE INDEX idx_post_emb_1536_active ON post_embeddings
    USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE dim = 1536 AND status = 'active';

-- 3072 维 active(text-embedding-3-large)— 必须走 halfvec
CREATE INDEX idx_post_emb_3072_active ON post_embeddings
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE dim = 3072 AND status = 'active';
```

设计要点:
1. **变长 `vector` 列上必须 cast** 才能建 HNSW(`(embedding::vector(N))` 表达式索引)。
2. **partial(`WHERE status='active'`)** 让旧 deprecated 行不进索引,reindex 后翻转 status 即下线。
3. **3072 维必须走 halfvec** —— pgvector 的 HNSW 对 `vector` 类型硬上限 2000 维;`halfvec` 上限 4000。查询端 `ai-service::vector_store.py` 必须 cast 成 `halfvec(3072)` 才能走索引。
4. **未来新维度** = 加一条 partial 索引,主表不动。

### 2.2 辅助索引(`post_embeddings`)
```sql
idx_post_emb_post_status     (post_id, status)        -- 按文章反查 active/shadow
idx_post_emb_model_status    (model_id, status)
idx_post_emb_profile_status  (profile_id, status)     -- 000041
```

### 2.3 已废弃 `post_vectors` 上的 HNSW
000015 引入,000034 DROP:
```sql
CREATE INDEX idx_post_vectors_embedding ON post_vectors
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

### 2.4 HNSW 参数选择
- `m=16`:每个节点的最大连接数。Aether 默认值,适合 < 100 万行规模;搜索质量与索引大小平衡点。
- `ef_construction=64`:构建期候选队列长度。值越大召回越好但建索引越慢;Aether 选 64 是 default。
- 查询时 `SET LOCAL hnsw.ef_search = N` 控制召回深度;Aether 默认依赖 pgvector 的 `ef_search=40`,在 admin reindex 时可临时调高。

---

## 3. 全文检索 (tsvector + GIN)

### 3.1 `posts` 上的全文索引
**文件**: `migrations/000001_init_schema.up.sql:125`
```sql
CREATE INDEX IF NOT EXISTS idx_posts_fulltext ON posts
    USING gin(to_tsvector('simple',
        title || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content_markdown, '')));
```

设计要点:
1. **配置 `simple`** —— 不做词干提取、不去停用词。中文按字节切,英文按空格切;够用作"包含匹配 + 高亮"。
2. **三字段拼接** —— `title` (高权重) + `summary` + `content_markdown` 一锅端;查询期 `ts_rank` 不区分字段权重(简单实现)。
3. **GIN 索引** —— 倒排表,适合查询比写入多的负载。Aether 的写入(发文)频率远低于检索。
4. **不索引 `content_html`** —— html 标签会污染 token,纯 markdown 即可。

### 3.2 关键词查询路径
```sql
SELECT id, title, slug, ts_rank(...) AS rank
FROM posts
WHERE deleted = false AND status = 'PUBLISHED'
  AND to_tsvector('simple', title || ' ' || COALESCE(summary,'') || ' ' || COALESCE(content_markdown,''))
        @@ plainto_tsquery('simple', $1)
ORDER BY ts_rank(...) DESC, published_at DESC
LIMIT $2 OFFSET $3;
```

`SearchHandler` (`apps/server-go/internal/handler/search_handler.go`) 直接命中此索引。

### 3.3 中文分词的取舍
没有引入 `pg_jieba` / `zhparser`,因为:
- 部署复杂(扩展不在 PG 官方仓库,需从源码编译)。
- `simple` 配置的中文按字节切等价于 bigram,Aether 查询长度短(通常 ≤ 8 字),召回率可接受。
- 真正的"语义"召回交给 pgvector 的 HNSW,关键词只需"快速精确包含"。

---

## 4. JSONB GIN 索引

| 索引 | 表 | 列 | 引入 | 用途 |
|---|---|---|---|---|
| `idx_media_files_ai_labels` | `media_files` | `ai_labels JSONB` | 000010 | AI 视觉标签查询(`ai_labels @> '{"label":"猫"}'`) |

其他 JSONB 列(`metadata`, `capabilities`, `config_*`, `*_stats`, `exif_data`)目前 **不建** GIN 索引 —— 读路径都是按主键 / 外键反查再 JSON 解码,不做 JSON 内字段检索。

---

## 5. 部分唯一索引(条件唯一)

| 索引 | 表 | 条件 | 语义 | 引入 |
|---|---|---|---|---|
| `uq_jwt_secrets_current` | `jwt_secrets` | `WHERE status='current'` | 同时刻最多一行 current | 000033 |
| `uq_jwt_secrets_previous` | `jwt_secrets` | `WHERE status='previous'` | 同时刻最多一行 previous | 000033 |
| `uq_search_profiles_one_active` | `search_profiles` | `ON ((1)) WHERE status='active'` | 同时刻最多一行 active(用 `(1)` 常量列做唯一) | 000041 |
| `idx_posts_source_key` | `posts` | `WHERE source_key IS NOT NULL` | VanBlog 外部 ID 唯一,空时不约束 | 000027 |
| `idx_posts_scheduled` | `posts` | `WHERE scheduled_at IS NOT NULL` | 调度发文索引,免扫全表 | 000001 |
| `idx_media_files_sync_status` | `media_files` | `WHERE sync_status != 'NONE'` | 99% 文件 sync_status='NONE',部分索引节省体积 | 000043 |

---

## 6. 复合索引(有序前缀)

| 索引 | 表 | 列序 | 用途 |
|---|---|---|---|
| `idx_posts_pinned` | `posts` | `(is_pinned DESC, published_at DESC)` | 置顶优先 + 时间倒序 |
| `idx_posts_pin_priority` | `posts` | `(pin_priority DESC, published_at DESC)` | 多级置顶权重 |
| `idx_posts_hidden_status` | `posts` | `(is_hidden, status, published_at DESC)` | VanBlog 隐藏文章过滤 |
| `idx_ai_usage_logs_task_created` | `ai_usage_logs` | `(task_type, created_at DESC)` | dashboard 按 task 维度看时段 |
| `idx_ai_usage_logs_model_created` | `ai_usage_logs` | `(model_id, created_at DESC)` | 同上,model 维度 |
| `idx_ai_usage_logs_provider_created` | `ai_usage_logs` | `(provider_code, created_at DESC)` | 同上,provider 维度 |
| `idx_ai_usage_logs_success_created` | `ai_usage_logs` | `(success, created_at DESC)` | 失败率监控 |
| `idx_ai_usage_logs_cost_archive_status_created` | `ai_usage_logs` | `(cost_archive_status, created_at DESC)` | 归档批处理拣 pending |
| `idx_media_sync_jobs_status_created` | `media_sync_jobs` | `(status, created_at)` | worker 拣 PENDING |
| `idx_jwt_secrets_retires_at` | `jwt_secrets` | `(status, retires_at)` | rotator 扫到点 previous |

---

## 7. DESC 索引(时间倒序优化)

Aether 几乎所有列表页都按时间倒序展示。PG 在 B-tree 索引上对 `ORDER BY ... DESC` 的支持依赖索引的列方向 —— 显式建 `DESC` 索引可避免 backward scan。

清单(从 migrations 抓):
```
idx_posts_published_at         (published_at DESC)
idx_posts_pinned               (is_pinned DESC, published_at DESC)
idx_posts_pin_priority         (pin_priority DESC, published_at DESC)
idx_posts_hidden_status        (..., published_at DESC)
idx_comments_created           (created_at DESC)
idx_visit_records_created      (created_at DESC)
idx_visit_records_date         (DATE(created_at))   -- 表达式,非 DESC
idx_daily_stats_date           (stat_date DESC)
idx_operation_log_created      (created_at DESC)
idx_media_files_created        (created_at DESC)
idx_media_versions_created     (created_at DESC)
idx_media_shares_*             (created_at DESC,部分)
idx_activity_events_created    (created_at DESC)
idx_ai_usage_logs_created_at   (created_at DESC)
idx_ai_usage_logs_*_created    全部 (created_at DESC)
```

---

## 8. 反范式索引 / 缓存列

下列列是 **缓存反范式**,业务层 / trigger 维护,**不靠索引**:
- `categories.post_count` — `trigger_update_post_counts` 维护
- `tags.post_count` — 应用层 service 维护
- `media_folders.file_count`, `media_folders.total_size` — 应用层维护(物化路径上无 trigger)
- `media_tags.usage_count` — 应用层维护
- `posts.view_count`, `posts.comment_count`, `posts.like_count` — 应用层 / 计数器路由
- `posts.word_count`, `posts.reading_time` — 保存文章时计算
- `media_shares.access_count` — 每次访问 +1

读这些列直接走主键索引/常规过滤索引,不需要单独建。

---

## 9. 索引性能注意点

### 9.1 GIN 写入开销
`idx_posts_fulltext`(GIN tsvector)在 INSERT/UPDATE 时需要重建倒排桶 —— 写入文章时延迟比 B-tree 高一倍。Aether 的写流量低,可接受。**不要** 在 `post_embeddings` 这种高写入表上加 GIN tsvector。

### 9.2 HNSW 写入开销
INSERT 时 HNSW 走"找最近邻 → 插入连接"流程,延迟随 `m × ef_construction` 增长。Aether 默认参数下 INSERT 一行 1536d 约 5-15ms。**不要** 在 reindex 期间并发写入 — `ai-service::reindex_all` 走批量 INSERT(单事务多行)。

### 9.3 partial 索引的查询匹配
PG 优化器只在 **WHERE 条件 ⊇ 索引 partial 条件** 时才走索引。Aether 的语义查询永远带 `status='active' AND dim=N`,与索引匹配,没有"intent index but full scan"问题。

### 9.4 视图依赖阻挡 ALTER
`v_published_posts` 上的 `SELECT p.*` 阻挡了 `ALTER COLUMN posts.summary TYPE` —— 000038→000039 的故事。任何对 posts 列类型的修改必须 `DROP VIEW + ALTER + CREATE OR REPLACE VIEW`(参见 `02-migration-history.md` §000039)。

### 9.5 reindex 时 `dim` 误填的风险
`post_embeddings` 没有 trigger 校验 `array_length(embedding, 1) = dim`(pgvector 不开放数组长度函数,需在应用层校验)。`ai-service::vector_store.py::upsert_post_embedding` 在 INSERT 前 assert dim 与 embedding 维度一致;失败立即把 `posts.embedding_status` 标 FAILED 而不是吞错(参见 `architecture.md` §失败可见性)。

---

## 10. 索引清单(全部,from migrations 全文抓)

> 按表归类,只列由 migration 显式 CREATE 的索引(主键 / UNIQUE 列约束自动建的不重复列)。

### 10.1 users
- `idx_users_username (username)`
- `idx_users_email (email)`
- `idx_users_status (status)`

### 10.2 categories
- `idx_categories_slug (slug)`
- `idx_categories_parent (parent_id)`
- `idx_categories_sort_order (sort_order)`

### 10.3 tags
- `idx_tags_slug (slug)`
- `idx_tags_post_count (post_count DESC)`

### 10.4 posts
- `idx_posts_slug (slug)`
- `idx_posts_status (status)`
- `idx_posts_published_at (published_at DESC)`
- `idx_posts_category (category_id)`
- `idx_posts_author (author_id)`
- `idx_posts_deleted (deleted)`
- `idx_posts_embedding_status (embedding_status)`
- `idx_posts_pinned (is_pinned DESC, published_at DESC)`
- `idx_posts_scheduled (scheduled_at) WHERE scheduled_at IS NOT NULL`
- `idx_posts_fulltext GIN(to_tsvector('simple', title||' '||COALESCE(summary,'')||' '||COALESCE(content_markdown,'')))`
- `idx_posts_pin_priority (pin_priority DESC, published_at DESC)` (000003)
- `idx_posts_source_key UNIQUE (source_key) WHERE source_key IS NOT NULL` (000027)
- `idx_posts_hidden_status (is_hidden, status, published_at DESC)` (000027)

### 10.5 post_tags
- `idx_post_tags_tag (tag_id)`
- 主键 `(post_id, tag_id)` 自带 B-tree

### 10.6 comments
- `idx_comments_post (post_id)`
- `idx_comments_parent (parent_id)`
- `idx_comments_status (status)`
- `idx_comments_created (created_at DESC)`

### 10.7 friend_links
- `idx_friend_links_visible (visible)`
- `idx_friend_links_sort (sort_order)`

### 10.8 site_settings
- `idx_site_settings_key (setting_key)`
- `idx_site_settings_group (group_name)`

### 10.9 post_embeddings (000034 / 000041 累积)
- `idx_post_emb_1536_active hnsw((embedding::vector(1536)) vector_cosine_ops) WHERE dim=1536 AND status='active'`
- `idx_post_emb_3072_active hnsw((embedding::halfvec(3072)) halfvec_cosine_ops) WHERE dim=3072 AND status='active'`
- `idx_post_emb_post_status (post_id, status)`
- `idx_post_emb_model_status (model_id, status)`
- `idx_post_emb_profile_status (profile_id, status)`
- 唯一约束 `post_embeddings_unique (post_id, profile_id, chunk_index)` (000041)

### 10.10 search_profiles (000041)
- `idx_search_profiles_status (status)`
- `uq_search_profiles_one_active UNIQUE ((1)) WHERE status='active'`

### 10.11 prompt_templates
- `idx_prompt_templates_category (category)`
- `idx_prompt_templates_active (active)`

### 10.12 visit_records / visit_daily_stats / daily_stats / sys_operation_log
- `idx_visit_records_post (post_id)`
- `idx_visit_records_visitor (visitor_hash)`
- `idx_visit_records_created (created_at DESC)`
- `idx_visit_records_date (DATE(created_at))`
- `idx_visit_daily_stats_date (stat_date)` (000006)
- `idx_daily_stats_date (stat_date DESC)`
- `idx_operation_log_user (user_id)`
- `idx_operation_log_module (module)`
- `idx_operation_log_created (created_at DESC)`

### 10.13 activity_events (000022)
- `idx_activity_events_type (event_type)`
- `idx_activity_events_category (event_category)`
- `idx_activity_events_created (created_at DESC)`
- `idx_activity_events_user (user_id)`
- `idx_activity_events_status (status)`

### 10.14 media_files
- `idx_media_files_uploader (uploader_id)`
- `idx_media_files_type (file_type)`
- `idx_media_files_created (created_at DESC)`
- `idx_media_files_folder (folder_id)` (000007)
- `idx_media_files_storage_provider (storage_provider_id)` (000009)
- `idx_media_files_ai_labels GIN(ai_labels)` (000010)
- `idx_media_files_archived (is_archived)` (000011)
- `idx_media_files_deleted (deleted)` (000012)
- `idx_media_files_sync_status (sync_status) WHERE sync_status != 'NONE'` (000043)

### 10.15 media_folders / media_variants / media_versions / media_tags / media_file_tags / media_metadata / media_shares / folder_permissions / storage_providers / media_sync_jobs
- `idx_media_folders_parent/path/owner/visibility/created_at` (000007)
- `idx_media_variants_file/type` (000010), `idx_media_variants_storage_provider` (000042)
- `idx_media_versions_file/created` (000011)
- `idx_media_tags_slug/usage/category` (000008)
- `idx_media_file_tags_file/tag/source` (000008)
- `idx_media_metadata_file/key` (000008)
- `idx_media_shares_token/file/folder` (000011)
- `idx_folder_permissions_folder/user` (000011)
- `idx_storage_providers_default/enabled` (000009)
- `idx_media_sync_jobs_status_created (status, created_at)` (000043)
- `idx_media_sync_jobs_media_id (media_id)` (000043)

### 10.16 attachments
- `idx_attachments_post (post_id)`
- `idx_attachments_uploader (uploader_id)`

### 10.17 ai_providers / ai_models / ai_credentials / ai_task_routing / ai_usage_logs
- `idx_ai_providers_code/enabled/priority` (000017+020)
- `idx_ai_models_provider/type/enabled` (000017)
- `idx_ai_credentials_user/provider` (000017)
- `idx_ai_task_routing_user/task` (000017)
- `idx_ai_usage_logs_created_at (created_at DESC)` (000016)
- `idx_ai_usage_logs_user/endpoint` (000016)
- `idx_ai_usage_logs_task_created/model_created/provider_created` (000023)
- `idx_ai_usage_logs_success_created` (000025)
- `idx_ai_usage_logs_cost_archive_status_created` (000030)

### 10.18 jwt_secrets
- `uq_jwt_secrets_current/previous` partial UNIQUE
- `idx_jwt_secrets_retires_at (status, retires_at)`
