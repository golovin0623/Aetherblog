# 04 · 关键数据流(SQL 链路)

> 不写 service / handler 的 Go / Python 代码,只跟踪 **SQL 在哪几张表 / 索引上发生**。
> 所有 SQL 片段缩短至最小可读形式;真实代码见 `apps/server-go/internal/repository/*` 与 `apps/ai-service/app/*`。

---

## 1. 文章发布 + 自动摘要 + Embedding

### 1.1 触发链
```
POST /v1/admin/posts (status=DRAFT|PUBLISHED|SCHEDULED)
  └─ post_handler.go::Create / Update
      └─ post_repo.go::Insert / Update          [1]
          └─ trigger update_posts_updated_at
          └─ trigger trigger_update_post_counts → categories.post_count
      └─ async: search_service.go::IndexPost   [2]  仅 status=PUBLISHED 且 auto_index_on_publish=true
          ├─ ai_service /v1/ai/index/post      [3]
          │   └─ posts.embedding_status = 'PENDING' (UPDATE)
          │   └─ chunker.split_post(...)        — chunk_text 计算
          │   └─ embedding_provider.embed(...)
          │   └─ post_embeddings INSERT (post_id, model_id, dim, embedding,
          │                              status='active', profile_id, chunk_index, chunk_text, parent_text)
          │   └─ posts.embedding_status = 'INDEXED'  (UPDATE)
          ├─ activity_events INSERT (event_type='POST_PUBLISH', event_category='post')
          └─ AI 自动摘要(可选)
              └─ ai_task_routing 查 summary 路由
              └─ ai_usage_logs INSERT
```

### 1.2 关键 SQL

#### [1] 写入 posts(简化)
```sql
INSERT INTO posts (
    title, slug, content_markdown, content_html, summary, cover_image,
    status, category_id, author_id, word_count, reading_time,
    is_pinned, pin_priority, allow_comment,
    seo_title, seo_description, seo_keywords,
    embedding_status, scheduled_at, published_at,
    is_hidden, source_key, legacy_author_name, legacy_visited_count, legacy_copyright
)
VALUES (...)
RETURNING id, slug, created_at, updated_at;
```

发布时 `published_at = CURRENT_TIMESTAMP`(若客户端未传)。命中索引:`idx_posts_slug` UNIQUE 校验,`idx_posts_status` / `idx_posts_published_at` 后续被列表页消费。

#### [2] 触发 trigger
- `update_posts_updated_at` BEFORE UPDATE — 自动 `NEW.updated_at = CURRENT_TIMESTAMP`,除非 `app.preserve_updated_at='true'`(VanBlog 导入旁路)。
- `trigger_update_post_counts` AFTER INSERT/UPDATE/DELETE — 同步 `categories.post_count`(只在 `status='PUBLISHED' AND deleted=FALSE` 时计入)。

#### [3] embedding 写入(`post_embeddings`)
```sql
-- 标记 PENDING
UPDATE posts SET embedding_status='PENDING' WHERE id = $1;

-- 删除该 post 在当前 active profile 下的旧 chunk(避免增量留尘)
DELETE FROM post_embeddings
WHERE post_id = $1 AND profile_id = (SELECT id FROM search_profiles WHERE code = $active_profile_code);

-- 批量 INSERT 新 chunk(每 chunk 一行)
INSERT INTO post_embeddings (
    post_id, profile_id, chunk_index,
    model_id, dim, embedding, status, indexed_at,
    chunk_text, parent_text
)
SELECT $1, $profile_id, idx,
       $model_id, $dim, $embedding::vector, 'active', NOW(),
       $chunk_text, $parent_text
FROM unnest($chunks) WITH ORDINALITY t(chunk, idx);
-- ON CONFLICT (post_id, profile_id, chunk_index) DO UPDATE  -- 幂等 reindex 时使用

-- 标记 INDEXED
UPDATE posts SET embedding_status='INDEXED' WHERE id = $1;
```

命中索引:
- partial HNSW(`idx_post_emb_1536_active` 或 `idx_post_emb_3072_active`)在 INSERT 时被维护。
- `idx_post_emb_post_status` / `idx_post_emb_profile_status` 用于 DELETE 反查。

失败可见性:任何 `pgvector DataError` / asyncpg 异常 → catch → `posts.embedding_status='FAILED'` + 写 activity_event(`event_category='ai'`)。

