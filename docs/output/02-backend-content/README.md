# 02 · 后端内容模块（Posts / Tags / Categories / Comments / Share / Archive / Versions）

> **版本基线：** migrations 000045（HEAD 实际 000046，但 046 属于 activity_events 模块） / 26 个后端 handler / Aether Codex Round 5。
> **作用域：** Go 后端 `apps/server-go` 中负责"博客内容"的全部 handler / service / repository / model / migration。
> **不在范围：** 媒体文件、AI 服务、搜索 indexer / qa（这些有专属文档）；本模块仅记录"内容侧与之耦合的接口契约"。

---

## 1. 模块定位

内容模块是 AetherBlog 的"血肉"。Auth/Users 给出"谁能写"，Media 给出"挂什么"，AI/Search 给出"怎么找"，**Content 才是公开站点存在的理由**。

它的边界是：

```
                              [ Blog 前台 ]                     [ Admin 后台 ]
                                   |                                  |
                              /api/v1/public                     /api/v1/admin
                                   |                                  |
                +------------------+------------------+               |
                |                  |                  |               |
            posts/*           comments/post/*    archives/*           |
            (slug 路由)       (公开列表+提交)    (按月分组)            |
                |                  |                  |               |
                v                  v                  v               v
+----------------------------------------------------------------------------+
|                            Echo handler 层                                 |
|     post_handler · tag_handler · category_handler · comment_handler        |
|     archive_handler · share_handler(媒体) · version_handler(媒体)          |
+----------------------------------------------------------------------------+
                |                                                            
                v                                                            
+----------------------------------------------------------------------------+
|                           Service 业务规则层                                |
|        PostService · TagService · CategoryService · CommentService         |
|   职责：状态机推进、slug 唯一性、bcrypt 密码、AI 索引触发、评论树构建      |
+----------------------------------------------------------------------------+
                |
                v
+----------------------------------------------------------------------------+
|                           Repository 数据访问层                            |
|     PostRepo (650+ 行 / 14 个查询) · TagRepo · CategoryRepo · CommentRepo  |
|   通过 sqlx.DB；动态 WHERE 子句使用 placeholder 闭包避免 SQL 注入          |
+----------------------------------------------------------------------------+
                |
                v
+----------------------------------------------------------------------------+
|                       PostgreSQL 17 + pgvector                             |
|     posts · post_tags · tags · categories · comments                       |
|     post_embeddings (versioned, ref §1.4) · v_published_posts (view)       |
+----------------------------------------------------------------------------+
                ^
                |
        Redis 7（草稿缓存 / 限流 token bucket）
```

---

## 2. 内容生命周期（状态机）

文章状态字段 `posts.status`，CHECK 约束允许 `DRAFT | PUBLISHED | ARCHIVED | SCHEDULED`（见 `apps/server-go/migrations/000001_init_schema.up.sql:112`）。**实际代码路径只覆盖前三种**：

```
[ 不存在 ]
     |
     |  POST /admin/posts (Create)
     v
[ DRAFT ]  ←─────────┐
     |               │
     |  PATCH        │  PATCH .../properties (status=DRAFT)
     |  status       │
     |  = PUBLISHED  │
     v               │
[ PUBLISHED ] ───────┘
     |
     |  PATCH .../properties (status=ARCHIVED)
     v
[ ARCHIVED ]   ─── 当前所有公开列表 SQL 都按 status='PUBLISHED' 过滤；
                   ARCHIVED 实际等同于"对外不可见"。
     |
     |  DELETE /admin/posts/:id (软删除)
     v
[ deleted=true ]   ─── 软删除标志，所有查询都加 `deleted = false`
```

**正交布尔位影响可见性**（任何状态下都生效）：
- `is_hidden`：进了 `PUBLISHED` 但不出现在公开列表 / 归档 / 上下篇导航。
- `password`：bcrypt 哈希；详情页 stub 化（`apps/server-go/internal/service/post_service.go:398-426`）。
- `is_pinned + pin_priority`：仅影响排序（`is_pinned DESC, pin_priority DESC, published_at DESC`），见 `apps/server-go/internal/repository/post_repo.go:281-296`。

> **怪味（非显然）：** `SCHEDULED` 在 schema 上是合法状态、`scheduled_at` 列也存在，但**没有任何 worker / cron 把 SCHEDULED 推进到 PUBLISHED**。`triggerIndexing` 的判断只看 `status == 'PUBLISHED'`（`post_service.go:182, 244, 367`）。定时发布功能=半实现：DTO 接受 `publishedAt` 未来时间，但 `Publish(id)` 是即时切换。建议视作未交付特性，不要让前端把"定时发布"按钮接到这条路径上。

