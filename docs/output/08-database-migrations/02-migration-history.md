# 02 · Migration 演进史(67 条,主题分组叙事)

> 按主题(用户/鉴权 → 内容 → AI prompt 演进 → 搜索 profiles → 媒体存储 → 安全/审计)梳理。每条 migration 给:
> - **文件**: `apps/server-go/migrations/<编号>_<名字>.{up,down}.sql`
> - **摘要 + 影响**:对 schema / 业务的实际作用
> - **历史故事**(若有):为什么这一版要单独存在
>
> 时间轴大致:000001(2026-01-06 初始化) → 000046(原始摸底基线) → 000066(Atlas carrier source_uri 唯一约束) → 000067(KB schema 幂等修复)。

---

## 0. 全清单速览

| 编号 | 主题 | 类型 |
|---|---|---|
| 000001 | 初始 schema(40+ 张表) | DDL 大型 |
| 000002 | 默认 admin + 站点设置 + Hello World 文章 | seed |
| 000003 | posts.pin_priority | DDL 小型 |
| 000004 | comments.status 加 DELETED | CHECK 修复 |
| 000005 | mock 评论 | seed (开发用) |
| 000006 | visit_records.is_bot + visit_daily_stats | DDL |
| 000007 | media_folders + media_files.folder_id | Phase 1 媒体 |
| 000008 | media_tags / media_file_tags / media_metadata | Phase 2 媒体 |
| 000009 | storage_providers | Phase 3 媒体 |
| 000010 | media_variants + media_files.{blurhash,exif_data,ai_labels} | Phase 4 媒体 |
| 000011 | folder_permissions + media_shares + media_versions | Phase 5 媒体 |
| 000012 | media_files.deleted | 软删除 |
| 000013 | site_settings 补齐(post_page_size 默认 10) | seed |
| 000014 | site_settings.social_links | seed |
| 000015 | post_vectors + search_similar_posts() | AI 检索 v1 |
| 000016 | ai_usage_logs(8 字段) | AI 埋点 v1 |
| 000017 | ai_providers / ai_models / ai_credentials / ai_task_types / ai_task_routing + 50+ provider seed | AI 模型 |
| 000018 | gpt-4o-mini → gpt-5-mini routing | seed 切换 |
| 000019 | seed AI task types(7 类 prompt) | seed |
| 000020 | backfill 旧 AI schema(ALTER + UPDATE 兼容) | DDL 修复 |
| 000021 | chk_ai_model_type 加 code/completion | CHECK 修复 |
| 000022 | activity_events(7 类) | DDL |
| 000023 | ai_usage_logs 加 task/provider/model/total_tokens/cost | AI 埋点 v2 |
| 000024 | ai_usage_logs 字段加宽 + provider 回填 | DDL 修复 |
| 000025 | ai_usage_logs NOT NULL + DEFAULT 固化 | DDL 收口 |
| 000026 | 重新种入 50+ AI provider seed | seed 大型 |
| 000027 | posts VanBlog 字段(is_hidden, source_key, legacy_*) | DDL |
| 000028 | update_updated_at_column 加 preserve 旁路 | trigger 修改 |
| 000029 | site_settings.font_family + theme_primary_color_light/dark | seed |
| 000030 | ai_usage_logs.cost_archive_* | AI 成本归档 |
| 000031 | site_settings.search.* 6 项配置 | seed |
| 000032 | site_settings.search.index_post_timeout_sec | seed |
| 000033 | jwt_secrets | DDL 鉴权 |
| 000034 | post_embeddings(版本化) DROP post_vectors | AI 检索 v2 |
| 000035 | 修复 000034 在存量 chunk-表上静默失败 | DDL 自愈 |
| 000036 | 等价于 035 的幂等修复(配 deploy.sh v34→force 35) | DDL 自愈 |
| 000037 | active_embedding_model 孤儿指针对齐 | data heal |
| 000038 | 7 个 ai_task_types prompt 强约束改写 + posts.summary 加宽 | DDL + UPDATE |
| 000039 | 修复 038 因 view 引用失败(DROP VIEW + ALTER + 重建) | DDL 自愈 |
| 000040 | tags prompt 加 {existing_tags} + JSON 对象输出 | UPDATE prompt |
| 000041 | search_profiles + post_embeddings.{profile_id,chunk_index,chunk_text} + UNIQUE 重建 | AI 检索 v3 |
| 000042 | storage_providers/media_files 加 R2 + media_variants.storage_provider_id | DDL |
| 000043 | media_files 同步备份字段 + media_sync_jobs + storage.sync.auto_enabled | Phase 4 备份 |
| 000044 | post_embeddings.parent_text(parent_child chunker) | DDL |
| 000045 | post_page_size 默认 10→9 | seed 修正 |
| 000046 | activity_events.event_category 加 security | CHECK 放宽 |
| 000047 | ai_global_pricing | 全局模型价格 |
| 000048 | media backup verification | 备份完整性校验 |
| 000049 | storage.sync.target_provider_id | 备份目标 provider |
| 000050 | theme visual color settings | 主题视觉色设置 |
| 000051 | permissions / roles / teams / content_shares | 用户团队 RBAC |
| 000052 | agent workflow canvas | 智能体编排 |
| 000053 | editor image smart compression setting | 编辑器设置 |
| 000054 | notes / note_embeddings | 智能笔记 |
| 000055 | fulltext tsvector input limit | FTS 稳定性 |
| 000056 | post_embeddings chunk checkpoint | profile 重建断点 |
| 000057 | media_folders is_system / undeletable | KB 系统目录 |
| 000058 | knowledge_bases / kb_* | KB 核心 schema |
| 000059 | kb default profiles | SYSTEM_POSTS profile seed |
| 000060 | kb_embeddings vector unconstrained | KB 维度解耦 |
| 000061 | kb_embeddings HNSW partial indexes | KB 向量索引 |
| 000062 | atlas core | Atlas Phase 0 schema |
| 000063 | atlas permissions | 权限 seed |
| 000064 | atlas KP links / relation evidence | 证据链接 |
| 000065 | atlas AI suggestions | suggestion inbox |
| 000066 | atlas_carriers.source_uri unique | 并发去重 |
| 000067 | kb_schema_repair | KB schema 前向幂等修复 |

