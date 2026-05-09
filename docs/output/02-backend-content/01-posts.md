# 01 · Posts（文章）

> 文章是博客的根模块。Post CRUD、状态机、密码、SEO、AI 索引触发全部在这里。

---

## 1. 责任范围

- 管理端 CRUD（DRAFT / PUBLISHED / ARCHIVED 状态机）。
- 公开端按 slug / category / tag / archive 检索。
- Slug 自动生成与冲突处理。
- 密码保护（bcrypt 哈希，明文输入 → 加密存储）。
- 浏览量异步累加（`go IncrementViewCount`）。
- 草稿自动保存（Redis，TTL 7 天）。
- 上下篇导航（按 `published_at`）。
- 字数 / 阅读时间自动计算。
- AI embedding 索引触发（异步 + site_settings 开关）。
- IDOR 防御（admin / 作者本人）。

---

## 2. 关键代码入口

### Handler 层
- `apps/server-go/internal/handler/post_handler.go:33-52` — `MountAdmin` / `MountPublic` 注册路由。
- `apps/server-go/internal/handler/post_handler.go:277-293` — `checkPostOwnership`（IDOR 闸口，所有写操作必经）。

### Service 层
- `apps/server-go/internal/service/post_service.go:138-187` — `Create`。
- `apps/server-go/internal/service/post_service.go:195-249` — `Update`。
- `apps/server-go/internal/service/post_service.go:254-335` — `UpdateProperties`（PATCH 局部更新）。
- `apps/server-go/internal/service/post_service.go:339-348` — `AutoSave`（Redis 草稿）。
- `apps/server-go/internal/service/post_service.go:359-370` — `Publish`。
- `apps/server-go/internal/service/post_service.go:398-426` — `GetPublicBySlug`（含密码保护处理）。
- `apps/server-go/internal/service/post_service.go:608-629` — `resolveSlug`。
- `apps/server-go/internal/service/post_service.go:731-792` — `triggerIndexing`（异步 AI 索引）。

### Repository 层
- `apps/server-go/internal/repository/post_repo.go:42-53` — `FindOwnership`（轻量 SELECT author_id）。
- `apps/server-go/internal/repository/post_repo.go:82-98` — `Create`（INSERT RETURNING *，初始化 embedding_status='PENDING'）。
- `apps/server-go/internal/repository/post_repo.go:120-155` — `UpdateProperties`（白名单+动态 UPDATE）。
- `apps/server-go/internal/repository/post_repo.go:197-218` — `FindForAdmin`（多过滤分页）。
- `apps/server-go/internal/repository/post_repo.go:281-296` — `FindPublished`（公开列表，pin 优先）。
- `apps/server-go/internal/repository/post_repo.go:382-401` — `SetTags`（事务内 DELETE + INSERT ON CONFLICT）。
- `apps/server-go/internal/repository/post_repo.go:416-444` — `FindAdjacentPosts`（上下篇）。

---

## 3. 路由表

| 方法 | 路径 | Handler | 鉴权 | 备注 |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/posts` | `AdminList` | JWT + admin | 多维过滤 + 分页（默认 pageSize=10） |
| GET | `/api/v1/admin/posts/:id` | `AdminGet` | JWT + admin | 含 Redis 草稿 |
| POST | `/api/v1/admin/posts` | `Create` | JWT + admin | author_id = JWT user.id |
| PUT | `/api/v1/admin/posts/:id` | `Update` | JWT + admin + ownership | 全量替换 |
| PATCH | `/api/v1/admin/posts/:id/properties` | `UpdateProperties` | JWT + admin + ownership | 局部更新（status / pin / tags 等） |
| POST | `/api/v1/admin/posts/:id/auto-save` | `AutoSave` | JWT + admin + ownership | 草稿落 Redis，**不写 DB** |
| DELETE | `/api/v1/admin/posts/:id` | `Delete` | JWT + admin + ownership | 软删除 + 触发 AI delete |
| PATCH | `/api/v1/admin/posts/:id/publish` | `Publish` | JWT + admin + ownership | status='PUBLISHED'，自动写 published_at |
| GET | `/api/v1/public/posts` | `PublicList` | 公开 | 已发布+未隐藏；置顶优先 |
| GET | `/api/v1/public/posts/:slug` | `PublicGet` | 公开 | 异步累加 view_count |
| POST | `/api/v1/public/posts/:slug/verify-password` | `VerifyPassword` | 公开 + IP 限流 10/min | bcrypt 校验 |
| GET | `/api/v1/public/posts/category/:categoryId` | `ByCategory` | 公开 | 分页 |
| GET | `/api/v1/public/posts/tag/:tagId` | `ByTag` | 公开 | 分页 |
| GET | `/api/v1/public/posts/:slug/adjacent` | `Adjacent` | 公开 | prev/next 文章 |

注：限流配置在 `apps/server-go/internal/server/server.go:259, 267, 277-279`。

---

## 4. 数据流

### 4.1 Create（POST /admin/posts）
```
HTTP POST + CreatePostRequest body
   |
   v