---

## 3. 子模块清单

| 文件 | 端点 | 行数 | 角色 |
| --- | --- | ---: | --- |
| `01-posts.md` | `/admin/posts` `/public/posts/*` | post_handler 449 / post_service 792 / post_repo 674 | 文章 CRUD、密码、SEO、AI 触发 |
| `02-tags.md` | `/admin/tags` | tag_* ~115 / 117 / 89 | 标签 CRUD（无 merge） |
| `03-categories.md` | `/admin/categories` `/public/categories` | category_* 116 / 167 / 96 | 分类树、parent/sort、删除前置检查 |
| `04-comments.md` | `/admin/comments/*` `/public/comments/post/:id` | comment_* 277 / 361 / 182 | 5 状态审核流 + 嵌套评论树 |
| `05-share-and-archive.md` | `/public/archives/*` (`+ /admin/media/shares` 仅供对照) | archive_handler 41；share_* 仅文件 | **关键事实：post share 不存在；archive 用 PostService** |
| `06-versioning.md` | `/admin/media/files/:id/versions` (仅供对照) | version_* 113 / 147 / 81 | **关键事实：post version 不存在；版本仅适用于媒体** |

---

## 4. 横向依赖

### 4.1 与 AI 自动摘要（writeback）
PostService 不直接调 AI，但 ai-service 在执行 `summary` / `tags` / `titles` 任务时回写到 `posts.summary` / `post_tags`。这是**单向的，由 AI 模块把生成结果 PATCH 到 admin /posts/:id/properties**（行政视图）。本模块不发起调用。

### 4.2 与 AI 索引（embedding）
**双向耦合**，PostService 主动触发：

- `PostService.Create / Update / Publish / Delete` → `triggerIndexing(postID, action)`（`post_service.go:731-792`）。
- 异步 goroutine + 30s timeout，先读 `site_settings.search.auto_index_on_publish` / `search.semantic_enabled`，再 POST 到 ai-service `/api/v1/admin/search/index` 走 `X-Internal-Service` 通道。
- `delete` action 不带正文；`upsert` 重新拉一次 post 完整内容（`post_service.go:768-782`）。
- AI 写回 `posts.embedding_status ∈ {PENDING, INDEXED, FAILED}`，与 `posts.deleted/is_hidden` 联动 —— 见 `MarkEmbeddingFailed`（`post_repo.go:661-674`）的 VULN-062 注释。

涉及表：
- `post_embeddings`（migration 000034）：版本化向量，`(post_id, model_id)` 唯一。
- `post_embeddings.parent_text`（migration 000044）：parent_child 切分策略下父段原文。

### 4.3 与搜索（搜索 handler / public search）
- `PostRepo.SearchPublished`（`post_repo.go:516-547`）：tsvector + ILIKE 双路径关键词搜索，CJK 兼容。
- `PostRepo.FilterPublicNoPassword`（`post_repo.go:557-577`）：Agent picker 用，去除密码保护文章。
- `PostRepo.ListEmbeddingStatus / FindByIDs / MarkEmbeddingPending / MarkEmbeddingFailed`：搜索后台批量索引面板的回调。

### 4.4 与媒体（cover_image, attachments）
- 弱耦合：`posts.cover_image` 是 URL 字符串（VARCHAR(500)），不做外键校验。
- 历史 `attachments` 表通过 `attachments.post_id` 软关联到 posts；当前 handler 层不操作 `attachments`，是 vanblog 兼容遗留（`migration 000001:351-367`）。

### 4.5 与 Activity（事件流）
PostHandler / CommentHandler 的写操作都会调 `recordPostActivity` / `recordCommentActivity`（`post_handler.go:296-316`、`comment_handler.go:243-264`）写入 `activity_events`。失败仅 log，不阻塞。

---

## 5. 关键决策

