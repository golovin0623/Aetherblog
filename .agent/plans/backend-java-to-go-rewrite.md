# AetherBlog 后端 Java → Go 重构计划

## Context

Java Spring Boot 后端存在以下瓶颈：构建时间 1-3 分钟、Docker 镜像 350+ MB、启动 5-15 秒、内存占用 300-500 MB。目标是重写为 Go，实现 <10s 构建、<30MB 镜像、<100ms 启动、<50MB 内存。采用 Big Bang 策略：在 `apps/server-go/` 中完整开发，完成后一次性替换 Java 后端。

## 技术选型

| 层 | 选型 | 理由 |
|---|------|------|
| HTTP | labstack/echo/v4 | 用户选择，高性能，中间件丰富 |
| DB | jmoiron/sqlx + lib/pq | 原生 SQL，可复用现有查询，性能最优 |
| Redis | redis/go-redis/v9 | 标准客户端 |
| JWT | golang-jwt/jwt/v5 | 标准库 |
| Validation | go-playground/validator/v10 | Echo 原生支持 |
| Config | knadh/koanf/v2 | 轻量，支持 YAML/env |
| ES | elastic/go-elasticsearch/v8 | 官方客户端 |
| MinIO | minio/minio-go/v7 | 官方 SDK |
| S3 | aws/aws-sdk-go-v2 | 官方 SDK |
| Image | disintegration/imaging | 纯 Go，无 CGO |
| Log | rs/zerolog | 零分配 JSON 日志 |
| Migration | golang-migrate/migrate/v4 | 复用现有 Flyway SQL |
| Bcrypt | golang.org/x/crypto/bcrypt | 标准库 |

## 项目结构

```
apps/server-go/
├── cmd/server/main.go
├── internal/
│   ├── config/config.go           # 配置加载
│   ├── server/server.go           # Echo 服务器初始化 + 路由注册
│   ├── middleware/                 # JWT, CORS, RateLimit, Recovery, Logger
│   ├── handler/                   # HTTP 处理器 (按领域分组)
│   ├── service/                   # 业务逻辑
│   ├── repository/                # sqlx 数据库访问
│   ├── model/                     # 数据库实体 struct
│   ├── dto/                       # 请求/响应 struct
│   └── pkg/
│       ├── response/              # R[T] 响应包装
│       ├── pagination/            # PageResult[T]
│       ├── storage/               # 存储抽象 (Local/MinIO/S3)
│       ├── ratelimit/             # Redis 限流
│       └── imgproc/               # 图像处理
├── migrations/                    # 转换自 Flyway SQL (001_init.up.sql ...)
├── Dockerfile
├── Makefile
└── go.mod
```

## API 兼容性契约

**响应格式 R[T]** — 必须精确匹配 (`@JsonInclude(NON_NULL)` = `omitempty`)：
```go
type R[T any] struct {
    Code          int    `json:"code"`
    Message       string `json:"message"`
    Data          T      `json:"data,omitempty"`
    Timestamp     int64  `json:"timestamp"`
    TraceID       string `json:"traceId,omitempty"`
    ErrorCategory string `json:"errorCategory,omitempty"`
}
```

**ResultCode 映射**：200(成功), 400/401/403/404/429, 500, 1001-1005(业务), 2001-2005(认证)

**Context Path**：所有路由注册在 `/api` 前缀组下 (Echo Group)

**Cookie Auth**：Access Token 写入 HttpOnly cookie path=/api, Refresh Token path=/api/v1/auth

---

## Phase 1: 脚手架与基础设施

**目标**：可运行的空 Echo 服务器 + 数据库连接 + 配置 + 响应框架

**创建文件**：
- `cmd/server/main.go` — 入口
- `internal/config/config.go` — YAML + env 配置
- `internal/server/server.go` — Echo 实例、中间件注册、优雅关闭
- `internal/pkg/response/response.go` — R[T]、PageResult[T]、ResultCode
- `internal/pkg/pagination/pagination.go` — 分页参数解析
- `internal/middleware/recovery.go` — Panic 恢复
- `internal/middleware/logger.go` — 请求日志
- `migrations/` — 从 Flyway 转换 28 个 SQL 文件（仅重命名格式）
- `Makefile` — build, run, migrate, test, docker
- `Dockerfile` — 多阶段构建 (CGO_ENABLED=0)
- `go.mod`