---

## 1. 用户与鉴权(000001 / 000033)

### 000001 · `init_schema`
**文件**: `migrations/000001_init_schema.up.sql` / `.down.sql`(down 是 no-op `-- 未实现 down migration`)

一次性建出 40+ 张表 + 触发器 + 视图。涵盖:
- 启用扩展 `vector`, `uuid-ossp`, `pgcrypto`
- users / categories / tags / posts / post_tags / comments / friend_links / site_settings / post_embeddings(早期 chunk 版,后被 034 替换) / prompt_templates / visit_records / daily_stats / sys_operation_log / media_files / attachments
- 索引含 `idx_posts_fulltext` GIN tsvector
- 视图 `v_published_posts` / `v_post_archives`
- 触发器 `update_updated_at_column()` + 各表 BEFORE UPDATE 调用
- `update_post_counts()` 同步 categories.post_count

> ⚠️ 关键约束: 000001 在 schema 中放置了一张早期 chunk-版 `post_embeddings` 表 — 后来变成 000034/035/036 一系列修复的根源。

### 000033 · `jwt_secrets`
**文件**: `migrations/000033_jwt_secrets.up.sql`

VULN-152 后的安全升级 — 把 JWT 签名密钥从环境变量提升为 DB 管理的资源,支持:
- `current` / `previous` / `retired` 三态
- 部分唯一索引保证每态最多一行
- rotator 在事务里做 demote+promote CAS

启动时由 Go 层 `BootstrapIfEmpty` 注入当前 `JWT_SECRET` 作为 current,migration 不在 SQL 里读环境变量。

---

## 2. 内容核心 + VanBlog 迁入(000003 / 000004 / 000027 / 000028)

### 000003 · `add_pin_priority`
单列 + 一个 DESC 索引 `idx_posts_pin_priority`。优先级越大越靠前;0 表示不置顶。补 000001 仅 `is_pinned` 布尔的不足。

### 000004 · `fix_comment_status_constraint`
`comments.status` CHECK 加 `DELETED` —— 业务侧需要"软删除评论但留痕"。`DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT` 模式。

### 000005 · `add_mock_comments`
开发用 seed 4 条评论(张三/李四/王五/spammer),生产部署一般跑 down 清掉。

### 000027 · `add_vanblog_migration_fields`
**文件**: `migrations/000027_add_vanblog_migration_fields.up.sql`

为 VanBlog 导入加 5 列:
```sql
ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS source_key VARCHAR(128),
    ADD COLUMN IF NOT EXISTS legacy_author_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS legacy_visited_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS legacy_copyright VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_source_key
    ON posts(source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_hidden_status
    ON posts(is_hidden, status, published_at DESC);
```

### 000028 · `allow_preserve_updated_at`
**文件**: `migrations/000028_allow_preserve_updated_at.up.sql`

修改 `update_updated_at_column()` 加旁路:
```sql
IF current_setting('app.preserve_updated_at', true) = 'true' AND NEW.updated_at IS NOT NULL THEN
    RETURN NEW;
END IF;
NEW.updated_at = CURRENT_TIMESTAMP;
RETURN NEW;
```

VanBlog 导入时 `SET LOCAL app.preserve_updated_at = 'true'`,batch 内事务保留原始 `updated_at`,避免导入后所有文章一律是导入时间(对归档时间序列毁灭性)。

---

## 3. AI 模型与凭证(000015–000026)

### 000015 · `ai_vector_store`
**文件**: `migrations/000015_ai_vector_store.up.sql`

引入第一代向量表:
```sql
CREATE TABLE post_vectors (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
    embedding vector(1536),                  -- 锁死维度
    model VARCHAR(50) DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_post_vectors_embedding ON post_vectors
    USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
```
+ `search_similar_posts(...)` SQL 函数。