### 1.3 调度发布
```sql
-- 后端定时器(cron)每分钟扫
SELECT id FROM posts
WHERE status='SCHEDULED' AND scheduled_at <= NOW() AND deleted=FALSE;

-- 命中的批量 update
UPDATE posts SET status='PUBLISHED', published_at = scheduled_at, scheduled_at = NULL
WHERE id = ANY($ids);
```
命中部分索引 `idx_posts_scheduled WHERE scheduled_at IS NOT NULL`。

---

## 2. 搜索的 keyword + vector 双通路

### 2.1 流量入口
```
GET /v1/public/search?q=xxx&mode=keyword|semantic|hybrid|qa
  └─ search_handler.go (server-go)
      ├─ mode=keyword  → SQL tsvector 查 posts
      ├─ mode=semantic → 转发 ai-service /v1/ai/search
      ├─ mode=hybrid   → 并发 keyword + semantic → re-rank
      └─ mode=qa       → 转发 ai-service /v1/ai/qa(SSE)
```

### 2.2 关键词检索(server-go 直查 PG)
```sql
WITH q AS (SELECT plainto_tsquery('simple', $1) AS tsq)
SELECT
    p.id, p.title, p.slug, p.summary, p.cover_image, p.published_at,
    ts_rank(
        to_tsvector('simple', p.title || ' ' || COALESCE(p.summary,'') || ' ' || COALESCE(p.content_markdown,'')),
        (SELECT tsq FROM q)
    ) AS rank,
    ts_headline('simple',
        COALESCE(p.summary, LEFT(p.content_markdown, 500)),
        (SELECT tsq FROM q),
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=8, MaxWords=24'
    ) AS snippet
FROM posts p, q
WHERE p.status='PUBLISHED' AND p.deleted=FALSE AND p.is_hidden=FALSE
  AND to_tsvector('simple', p.title || ' ' || COALESCE(p.summary,'') || ' ' || COALESCE(p.content_markdown,''))
        @@ q.tsq
ORDER BY rank DESC, p.published_at DESC
LIMIT $2 OFFSET $3;
```
命中索引 `idx_posts_fulltext` GIN。`ts_headline` 提供高亮片段(后端拼装),不需要额外存储。

### 2.3 语义检索(ai-service `vector_store.py`)
```sql
-- 1. 解析当前活跃 profile + model
SELECT sp.id, sp.code, sp.model_id, sp.chunker_kind, sp.chunk_size_tokens
FROM search_profiles sp
WHERE sp.status = 'active'
LIMIT 1;

-- 2. 把查询文本生成 embedding(走 ai_task_routing.embedding 路由)
-- 3. 查 post_embeddings(以 1536d 为例)
SELECT
    pe.post_id, pe.chunk_index, pe.chunk_text, pe.parent_text,
    1 - (pe.embedding::vector(1536) <=> $1::vector(1536)) AS similarity,
    p.title, p.slug, p.summary, p.published_at
FROM post_embeddings pe
JOIN posts p ON p.id = pe.post_id
WHERE pe.dim = 1536
  AND pe.status = 'active'
  AND pe.profile_id = $active_profile_id
  AND p.status = 'PUBLISHED' AND p.deleted = FALSE AND p.is_hidden = FALSE
  AND 1 - (pe.embedding::vector(1536) <=> $1::vector(1536)) >= $threshold
ORDER BY pe.embedding::vector(1536) <=> $1::vector(1536)
LIMIT $top_k;
```

3072d 路径同结构,只是 cast 成 `halfvec(3072)` + `halfvec_cosine_ops`(`<#>` 算子族同样支持 `<=>`)。

命中索引:partial HNSW `idx_post_emb_1536_active` / `idx_post_emb_3072_active`(WHERE 子句完全覆盖 partial 条件 + dim cast 完全匹配 — PG 才会走索引)。

### 2.4 hybrid 混排
后端把 keyword 与 semantic 各自 top-N 在 Go 内存做 reciprocal rank fusion:
```
score(p) = α / (k + rank_keyword(p)) + (1-α) / (k + rank_semantic(p))
```
不依赖 SQL,Python `ai-service` 只返回 `(post_id, similarity)`,Go 侧聚合。