**关键实现**：
- koanf 加载 config.yaml + 环境变量覆盖
- sqlx 连接池 (MaxOpenConns=20, MaxIdleConns=5)
- go-redis 连接
- golang-migrate 自动迁移
- Echo 中间件链: Recovery → Logger → CORS → 路由
- Health endpoint: `GET /api/actuator/health`

**验收标准**：
- [ ] `make build` < 5 秒
- [ ] `make run` 启动 < 100ms，监听 :8080
- [ ] `GET /api/actuator/health` 返回 `{"code":200,"message":"操作成功","data":{"status":"UP"},"timestamp":...}`
- [ ] `make migrate` 对现有数据库无破坏性变更
- [ ] Docker 镜像 < 30 MB
- [ ] 内存占用 < 20 MB (空载)

---

## Phase 2: 认证模块 (8 endpoints)

**目标**：JWT 认证完整流程，兼容现有前端 Cookie 机制

**端点**：
```
POST   /api/v1/auth/login
POST   /api/v1/auth/register
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
POST   /api/v1/auth/change-password
PUT    /api/v1/auth/profile
PUT    /api/v1/auth/avatar
```

**创建文件**：
- `internal/model/user.go` — User struct (映射 users 表)
- `internal/repository/user_repo.go` — FindByUsername, FindByEmail, UpdateLoginInfo
- `internal/dto/auth.go` — LoginRequest, LoginResponse, RegisterRequest, UserInfoVO
- `internal/service/auth_service.go` — Login, Register, RefreshToken, 密码校验
- `internal/service/session_service.go` — Redis 会话管理, Token 黑名单
- `internal/handler/auth_handler.go` — 8 个端点处理器
- `internal/middleware/jwt.go` — JWT 提取 (Header + Cookie 双源)
- `internal/middleware/ratelimit.go` — Redis Lua 脚本限流
- `internal/pkg/jwt/jwt.go` — Token 生成/验证

**关键实现**：
- bcrypt 密码哈希 (兼容 Java BCryptPasswordEncoder 生成的 hash)
- JWT HS256 签名，与 Java 端使用相同 secret
- Access Token → HttpOnly Cookie (path=/api, SameSite=Strict)
- Refresh Token → HttpOnly Cookie (path=/api/v1/auth)
- Redis 存储 Refresh Token (SHA-256 hash key, 7 天 TTL)
- 限流: login 10/60s per IP, register 5/600s per IP, change-password 5/300s per user
- Login 安全: 5 次失败锁定 15 分钟 (Redis 计数)

**验收标准**：
- [ ] 使用现有 admin/admin123 账号登录成功，返回 JWT Cookie
- [ ] 前端 Admin 无改动即可登录（Cookie 格式兼容）
- [ ] Refresh Token 轮换工作正常
- [ ] 密码错误 5 次后账号锁定 15 分钟
- [ ] 限流触发返回 429 + `{"code":429,"errorCategory":"too_many_requests"}`
- [ ] `GET /api/v1/auth/me` 用 Cookie 认证返回用户信息

---

## Phase 3: 简单 CRUD (29 endpoints)

**目标**：分类、标签、友链、站点设置、站点信息