**坑**:`vector(1536)` 锁死;切到 3072 维(text-embedding-3-large)直接报 `expected 1536 dimensions, not 3072`。这是 000034 重设计的导火索。

### 000016 · `ai_usage_logs`
8 字段最小可用埋点:`user_id, endpoint, model, request_chars, response_chars, tokens_in, tokens_out, latency_ms, success, cached, error_code, request_id`。索引 `idx_ai_usage_logs_created_at/user/endpoint`。

### 000017 · `ai_providers`(超大 1979 行)
**文件**: `migrations/000017_ai_providers.up.sql`

一次性建出全部 AI 模型配置表(providers/models/credentials/task_types/task_routing) + 50+ 内置 provider seed(OpenAI / Azure / Anthropic / Google / DeepSeek / Moonshot / Aliyun Bailian / Wenxin / Spark / SenseNova / Stepfun / Qwen / Hunyuan / ZhiPu / SiliconCloud / 等)。

**坑**: 这条 migration 在 fresh 部署上一气呵成,但任何"早期开发分支已经手动建过 ai_providers"的存量库都会撞到 `CREATE TABLE IF NOT EXISTS` 跳过 + 字段缺失 —— 后续 000020 backfill 出现的根因。

### 000018 · `update_base_model_gpt5`
INSERT `gpt-5-mini` model 行,DO 块内把 `ai_task_routing.primary_model_id` / `fallback_model_id` 中所有 `gpt-4o-mini` 引用替换为 `gpt-5-mini`。纯 routing 切换。

### 000019 · `seed_ai_task_types`
INSERT 7 类 task_type:
```
summary, tags, titles, polish, outline, embedding, qa
```
每类 prompt 初版宽松("请为以下内容生成摘要({max_length}字以内):{content}")。配套 INSERT `ai_task_routing` 默认行(`user_id=NULL` = 系统级)。

### 000020 · `backfill_legacy_ai_schema`
**文件**: `migrations/000020_backfill_legacy_ai_schema.up.sql`

存量库自愈:`ALTER TABLE ai_providers ADD COLUMN IF NOT EXISTS display_name/api_type/base_url/...`;DO 块从 `api_base_url` / `sort_order` 旧列复制到新列;统一 `api_type` 默认 `openai_compat`。

补 `chk_ai_provider_api_type CHECK` constraint(if missing);补 `uq_ai_models_provider_model UNIQUE`;补 `chk_ai_model_type CHECK`(10 类初版);新建 `ai_credentials/ai_task_types/ai_task_routing` IF NOT EXISTS;补 trigger。

### 000021 · `fix_ai_model_type_constraint`
`chk_ai_model_type` 加 `code, completion` —— 让 LiteLLM `model_list` 拉到的 stt/whisper/code 模型能落库。

### 000022 · `activity_events`
**文件**: `migrations/000022_activity_events.up.sql`

```sql
CREATE TABLE activity_events (
    id BIGSERIAL PK,
    event_type VARCHAR(50) NOT NULL,
    event_category VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    metadata JSONB,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ip VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'INFO',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_activity_event_category CHECK (event_category IN
        ('post', 'comment', 'user', 'system', 'friend', 'media', 'ai')),
    CONSTRAINT chk_activity_event_status CHECK (status IN
        ('INFO', 'SUCCESS', 'WARNING', 'ERROR'))
);
```
**坑**: 白名单 7 类漏 `security`,造成 JWT 轮换审计写入失败 —— 000046 修复。

### 000023 · `enhance_ai_usage_analytics`
ai_usage_logs 加 5 列:`task_type, provider_code, model_id, total_tokens, estimated_cost`。回填:从 `endpoint` 的第 4 段拆 task_type;从 `model` 的 `provider/model` 拆;按 `ai_models` 表 join 回填 cost。

### 000024 · `fix_ai_usage_backfill_and_lengths`
- `model VARCHAR(64)→VARCHAR(128)`,`error_code VARCHAR(64)→VARCHAR(128)`(防长 model id 写入失败)。
- 清掉历史上被错误填到 `provider_code` 的 model 字符串。
- 仅当 model_id 唯一映射到一个 provider 时回填 provider_code。

### 000025 · `normalize_ai_usage_logs`
- 清空字符串归一化为 NULL(`NULLIF(TRIM(...), '')`)。
- 数值类字段 `request_chars/response_chars/tokens_in/tokens_out/total_tokens/latency_ms/estimated_cost` 全部 `COALESCE(..., 0)` 后 `SET NOT NULL`。
- 新增 `idx_ai_usage_logs_success_created`。

### 000026 · `backfill_ai_providers`
**文件**: `migrations/000026_backfill_ai_providers.up.sql`(1787 行)

- 兼容性守卫:某些旧库的 `chk_ai_provider_api_type` 不允许 `azure`,先归一化(`UPDATE api_type='openai'→'openai_compat'`)再 DROP+ADD constraint(NOT VALID 模式,后续逐步校验)。
- 复用 V2_11 全量 provider/model seed,共 50+ provider 4-5 个 model 各。`ON CONFLICT DO NOTHING` 幂等。