### 2.5 QA(RAG)
```
1. Go /v1/public/search?mode=qa → ai-service /v1/ai/qa (SSE)
2. ai-service:
   a. semantic_search 取 top-K chunk(同 §2.3)
   b. 对 parent_child profile 命中的 chunk,把 parent_text 一并加入 context
   c. ai_task_routing 取 qa 路由
   d. LiteLLM 流式 chat → SSE forward 给客户端
   e. 落库 ai_usage_logs(provider/model/tokens/cost)
   f. 落 activity_events(event_category='ai', event_type='ai.qa')
```
相关 prompt 在 `ai_task_types.prompt_template[code='qa']`,000038/039 写定的强约束版:必须答案只来自参考内容、不编造。

---

## 3. 媒体上传 + folder 权限校验

### 3.1 触发链(简化)
```
POST /v1/admin/media/upload (multipart, x-folder-id)
  └─ media_handler.go::Upload
      ├─ 1) 校验权限:folder_permissions [1]
      ├─ 2) provider 选择:storage_providers [2]
      ├─ 3) 写入存储(local/S3/R2/etc.)
      ├─ 4) media_files INSERT [3]
      ├─ 5) (可选)media_variants 生成缩略图 + INSERT [4]
      ├─ 6) (可选)blurhash / exif_data / ai_labels 计算后 UPDATE
      └─ 7) (可选)media_sync_jobs INSERT (storage.sync.auto_enabled=true 时) [5]
```

### 3.2 关键 SQL

#### [1] 文件夹权限校验(`folder_permissions`)
```sql
-- 文件夹存在 + 用户身份
SELECT mf.id, mf.path, mf.owner_id, mf.visibility
FROM media_folders mf
WHERE mf.id = $folder_id;

-- 用户对该文件夹有 UPLOAD 及以上权限
SELECT permission_level
FROM folder_permissions
WHERE folder_id = $folder_id AND user_id = $user_id
  AND (expires_at IS NULL OR expires_at > NOW())
LIMIT 1;
```

权限映射(代码侧):`VIEW < UPLOAD < EDIT < DELETE < ADMIN`,UPLOAD 即可上传。`folder.owner_id = user_id` 时跳过 permission 校验。

仓库 commit 历史显示 PR #647 / 0542e1c3 把"权限拒绝"映射到 HTTP 403/400 而非 500(`internal/server/error_translate.go`)。

#### [2] provider 选择
```sql
-- 优先 default
SELECT id, name, provider_type, config_json, priority
FROM storage_providers
WHERE is_enabled = TRUE
ORDER BY is_default DESC, priority DESC, id ASC
LIMIT 1;
```

`config_json` 在 Go 层 unmarshal,根据 `provider_type` 路由到 `factory.go::NewProvider(...)`(LOCAL / S3 / MINIO / OSS / COS / R2)。

#### [3] media_files INSERT
```sql
INSERT INTO media_files (
    filename, original_name, file_path, file_url, file_size, mime_type,
    file_type, storage_type, width, height, alt_text,
    uploader_id, folder_id, storage_provider_id, cdn_url,
    blurhash, exif_data, ai_labels,
    current_version, is_archived, deleted,
    sync_status                                   -- 默认 'NONE'
)
VALUES (...)
RETURNING id;
```

#### [4] 缩略图 / 变体
```sql
-- 主文件 + 缩略图同一 storage_provider_id
INSERT INTO media_variants (
    media_file_id, variant_type, file_path, file_url, file_size,
    width, height, format, quality, storage_provider_id
)
VALUES ($1, 'THUMBNAIL', $2, $3, $4, ...);
-- ON CONFLICT (media_file_id, variant_type) DO UPDATE SET ...   -- 重新生成
```

#### [5] 同步备份队列
```sql
-- 仅 storage.sync.auto_enabled=true 且主文件不在 default provider
WITH default_provider AS (
    SELECT id FROM storage_providers WHERE is_default = TRUE AND is_enabled = TRUE LIMIT 1
)
INSERT INTO media_sync_jobs (media_id, target_provider_id)
SELECT $media_id, dp.id
FROM default_provider dp
WHERE NOT EXISTS (
    SELECT 1 FROM media_files mf WHERE mf.id = $media_id AND mf.storage_provider_id = dp.id
);

-- 同时把主文件状态翻成 PENDING
UPDATE media_files SET sync_status = 'PENDING' WHERE id = $media_id;
```

