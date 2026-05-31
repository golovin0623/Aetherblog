# 08 · 数据库与迁移 (PG 17 + pgvector) 总体设计

> 本目录拆分:
> - `README.md` (本篇) — 全局视图
> - `01-schema-overview.md` — 全表清单与字段说明
> - `02-migration-history.md` — 67 条 migration 演进叙事
> - `03-extensions-and-indexes.md` — pgvector / tsvector / 全部索引
> - `04-data-flows.md` — 关键 SQL 链路
> - `05-operations.md` — 应用流程 / 事故恢复 / 备份回滚

---

## 1. 数据库技术栈

| 维度 | 选型 | 备注 |
|---|---|---|
| 主库 | PostgreSQL 17 | 业务、检索、日志、审计共用一库,事务边界清晰 |
| 向量扩展 | pgvector ≥ 0.7 | 提供 `vector` 与 `halfvec` 类型 + HNSW / IVFFlat 索引算子族 |
| 全文检索 | 内建 `tsvector` + GIN | `to_tsvector('simple', ...)` 三字段拼接 |
| 加密 / UUID | `pgcrypto`, `uuid-ossp` | 仅 `init_schema` 启用,目前未实际依赖 |
| 缓存层 | Redis 7 | 与 PG 解耦,只承载会话 / 限流 / 短期热数据,不参与持久化 schema |
| 迁移工具 | `golang-migrate/migrate v4` | `apps/server-go/cmd/migrate/main.go` 二进制 + `apps/server-go/migrations/*.{up,down}.sql` |
| ORM | `sqlx` (Go) + `asyncpg` (Python ai-service) | 不引入 GORM,SQL 显式;`config_schema`/`metadata` JSONB 列由应用层处理,部分字段在结构体里被 **有意省略** 以规避 sqlx 扫描 |

迁移目录: `apps/server-go/migrations/000001_init_schema` 至 `000067_kb_schema_repair`,当前共 67 条。每条 migration 都有对偶 `*.up.sql` / `*.down.sql`,文件名编号顺序即应用顺序。原始文档基线停在 000046;000047-000067 是本轮纠偏必须补齐的新增能力面。

---

## 2. Schema 分组(10 大主题域)

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  用户/鉴权    │    │  内容/笔记    │    │  评论与互动   │
├──────────────┤    ├──────────────┤    ├──────────────┤
│ users        │◄───┤ posts        │◄───┤ comments     │
│ jwt_secrets  │    │ notes        │    │              │
│ roles/teams  │    │ categories   │    │              │
│ permissions  │    │ tags         │    │              │
└──────────────┘    └──────┬───────┘    └──────────────┘
                           │
        ┌──────────────────┼──────────────────────────┐
        ▼                  ▼                          ▼
┌──────────────┐    ┌──────────────┐         ┌──────────────┐
│  AI 模型     │    │  AI/KB 检索  │         │  统计/审计   │
├──────────────┤    ├──────────────┤         ├──────────────┤
│ ai_providers │◄───┤ post_embed-  │         │ visit_records│
│ ai_models    │    │ dings        │         │ daily_stats  │
│ ai_creden-   │    │ search_      │         │ activity_    │
│ tials        │    │ profiles     │         │ events       │
│ ai_global_   │    │ kb_embed-    │         │ sys_op_log   │
│ pricing      │    │ dings        │         │              │
│ ai_task_     │    │              │         │              │
│ routing      │    │              │         │              │
└──────────────┘    └──────────────┘         └──────────────┘