### 000030 · `add_ai_cost_archives`
ai_usage_logs 加 4 列:`cost_archive_status, cost_archive_amount, cost_archived_at, cost_archive_error`,CHECK ∈ {pending, archived, failed}。

业务:成本归档批处理把单价快照固化到 `cost_archive_amount`,后续模型价格调整后历史成本不变;失败回退实时计算。索引 `idx_ai_usage_logs_cost_archive_status_created`。

---

## 4. 媒体存储(000007–000012 / 000042 / 000043)

### 000007 · `add_media_folders` (Phase 1)
建 `media_folders`(物化路径 `path UNIQUE`)+ `media_files.folder_id`。预创建 id=1 `Root`,`SELECT setval` 让序列跳到 2。

### 000008 · `add_media_tags` (Phase 2)
`media_tags`(category CHECK ∈ {CUSTOM, AI_DETECTED, SYSTEM}) + `media_file_tags`(source CHECK)+ `media_metadata`(meta_type CHECK)。Seed 4 个系统标签。

### 000009 · `add_storage_providers` (Phase 3)
`storage_providers`(`config_json TEXT`)+ `media_files.storage_provider_id, cdn_url`。Seed `Local Storage` provider。

### 000010 · `add_media_variants` (Phase 4 图像处理)
`media_variants`(7 类 variant_type)+ `media_files.{blurhash, exif_data JSONB, ai_labels JSONB}`。`idx_media_files_ai_labels GIN(ai_labels)`。

### 000011 · `add_permissions_and_sharing` (Phase 5)
`folder_permissions` + `media_shares`(file/folder 二选一 CHECK + 密码哈希)+ `media_versions`(版本回溯)。`media_files` 加 `current_version, is_archived, archived_at, archived_by`。

### 000012 · `fix_media_files_deleted_column`
补软删除字段:`deleted, deleted_at`,索引 `idx_media_files_deleted`。

### 000042 · `align_storage_provider_types`
**文件**: `migrations/000042_align_storage_provider_types.up.sql`

R2 加入(VULN-fix):
```sql
ALTER TABLE storage_providers DROP CONSTRAINT IF EXISTS chk_provider_type;
ALTER TABLE storage_providers
    ADD CONSTRAINT chk_provider_type CHECK (provider_type IN ('LOCAL', 'S3', 'MINIO', 'OSS', 'COS', 'R2'));

ALTER TABLE media_files DROP CONSTRAINT IF EXISTS chk_media_storage_type;
ALTER TABLE media_files
    ADD CONSTRAINT chk_media_storage_type CHECK (storage_type IN ('LOCAL','MINIO','COS','OSS','S3','R2'));

ALTER TABLE media_variants
    ADD COLUMN IF NOT EXISTS storage_provider_id BIGINT REFERENCES storage_providers(id) ON DELETE SET NULL;
```

`factory.go` 早就接受 R2 字符串,但 CHECK 拦截了创建 R2 provider —— 这是用户层观测到的"violates check constraint"bug。

### 000043 · `add_media_sync` (Phase 4 同步备份)
`media_files` 加 5 字段:`sync_status (NONE/PENDING/SYNCING/SYNCED/FAILED), backup_provider_id, backup_url, backup_at, backup_error`。

部分索引 `idx_media_files_sync_status WHERE sync_status != 'NONE'` —— 99% 文件都是 NONE,部分索引大幅减少索引体积。

`media_sync_jobs`(队列):`media_id, target_provider_id, status (PENDING/RUNNING/SUCCEEDED/FAILED), attempt, last_error`,索引 `idx_media_sync_jobs_status_created` 让 worker 拣任务 O(log N)。

Seed `site_settings.storage.sync.auto_enabled=false`(默认手动触发)。

---

## 5. AI Prompt 演进(000038 / 000039 / 000040,**有故事的几条**)

### 000038 · `improve_ai_prompts` —— 生产必然失败
**文件**: `migrations/000038_improve_ai_prompts.up.sql`

意图:把 7 个 task_type 的 prompt 重写成强约束版本(单段 / JSON 数组 / 禁止改事实 / Markdown 大纲层级)。同时在末尾:
```sql
ALTER TABLE posts ALTER COLUMN summary TYPE VARCHAR(2000);
```
**致命错误**:`v_published_posts` 视图(`SELECT p.*`)引用了 `posts.summary`,PG 在 view 引用列上不允许直接 ALTER TYPE,抛 `0A000 cannot alter type of a column used by a view or rule`。golang-migrate 把整个 migration 放在单事务 → 7 条 UPDATE ai_task_types **全部回滚** → `schema_migrations` 标 v38 dirty。

### 000039 · `widen_summary_with_view` —— 接管 038 残局
**文件**: `migrations/000039_widen_summary_with_view.up.sql`