### 3.3 worker 拣任务
```sql
-- 单事务里拣一个 PENDING(SKIP LOCKED 防多 worker 抢同一行)
WITH next_job AS (
    SELECT id FROM media_sync_jobs
    WHERE status = 'PENDING'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE media_sync_jobs j
SET status = 'RUNNING', started_at = NOW(), attempt = attempt + 1
FROM next_job n WHERE j.id = n.id
RETURNING j.id, j.media_id, j.target_provider_id;
```

成功完成:
```sql
UPDATE media_sync_jobs SET status = 'SUCCEEDED', finished_at = NOW() WHERE id = $1;
UPDATE media_files SET sync_status='SYNCED', backup_provider_id=$2, backup_url=$3, backup_at=NOW() WHERE id=$media;
```

失败(重试上限 3):
```sql
UPDATE media_sync_jobs SET last_error=$err, status= CASE WHEN attempt >= 3 THEN 'FAILED' ELSE 'PENDING' END
WHERE id = $1;

-- 达到上限时主文件状态翻 FAILED + backup_error 记录
UPDATE media_files SET sync_status='FAILED', backup_error=$err WHERE id=$media AND $attempt>=3;
```

worker 启动时把 RUNNING 行重置为 PENDING(防"幽灵任务"):
```sql
UPDATE media_sync_jobs SET status='PENDING', started_at=NULL WHERE status='RUNNING';
```

---

## 4. activity 事件分类与安全审计

### 4.1 写入路径(异步、非关键路径)
```
任何业务事件
  └─ activity_service.go::Create(eventType, category, title, ...)
      └─ activity_events INSERT
          └─ chk_activity_event_category 校验 ∈ {post, comment, user, system, friend, media, ai, security}
          └─ chk_activity_event_status 校验 ∈ {INFO, SUCCESS, WARNING, ERROR}
```

写入 SQL:
```sql
INSERT INTO activity_events (
    event_type, event_category, title, description, metadata, user_id, ip, status
)
VALUES (
    $1, $2, $3, $4, $5::jsonb, $6, $7, $8
)
RETURNING id;
```

> ⚠️ Go 侧把 `_ = activitySvc.Create(...) / log.Warn(...)` 吞掉错误 —— 000022 漏 `security` 类目时,JWT 轮换审计**静默失败**(PG 抛 CHECK 违反但 Go 不报)。000046 修复后才把这条审计写进库(`02-migration-history.md` §000046)。

### 4.2 分类一览(2026-05 基线)

| event_category | 来源 | 典型 event_type |
|---|---|---|
| `post` | 文章 CRUD | `POST_PUBLISH`, `POST_UPDATE`, `POST_ARCHIVE`, `POST_DELETE` |
| `comment` | 评论审核 | `COMMENT_NEW`, `COMMENT_APPROVE`, `COMMENT_REJECT`, `COMMENT_SPAM` |
| `user` | 注册 / 改密 | `USER_REGISTER`, `USER_LOGIN`, `USER_PASSWORD_CHANGE`, `USER_BAN` |
| `system` | 启动 / 配置 | `SYSTEM_BOOT`, `SETTINGS_UPDATE`, `MIGRATION_APPLIED` |
| `friend` | 友链 | `FRIEND_LINK_ADD`, `FRIEND_LINK_HEALTH_FAIL` |
| `media` | 媒体上传 / 删除 | `MEDIA_UPLOAD`, `MEDIA_DELETE`, `MEDIA_SYNC_SUCCESS` |
| `ai` | AI 调用 | `ai.generation.summary`, `ai.generation.tags`, `ai.agent_chat`, `ai.qa`, `ai.task_*`, `ai.prompt_update`, `ai.provider_proxy_write` |
| `security` | 鉴权敏感操作(000046) | `JWT_SECRET_ROTATE`, `JWT_SECRET_RETIRE`, `LOGIN_FAILURE_BURST` |

### 4.3 前端展示
admin `ActivitiesPage` 通过:
```sql
SELECT id, event_type, event_category, title, description, user_id, ip, status, created_at
FROM activity_events
WHERE ($category IS NULL OR event_category = $category)
  AND ($since IS NULL OR created_at >= $since)
ORDER BY created_at DESC
LIMIT $limit OFFSET $offset;
```
命中 `idx_activity_events_category` + `idx_activity_events_created`。

`metadata JSONB` 在 Go 模型 `ActivityEvent` 里**不反序列化**(避免 sqlx 扫描问题),需要 metadata 时单独走 raw query。

---

## 5. AI 使用埋点 + 成本归档