**端点**：
```
# 分类 (Admin)
GET    /api/v1/admin/categories
GET    /api/v1/admin/categories/:id
POST   /api/v1/admin/categories
PUT    /api/v1/admin/categories/:id
DELETE /api/v1/admin/categories/:id

# 分类 (Public)
GET    /api/v1/public/categories

# 标签 (Admin)
GET    /api/v1/admin/tags
GET    /api/v1/admin/tags/:id
POST   /api/v1/admin/tags
PUT    /api/v1/admin/tags/:id
DELETE /api/v1/admin/tags/:id

# 友链 (Admin - 9 endpoints)
GET    /api/v1/admin/friend-links
GET    /api/v1/admin/friend-links/page
GET    /api/v1/admin/friend-links/:id
POST   /api/v1/admin/friend-links
PUT    /api/v1/admin/friend-links/:id
DELETE /api/v1/admin/friend-links/:id
DELETE /api/v1/admin/friend-links/batch
PATCH  /api/v1/admin/friend-links/:id/toggle-visible
PATCH  /api/v1/admin/friend-links/reorder

# 友链 (Public)
GET    /api/v1/public/friend-links

# 站点设置 (Admin)
GET    /api/v1/admin/settings
GET    /api/v1/admin/settings/group/:group
PATCH  /api/v1/admin/settings/batch
GET    /api/v1/admin/settings/:key
PUT    /api/v1/admin/settings/:key

# 站点信息 (Public)
GET    /api/v1/public/site/info
GET    /api/v1/public/site/stats
GET    /api/v1/public/site/author

# 系统时间
GET    /api/v1/admin/system/time
```

**创建文件**：
- `internal/model/category.go, tag.go, friend_link.go, site_setting.go`
- `internal/repository/category_repo.go, tag_repo.go, friend_link_repo.go, setting_repo.go`
- `internal/service/category_service.go, tag_service.go, friend_link_service.go, setting_service.go, site_service.go`
- `internal/handler/category_handler.go, tag_handler.go, friend_link_handler.go, setting_handler.go, site_handler.go, system_handler.go`
- `internal/dto/category.go, tag.go, friend_link.go, setting.go`

**关键实现**：
- Category 层级树查询 (parent_id 递归或 CTE SQL)
- Category/Tag slug 自动生成 + 唯一性校验
- Category/Tag postCount 缓存字段维护
- Friend Link 排序 (sortOrder 字段, batch reorder)
- Site Settings key-value 模式 (group 分组)
- 所有 Admin 端点需 JWT 中间件保护

**验收标准**：
- [ ] Admin 后台分类管理页面正常 CRUD
- [ ] Admin 后台标签管理页面正常 CRUD
- [ ] Admin 后台友链管理页面正常，拖拽排序工作
- [ ] Admin 后台站点设置页面读写正常
- [ ] Blog 前台首页能获取站点信息、分类列表、友链列表
- [ ] 删除有文章的分类返回业务错误

---

## Phase 4: 文章模块 (17 endpoints)

**目标**：最核心的文章 CRUD，包括复杂过滤、草稿、状态流转

**端点**：
```
# 文章 (Admin)
GET    /api/v1/admin/posts          # 复杂过滤: status/keyword/categoryId/tagId/viewCount/date/hidden
GET    /api/v1/admin/posts/:id
POST   /api/v1/admin/posts
PUT    /api/v1/admin/posts/:id
PATCH  /api/v1/admin/posts/:id/properties
POST   /api/v1/admin/posts/:id/auto-save
DELETE /api/v1/admin/posts/:id
PATCH  /api/v1/admin/posts/:id/publish

# 文章 (Public)
GET    /api/v1/public/posts
GET    /api/v1/public/posts/:slug
POST   /api/v1/public/posts/:slug/verify-password
GET    /api/v1/public/posts/category/:categoryId
GET    /api/v1/public/posts/tag/:tagId
GET    /api/v1/public/posts/:slug/adjacent

# 归档
GET    /api/v1/public/archives
GET    /api/v1/public/archives/stats
```

**创建文件**：
- `internal/model/post.go` — Post struct (所有字段映射)
- `internal/repository/post_repo.go` — 动态 SQL 构建器 (替代 JPA Specification)
- `internal/service/post_service.go` — 文章业务逻辑
- `internal/handler/post_handler.go` — Admin + Public 端点
- `internal/handler/archive_handler.go` — 归档端点
- `internal/dto/post.go` — CreatePostRequest, PostListResponse, PostDetailResponse, AdjacentPostResponse