修复 038 留下的 v38 dirty:
1. `DROP VIEW v_published_posts`
2. 重做 7 条 `UPDATE ai_task_types`(因为 038 整体回滚)
3. `ALTER TABLE posts ALTER COLUMN summary TYPE VARCHAR(2000)`
4. `CREATE OR REPLACE VIEW v_published_posts`(从 000001 原文照抄)

`deploy.sh` 加自愈:**v38 dirty → force 38 + up** 让 039 接管。**注意 PR #521 当时基于"038 全幂等可重放"的错误判断给出的是 force 37 + up,重放仍会撞 view 依赖再次失败,后改为 force 38**。

### 000040 · `tags_existing_aware_prompt` —— 让 tags 复用现有标签库
**文件**: `migrations/000040_tags_existing_aware_prompt.up.sql`

只 UPDATE `ai_task_types` 的 `tags` prompt,加入 `{existing_tags}` 占位符(由 ai-service 路由层始终注入,空时填 `(无)`),要求模型输出结构化 JSON:
```json
{"matches":[{"name":"现有标签","reason":"..."}], "suggestions":["新标签1"]}
```
ai-service `_parse_tags_structured` 配套实现:严格 JSON → 扁平数组兜底 → 幻觉 match 降级 → match 名字归一化到库内规范大小写。

兼容性: 老客户端不受影响,因为 ai-service 始终注入 `{existing_tags}`。

---

## 6. 搜索 / 向量检索(000015 → 000034 → 000041 → 000044,蓝绿协议演进)

### 000034 · `versioned_post_embeddings` —— 蓝绿协议 v1
**文件**: `migrations/000034_versioned_post_embeddings.up.sql`

把维度从列上解耦:
```sql
CREATE TABLE post_embeddings (
    id BIGSERIAL PK,
    post_id BIGINT FK,
    model_id VARCHAR(120) NOT NULL,
    dim INT CHECK (dim>0 AND dim<=4096),
    embedding vector NOT NULL,                 -- 变长 vector(pgvector 0.7+)
    status VARCHAR(20) DEFAULT 'active' CHECK ∈ {active, shadow, deprecated},
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (post_id, model_id)
);

-- partial HNSW 按 dim × status='active' 分桶
CREATE INDEX idx_post_emb_1536_active ON post_embeddings
    USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
    WHERE dim=1536 AND status='active';

CREATE INDEX idx_post_emb_3072_active ON post_embeddings
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)  -- pgvector vector 上限 2000d
    WHERE dim=3072 AND status='active';
```

数据迁移:把 `post_vectors` 全部行 INSERT 为 `(dim=1536, status='active')`。最后 DROP `post_vectors` + `search_similar_posts(...)` 函数。

`site_settings.search.active_embedding_model` 作为活跃模型指针;换模型 = INSERT 新行 + 翻转指针,**不动 schema**。

### 000035 · `fix_legacy_post_embeddings`(自愈 v1)
**文件**: `migrations/000035_fix_legacy_post_embeddings.up.sql`

存量部署上 000034 的 `CREATE TABLE IF NOT EXISTS post_embeddings (...status...)` 因为 000001 就建了一张 chunk-版的同名表而**静默跳过**,紧随的 `CREATE INDEX ... WHERE status='active'` 在不存在的列上失败,事务回滚。

035 的策略:DO 块内检查 `information_schema.columns` 看 `post_embeddings` 是否有 `status` 列;无则 `DROP TABLE CASCADE` 再按 034 的定义重建,把 `post_vectors` 数据(若还在)平移回来。已是新 schema 的部署该 migration 是 no-op。

### 000036 · `post_embeddings_repair`(自愈 v2)
**文件**: `migrations/000036_post_embeddings_repair.up.sql`

035 的修复逻辑没问题但**前提是它能被执行** —— v34 dirty 把迁移链卡死,035 永远进不来。036 与 035 在语义上等价,但放在一个独立的新版本号里,**配合 `deploy.sh` 里的"v34 dirty → force 35"一键解锁**,陷在 v34 的生产部署 force 跳到 35 后立刻被 036 接管。

正常部署(034+035 跑通):036 是 no-op。

### 000037 · `heal_active_embedding_pointer`
**文件**: `migrations/000037_heal_active_embedding_pointer.up.sql`

034/036 seed `site_settings.search.active_embedding_model` 时:
```sql
COALESCE((SELECT model_id FROM post_embeddings WHERE status='active' LIMIT 1),
         'text-embedding-3-small')
```
新部署 / 空 post_embeddings 时 fallback 到字符串 → 但 admin 实际 routing 配的是 `text-embedding-3-large` → semantic_search 永远匹配不到行。

037 策略:
- 指针无匹配 active 行 → 对齐到 post_embeddings 行数最多的 model_id
- 全空 → 清空指针,让 ai-service 走 llm_router fallback,Go GetDiagnostics 标 `source='unset' + note='请运行全量重建索引'`

### 000041 · `search_profiles` —— 蓝绿协议 v2
**文件**: `migrations/000041_search_profiles.up.sql`