┌────────────────────────────────────────────────────────────┐
│                  媒体存储与权限                              │
├────────────────────────────────────────────────────────────┤
│ media_files ── media_folders ── folder_permissions          │
│       │              │                                      │
│       ├── media_variants                                    │
│       ├── media_versions                                    │
│       ├── media_file_tags ── media_tags                     │
│       ├── media_metadata                                    │
│       └── media_shares / media_sync_jobs ── storage_provid- │
│                                              ers           │
│                                                            │
│  attachments(独立: 文章下载附件)                              │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────┐   ┌────────────────────────────┐
│       系统配置             │   │ Aether Knowledge / Atlas   │
├────────────────────────────┤   ├────────────────────────────┤
│ site_settings (KV)         │   │ knowledge_bases / kb_*     │
│ friend_links               │   │ atlas_carriers / annot-    │
│ schema_migrations          │   │ ations / kp / relations    │
└────────────────────────────┘   └────────────────────────────┘
```

主题与对应 migration 范围速查:

| 主题 | 引入版本 | 关键表 |
|---|---|---|
| 用户/鉴权 | 000001, 000033 | users, jwt_secrets |
| 内容核心 | 000001, 000003, 000027, 000038/039 | posts, categories, tags, post_tags |
| 评论 | 000001, 000004, 000005 | comments |
| 媒体存储 | 000007–000012, 000042, 000043 | media_files / folders / variants / versions / tags / shares / sync_jobs / storage_providers |
| AI 模型注册 | 000017, 000018, 000020, 000021, 000026 | ai_providers, ai_models, ai_credentials, ai_task_types, ai_task_routing |
| 全局模型价格 | 000047 | ai_global_pricing |
| AI 检索 / 向量 | 000015, 000034–000037, 000041, 000044 | post_embeddings, search_profiles, post_vectors(已 drop) |
| Profile 断点续跑 | 000056 | post_embeddings.chunk_hash, chunk_count |
| 搜索配置 | 000031, 000032, 000045 | site_settings.search.* |
| Notes | 000054, 000055 | notes, note_folders, note_tags, note_embeddings, fulltext 限长 |
| 用户/团队 RBAC | 000051, 000063 | permissions, roles, role_permissions, user_roles, teams, team_members, content_shares, atlas permissions |
| Agent Workflow | 000052 | agent_connectors, agent_tools, agent_agents, agent_workflows, agent_* |
| KB / 知识库 | 000057–000061, 000067 | media_folders system flags, knowledge_bases, kb_profiles, kb_members, kb_files, kb_embeddings, KB schema repair |
| Atlas / 知识图集 | 000062–000066 | atlas_carriers, atlas_annotations, atlas_knowledge_points, atlas_typed_relations, suggestions |
| 统计 / 审计 | 000006, 000022, 000046 | visit_records, visit_daily_stats, daily_stats, sys_operation_log, activity_events |
| AI 使用埋点 | 000016, 000023–000025, 000030 | ai_usage_logs |
| 站点设置 | 000001, 000013, 000014, 000029 | site_settings, friend_links |
| Prompt 升级 | 000019, 000038, 000039, 000040 | ai_task_types.prompt_template |

---

## 3. ER 视图(主体关系,简化)

```
users 1──n posts                            users 1──n comments
users 1──n jwt_secrets(auth-internal)        users 1──n media_files (uploader)
users 1──n media_folders (owner/created/updated)
users 1──n folder_permissions
users 1──n ai_credentials (user_id 可空 = 系统级)
users 1──n ai_task_routing  (user_id 可空 = 默认路由)

posts n──n tags             via post_tags          (init schema: 000001)
posts n──1 categories                              (init schema: 000001)
posts 1──n post_embeddings  via post_id            (000034: 版本化 + 0..n chunk)
post_embeddings n──1 search_profiles               (000041: chunker+模型四元组)
post_embeddings 加 chunk_hash/chunk_count           (000056: profile reindex checkpoint)
notes 1──n note_embeddings                          (000054)

categories 1──n categories  (parent_id 自引用)
comments   1──n comments    (parent_id 自引用,二级回复)
media_folders 1──n media_folders (parent_id, 物化路径)

media_files 1──n media_variants                    (000010 缩略图/WEBP/AVIF)
media_files 1──n media_versions                    (000011 版本回溯)
media_files 1──n media_file_tags ── media_tags     (000008)
media_files 1──n media_metadata                    (000008 自定义 KV)
media_files 1──n media_sync_jobs (本地→云备份队列)  (000043)
media_files n──1 storage_providers                 (000009)
media_files n──1 media_folders                     (000007)
media_shares  1──1 (media_files | media_folders)   (000011 二选一 CHECK)
folder_permissions n──1 media_folders              (000011)

ai_providers 1──n ai_models 1──n ai_task_routing(primary/fallback)
ai_credentials n──1 ai_providers
ai_task_routing n──1 ai_task_types
ai_global_pricing 1──n ai_models(逻辑同步,非 FK)