**关键实现**：
- **动态过滤**：用 `strings.Builder` 构建 WHERE 子句 + 命名参数，替代 JPA Specification
  ```go
  // 9 个可选过滤参数: status, keyword, categoryId, tagId, minViewCount, maxViewCount, startDate, endDate, hidden
  func (r *PostRepo) FindForAdmin(ctx context.Context, filter PostFilter, page Pagination) (*PageResult[PostListResponse], error)
  ```
- **Slug 生成**：支持 CJK 字符的 URL-safe slug
- **草稿自动保存**：Redis key `post:draft:{id}`, 7 天 TTL
- **文章-标签关联**：post_tags 中间表操作 (事务)
- **相邻文章**：基于 publishedAt 的前后文章查询
- **密码保护文章**：bcrypt 验证，通过限流防暴力破解
- **归档**：GROUP BY date_trunc('month', published_at) 聚合

**验收标准**：
- [ ] Admin 文章列表页加载正常，9 个过滤条件单独和组合都正确
- [ ] 创建/编辑/删除文章工作正常
- [ ] 文章状态流转: DRAFT → PUBLISHED → ARCHIVED
- [ ] 草稿自动保存到 Redis，刷新页面能恢复
- [ ] Blog 前台文章列表分页正常
- [ ] Blog 前台文章详情页正确渲染 (slug 路由)
- [ ] 密码保护文章需要输入密码才能查看
- [ ] 归档按月分组统计正确
- [ ] 相邻文章导航正确

---

## Phase 5: 评论模块 (13 endpoints)

**目标**：评论系统含审核流程、嵌套回复、批量操作

**端点**：
```
# 评论 (Admin)
GET    /api/v1/admin/comments/pending
GET    /api/v1/admin/comments
GET    /api/v1/admin/comments/:id
PATCH  /api/v1/admin/comments/:id/approve
PATCH  /api/v1/admin/comments/:id/reject
PATCH  /api/v1/admin/comments/:id/spam
PATCH  /api/v1/admin/comments/:id/restore
DELETE /api/v1/admin/comments/:id
DELETE /api/v1/admin/comments/:id/permanent
DELETE /api/v1/admin/comments/batch
DELETE /api/v1/admin/comments/batch/permanent
PATCH  /api/v1/admin/comments/batch/approve

# 评论 (Public)
GET    /api/v1/public/comments/post/:postId
POST   /api/v1/public/comments/post/:postId
```

**创建文件**：
- `internal/model/comment.go`
- `internal/repository/comment_repo.go`
- `internal/service/comment_service.go`
- `internal/handler/comment_handler.go`
- `internal/dto/comment.go` — CreateCommentRequest

**关键实现**：
- 评论状态机: PENDING → APPROVED/REJECTED/SPAM, 支持 RESTORE
- 嵌套回复: parent_id 自引用, 查询时构建树结构
- 公开提交: IP + UserAgent 记录, 限流 5/60s per IP
- 批量操作: IN 子句批量 approve/delete
- 评论数缓存: 更新 post.comment_count

**验收标准**：
- [ ] Admin 评论管理页面正常：列表、审核、删除
- [ ] 批量审核/删除工作正常
- [ ] Blog 前台评论显示正确 (树结构)
- [ ] 访客提交评论后状态为 PENDING
- [ ] 评论限流正常工作

---

## Phase 6: 媒体系统 (33 endpoints)

**目标**：文件上传、文件夹管理、存储抽象、图像处理