post_handler.go:137 Create
   ├─ bindAndValidate → DTO
   ├─ middleware.GetLoginUser → authorID
   |
   v
post_service.go:138 Create(req, authorID)
   ├─ resolveSlug(req.Slug, req.Title, 0)
   |    └─ generateSlug() → 保留 CJK/拉丁/digit；冲突追加 ts%10000
   ├─ status = req.Status || 'DRAFT'
   ├─ post = model.Post{...}
   ├─ if PUBLISHED && !req.PublishedAt → PublishedAt=NOW()
   ├─ hashPostPassword(post)  ← bcrypt(req.Password)
   |
   v
post_repo.go:82 Create(p)
   └─ INSERT RETURNING *  (embedding_status='PENDING', view/comment/like_count=0)
   |
   v
post_repo.go:382 SetTags(out.ID, req.TagIDs)  (事务 DELETE+INSERT)
   |
   v
post_service.go:182 if PUBLISHED → triggerIndexing(out.ID, "upsert")
   └─ go func: 检查 search.auto_index_on_publish + semantic_enabled
      └─ ai_client.DoSync POST /api/v1/admin/search/index (X-Internal-Service)
   |
   v
post_service.go:186 enrichDetail → PostDetail VO
   |
   v
post_handler.go:154 recordPostActivity('post.create', ...)
   |
   v
HTTP 200 + PostDetail
```

### 4.2 GetPublicBySlug（密码保护流）
```
GET /public/posts/:slug
   |
   v
post_handler.go:335 PublicGet
   |
   v
post_service.go:398 GetPublicBySlug(slug, "")
   ├─ post_repo.go:69 FindBySlugPublished
   |    └─ WHERE status='PUBLISHED' AND is_hidden=false AND deleted=false
   ├─ enrichDetail(p, false)
   ├─ if p.Password != nil:
   |    ├─ password 为空 → detail.Content=nil + PasswordRequired=true
   |    └─ bcrypt.CompareHashAndPassword 失败 → 同上 stub
   |
   v
return detail
   |
   v