把版本化维度从 `model_id` 推广到四元组 `(chunker_kind, model_id, chunk_size_tokens, overlap_tokens)`:
1. 新建 `search_profiles` 表(code 唯一,status 5 类含 archived/deprecated,chunker_kind 5 类)。
2. `post_embeddings` 加三列:`profile_id`(FK NOT NULL), `chunk_index`(默认 0), `chunk_text`(NULL 容许 — 旧行无原文 snippet)。
3. 存量 1:1 (post_id, model_id) 行整体归到默认 profile(`code='default'`),`chunk_index=0`, `chunk_text=NULL`。
4. **DROP 旧 UNIQUE (post_id, model_id), ADD `post_embeddings_unique UNIQUE (post_id, profile_id, chunk_index)`** —— 多 chunk 并存的关键。
5. 部分唯一索引 `uq_search_profiles_one_active ON ((1)) WHERE status='active'` —— 同时刻只一行 active。
6. 新增 `site_settings.search.active_profile_code='default'`,与旧的 `active_embedding_model` 共存(90 天兼容期)。

切换流程同 034 的协议 — shadow reindex → 一条事务里翻转三处指针(profile.status × 旧/新 + active_profile_code)。

### 000044 · `post_embedding_parent_text` (parent_child chunker follow-up)
单列加列:
```sql
ALTER TABLE post_embeddings ADD COLUMN IF NOT EXISTS parent_text TEXT;
```
parent_child chunker 把 post 切成 child(小,高精度)+ parent(大,高上下文回显),父段原文存这一列。其他 chunker_kind 为 NULL。

PG 17 的 `ADD COLUMN IF NOT EXISTS` 是 instant DDL(不重写表),百万级行也不会触发长锁。父段长度 = `search_profiles.chunk_size_tokens × 4`(经验值,固化在 `chunker.py::_split_parent_child`)。

> **历史小坑**:该 migration 一开始误编号为 000042(与同期开发的 `align_storage` 撞号),最终在 commit `10a116f9 fix(db): renumber parent text migration` 重编为 000044。生产无影响(开发分支隔离)。

---

## 7. 搜索配置(000031 / 000032 / 000045)

### 000031 · `search_config`
为搜索功能 seed 6 项:
- `search.keyword_enabled` (BOOL true)
- `search.semantic_enabled` (BOOL false,需先配置向量化模型)
- `search.ai_qa_enabled` (BOOL false)
- `search.anon_search_rate_per_min` (10)
- `search.anon_qa_rate_per_min` (3)
- `search.auto_index_on_publish` (true)

### 000032 · `search_index_timeout`
单项 seed:`search.index_post_timeout_sec=180`。Go 后端每次批次开始时读最新值,保存即生效。

### 000045 · `default_post_page_size_to_9`
**文件**: `migrations/000045_default_post_page_size_to_9.up.sql`

`/posts` 列表页 lg 断点 `grid-cols-3`;000013 默认 10 → 3+3+3+1 末行单卡。改 9 → 3 行整齐。
```sql
UPDATE site_settings SET setting_value = '9'
WHERE setting_key = 'post_page_size' AND setting_value = '10';
```

策略(**不修改 000013,严守 migration 不可变约定**):
- 全新装:000013 INSERT '10' → 045 UPDATE 到 '9'。
- 存量(默认未改):'10' → '9'。
- 自定义 5/12 等:不动。

⚠️ down 不严格可逆:站长在 045 之前手动设过 '9' 的实例,回滚后会被退回 '10'。`down.sql` 头部注释里写明,需事前 dump。

---

## 8. 安全/审计(000022 / 000046)

### 000022 (前述) · `activity_events`
7 类 event_category 白名单。

### 000046 · `activity_event_category_security`
**文件**: `migrations/000046_activity_event_category_security.up.sql`

```sql
ALTER TABLE activity_events DROP CONSTRAINT IF EXISTS chk_activity_event_category;
ALTER TABLE activity_events
    ADD CONSTRAINT chk_activity_event_category
    CHECK (event_category IN ('post','comment','user','system','friend','media','ai','security'));
```

故事:
- 000022 漏了 `security`,但 `auth_handler.go::RotateJWTSecret` 一直直接写 `EventCategory='security'`,PG 静默拒绝 —— Go 侧 `_ = h.activitySvc.Create(...)` / `log.Warn()` 把错误吞掉,前端永远拿不到这条审计。
- 同期补全的 AI 模块审计(`ai.generation.*` / `ai.agent_chat` / `ai.prompt_update` / `ai.task_*`)仍归类 `'ai'`(已在白名单),不需要新分类。

⚠️ 回滚提示:若线上已有 `event_category='security'` 的行,down.sql 会因 CHECK 重建失败。回滚前需先 `DELETE FROM activity_events WHERE event_category = 'security'` 或迁到 'system'。

---

## 9. 近期新增能力(000047-000067)

### 000047 · `ai_global_pricing`