### 5.1 写入(每次 AI 调用)
ai-service 在 LiteLLM 完成后:
```sql
INSERT INTO ai_usage_logs (
    user_id, endpoint, model, model_id, provider_code, task_type,
    request_chars, response_chars, tokens_in, tokens_out, total_tokens,
    latency_ms, success, cached, error_code, request_id,
    estimated_cost,
    cost_archive_status        -- 默认 'pending'
)
VALUES (...);
```

`estimated_cost` 在写入时即时计算:
```
cost = tokens_in/1000 * input_cost_per_1k + tokens_out/1000 * output_cost_per_1k
```
查 `ai_models` 表(JOIN `ai_providers`)。

### 5.2 归档批处理(降低后续读成本)
```sql
-- 拣 pending 行(限速,每批 N 行)
SELECT id, model, model_id, provider_code, tokens_in, tokens_out
FROM ai_usage_logs
WHERE cost_archive_status = 'pending'
ORDER BY created_at
LIMIT $batch FOR UPDATE SKIP LOCKED;

-- 算定价快照,落库
UPDATE ai_usage_logs
SET cost_archive_amount = $cost_snapshot,
    cost_archive_status = 'archived',
    cost_archived_at    = NOW()
WHERE id = $1;
```

后续读路径优先用 `cost_archive_amount`(快照),fallback `estimated_cost`(实时)。

命中 `idx_ai_usage_logs_cost_archive_status_created`(`(status, created_at DESC)`)。

### 5.3 dashboard 聚合
```sql
-- 按 task 维度看每日成本
SELECT date_trunc('day', created_at) AS day,
       task_type,
       SUM(total_tokens) AS tokens,
       SUM(COALESCE(cost_archive_amount, estimated_cost)) AS cost
FROM ai_usage_logs
WHERE created_at >= $since AND task_type IS NOT NULL
GROUP BY day, task_type
ORDER BY day DESC, cost DESC;
```
命中 `idx_ai_usage_logs_task_created (task_type, created_at DESC)`。

---

## 6. 蓝绿协议:换 embedding 模型 / 换 search_profile

### 6.1 换 embedding 模型(000034 v1 协议)
```
admin SearchConfigPage 选新模型 + Confirm
  ↓
1. UPDATE site_settings SET setting_value=$new_model WHERE setting_key='search.active_embedding_model';
2. UPDATE ai_task_routing SET primary_model_id = (新模型 ID), credential_id = (新凭证) WHERE task_type_id = (embedding);
   -- 这一步在事务里,与 1 同时;失败回滚
3. (异步)ai-service /v1/ai/index/all
   ↓  对每篇 PUBLISHED post:
       INSERT INTO post_embeddings (post_id, model_id=$new, dim=$new_dim, embedding, status='shadow')
       ON CONFLICT (post_id, profile_id, chunk_index) DO UPDATE ...
4. 全部 shadow 写入完成后:
   BEGIN;
     UPDATE post_embeddings SET status='deprecated' WHERE model_id=$old AND status='active';
     UPDATE post_embeddings SET status='active'     WHERE model_id=$new AND status='shadow';
   COMMIT;
5. 失败任一篇 → 不翻转,shadow 行保留
```

partial HNSW 索引 `WHERE status='active'` 自动跟随 — 不需要 `REINDEX`。

### 6.2 换 search profile(000041 v2 协议)
```
admin ProfileManagementSection 选新 profile(可指定 chunker / chunk_size / overlap)
  ↓
1. INSERT INTO search_profiles (code, name, model_id, chunker_kind, chunk_size_tokens, chunk_overlap_tokens, status='shadow') ...;
2. (SSE 流式)/v1/admin/search/profiles/:code/reindex/stream
   ↓  对每篇 PUBLISHED post 切 chunk + 写 shadow 行
       INSERT INTO post_embeddings (..., profile_id=$new_profile, status='shadow', chunk_index, chunk_text, parent_text);
3. 全部成功后(409 锁竞争返回 HTTP 状态码):
   BEGIN;
     UPDATE search_profiles SET status='deprecated' WHERE code=$old AND status='active';
     UPDATE search_profiles SET status='active'     WHERE code=$new AND status='shadow';
     UPDATE post_embeddings SET status='deprecated' WHERE profile_id=$old_profile_id AND status='active';
     UPDATE post_embeddings SET status='active'     WHERE profile_id=$new_profile_id AND status='shadow';
     UPDATE site_settings SET setting_value=$new_code WHERE setting_key='search.active_profile_code';
     UPDATE site_settings SET setting_value=$new_model_id WHERE setting_key='search.active_embedding_model';  -- 90 天兼容期
   COMMIT;
```