post_handler.go:345 if !PasswordRequired → go IncrementViewCount(id)
```

---

## 5. DB 表

### posts（`migration 000001:82-114` + 后续追加）

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| id | BIGSERIAL | | PK |
| title | VARCHAR(200) | | 必填 |
| slug | VARCHAR(200) UNIQUE | | URL 别名 |
| content_markdown | TEXT | NULL | 原文（VanBlog 导入可空） |
| content_html | TEXT | NULL | 预渲染 HTML（**当前代码不写**，是占位） |
| summary | VARCHAR(2000) | NULL | migration 000039 从 500 加宽到 2000 |
| cover_image | VARCHAR(500) | NULL | URL 字符串，无外键 |
| status | VARCHAR(20) | 'DRAFT' | CHECK in (DRAFT, PUBLISHED, ARCHIVED, SCHEDULED) |
| category_id | BIGINT FK | NULL | → categories.id (SET NULL) |
| author_id | BIGINT FK | NULL | → users.id (SET NULL); VanBlog 文章可为 NULL |
| view_count | BIGINT | 0 | 异步累加 |
| comment_count | BIGINT | 0 | 由 `UpdatePostCommentCount` 维护 |
| like_count | BIGINT | 0 | 当前**无 handler 写入** |
| word_count | INT | 0 | 保存时计算 (utf8.RuneCount) |
| reading_time | INT | 0 | words / 300，min 1 |
| is_pinned | BOOL | false | |
| pin_priority | INT | 0 | migration 000003 加；DESC 排序 |
| is_featured | BOOL | false | **当前代码不读不写** |
| is_hidden | BOOL | false | migration 000027 加 |
| allow_comment | BOOL | true | |
| password | VARCHAR(100) | NULL | bcrypt 哈希（≈ 60 字符） |
| seo_title | VARCHAR(200) | NULL | DTO 中含字段，但 `CreatePostRequest` 不接受（需用 `UpdateProperties` ？也不在白名单）—— 实际**前端无法设置**，仅供 VanBlog 导入填值 |
| seo_description | VARCHAR(300) | NULL | 同上 |
| seo_keywords | VARCHAR(200) | NULL | 同上 |
| embedding_status | VARCHAR(20) | 'PENDING' | CHECK in (PENDING, INDEXED, FAILED) |
| deleted | BOOL | false | 软删除 |
| scheduled_at | TIMESTAMP | NULL | **无 worker 消费** |
| published_at | TIMESTAMP | NULL | 发布时填 |
| source_key | VARCHAR(128) | NULL | migration 000027 加；UNIQUE 部分索引；VanBlog 导入幂等键 |
| legacy_author_name | VARCHAR(100) | NULL | migration 000027 加 |
| legacy_visited_count | BIGINT | 0 | migration 000027 加 |
| legacy_copyright | VARCHAR(255) | NULL | migration 000027 加 |
| created_at | TIMESTAMP | NOW() | |
| updated_at | TIMESTAMP | NOW() | trigger 自动更新 |

### post_tags（`migration 000001:128-135`）

| 字段 | 类型 |
| --- | --- |
| post_id | BIGINT FK CASCADE |
| tag_id | BIGINT FK CASCADE |
| created_at | TIMESTAMP |

PK = (post_id, tag_id)。Index `idx_post_tags_tag(tag_id)` 用于反向查询。

---

## 6. SEO 字段处理（重要警告）

`Post` model 有 `SEOTitle / SEODescription / SEOKeywords` 字段，DTO `PostDetail` 也回传它们，**但**：

- `CreatePostRequest`（`apps/server-go/internal/dto/post.go:6-21`）**没有这三个字段**。
- `UpdatePostPropertiesRequest`（`dto/post.go:25-42`）**也没有**。
- `PostRepo.Create / Update` SQL 中 `seo_title/seo_description/seo_keywords` 取自 model.Post，但 service 层没有把请求传过去。

**结论：通过当前 admin handler 无法设置 SEO 字段**。仅 VanBlog 迁移路径（`migration_repo.go`）会写入。这是设计漏洞，前端 admin 编辑器即便有"SEO" 折叠面板，提交也会被丢弃。

---

## 7. 自动摘要 / 向量化触发

### 7.1 自动摘要不在 Post 模块发起
`PostService` 不调 ai-service 生成摘要 / 标题 / 标签。**这些动作由前端 admin 编辑器主动调用 `/api/v1/admin/ai/*`**，得到结果后再 PATCH 文章 properties 写回 `summary` 字段。Post 模块对 AI 摘要透明。

### 7.2 向量化触发条件
`triggerIndexing(postID, action)` 只在以下场景触发：
- `Create`：仅当 `out.Status == 'PUBLISHED'`。
- `Update`：仅当 `out.Status == 'PUBLISHED'`（即便从 PUBLISHED 改回 DRAFT，也不会触发 delete —— 这是隐藏 bug）。
- `Publish`：必触发。
- `Delete`：必触发 `action='delete'`。

异步 goroutine 内部检查（`post_service.go:741-751`）：
- `site_settings.search.auto_index_on_publish` == 'false' → 跳过。
- `site_settings.search.semantic_enabled` == 'false' 且非 delete → 跳过。

> **隐藏 bug：** PUBLISHED → DRAFT 的状态切换，`Update` / `UpdateProperties` 都不会调 `triggerIndexing("delete")`，向量库残留旧索引，公开搜索可能命中已下架文章的 stub。复现路径：发表 → 改 status='DRAFT' → 在公开搜索仍可能召回（命中后 ai-service 二次校验文章可见性）。下游 ai-service 有 VULN-062 兜底，但 backend 应自己清。

---

## 8. parent_text 字段

migration 000044 在 `post_embeddings` 表加 `parent_text TEXT`：
- 用于 ai-service 的 parent_child chunker 策略。
- child 嵌入用于召回，parent 文本提供完整上下文。
- 其他 chunker（recursive / fixed / markdown / qa）下该列为 NULL。
- backend 不读不写这列；纯由 ai-service `chunker.py:_split_parent_child` 维护。
- 本模块只需知道：**post_embeddings 是版本化表，parent_text 由 ai-service 写**。

---

## 9. 配置 / 环境变量

| 类别 | 来源 | 影响 |
| --- | --- | --- |
| Redis | `cfg.Redis.*` | `AutoSave` 草稿 / 限流 |
| AI 内部 token | `cfg.AI.InternalServiceToken` | `triggerIndexing` 调 ai-service |
| `site_settings.search.auto_index_on_publish` | `migration 000031` 默认 `true` | 关掉就不触发索引 |
| `site_settings.search.semantic_enabled` | `migration 000031` 默认 `false` | 关掉非 delete 调用都跳过 |
| `site_settings.post_page_size` | `migration 000045` 默认 `9` | 只前端读，后端默认仍 10 |

---

## 10. 与其他模块耦合

| 方向 | 模块 | 接触面 |
| --- | --- | --- |
| 依赖 | Auth / JWT | `middleware.GetLoginUser` 取 user.id 作为 author_id；`AssertOwnership` IDOR 防御 |
| 依赖 | AI Service | `triggerIndexing` POST `/api/v1/admin/search/index` |
| 依赖 | Search 后台 | `ListEmbeddingStatus` `MarkEmbedding{Pending,Failed}` 回填 `embedding_status` |
| 被依赖 | Comments | `Submit` 校验 `posts.status='PUBLISHED' AND is_hidden=false AND allow_comment=true`（`comment_service.go:184-189`，VULN-043） |
| 被依赖 | Archive Handler | 调 `PostService.GetArchives` / `GetArchiveStats` |
| 被依赖 | Agent picker | `PostRepo.SearchPublished` + `FilterPublicNoPassword`（`post_repo.go:557`） |
| 被依赖 | Site / Stats | `CountPublished`（`post_repo.go:489`） |

---

## 11. 已知限制

1. **SEO 字段无法通过 admin 编辑器设置**（详 §6）—— 高优先级 bug。
2. **PUBLISHED→DRAFT 不触发 indexing delete**（详 §7.2 隐藏 bug）。
3. **`like_count` 字段无写入路径**——前端如果显示点赞数永远是 0，要么实现，要么从 DTO 拿掉。
4. **`is_featured` 同上**——表中存在但代码不读。
5. **`scheduled_at` 同上**——SCHEDULED 状态无消费者。
6. **`AutoSave` 不校验内容长度**：DTO `Content` 必填但 ` AutoSave` 走 `c.Bind` 没走 validator（`post_handler.go:218`）。可能落 Redis 大量空草稿。
7. **`UpdateProperties.Slug` 必须传非空**：`resolveSlug` 当 reqSlug 非空 + title 空时用 reqSlug，没问题；但当 PATCH 仅传 `slug=null` 时，会进 generateSlug(""),fallback 到时间戳后缀，相当于站点路径直接换名。前端 PATCH 时务必不要把 slug 显式置 null。
8. **`UpdateProperties.UpdatedAt` 在白名单里**（`post_repo.go:124`）但实际 `UpdateProperties` 在 setClauses 后强行追加 `updated_at=NOW()`（`post_repo.go:148`），用户传的 `UpdatedAt` 会被覆写——白名单条目实际无效。
9. **`Adjacent` 不考虑 is_pinned**：纯按 published_at 升降序，置顶文章会插队前后导航顺序。

---

## 12. 测试覆盖

无。`post_handler_test.go / post_service_test.go / post_repo_test.go` 都不存在。

人工验收路径：
- `POST /admin/posts` + `GET /api/v1/public/posts/:slug` 全链路。
- 密码保护：`POST /verify-password` 错码返 403。
- 软删除：`DELETE` 后 `GET` 返 404 不返 410。
- IDOR：以非作者非 admin 用户 PATCH 别人文章预期 403。