**端点**：
```
# 媒体文件 (17 endpoints)
POST   /api/v1/admin/media/upload
POST   /api/v1/admin/media/upload/batch
GET    /api/v1/admin/media
GET    /api/v1/admin/media/stats
POST   /api/v1/admin/media/batch-move
DELETE /api/v1/admin/media/batch
GET    /api/v1/admin/media/trash
GET    /api/v1/admin/media/trash/count
POST   /api/v1/admin/media/trash/batch-restore
DELETE /api/v1/admin/media/trash/batch-permanent
DELETE /api/v1/admin/media/trash/empty
GET    /api/v1/admin/media/:id
PUT    /api/v1/admin/media/:id
DELETE /api/v1/admin/media/:id
POST   /api/v1/admin/media/:id/move
POST   /api/v1/admin/media/:id/restore
DELETE /api/v1/admin/media/:id/permanent

# 文件夹 (7 endpoints)
GET    /api/v1/admin/media/folders/tree
GET    /api/v1/admin/media/folders/:id
GET    /api/v1/admin/media/folders/:id/children
POST   /api/v1/admin/media/folders
PUT    /api/v1/admin/media/folders/:id
DELETE /api/v1/admin/media/folders/:id
POST   /api/v1/admin/media/folders/:id/move

# 存储提供商 (7 endpoints)
GET    /api/v1/admin/storage/providers
GET    /api/v1/admin/storage/providers/:id
GET    /api/v1/admin/storage/providers/default
POST   /api/v1/admin/storage/providers
PUT    /api/v1/admin/storage/providers/:id
DELETE /api/v1/admin/storage/providers/:id
POST   /api/v1/admin/storage/providers/:id/set-default
POST   /api/v1/admin/storage/providers/:id/test

# 静态文件服务
GET    /api/uploads/*  (Echo Static 中间件)
```

**创建文件**：
- `internal/model/media.go` — MediaFile, MediaFolder, MediaVariant, StorageProvider
- `internal/repository/media_repo.go, folder_repo.go, storage_provider_repo.go`
- `internal/service/media_service.go, folder_service.go, storage_provider_service.go`
- `internal/handler/media_handler.go, folder_handler.go, storage_provider_handler.go`
- `internal/pkg/storage/storage.go` — Storage interface
- `internal/pkg/storage/local.go, minio.go, s3.go` — 各实现
- `internal/pkg/imgproc/imgproc.go` — 缩略图、WebP 转换

**关键实现**：
- **文件上传**：Echo `c.FormFile()`, 10GB 上限, 流式写入存储
- **存储抽象**：`Storage` interface { Upload, Download, Delete, GetURL }
- **软删除**：deleted + deleted_at 字段，120 天后清理
- **文件夹树**：递归查询或 path 前缀匹配
- **图像处理**：`disintegration/imaging` 生成缩略图

**验收标准**：
- [ ] Admin 媒体库上传/浏览/删除正常
- [ ] 文件夹创建/移动/删除正常
- [ ] 回收站功能正常 (软删除 → 恢复 → 永久删除)
- [ ] 批量操作正常
- [ ] 本地存储和 MinIO 存储切换正常
- [ ] 上传图片自动生成缩略图
- [ ] `/api/uploads/` 静态文件可访问

---

## Phase 7: 统计与分析 (10 endpoints)

**目标**：仪表盘数据、访问追踪、活动事件

**端点**：
```
# Dashboard
GET    /api/v1/admin/stats/dashboard
GET    /api/v1/admin/stats/top-posts
GET    /api/v1/admin/stats/visitor-trend
GET    /api/v1/admin/stats/archives
GET    /api/v1/admin/stats/ai-dashboard

# 访客追踪
POST   /api/v1/public/visit
GET    /api/v1/public/visit/today

# 活动事件
GET    /api/v1/admin/activities/recent
GET    /api/v1/admin/activities
GET    /api/v1/admin/activities/user/:userId
```

**创建文件**：
- `internal/model/visit.go, daily_stats.go, activity_event.go, ai_usage_log.go`
- `internal/repository/visit_repo.go, stats_repo.go, activity_repo.go, ai_usage_repo.go`
- `internal/service/analytics_service.go, stats_service.go, activity_service.go, visitor_service.go`
- `internal/handler/stats_handler.go, visitor_handler.go, activity_handler.go`

**关键实现**：
- **异步访问记录**：goroutine channel 缓冲写入，不阻塞请求
- **Dashboard 聚合**：多表 JOIN + GROUP BY SQL
- **AI 分析**：聚合 ai_usage_logs 表
- **活动事件**：使用 JSONB metadata 字段
- **设备/浏览器解析**：User-Agent 解析

**验收标准**：
- [ ] Admin Dashboard 页面数据加载正常
- [ ] 访客趋势图数据正确
- [ ] Top Posts 排序正确
- [ ] 活动事件列表正常
- [ ] 访问记录异步写入不影响接口延迟

