# 🏗 系统架构

本文档介绍 AetherBlog 的整体架构、模块划分、技术选型及数据流转。

> 返回 [项目主页](../README.md) · 查看 [开发指南](./development.md) · 查看 [部署指南](./deployment.md)

---

## 目录

- [架构概览](#架构概览)
- [Monorepo 结构](#monorepo-结构)
- [后端架构](#后端架构)
- [AI 服务架构](#ai-服务架构)
- [前端架构](#前端架构)
- [API 设计](#api-设计)
- [数据流](#数据流)
- [部署与发布链路](#部署与发布链路)
- [技术选型](#技术选型)

---

## 架构概览

AetherBlog 采用微服务 + Monorepo 架构，由 5 个核心服务协同工作：

```
                    ┌──────────────────────────────────────────┐
                    │           Nginx Gateway (:7899)          │
                    └──────┬──────────┬──────────┬─────────────┘
                           │          │          │
                    ┌──────▼───┐ ┌────▼────┐ ┌───▼──────────┐
                    │  Blog    │ │  Admin  │ │   Backend    │
                    │ Next.js  │ │  Vite   │ │  Go (Echo)   │
                    │  :3000   │ │  :5173  │ │   :8080      │
                    └──────────┘ └────┬────┘ └──┬───────────┘
                                      │         │
                                      │    ┌────▼────────┐
                                      │    │ AI Service  │
                                      │    │  FastAPI    │
                                      │    │   :8000     │
                                      │    └──┬──────────┘
                                      │       │
                              ┌───────▼───────▼──────────┐
                              │     PostgreSQL + pgvector │
                              │          Redis           │
                              └──────────────────────────┘
```

| 服务 | 技术栈 | 职责 |
|------|--------|------|
| **Blog** | Next.js 15 + React 19 | 博客前台，SSR 渲染，SEO |
| **Admin** | Vite + React 19 | 管理后台，内容管理，AI 写作工具 |
| **Backend** | Go 1.24 (Echo) | 业务 API，认证授权，数据持久化 |
| **AI Service** | FastAPI + LiteLLM | AI 写作辅助，语义搜索，多模型路由 |
| **Gateway** | Nginx | 请求路由，静态资源代理，SSL 终止 |

---

## Monorepo 结构

项目使用 **pnpm workspace** 管理前端代码，**Go module** 管理后端代码：

```
AetherBlog/
├── apps/
│   ├── blog/                    # 📝 博客前台 (Next.js 15)
│   ├── admin/                   # ⚙️ 管理后台 (Vite + React 19)
│   ├── ai-service/              # 🤖 AI 服务 (FastAPI + LiteLLM)
│   └── server-go/               # 🔧 后端服务 (Go + Echo)
│       ├── cmd/server/           #    应用启动入口 (main.go)
│       ├── cmd/migrate/          #    数据库迁移工具
│       ├── internal/
│       │   ├── config/           #    配置加载与管理
│       │   ├── handler/          #    HTTP 请求处理器（控制层）
│       │   ├── service/          #    业务逻辑层
│       │   ├── repository/       #    数据访问层（数据库操作）
│       │   ├── model/            #    数据模型定义
│       │   ├── dto/              #    请求/响应 DTO
│       │   ├── middleware/       #    中间件（JWT、CORS、限流）
│       │   ├── server/           #    HTTP 服务器初始化与路由
│       │   └── pkg/              #    内部公共工具包
│       └── migrations/           #    SQL 迁移文件
├── packages/
│   ├── ui/                      # 🎨 共享 UI 组件
│   ├── hooks/                   # 🪝 共享 React Hooks
│   ├── types/                   # 📋 TypeScript 类型定义
│   ├── utils/                   # 🔧 工具函数
│   └── editor/                  # ✏️ Markdown 编辑器
├── docs/                        # 📚 项目文档
├── nginx/                       # 🌐 Nginx 配置
├── ops/                         # 🔩 运维脚本
└── .github/workflows/           # 🔄 CI/CD 工作流
```

---

## 后端架构

### 模块依赖

```
cmd/server/main.go（Go 可执行入口）
    │
    ├── internal/server（路由注册、服务器初始化）
    │       │
    │       ├── internal/handler（HTTP 请求处理器）
    │       │       │
    │       │       ├── internal/service（业务逻辑层）
    │       │       │       │
    │       │       │       ├── internal/repository（数据访问层）
    │       │       │       │       │
    │       │       │       │       └── internal/model（数据模型）
    │       │       │       │
    │       │       │       └── internal/pkg/*（工具函数）
    │       │       │
    │       │       └── internal/dto（请求/响应 DTO）
    │       │
    │       └── internal/middleware（JWT、CORS、限流等）
    │
    └── internal/config（配置加载）
```

### 分层职责

| 层级 | 模块 | 职责 |
|------|------|------|
| **入口层** | `cmd/server` | main.go 启动入口、配置加载 |
| **服务器层** | `internal/server` | HTTP 服务器初始化、路由注册 |
| **接口层** | `internal/handler` + `internal/dto` | HTTP 请求处理、请求/响应 DTO |
| **业务层** | `internal/service` | 核心业务逻辑 |
| **数据层** | `internal/repository` + `internal/model` | 数据库访问、数据模型 |
| **中间件层** | `internal/middleware` | JWT 认证、CORS、限流 |
| **基础层** | `internal/pkg/*` | 分页、响应格式、JWT 工具、图片处理、存储 |
| **配置层** | `internal/config` | 配置管理（koanf） |

### 核心 Handler（24 个）

| Handler | 路径前缀 | 功能 | 路由示例 |
|-----------|----------|------|---------|
| `AuthHandler` | `/v1/auth` | 登录 / JWT 认证 / 个人设置 | POST /v1/auth/login, GET /v1/auth/me, PUT /v1/auth/profile |
| `PostHandler` | `/v1/admin/posts` + `/v1/public/posts` | 文章 CRUD / 自动保存 / 发布 / 属性更新；公开 5 路由 + 密码验证 | PATCH /v1/admin/posts/:id/publish |
| `CategoryHandler` | `/v1/admin/categories` + `/v1/public/categories` | 分类管理 | GET/POST/PUT/DELETE |
| `TagHandler` | `/v1/admin/tags` + `/v1/public/tags` | 标签管理 | GET/POST/PUT/DELETE |
| `CommentHandler` | `/v1/admin/comments` + `/v1/public/comments` | 评论审核 / 批量操作 / 垃圾标记；公开评论列表 + 提交（限流） | PATCH .../approve, PATCH .../spam |
| `MediaHandler` | `/v1/admin/media` | 媒体库 / 单个+批量上传 / 回收站 / 内容更新 | POST /v1/admin/media/upload |
| `FolderHandler` | `/v1/admin/folders` | 文件夹树 / 层级 / 移动 | GET /v1/admin/folders/tree |
| `PermissionHandler` | `/v1/admin/folders/*/permissions` | 文件夹权限 ACL | GET/POST/PUT/DELETE |
| `ShareHandler` | `/v1/admin/shares` | 文件/文件夹分享链接管理 | POST .../file/:fileId, POST .../folder/:folderId |
| `StatsHandler` | `/v1/admin/stats` | 统计仪表盘 / 访客趋势 / AI 分析 | GET .../dashboard, .../ai-dashboard, .../ai-pricing-gaps |
| `AiHandler` | `/v1/admin/ai` | AI 写作辅助（6 工具 + stream）/ Prompt 配置 / 任务配置 / 供应商代理 | POST .../summary/stream |
| `SystemMonitorHandler` | `/v1/admin/monitor` | 系统指标 / 容器 / 日志 / 告警 / 历史 | GET .../overview, .../containers/:id/logs |
| `SiteHandler` | `/v1/admin/site` | 站点信息 / 统计 / 作者 | GET .../info, .../stats, .../author |
| `SiteSettingHandler` | `/v1/admin/settings` | 站点设置 CRUD / 分组查询 / 批量更新 | GET .../group/:group, PATCH .../batch |
| `FriendLinkHandler` | `/v1/admin/friends` + `/v1/public/friends` | 友链 CRUD / 排序 / 可见切换 / 分页 | PATCH .../toggle-visible, .../reorder |
| `ActivityHandler` | `/v1/admin/activities` | 操作活动事件流 | GET .../recent, GET /, GET .../user/:userId |
| `StorageProviderHandler` | `/v1/admin/storage` | 存储提供商 / 默认设置 / 连接测试 | POST .../:id/test, POST .../:id/set-default |
| `ArchiveHandler` | `/v1/public/archives` | 归档列表 / 统计 | GET .../stats |
| `MigrationHandler` | `/v1/admin/migration` | Vanblog 数据导入 | POST .../vanblog/import |
| `MediaTagHandler` | `/v1/admin/media-tags` | 媒体标签 CRUD + 热门 + 搜索 + 批量；文件标签关联 | GET .../popular, POST .../batch |
| `SystemHandler` | `/v1/system` | 系统时间 | GET .../time |
| `VisitorHandler` | `/v1/admin/visitors` | 访客记录 / 今日统计 | POST /, GET .../today |
| `VersionHandler` | `/v1/admin/files/:fileId/versions` | 文件版本历史 / 回滚 / 删除 | POST .../versions/:num/restore |
| `SearchHandler` | `/v1/public/search` + `/v1/admin/search` | 混合搜索 / 语义搜索 / QA（SSE）/ 配置 / 索引管理 | GET .../search, GET .../qa |

---

## AI 服务架构

AI 服务作为独立微服务运行，通过 HTTP API 与后端通信：

```
┌─────────────────────────────────────────────────┐
│                  AI Service                     │
│                                                 │
│  ┌───────────┐   ┌──────────────┐              │
│  │  FastAPI   │──▶│  LLM Router  │              │
│  │  Routes    │   │  (LiteLLM)   │              │
│  └─────┬─────┘   └──────┬───────┘              │
│        │                 │                       │
│  ┌─────▼─────┐   ┌──────▼───────┐              │
│  │  Cache     │   │  Provider    │              │
│  │  (Redis)   │   │  Registry    │              │
│  └───────────┘   └──────┬───────┘              │
│                          │                       │
│                  ┌───────▼──────────┐           │
│                  │ OpenAI / DeepSeek│           │
│                  │ / 通义千问 / ...  │           │
│                  └──────────────────┘           │
│                                                 │
│  ┌───────────┐   ┌──────────────┐              │
│  │ Vector     │   │  Metrics     │              │
│  │ Store      │──▶│  Store       │              │
│  │ (pgvector) │   │  (Usage Log) │              │
│  └───────────┘   └──────────────┘              │
└─────────────────────────────────────────────────┘
```

### AI 能力

| 能力 | 端点 | 流式版本 | 说明 |
|------|------|---------|------|
| 内容摘要 | `POST /api/v1/ai/summary` | `/summary/stream` | 自动生成文章摘要 |
| 标题建议 | `POST /api/v1/ai/titles` | `/titles/stream` | 智能标题推荐 |
| 标签提取 | `POST /api/v1/ai/tags` | `/tags/stream` | 关键词 / 标签生成 |
| 内容润色 | `POST /api/v1/ai/polish` | `/polish/stream` | AI 文本优化 |
| 大纲生成 | `POST /api/v1/ai/outline` | `/outline/stream` | 文章结构规划 |
| 翻译 | `POST /api/v1/ai/translate` | `/translate/stream` | 多语言翻译 |
| 语义搜索 | `GET /api/v1/search/semantic` | — | 基于 pgvector 的内容检索 |
| 索引构建 | `POST /api/v1/admin/search/index` | — | 主动触发向量索引 |
| 全量重建 | `POST /api/v1/admin/search/reindex` | — | 全量重建向量索引 |
| 健康检查 | `GET /api/v1/health` | — | 服务状态 + 供应商连通性 |
| 使用指标 | `GET /api/v1/admin/metrics/ai` | — | 用量 / 成本统计（管理员） |
| Prompt 管理 | `CRUD /api/v1/admin/prompts` | — | Prompt 模板版本管理 |
| 任务配置 | `CRUD /api/v1/admin/tasks` | — | AI 任务路由配置 |
| 供应商代理 | `ANY /v1/admin/ai/providers/*` | — | Go 后端代理到 FastAPI |

所有写作类端点同时支持普通响应和 SSE 流式响应（`/stream` 后缀），前端使用 `fetch` + `ReadableStream` 解析。

#### 流式事件协议（SSE）

每个 `data: {...}\n\n` 行的 JSON 载荷遵循下列四种类型：

| 类型 | 形状 | 说明 |
|------|------|------|
| `delta` | `{type:"delta", content:string, isThink?:boolean}` | 增量文本片段。`isThink=true` 表示处于 `<think>` 块内。 |
| `result` | `{type:"result", data:<TaskData>}` | **结构化终稿**（在 `done` 之前发送一次）。`data` 形状与对应的非 stream 响应 DTO 一致：summary→`SummaryData`、tags→`TagsData`、titles→`TitlesData`、polish→`PolishData`、outline→`OutlineData`、translate→`TranslateData`。前端应优先消费此字段而非重新解析 `delta` 文本。 |
| `done` | `{type:"done"}` | 流结束标记。 |
| `error` | `{type:"error", code:string, message:string}` | 流中途失败。 |

前端 hook `useStreamResponse` 已内置对这四种事件的处理；tags/titles 等结构化工具的"应用到文章"按钮完全基于 `result` payload 工作，无需客户端做正则/分隔符解析。

### 支持的 LLM 供应商

| 供应商 | 接入方式 | 说明 |
|--------|---------|------|
| OpenAI | 原生 API | GPT 系列，内容润色 |
| Anthropic | 原生 API | Claude 系列，长文改写 |
| Google | 原生 API | Gemini 系列，大纲 / 长文摘要 |
| Azure OpenAI | LiteLLM 路由 | 企业级部署 |
| LiteLLM | 统一代理 | 多供应商兼容路由 |
| Custom | OpenAI 协议兼容 | 可插拔私有模型 |

### 速率限制策略

- 用户级：10 次 / 分钟 / 操作
- 全局级：100 次 / 分钟
- 缓存：summary/tags 缓存 24h，titles 缓存 1h（Redis）
- **Redis 不可达时默认拒绝（503）**(VULN-070)；开发/CI 可通过 `AI_RATE_LIMIT_FAIL_OPEN=true` 翻转，生产保持 false 防止 Redis 宕机导致 wallet-drain 攻击。

### 凭证加密与密钥管理

| 能力 | 配置项 | 说明 |
|---|---|---|
| 供应商 API Key 加密 | `AI_CREDENTIAL_ENCRYPTION_KEYS` (**VULN-056**) | 独立于 `JWT_SECRET`，支持逗号分隔多 key；第一个 key 加密新数据，所有 key 参与解密（MultiFernet 零停机轮换） |
| Base64url padding 自愈 | `config._pad_b64url` | Fernet key 标准 44 字符末尾 `=`，常见运维事故是 `.env` 复制粘贴 / shell env 解析器吞掉结尾 `=` 变成 43 字符；validator 自动补齐到 4 字节边界，字节数真错时带长度提示报错 |
| JWT 签名密钥轮换 | `jwt_secrets` 表 + migration 000033 | current 签名、current+previous 参与验签、retired 归档；Go 后端 `StartRotator` goroutine 按 `AETHERBLOG_JWT_ROTATION_INTERVAL` (默认 7d) 自动轮换；ai-service `app/core/jwt_keys.py` 后台任务每 60s 从同表同步 |
| 手动紧急轮换 | `POST /v1/admin/auth/rotate-jwt-secret` | VULN-152 类历史泄露应急用 |

### ai-service 冷启动与健康探活

Python 容器启动需要完成：
1. 导入 litellm / asyncpg / pgvector / FastAPI 等大型依赖 (~10s 慢机)
2. FastAPI lifespan 里 `asyncpg.create_pool(min_size=1)` 首连 (~3s)
3. `jwt_keys` 后台任务首次 DB 拉取 (~1s)

整段在慢机 / 冷 cache 上可超过 60s。`docker-compose.prod.yml` ai-service healthcheck 配置：

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  start_period: 45s   # 窗口内失败不计 retries,避免 CI preflight 误判
  interval: 10s
  timeout: 5s
  retries: 3
```

`ops/release/preflight.sh` 同步扩大 ai-service 健康检查重试窗口到 24 次 × 5s (~120s)，以 `docker inspect` 健康状态或容器内 curl 任一成立为通过。

---

## 前端架构

### 博客前台 (Next.js 15)

- **App Router** — 基于文件系统的路由
- **SSR / SSG** — 服务端渲染与静态生成结合
- **React 19** — 最新 React 特性
- **Rich Markdown** — Shiki 语法高亮 + KaTeX 数学公式 + Mermaid 图表

### 管理后台 (Vite + React 19)

- **SPA 架构** — 客户端渲染
- **Zustand** — 状态管理
- **React Router** — 客户端路由
- **Zod** — 表单验证
- **CodeMirror** — Markdown 编辑器核心
- **Framer Motion** — 动画交互

#### 主要页面模块（17+ 主页面）

| 页面 | 路径 | 说明 |
|------|------|------|
| `DashboardPage` | `/dashboard` | 数据概览 / 近期活动 / AI 使用趋势 |
| `PostsPage` | `/posts` | 文章列表 |
| `CreatePostPage` | `/posts/create` | 新建文章（AI 写作工作台） |
| `EditPostPage` | `/posts/:id/edit` | 编辑文章 |
| `AiWritingWorkspacePage` | `/posts/ai-workspace` | AI 辅助写作工作区 |
| `CategoriesPage` | `/categories` | 分类管理 |
| `CommentsPage` | `/comments` | 评论审核（pending/spam） |
| `MediaPage` | `/media` | 媒体库 + 文件夹树 + 标签 + 版本 |
| `FriendsPage` | `/friends` | 友链管理（拖拽排序） |
| `MonitorPage` | `/monitor` | 系统监控（指标 / 容器 / 日志） |
| `SettingsPage` | `/settings` | 站点设置（分组）+ 存储提供商 |
| `AnalyticsPage` | `/analytics` | 数据统计分析 |
| `ActivitiesPage` | `/activities` | 操作活动事件流 |
| `AIToolsPage` | `/ai-tools` | AI 写作工具集入口 |
| `AiConfigPage` | `/ai-config` | AI 配置中心（供应商 / 模型 / 凭证 / Prompt / 任务） |
| `SearchConfigPage` | `/search-config` | 搜索功能配置 |
| `MigrationPage` | `/migration` | Vanblog 数据导入 |
| `AiTestPage` | `/ai-test` | AI 接口调试 |

AI 工具子页面：`SummaryPage`, `TaggerPage`, `ContentRewriterPage`, `SeoOptimizerPage`, `QAPage`, `TextCleanerPage`

### 共享包

```
packages/
├── ui/       →  Button, Card, Input, Modal, ConfirmModal, Toast, Avatar, Badge, Tag,
│                 Skeleton, Dropdown, Tooltip, Textarea, Toggle + cn()
├── hooks/    →  useDebounce, useThrottle, useMediaQuery, useTheme, useClickOutside,
│                 useScrollLock, useLocalStorage, useSessionStorage, ... (16 hooks + ThemeToggle)
├── types/    →  api/ (request, response, error), models/ (post, user, comment, media, friendLink),
│                 ai/ (prompt, completion)
├── utils/    →  format/ (date, number, string, duration), url/ (queryString, slug, UrlBuilder),
│                 helpers/ (deepClone, retry, omit, pick, uuid), validation/ (email, url, password),
│                 storage/ (IndexedDB), color.ts (theme CSS vars)
└── editor/   →  MarkdownEditor, MarkdownPreview, EditorWithPreview, UploadProgress,
                  ImageSizePopover + hooks (useEditorCommands, useTableCommands, useImageUpload)
```

---

## API 设计

### 路由规范

| 类型 | 前缀 | 说明 | 鉴权 |
|------|------|------|------|
| 认证 | `/v1/auth/*` | 登录 / 注册 | 否 |
| 公开 | `/v1/public/*` | 面向访客的内容 API | 否 |
| 管理 | `/v1/admin/*` | 后台管理 API | JWT |
| AI | `/api/v1/ai/*` | AI 服务代理 | JWT |

### 通用响应格式

```json
{
  "code": 200,
  "message": "success",
  "data": { ... }
}
```

---

## 数据流

### 文章发布流程

```
Admin Editor ──POST──▶ Backend API ──persist──▶ PostgreSQL
                              │
                              ├──cache──▶ Redis
                              │
                              └──index──▶ Elasticsearch (可选)
```

### AI 写作辅助流程

```
Admin Editor ──request──▶ Backend API ──proxy──▶ AI Service
                                                     │
                                                     ├── LiteLLM ──▶ LLM Provider
                                                     ├── Cache (Redis)
                                                     └── Usage Log (PostgreSQL)
                                                     │
Admin Editor ◀──SSE stream──────────────────────────┘
```

### 访客阅读流程

```
Browser ──GET──▶ Next.js (SSR) ──fetch──▶ Backend API ──query──▶ PostgreSQL
                     │
                     └── 渲染 HTML + Markdown → 返回完整页面
```

---

## 数据库表结构

数据库共 28 个迁移（000001–000028），创建以下主要表：

### 核心业务表

| 表名 | 说明 |
|------|------|
| `posts` | 文章（含 is_hidden / source_key / legacy_* / preserve_updated_at） |
| `users` | 用户账户 |
| `comments` | 评论 |
| `categories` | 分类 |
| `tags` | 标签 |
| `post_categories` | 文章-分类多对多 |
| `post_tags` | 文章-标签多对多 |
| `visit_records` | 访问记录 |

### 媒体表

| 表名 | 说明 |
|------|------|
| `media_files` | 媒体文件（含文件夹 / 存储提供商关联） |
| `media_folders` | 文件夹层级（物化路径） |
| `media_tags` | 媒体标签定义 |
| `media_file_tags` | 文件-标签多对多（含来源：MANUAL/AI_AUTO） |
| `media_variants` | 图像变体（缩略图 / WEBP 等） |

### AI 表

| 表名 | 说明 |
|------|------|
| `ai_providers` | AI 供应商注册 |
| `ai_models` | 模型清单（含类型 / 能力） |
| `ai_credentials` | 供应商凭证（加密存储） |
| `ai_task_types` | AI 任务类型定义（摘要 / 标签等） |
| `ai_task_routing` | 任务到模型的路由映射 |
| `ai_usage_logs` | 使用日志（tokens / latency / cached） |
| `ai_vector_store` | 向量检索存储（pgvector） |

### 其他表

| 表名 | 说明 |
|------|------|
| `site_settings` | 站点设置（分组键值对） |
| `social_links` | 社交链接 |
| `friend_links` | 友链（含排序 / 状态） |
| `storage_providers` | 云存储提供商配置 |
| `permissions` | 文件夹 ACL 权限记录 |
| `shared_items` | 分享链接（含令牌 / 过期时间） |
| `activity_events` | 操作活动事件流 |

---

## 部署与发布链路

生产部署由 **GitHub Actions → Webhook → deploy.sh → Preflight** 五阶段自动化完成，服务器端零人工介入。**详细的故障排查、部署模式、手动触发方式见 [部署指南](./deployment.md#cicd-自动化发布链路)**。

### 发布触发链

```
┌──────────────────┐   push / release    ┌──────────────────────┐
│  GitHub Actions  │ ──────────────────▶ │ ci-cd.yml            │
│  (.github/wf)    │                     │ build & push images  │
└──────────────────┘                     └──────────┬───────────┘
                                                    │ HMAC-SHA256
                                                    │ 签名 POST /deploy
                                                    ▼
┌─────────────────────────────────────────────────────────────┐
│  服务器 (deploy-webhook.service)                             │
│                                                              │
│  webhook_server.py                                           │
│      │  校验签名 → fork deploy.sh → 返回 202                 │
│      ▼                                                       │
│  deploy.sh  (ops/webhook/)                                   │
│      ├─ flock  /var/lock/aetherblog-deploy.lock              │
│      ├─ git fetch + reset --hard FETCH_HEAD  ← 代码自拉取    │
│      ├─ self-reexec (脚本自身变更时)                         │
│      ├─ strict KEY=VALUE 解析 .env                           │
│      ├─ docker compose pull                                  │
│      ├─ pre-deploy migration  (compose run --rm)             │
│      └─ docker compose up -d                                 │
│              │                                               │
│              ▼                                               │
│  ops/release/preflight.sh                                    │
│      ├─ static: compose config / 必备命令                    │
│      └─ runtime: 服务 running / 迁移版本 / gateway 健康 /    │
│                  ai-service 健康 (≤120s) / auth 生效 /       │
│                  ai_providers 计数 ≥60 / ai_models ≥1500 /   │
│                  backend 日志无 schema 错误 / logs 目录可读  │
└─────────────────────────────────────────────────────────────┘
```

### 部署模式

四种模式由 `DEPLOY_MODE` 环境变量切换：

| 模式 | 用例 | Migration 行为 | 中间件 |
|---|---|---|---|
| `full` | 首次发布 / 全量升级（默认） | 总是执行 | 保留运行 |
| `incremental` | 只改部分服务 (`DEPLOY_SERVICES="backend"`) | 前端-only 自动跳过 | 不重启 |
| `canary` | 核心服务先升 (`CANARY_SERVICES=backend,ai-service`) | 执行 | 保留运行 |
| `rollback` | 紧急回滚 (`ROLLBACK_VERSION=v1.1.0`) | 执行 | 保留运行 |

### 关键可靠性设计

| 设计 | 位置 | 规避的坑 |
|---|---|---|
| `git fetch + reset --hard FETCH_HEAD` | `deploy.sh:61-68` | 配置漂移（镜像更新但 compose 文件未更新）自动修复 |
| deploy.sh self-reexec | `deploy.sh:70-75` | 同次发布中脚本自身被更新，新版本立即接管 |
| 严格 `.env` 解析器 | `deploy.sh:95-117` | **VULN-133** 不 `source`，不用 `IFS='='`（后者吞尾随 `=`，致命于 base64 Fernet key） |
| pre-deploy migration | `deploy.sh:155-195` | 旧版 backend 启动即 FTL 的死锁 (#459) |
| preflight 冷启动重试 | `preflight.sh:125-144` | ai-service 冷启动 > 60s 时部署被误判失败 |

### 容器安全加固摘要

| 约束 | VULN 编号 | 应用服务 |
|---|---|---|
| `no-new-privileges:true` | VULN-123 | gateway / backend / ai-service |
| `cap_drop: ALL` | VULN-123 | 同上（gateway 仅 `cap_add` 四项绑定 :80 所需） |
| `read_only: true` + `tmpfs` | VULN-123 | 同上（工作目录 tmpfs，持久数据命名卷） |
| `JWT_SECRET:?` 必填 | VULN-120 | compose 变量替换层 fail-fast |
| `AI_CREDENTIAL_ENCRYPTION_KEYS:?` 必填 | VULN-056 | 独立于 JWT_SECRET，MultiFernet 多 key 轮换 |
| Redis `--requirepass` 必填 | VULN-119 | redis 服务（移除空密码 fallback） |
| Redis 健康检查 `REDISCLI_AUTH` | VULN-147 | 不让密码进 `ps auxf` |
| Docker socket `:ro` 挂载 | VULN-123 权衡 | backend（管理员容器监控用；`:ro` 仅限套接字文件，API 仍 root-equivalent） |

---

## 技术选型

| 领域 | 技术 | 版本 | 选型理由 |
|------|------|------|---------|
| 博客前台 | Next.js + React | 15.1.3 / 19 | SSR/SSG 支持，SEO 友好，App Router |
| 管理后台 | Vite + React | 6.x / 19 | 极速 HMR，SPA 架构适合后台 |
| 后端 | Go + Echo | 1.24.1 / v4.15.1 | 高性能，编译型，并发原生支持 |
| AI 服务 | FastAPI + LiteLLM | 最新 / Python 3.12 | 异步高性能，多模型路由，流式输出 |
| 数据库 | PostgreSQL + pgvector | 17 | 关系型 + 向量检索一体化 |
| 缓存 | Redis | 7 | 高性能缓存，会话管理，AI 限流 |
| 搜索 | Elasticsearch | 8.15.0 | 全文搜索（可选） |
| 序列化 | encoding/json | — | Go 标准库内置支持 |
| 网关 | Nginx | 最新稳定版 | 轻量高效，反向代理 |
| 容器 | Docker Compose | — | 一键部署，环境一致性 |
| CI/CD | GitHub Actions | — | 原生集成，自动构建部署 |
| Monorepo | pnpm workspace + Go module | pnpm 9.15.0 | 共享依赖，统一版本管理 |