### 5.1 分页默认 9，不是 10
- 列表页栅格 `lg:grid-cols-3`，10 → "3+3+3+1"末行单卡破洞，9 → 整齐 3 行。
- migration 000045 将 `site_settings.post_page_size` 从 10 改 9，但**仅 UPDATE 当前值仍为 '10' 的行**（保留站长自定义值）。
- 后端 handler 默认值仍是 10：`post_handler.go:65 `parseIntDefault("pageSize", 10)`、`PublicList` `pagination.ParseWithDefaults(c, 1, 10)`（`post_handler.go:323`）。**真正决定分页大小的是前端 SiteSettingsProvider 从 `site_settings.post_page_size` 读出来再传 `pageSize` query 参数**（`apps/blog/app/components/SiteSettingsProvider.tsx:42`）。
- 注意点：`PublicList` 没有兜底读 setting；前端必须显式传 `pageSize=9`。

### 5.2 关键词搜索：tsvector + ILIKE 双重兜底
`PostRepo.SearchPublished`（`post_repo.go:516-547`）保留 `to_tsvector('simple', ...)` 全文索引（migration 000001:125 创建 `idx_posts_fulltext` GIN 索引），但额外叠加 `ILIKE '%kw%'`：
- 'simple' 分词器以空白切词，对中文整词查询返回 0 结果。
- ILIKE 子串匹配做兜底；title/summary 命中加更高 rank（0.5/0.2/0.05）。
- 大小写处理：在 CTE 里 `lower($1)` 强制把 tsquery 与 LIKE pattern 都走小写分支。

### 5.3 文章 slug 自动唯一化
`PostService.resolveSlug`（`post_service.go:608-629`）：
- 优先用请求 `slug`；空则从 title 生成。
- `generateSlug`（`post_service.go:672-692`）保留 CJK + 拉丁 + 数字 + `-`，截断 100。
- 冲突时追加 `-{timestamp_ms % 10000}`，**只追加一次，不递归检查**。理论上极小概率仍然冲突（4 位时间戳冲突）。

### 5.4 草稿缓存策略
- `AutoSave` 把 `CreatePostRequest` JSON 序列化到 Redis `post:draft:<id>`，TTL **7 天**（`post_service.go:24-27, 339-348`）。
- `Update` 自动 `deleteDraft`，已发布即清缓存。
- `GetByID(admin)` 时把 draft 一并返回，editor 用来判断"有未保存草稿，是否恢复"。
- Redis 不可用 → 全部静默 no-op（degrade gracefully）。

### 5.5 评论审核流：5 状态而非 3
- migration 000004 把 CHECK 约束扩展为 `PENDING|APPROVED|REJECTED|SPAM|DELETED`。
- 注意 `DELETED` 是评论的"软删除标志"，借用 status 列实现，**不像 posts 那样有独立 `deleted` 布尔列**。
- 审核动作各自独立：approve / reject / spam / restore / softDelete / permanentDelete + 各自 batch 版（`comment_handler.go:35-48`）。

### 5.6 文章版本快照"未实现"
- 任务名义说"6. versioning（文章版本）"。
- 实际代码：`version_handler.go` / `version_service.go` / `version_repo.go` 全部针对 **`media_versions` 表**（migration 000011，行 47），不是文章。
- 数据库**没有 `post_versions` 表**（grep 全部 migrations 确认）。
- 文章侧能做的只有 Update 时 Redis 草稿覆盖，没有可回滚版本链。详见 `06-versioning.md`。

### 5.7 文章分享"未实现"
- `ShareHandler` / `ShareService` / `ShareRepo` / `media_shares` 表全部针对**媒体文件 / 文件夹**（migration 000011，行 1-46）。
- 路由也挂在 `/admin/media/shares/*`（`server.go:323`），不在 `/admin/posts` 下。
- 文章公开 URL 直接用 `/posts/:slug`，靠 `posts.password` 字段做受控分享。详见 `05-share-and-archive.md`。

---

## 6. 数据库表全景（仅本模块）

| 表 | 主键 | 关键索引 | 引用关系 |
| --- | --- | --- | --- |
| `posts` | id BIGSERIAL | slug UNIQUE / status / published_at DESC / pin_priority DESC / fulltext GIN / source_key UNIQUE 部分索引 | category_id → categories.id (SET NULL); author_id → users.id (SET NULL) |
| `post_tags` | (post_id, tag_id) | tag_id | post_id → posts.id CASCADE; tag_id → tags.id CASCADE |
| `tags` | id BIGSERIAL | slug UNIQUE / post_count DESC | — |
| `categories` | id BIGSERIAL | slug UNIQUE / parent_id / sort_order | parent_id → categories.id (SET NULL，自引用) |
| `comments` | id BIGSERIAL | post_id / parent_id / status / created_at DESC | post_id → posts.id CASCADE; parent_id → comments.id CASCADE（自引用） |
| `post_embeddings` | id BIGSERIAL | (post_id, model_id) UNIQUE / partial HNSW vector(1536)+halfvec(3072) / (post_id, status) | post_id → posts.id CASCADE |
| `v_published_posts` | view | — | LEFT JOIN users / categories |

**触发器：**
- `update_*_updated_at`（pg func + trigger）：所有时间戳列自动维护。
- `trigger_update_post_counts`（`migration 000001:395-422`）：`posts` 表 INSERT/UPDATE/DELETE 触发 `categories.post_count` 重新计算。**注意：tags.post_count 没有触发器维护**——是 stale 列，没人写，列表查询里不依赖它（只在 `tags.findAll` ORDER BY 用，但实际值来源于 vanblog 导入，新建标签永远是 0）。

---

## 7. 已知问题

1. **AdminList 关键词 ILIKE 全表扫**：`post_repo.go:246-251` 对 `title || content_markdown` 做无边界 ILIKE，没有 trigram 索引。文章数 > 10k 时 admin 搜索会变慢。
2. **`tags.post_count` 是 stale 数据**：列上没有触发器，新建标签永远 0，老标签来自 vanblog 导入。前端 hot-tags 排序失真（按 0 排）。
3. **slug 冲突 1/10000 概率二次冲突**：`resolveSlug` 只追加一次时间戳后缀，并发场景理论可能再撞。
4. **Comment IsAdmin 永远 false**：`Submit` 强制写 `IsAdmin: false`（`comment_service.go:218`），即便登录管理员也走公开评论提交不会触发"管理员标记"。需要 admin 在后台直接 INSERT 或在 handler 加 JWT 上下文识别。
5. **`PublicList` 无 site setting 读取**：分页大小靠前端传，省略时默认 10，与 `post_page_size=9` 配置不一致。
6. **`SCHEDULED` 状态无 worker**：定时发布是半实现，详见 §2 怪味。
7. **trigger_update_post_counts 只更 categories**：删 / 改文章触发后类别 post_count 同步；标签关联在 post_tags，没触发，仍是 stale。
8. **`PostRepo.Update` 不更新 `embedding_status`**：发布触发 indexing 是异步的，PUBLISHED 后短暂 PENDING 是预期行为，但若 ai-service 永远不应答，posts 永远卡在 PENDING。
9. **`v_published_posts` 视图存在但代码不用**：所有查询都直接走 `posts` 表+ JOIN，view 仅是历史遗留。

---

## 8. 扩展点

- **新增 post 状态**（如 `REVIEW`）：改 CHECK 约束 + `post_repo.go:120` 的 `allowedPostColumns` 白名单 + service 状态机。
- **接入定时发布**：写一个 `cron` worker 或 `pg_cron`，扫描 `WHERE status='SCHEDULED' AND scheduled_at <= NOW()`，调 `PostService.Publish`。
- **加 trigram 索引解决 admin 慢搜索**：`CREATE INDEX ... USING gin(title gin_trgm_ops)`，需 `pg_trgm` 扩展（已启用）。
- **Tag merge**：当前 `TagService` 只能 Create/Update/Delete；merge（"把 tag-A 的所有 post_tags 转到 tag-B 后删 tag-A"）需新增 service 方法 + 事务。前端目前只能逐篇编辑文章手动改 tags。
- **真实文章版本控制**：参考 `media_versions` 表结构开 `post_versions(id, post_id, version_number, content_markdown, summary, change_description, created_by, created_at)`。

---

## 9. 测试覆盖

```
apps/server-go/internal/handler/
  ├── ai_handler_test.go
  ├── auth_handler_test.go
  ├── search_handler_test.go
  └── stats_handler_test.go
apps/server-go/internal/service/
  ├── auth_service_test.go
  ├── container_monitor_test.go
  ├── media_service_test.go
  ├── migration_service_test.go
  └── storage_provider_service_test.go
apps/server-go/internal/repository/
  └── ai_pricing_repo_test.go
```

**结论：内容模块零自动化测试**。post / tag / category / comment 的 handler / service / repo 都没有 `_test.go` 文件。所有验证依赖前端 e2e 与人工。这是首要可改进项。

---

## 10. 文档导航

按需阅读：
- 文章 CRUD / 索引触发 → `01-posts.md`
- 标签管理 / AI existing-aware prompt → `02-tags.md`
- 分类树 / sort_order / parent_id → `03-categories.md`
- 评论审核流 / 5 状态机 / XSS / 嵌套 → `04-comments.md`
- 归档实现 + share 错位说明 → `05-share-and-archive.md`
- 版本快照（媒体）+ 文章无版本说明 → `06-versioning.md`