---

## Phase 8: AI 代理 (15 endpoints)

**目标**：HTTP 代理到 FastAPI AI 服务，含 SSE 流式响应

**端点**：
```
POST   /api/v1/admin/ai/summary
POST   /api/v1/admin/ai/summary/stream     # SSE
POST   /api/v1/admin/ai/tags
POST   /api/v1/admin/ai/titles
POST   /api/v1/admin/ai/polish
POST   /api/v1/admin/ai/outline
POST   /api/v1/admin/ai/translate
GET    /api/v1/admin/ai/health
GET    /api/v1/admin/ai/prompts/:taskType
GET    /api/v1/admin/ai/prompts
PUT    /api/v1/admin/ai/prompts/:taskType
GET    /api/v1/admin/ai/tasks
POST   /api/v1/admin/ai/tasks
PUT    /api/v1/admin/ai/tasks/:code
DELETE /api/v1/admin/ai/tasks/:code
```

**创建文件**：
- `internal/service/ai_client.go` — HTTP 客户端到 FastAPI
- `internal/service/ai_service.go` — AI 业务逻辑 + 用量记录
- `internal/handler/ai_handler.go` — 15 个端点
- `internal/dto/ai.go` — 请求/响应 DTOs
- `internal/model/ai_task_type.go, ai_prompt.go`
- `internal/repository/ai_repo.go` — prompt/task CRUD

**关键实现**：
- **HTTP 代理**：`net/http.Client` 转发到 `http://localhost:8000`
- **SSE 流式**：
  ```go
  c.Response().Header().Set("Content-Type", "text/event-stream")
  c.Response().Header().Set("Cache-Control", "no-cache")
  // 逐行读取 AI 服务响应，用 Flusher 推送
  flusher := c.Response().Flush
  ```
- **用量日志**：每次 AI 调用写入 ai_usage_logs
- **超时配置**：普通请求 30s，流式请求 300s
- **Token 转发**：JWT Bearer Token 传递给 FastAPI

**验收标准**：
- [ ] Admin AI 摘要生成正常 (同步 + 流式)
- [ ] AI 标签提取、标题建议、内容润色正常
- [ ] SSE 流式响应前端实时显示
- [ ] AI 服务不可用时优雅降级
- [ ] 用量统计正确记录

---

## Phase 9: 系统监控 (15 endpoints)

**目标**：系统指标、容器监控、日志查看

**端点**：
```
GET    /api/v1/admin/system/metrics
GET    /api/v1/admin/system/storage
GET    /api/v1/admin/system/health
GET    /api/v1/admin/system/overview
GET    /api/v1/admin/system/containers
GET    /api/v1/admin/system/containers/:id/logs
GET    /api/v1/admin/system/logs
GET    /api/v1/admin/system/logs/files
GET    /api/v1/admin/system/logs/download
POST   /api/v1/admin/system/network/test
GET    /api/v1/admin/system/history
GET    /api/v1/admin/system/history/stats
DELETE /api/v1/admin/system/history
GET    /api/v1/admin/system/alerts
GET    /api/v1/admin/system/config
```

**创建文件**：
- `internal/service/system_monitor.go` — Go runtime metrics (替代 JVM metrics)
- `internal/service/container_monitor.go` — Docker API 交互
- `internal/service/log_viewer.go` — 日志文件读取
- `internal/service/metrics_history.go` — 内存环形缓冲区
- `internal/handler/system_monitor_handler.go`

**关键实现**：
- **Go Runtime Metrics**：`runtime.MemStats`, `runtime.NumGoroutine()`, CPU via `/proc`
- **Docker API**：通过 Unix socket `/var/run/docker.sock`
- **日志查看**：`os.Open` + `bufio.Scanner` + cursor 分页
- **指标历史**：goroutine 定时采集，环形缓冲区存储

**验收标准**：
- [ ] Admin 系统监控页面显示 Go 进程指标
- [ ] 容器列表和日志正常
- [ ] 日志查看功能正常 (关键字过滤、分页)
- [ ] 指标历史趋势图正常