**关键不变量**:`uq_search_profiles_one_active`(partial UNIQUE) 保证不会同时存在两行 active —— 翻转必须先把旧 active 转 deprecated 才能写新 active,事务里完成。

---

## 7. JWT 密钥轮换(000033 + 000046 审计)

### 7.1 rotator 触发(定时任务 + admin 手动)
```sql
BEGIN;

-- 1. 把当前 current 转 previous(可选,带 grace window)
UPDATE jwt_secrets
SET status='previous', demoted_at=NOW(), retires_at=NOW() + INTERVAL '24 hours'
WHERE status='current';

-- 2. 插入新 current
INSERT INTO jwt_secrets (secret_value, status, promoted_at)
VALUES ($new_secret, 'current', NOW());

COMMIT;

-- 3. 写审计(000046 后才会真正落库)
INSERT INTO activity_events (event_type, event_category, title, description, status)
VALUES ('JWT_SECRET_ROTATE', 'security', 'JWT signing key rotated', '...', 'SUCCESS');
```

`uq_jwt_secrets_current` 部分唯一索引保证步骤 2 不会冲突(因步骤 1 已经 demote 了旧 current)。

### 7.2 retires_at 到期清理
```sql
SELECT id FROM jwt_secrets
WHERE status='previous' AND retires_at <= NOW()
ORDER BY retires_at;

UPDATE jwt_secrets SET status='retired', retired_at=NOW() WHERE id = $1;
-- 实际删除留作审计;长期数据可手动 DELETE WHERE status='retired' AND retired_at < ...
```

命中 `idx_jwt_secrets_retires_at (status, retires_at)`。

---

## 8. VanBlog 导入

### 8.1 导入路径
```
ops/import/vanblog → POST /v1/admin/import/vanblog
  ↓
SET LOCAL app.preserve_updated_at = 'true';   -- 旁路 trigger,保留原 updated_at
INSERT INTO posts (..., source_key, legacy_author_name, legacy_visited_count, legacy_copyright,
                   created_at, updated_at, published_at)
VALUES (...)
ON CONFLICT (source_key) DO UPDATE SET ...    -- idx_posts_source_key UNIQUE 兜底重导入
```

`is_hidden=true` 的文章被 `idx_posts_hidden_status` 索引,前台列表过滤 `WHERE is_hidden=FALSE` 走该索引而非全表。

`legacy_visited_count` 在前台展示与 `view_count` 求和(仅 legacy 文章),对调用频率不敏感,无需迁入到 `view_count` 列。

---

## 9. 性能 / 索引敏感的 SQL 总结

| 场景 | 命中索引 | 备注 |
|---|---|---|
| 文章列表(置顶 + 时间倒序) | `idx_posts_pinned`, `idx_posts_pin_priority` | DESC 列顺序匹配 |
| 文章列表(隐藏过滤,VanBlog) | `idx_posts_hidden_status` | (is_hidden, status, published_at DESC) |
| slug 路由 | UNIQUE 主键索引(列约束自带) | |
| 关键词搜索 | `idx_posts_fulltext` GIN | tsvector simple |
| 语义搜索 | `idx_post_emb_1536_active` partial HNSW | 必须 cast `::vector(1536)` |
| QA / parent_child | 同上 + `parent_text` 字段读 | |
| 评论列表 | `idx_comments_post`, `idx_comments_status`, `idx_comments_created` | |
| 媒体浏览 | `idx_media_files_folder/type/created` | |
| sync worker 拣表 | `idx_media_sync_jobs_status_created` + `FOR UPDATE SKIP LOCKED` | |
| AI 调用日志 | `idx_ai_usage_logs_*_created` | task/model/provider 各一份 |
| activity feed | `idx_activity_events_created` + 可选 category 过滤 | |
| JWT 验证(每个请求) | `uq_jwt_secrets_current/previous` partial UNIQUE | 每请求 ≤ 2 行 |
| reindex 查活跃 profile | `idx_search_profiles_status` + partial UNIQUE | |
| 调度发文 cron | `idx_posts_scheduled` partial | WHERE scheduled_at IS NOT NULL |