全局模型价格基准。按 `model_id` 唯一维护 `currency`、per-1M input/output/cache 价格与扩展 `pricing JSONB`。ai-service Global Pricing 页通过 coverage / apply / sync 把它写回 `ai_models`;Go analytics 仍以 `ai_models` 行为成本事实源。

### 000048 · `add_backup_verification`

媒体备份完整性校验:扩展 `media_files.sync_status` 加 `MISSING`,增加 `last_verified_at` 与 partial 索引 `idx_media_files_verify_due`,并 seed `storage.verify.auto_enabled` / `storage.verify.interval_seconds`。

### 000049 · `add_storage_sync_target`

新增 `site_settings.storage.sync.target_provider_id`,把"新上传主存储"与"备份同步目标 provider"拆开,避免 LOCAL 主存储场景无法选择云端备份目标。

### 000050 · `add_theme_visual_color_settings`

新增 `theme_visual_color_mode/light/dark` 三个 appearance 设置,支撑后台/前台视觉光源配色策略。

### 000051 · `user_team_rbac`

落地可扩展 RBAC 与内容共享:
- `permissions`, `roles`, `role_permissions`, `user_roles`
- `teams`, `team_members`
- `content_shares` 统一授权 POST / MEDIA_FILE / MEDIA_FOLDER 给 USER / TEAM / ROLE

旧 `users.role` 仍存在,但新权限体系已经成为后续 Atlas/Access 等模块的基础。

### 000052 · `agent_workflow_canvas`

为后台智能体编排提供持久化边界:connectors、tools、agents、workflows、workflow_versions、variables、runs、trace 等。设计重点是 `secret_ref` 与变量分离,避免真实密钥下发到前端。

### 000053 · `add_editor_image_smart_compression_setting`

新增 `editor_image_smart_compression_enabled=false`,用于文章编辑器图片超过阈值时的智能压缩开关。

### 000054 · `create_notes`

后台私有智能笔记域。新增 `note_folders`, `note_tags`, `notes`, `note_tag_links`, `note_links`, `note_embeddings`。Notes 不是 posts 的子类型,不会进入前台公开路由;但 Atlas Markdown carrier 会把 note 包装为 `notes://{id}` carrier。

### 000055 · `limit_fulltext_tsvector_input`

重建 `idx_posts_fulltext` 与 `idx_notes_fulltext`,对派生 FTS 文档使用 `left(..., 200000)`,避免超长 Markdown 生成 tsvector 时触发 PG `SQLSTATE 54000`。源表仍保留完整 Markdown。

### 000056 · `post_embedding_chunk_checkpoint`

为 search profile reindex 加 chunk 级断点续跑元数据:
- `post_embeddings.chunk_hash`: `chunk_text + parent_text` 的 SHA-256 指纹。
- `post_embeddings.chunk_count`: 同一 `(post_id, profile_id)` 的总 chunk 数。
- `idx_post_emb_profile_post_status`: 便于按 profile/post/status 快速复用 shadow/deprecated chunk。

### 000057 · `media_folder_is_system`

给 `media_folders` 增加 `is_system` / `undeletable`,并 seed `/root/_system_kb`。它是 KB 文件复用媒体存储的前置条件。迁移按 `path='/root'` 定位 root,并补 `uq_folder_path`,避免旧库 root id 漂移。

部署脚本当前对 v57 dirty 的自愈是先探测 `public.knowledge_bases`。只有确认该表不存在时才 `migrate force 56` 后重放 057,再让 058 创建缺失 KB schema;若表已存在或无法判定,脚本拒绝自动自愈并交人工处理。

### 000058 · `knowledge_bases`

KB 核心 5 表:
- `knowledge_bases`: CUSTOM / SYSTEM_POSTS 两类库。
- `kb_profiles`: model+chunker+chunk_size+overlap+top_k+threshold,每 KB 最多一个 active profile。
- `kb_members`: USER/TEAM/ROLE × VIEW/USE/EDIT/MANAGE。
- `kb_files`: CUSTOM 引 media_files,SYSTEM_POSTS 引 posts,二者互斥。
- `kb_embeddings`: KB chunk 向量。

文件头注释仍写 000055,以文件名 000058 和 `schema_migrations.version` 为准。

### 000059 · `kb_default_profiles`

为 `slug='posts'` 的 SYSTEM_POSTS 库 seed default active profile。模型选择优先级: `site_settings.search.active_embedding_model` → `ai_task_routing.embedding` → `text-embedding-3-large`。

### 000060 · `kb_embedding_unconstrained`

把 `kb_embeddings.embedding` 从 `vector(3072)` 改为不锁维度 `vector`,支持 1536/3072/4096 等不同 embedding 模型。down 会删除非 3072 维行后改回 `vector(3072)`,属于有数据损失的降级。

### 000061 · `kb_embedding_hnsw`

为 KB active embeddings 建 partial HNSW:1536/3072/1024/768 四个维度桶,3072 使用 `halfvec`。查询端必须按同样 cast 才能命中表达式索引;超出已建桶的维度会退化为顺序扫描。