knowledge_bases 1──n kb_profiles 1──n kb_embeddings
knowledge_bases 1──n kb_files     1──n kb_embeddings
knowledge_bases 1──n kb_members

atlas_carriers 1──n atlas_carrier_versions
atlas_carriers 1──n atlas_annotations n──n atlas_knowledge_points
atlas_knowledge_points 1──n atlas_typed_relations(subject/object)
atlas_ai_suggestions -> accept 后才写 KP/Relation
```

> 详细字段、约束、索引参见 `01-schema-overview.md`。

---

## 4. 索引策略概览

### 4.1 主键 / 唯一键
- 所有表 `BIGSERIAL PRIMARY KEY`(`media_metadata`/`ai_credentials`/`ai_task_types`/`ai_task_routing` 在 `000020` 修复时为 `SERIAL`,后续 `000017` 重写为 BIGSERIAL)。
- 业务唯一键:`users.username` / `users.email`,`posts.slug`,`categories.slug`,`tags.slug`,`media_folders.path`,`storage_providers.name`,`ai_providers.code`,`(ai_models.provider_id, model_id)`,`media_tags.slug`,`search_profiles.code`,`media_shares.share_token`。
- 部分唯一索引(条件唯一):
  - `jwt_secrets`:`uq_jwt_secrets_current` / `uq_jwt_secrets_previous` 各允许一行。
  - `search_profiles`:`uq_search_profiles_one_active ON (1) WHERE status='active'` —— **同一时刻最多一个 active profile**。
  - `posts.source_key` 仅在非空时唯一。
  - `ai_task_routing`:`UNIQUE NULLS NOT DISTINCT (user_id, task_type_id)` —— PG15+ 语法,系统默认路由(`user_id=NULL`)被视为同一行,避免重复 seed。

### 4.2 检索类
- **GIN 全文索引** `idx_posts_fulltext` 在 `to_tsvector('simple', title || summary || content_markdown)` 上;`tsvector` 走 `simple` 配置(无词干提取),配合 `pg_trgm` 不在本仓库启用。
- **GIN JSONB 索引** `idx_media_files_ai_labels` 在 `media_files.ai_labels`。
- **HNSW 向量索引(partial / 表达式索引)** 见 §5。

### 4.3 排序与过滤
- `idx_posts_published_at`,`idx_posts_pinned (is_pinned DESC, published_at DESC)`,`idx_posts_pin_priority (pin_priority DESC, published_at DESC)`,`idx_posts_hidden_status (is_hidden, status, published_at DESC)`。
- `idx_visit_records_created`,`idx_daily_stats_date`,`idx_activity_events_created` 都按 `DESC` 建立 — Aether 的 admin 仪表盘 / 列表始终按时间倒序。
- `idx_ai_usage_logs_*_created` 系列(task / model / provider 维度)各自带 `created_at DESC`,支持仪表盘 group-by + 时段过滤。

详细索引清单见 `03-extensions-and-indexes.md`。

---

## 5. PG 扩展与 RAG 关键决策

### 5.1 开启的扩展(`init_schema` 一次性)
```sql
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4(); 当前未使用,留作可扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid 等;ai_credentials 实际密钥由应用层 Fernet 加密
```

### 5.2 向量列与索引(决策点)
- `post_embeddings.embedding` 与 `kb_embeddings.embedding` 现在都按 **不锁维度** 的 `vector` 列设计(pgvector 0.7+ 支持变长)。`kb_embeddings` 初版在 000058 写成 `vector(3072)`,000060 立即改为 unconstrained `vector`。
- 维度 ≤ 2000 用 `hnsw ((embedding::vector(D)) vector_cosine_ops)`;3072 维(`text-embedding-3-large` 默认)必须走 `halfvec` —— `hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)`。**partial 索引按 `dim` × `status='active'` 分桶**:换模型只需追加一条 partial 索引,主表不动。KB 侧 000061 预建 1536 / 3072 / 1024 / 768 四组 partial HNSW。
- 不使用 IVFFlat:HNSW 在 < 100 万行规模下无需训练,延迟更稳定;Aether 的语义检索流量低,维护成本压在 `m=16, ef_construction=64`。

### 5.3 search_profiles —— 为什么单独建表
000034 的版本化粒度仍是 **单一 `model_id`**,但实际 RAG 召回受 4 个独立维度影响:
1. **chunker_kind**(recursive / fixed / markdown / qa / parent_child)
2. **model_id**
3. **chunk_size_tokens**
4. **chunk_overlap_tokens**

把这 4 个维度绑成一个 `search_profile` 才能让"换 chunking 策略"也享受蓝绿翻转、零切换窗口、随时回滚 —— 与 Pinecone namespace / Weaviate class / OpenAI vector store 的设计思路对齐(详见 `02-migration-history.md` §000041)。`post_embeddings` 加 `(profile_id, chunk_index, chunk_text, parent_text)` 四列后,同一篇文章可同时被多 profile 索引、被多 chunk 切分。

### 5.4 embedding heal 单独建 migration —— 为什么
000034 + 000036 在 seed `site_settings.search.active_embedding_model` 时使用了:
```sql
COALESCE((SELECT model_id FROM post_embeddings WHERE status='active' LIMIT 1),
         'text-embedding-3-small')