---

## Phase 10: 集成与部署 (1 endpoint + 全面验证)

**目标**：VanBlog 导入、E2E 测试、Docker 部署、性能基准

**端点**：
```
POST   /api/v1/admin/migrations/vanblog/import
```

**任务清单**：

### 10.1 VanBlog 导入
- `internal/handler/migration_handler.go`
- `internal/service/vanblog_import.go` — JSON 解析、数据映射、事务导入

### 10.2 E2E 测试套件
- `tests/auth_test.go` — 登录流程
- `tests/post_test.go` — 文章 CRUD 完整流程
- `tests/media_test.go` — 文件上传
- `tests/ai_test.go` — AI 代理 (mock FastAPI)
- 使用 `httptest` + 真实数据库 (Docker Compose test env)

### 10.3 API 契约验证
- 录制 Java 后端所有端点的请求/响应快照
- Go 服务对相同请求生成响应
- 逐字段对比 JSON 结构 (忽略 timestamp/traceId)

### 10.4 生产 Docker 配置
- `apps/server-go/Dockerfile`:
  ```dockerfile
  FROM golang:1.23-alpine AS builder
  WORKDIR /app
  COPY go.mod go.sum ./
  RUN go mod download
  COPY . .
  RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

  FROM scratch
  COPY --from=builder /app/server /server
  COPY --from=builder /app/migrations /migrations
  COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
  EXPOSE 8080
  ENTRYPOINT ["/server"]
  ```
- 更新 `docker-compose.prod.yml`: 替换 backend 服务
- 更新 `docker-build.sh`: backend 构建改为 Go
- 更新 `start.sh` / `stop.sh`

### 10.5 前端小幅调整 (如需)
- 检查前端是否依赖 Java 特有的响应格式
- 调整 AI service 的 SSE 解析（如果 Go 的 event 格式略有不同）
- 验证 Cookie 路径和域名兼容

### 10.6 性能基准
```
wrk -t4 -c100 -d30s http://localhost:8080/api/v1/public/posts
```

**验收标准**：

| 指标 | Java (当前) | Go (目标) | 验收通过 |
|------|------------|-----------|---------|
| 构建时间 | 1-3 min | < 10s | [ ] |
| Docker 镜像 | 350 MB | < 30 MB | [ ] |
| 启动时间 | 5-15s | < 100ms | [ ] |
| 空闲内存 | 300-500 MB | < 50 MB | [ ] |
| API p99 延迟 | 20-50ms | < 5ms | [ ] |
| QPS (简单 CRUD) | ~1000 | > 10000 | [ ] |

- [ ] 所有 118+ 端点通过 API 契约测试
- [ ] Admin 后台所有页面功能正常
- [ ] Blog 前台所有页面功能正常
- [ ] 文件上传/下载正常
- [ ] AI 流式响应正常
- [ ] Docker Compose 一键部署成功
- [ ] `./start.sh` 和 `./start.sh --prod` 工作正常

---

## 执行顺序与依赖关系

```
Phase 1 (脚手架)
    ↓
Phase 2 (认证) ← 所有 Admin 端点依赖
    ↓
Phase 3 (简单 CRUD) ← 文章依赖分类/标签
    ↓
Phase 4 (文章) ← 核心业务，评论/统计依赖
    ↓
Phase 5 (评论)     Phase 6 (媒体)     ← 可并行开发
    ↓                   ↓
Phase 7 (统计)     Phase 8 (AI代理)   ← 可并行开发
    ↓                   ↓
Phase 9 (系统监控)
    ↓
Phase 10 (集成部署)
```

**关键路径**：Phase 1 → 2 → 3 → 4 → 10

## 需要删除的 Java 代码 (Phase 10 完成后)

- `apps/server/` — 整个 Java 后端目录
- 更新 `CLAUDE.md` 中的后端相关文档
- 更新 `docker-build.sh` 中的 backend 构建命令
- 更新 `docker-compose.prod.yml` 中的 backend 服务定义