### 000062 · `atlas_core`

Atlas Phase 0 数据骨架:carriers、carrier_versions、annotations、knowledge_points、typed_relations。它只建独立骨架,不改 posts/notes/media 现有表。

### 000063 · `atlas_permissions`

seed `content.atlas.read/write/admin`,默认授给 ADMIN。普通用户授权留给后续 UI/权限管理,因此当前 Atlas 仍应按管理员能力面理解。

### 000064 · `atlas_kp_links`

给 `atlas_knowledge_points.uuid` 加默认 `gen_random_uuid()`,并新增 `atlas_annotation_kp_links` 与 `atlas_relation_evidence`,把 annotation 作为 KP/relation 的证据多对多关系。

### 000065 · `atlas_ai_suggestions`

新增 `atlas_ai_suggestions` 和 `atlas_ignored_suggestions`。红线:AI 候选只能进 suggestions,用户 accept 后才由 Go transaction 写 KP/Relation;reject 写忽略指纹,避免重复推荐。

### 000066 · `atlas_carrier_unique_source_uri`

给 `atlas_carriers.source_uri` 加唯一约束,解决并发首次打开同一 note 时 read-then-insert 产生重复 carrier 的问题。迁移假设当前无真实重复;若线上已有重复,需要先合并/去重再加约束。

### 000067 · `kb_schema_repair`

KB 迁移块在历史重编号后可能出现 ledger 已越过 058、但 `knowledge_bases` 实表没有执行创建的环境。000067 是前向修复迁移,把 000058-000061 收敛后的 KB 最终 schema 用 `CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`、catalog 守卫和 seed `ON CONFLICT` 幂等补齐:

- 缺失 KB schema 的环境:补建 `knowledge_bases`、`kb_profiles`、`kb_members`、`kb_files`、`kb_embeddings`、FK、索引和 SYSTEM_POSTS 默认 profile。
- 已正确迁移的环境:语句应全部 no-op。
- `kb_embeddings.embedding` 直接建成不锁维度 `vector`,与 000060 后的最终形态一致。

000067 的 down 是 no-op。它不拥有 KB 表生命周期,不能在 `migrate down 1` 时误删知识库数据;真正 teardown 仍归 000058-000061 的 down 负责。

---

## 10. 部署期 migration 自愈机制

`ops/webhook/deploy.sh::_try_heal_known_dirty` 维护 dirty 自愈表:

| dirty 版本 | 自愈动作 | 由谁接管 |
|---|---|---|
| **v34 dirty** | `migrate force 35` | 让 035/036 接力补完版本化 schema |
| **v38 dirty** | `migrate force 38` | 让 039 接管 widen_summary 与 prompt 重写 |
| **v57 dirty** | 确认 `knowledge_bases` 不存在后 `migrate force 56` | 重放 057 media folder 系统目录迁移,再让 058 创建缺失的 KB schema;若表已存在或无法判定则中止交人工 |

逻辑:
1. 部署前 `migrate version` 解析输出,若命中 dirty 表中条目则 `migrate force <target>`。
2. 阶段 3:`migrate up` 失败时再次探测,命中条目则 force + retry up(同一次部署内自愈)。
3. 未登记的 dirty 版本 **一律中止**,避免误 heal。

新增 dirty 自愈条目时同步更新 `deploy.sh` 与本表(`02-migration-history.md` §10)。

---

## 11. 演进观察(总结)

1. **schema 反范式取舍**:`categories.post_count`、`tags.post_count`、`media_folders.{file_count,total_size}`、`media_tags.usage_count` 等都是缓存列,由 trigger / 业务层维护;读热点远高于写,反范式收益高于一致性代价。
2. **migration 不可变约定的代价**:发布后只能新增 migration,不能改字面量。如 000013 默认 10 → 必须 000045 UPDATE,文件数偏多,但避免了"已部署实例与新部署实例 schema 不一致"的远期故障。
3. **单事务 DDL+UPDATE 的高风险**:000038 的"加宽列 + 重写 7 条 UPDATE"在事务里失败后整体回滚,把"只想改 UPDATE"也搭进去;后续(如 000039)倾向于显式 `DROP VIEW + ALTER + CREATE OR REPLACE VIEW + UPDATE 单独跑`。
4. **DO 块 + information_schema 检测**:000020 / 000035 / 000036 / 000037 大量使用 "先查 schema 再决定 DDL" 的幂等模式,代价是 SQL 变长,但适合"已部署多版本环境一锅端"的场景。
5. **partial 索引在向量场景的复利**:HNSW 按 `dim × status='active'` 分桶后,新维度 = 加一条 partial 索引,主表零修改;同样适用于 `media_files.sync_status WHERE != 'NONE'` 减少索引体积。
6. **CHECK 演进遵循"先 DROP 再 ADD"**:几乎所有 CHECK 修改(000004 / 000021 / 000022→046 / 000042)都用此模式,保证幂等与原子。