```
新部署 / 空表场景下 fallback 到字符串字面量,但 admin 实际配置可能是 `text-embedding-3-large` —— 指针指向不存在的活跃行,**语义搜索永远返回空**。000037 把这条 heal 单独做成一个 migration 而不是合并进 000036:
- 035 / 036 已经在 main 上,生产已部分应用 → 不可变约定不允许改它们
- heal 是 **数据修复**,与 schema 重建语义独立,放在独立版本号方便审计与日后单独 force

---

## 6. 关键设计决策(整理)

| 决策 | 出处 | 取舍 |
|---|---|---|
| **migration 不可变** | 全仓约定 | 任何已发布 migration 不允许在原文件上改字面量 / 顺序;改默认值另起一条(如 000045)。代价:文件数偏多。 |
| **JSONB 列在 sqlx 模型里被有意省略** | `model/ai.go::AITaskType.config_schema`,`model/analytics.go::ActivityEvent.metadata` | 避免 `sqlx.Scan` 撞 JSONB 类型;按需走 raw SQL 单独查 |
| **不依赖 GORM** | 全仓 Go | sqlx + named query;迁移走 golang-migrate;单一职责 |
| **partial unique 表达 "至多 N 行某状态"** | jwt_secrets (current/previous), search_profiles (active) | 比 trigger 简洁,Postgres INSERT 冲突即语义错 |
| **NULL 表示系统默认而非缺失** | `ai_task_routing.user_id`, `ai_credentials.user_id` | 配合 `UNIQUE NULLS NOT DISTINCT` 避免重复 seed |
| **所有时间戳带 trigger 自动 updated_at** | `update_updated_at_column()` | 业务 service 不必显式 SET;000028 加旁路 `app.preserve_updated_at` 让 VanBlog 导入保留原时间 |
| **向量列不锁 dim** | post_embeddings | 换模型 = INSERT 新行 + 翻转指针,**不动 schema**(对比早期 `post_vectors vector(1536)` 锁死) |
| **KB 文件复用媒体系统目录** | 000057-000058 | KB 文件不新造对象存储系统,而是落 `/root/_system_kb/<slug>`;媒体目录隐藏和 undeletable 规则必须配套 |
| **AI suggestion 不直写 Atlas 图谱** | 000065 | LLM/heuristic 输出只能进入 `atlas_ai_suggestions`,用户 accept 后才写 KP/Relation |
| **存量数据迁移走 ON CONFLICT DO NOTHING** | 全部 seed migration | 部署幂等;新装 vs 存量统一路径 |
| **dirty self-heal 在部署脚本里硬编码** | `ops/webhook/deploy.sh::_try_heal_known_dirty` | v34→force 35,v38→force 38,v57→确认 `knowledge_bases` 不存在后 force 56;只在 **登记过且可证明安全的 dirty 特征** 上自愈,其他一律中止 |

---

## 7. 已知问题与扩展点

### 7.1 已知问题
- **down 不严格可逆**: 默认值类 migration(如 000045 把 page_size '10'→'9')无法区分"用户主动设 10"与"系统默认 10",回滚会被静默改回。`down.sql` 头部注释里写明,运维需事前 dump。
- **`config_schema` / `metadata` JSONB 暂未走 sqlx**: 业务逻辑通过 raw query + `pgtype.JSONB` 处理,会增加一次 marshal/unmarshal 成本。
- **`v_published_posts` 视图阻挡 ALTER COLUMN**: 000038 的 `posts.summary` 加宽因 view 引用 `SELECT p.*` 失败;最终在 000039 通过 `DROP VIEW + ALTER + CREATE OR REPLACE VIEW` 解决。后续任何对 posts 列类型的修改必须走同样模式。
- **`post_embeddings.parent_text` 仅 parent_child chunker 写**: 其他 chunker_kind 为 NULL;查询时需在应用层判断,后端不做强约束。
- **000058-000061 文件头注释编号漂移**:这些文件的头部注释仍写 000055-000058,但真实文件名是 000058-000061。以文件名和 `schema_migrations.version` 为准。
- **KB/Atlas down 会删除业务数据**:000058/000062/000065 的 down 会级联删除 KB/Atlas 数据;000060 down 会删除非 3072 维 KB embeddings。000067 down 刻意 no-op,避免单步回退误删知识库。不能把这些迁移当普通可逆迁移。

### 7.2 扩展点
- **新 embedding 模型 / 维度**: 仅需在 admin UI 切换 active model + 跑 reindex;若维度不在已有 partial 索引中(1536 / 3072),手工追加一条 partial HNSW 索引。
- **新 chunker 策略**: 在 `search_profiles.chunker_kind` CHECK 列表里追加值,在 `apps/ai-service/app/services/chunker.py` 实现切片函数;无 schema 变更。
- **新 storage provider**: 仅需扩展 `chk_provider_type` / `chk_media_storage_type` CHECK,以及 `apps/server-go/internal/service/storage/factory.go` 工厂注册(参见 000042 R2 加入流程)。
- **新 activity event 分类**: 在 `chk_activity_event_category` 上 `DROP CONSTRAINT + ADD CONSTRAINT`(参见 000046),配合前端 `ActivitiesPage.categoryConfig` 加 i18n 标签。
- **新 AI 任务类型**: 在 `ai_task_types` 新增一行(`ON CONFLICT DO UPDATE`),seed 默认 routing,prompt 升级独立 migration。

---

## 8. 子文档对接

| 文档 | 主题 |
|---|---|
| [`01-schema-overview.md`](./01-schema-overview.md) | 全表清单 / 字段 / PK / FK / 索引 |
| [`02-migration-history.md`](./02-migration-history.md) | 67 条 migration 演进叙事(分主题) |
| [`03-extensions-and-indexes.md`](./03-extensions-and-indexes.md) | pgvector / tsvector / GIN / 索引清单 |
| [`04-data-flows.md`](./04-data-flows.md) | 文章发布 / 搜索双通路 / 媒体上传 / 审计事件 SQL 链路 |
| [`05-operations.md`](./05-operations.md) | migration 应用 / 事故恢复 / dirty / 备份 / 回滚 |

---

## 9. 与其他模块的对接面

- **后端 server-go**(`apps/server-go/internal/repository/`): 全部 SQL 直写;migration 是结构契约的唯一真源;model 是行的 Go 表示。
- **AI 服务 Python**(`apps/ai-service/app/`): 通过 asyncpg / SQLAlchemy 直连同一 PG,读写 `post_embeddings`、`kb_embeddings`、`ai_usage_logs`、`search_profiles`、`ai_global_pricing`;对 schema 的修改一律走 server-go 的 migrations(Python 侧 **不持有** migration)。
- **Admin 前端 SearchConfigPage**: 直接消费 `search_profiles` + `site_settings.search.*` 暴露的 API,迁移变更体现为新增 admin 控件(profile 列表、reindex SSE 状态)。
- **部署脚本** `ops/webhook/deploy.sh`: 内嵌 `migrate up` + `_try_heal_known_dirty`;新增 dirty 自愈条目时同步更新此脚本与 `02-migration-history.md` 自愈表。
- **CI** `.github/workflows/`: 在 PR 阶段跑 `golangci-lint` + 编译 `cmd/migrate`,无独立 migration 校验;dirty 检测发生在生产部署阶段。
