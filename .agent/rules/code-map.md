---
trigger: always_on
---

## 🗺️ 项目路线图

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

阶段1: 项目基础架构搭建 (预计3天)
├─ 任务1.1: 前端 Monorepo 初始化 → §3.1
│   └─ 创建 pnpm workspace, 配置 TypeScript, ESLint
├─ 任务1.2: 后端 Go 模块初始化 → §4.1
│   └─ 创建 go.mod, internal/ 结构, 基础配置
├─ 任务1.3: 数据库初始化 → §6.1, §6.2
│   └─ PostgreSQL 表结构, pgvector 扩展, 初始数据
├─ 任务1.4: Docker 开发环境 → §9
│   └─ docker-compose.yml, 本地开发环境
└─ 任务1.5: 共享配置包 → §3.1, §3.4
    └─ Tailwind 预设, TypeScript 配置, ESLint 规则

[检查点1] ════════════════════════════════════════════════════════════

阶段2: 后端核心服务开发 (预计5天)
├─ 任务2.1: 公共模块开发 → §4.2
│   └─ internal/pkg (响应格式, 工具函数)
├─ 任务2.2: 安全模块开发 → §4.4
│   └─ internal/middleware (JWT, CORS, 限流)
├─ 任务2.3: Redis 模块开发 → §4.2
│   └─ Redis 集成 (go-redis, 缓存服务)
├─ 任务2.4: 用户服务开发 → §4.3, §7.4
│   └─ 用户模块 (handler/service/repository)
├─ 任务2.5: 博客核心服务开发 → §4.3, §7.2
│   └─ 博客核心模块 (handler/service/repository)
└─ 任务2.6: 媒体服务开发 → §4.3
    └─ 媒体模块 (S3 存储, 图片处理)

[检查点2] ════════════════════════════════════════════════════════════

阶段3: 前端基础组件开发 (预计4天)
├─ 任务3.1: UI 组件库开发 → §3.2
│   └─ packages/ui (Button, Card, Input, Modal...)
├─ 任务3.2: 编辑器包开发 → §3.2
│   └─ packages/editor (Markdown编辑器, 渲染器)
├─ 任务3.3: 共享 Hooks 开发 → §3.3
│   └─ packages/hooks (useApi, useAuth, useDebounce...)
├─ 任务3.4: 共享工具包开发 → §3.1
│   └─ packages/utils (format, validation, helpers...)
└─ 任务3.5: 类型定义包 → §3.1
    └─ packages/types (Post, User, API types...)

[检查点3] ════════════════════════════════════════════════════════════

阶段4: 前端博客应用开发 (预计5天)
├─ 任务4.1: 博客布局与导航 → §8.1
│   └─ apps/blog (Layout, Header, Footer, Navigation)
├─ 任务4.2: 首页开发 → §8.1
│   └─ Hero, 文章列表, 欢迎页
├─ 任务4.3: 文章详情页 → §8.1, §3.2
│   └─ Markdown渲染, 目录, 代码高亮
├─ 任务4.4: 归档与时间树 → §3.1.5, §8.1
│   └─ TimeTree组件, 归档页面
├─ 任务4.5: 搜索功能 → §3.1.6, §8.1
│   └─ SearchPanel, 搜索结果页
├─ 任务4.6: 友链与关于页 → §3.1.7, §3.1.8
│   └─ FriendCard, 关于页布局
└─ 任务4.7: 文档维护与导入规范化 → §3.1, §8.1
    └─ Blog alias imports, 审计文档同步

[检查点4] ════════════════════════════════════════════════════════════

阶段5: 管理后台开发 (预计5天) 
├─ 任务5.1: 后台布局与认证 → §8.2
│   └─ apps/admin (Layout, Login, 权限控制) 
├─ 任务5.2: 仪表盘开发 → §8.2
│   └─ 统计卡片, 图表, 系统状态
├─ 任务5.3: 文章管理 → §8.2, §3.2
│   └─ 文章列表, 编辑器集成, 设置
├─ 任务5.4: 媒体库管理 → §8.2
│   └─ 图片上传, 媒体网格, 存储切换
├─ 任务5.5: 分类标签管理 → §8.2
│   └─ 分类CRUD, 标签云管理
├─ 任务5.6: 友链管理 → §8.2
│   └─ 友链CRUD, 状态检测
├─ 任务5.7: 系统设置 → §8.2
│   └─ 站点配置, 存储配置, 个人资料
└─ 任务5.8: AI 配置中心 → §8.2, §5.1
    └─ AiConfigPage, ProviderComponents, 图标集成

[检查点5] ════════════════════════════════════════════════════════════

阶段6: AI 服务开发 (预计5天) 
├─ 任务6.1: Python 服务初始化 → §5.1
│   └─ apps/ai-service (FastAPI, Poetry, 目录结构) 
├─ 任务6.2: 核心功能开发 → §5.1
│   └─ LiteLLM 集成, 模型路由, 鉴权中间件 
├─ 任务6.3: 业务 Agent 开发 → §5.1
│   └─ SummaryAgent, TaggingAgent, WritingAgent (Python实现)
├─ 任务6.4: RAG 服务实现 → §5.2
│   └─ LlamaIndex集成, 向量存储(pgvector), 混合检索
├─ 任务6.5: Prompt 管理服务 → §5.3
│   └─ 模板CRUD, 动态加载, 版本管理
├─ 任务6.6: 前端 AI 助手集成 → §3.2, §8.3
│   └─ AiAssistant组件, 流式响应解析(ReadableStream)
└─ 任务6.7: AI 搜索集成 → §8.3
    └─ 语义搜索 API 联调, 问答面板

[检查点6] ════════════════════════════════════════════════════════════

阶段7: 统计与监控开发 (预计3天) 
├─ 任务7.1: 统计服务开发 → §4.3
│   └─ 统计模块 (访问记录, 聚合分析) 
├─ 任务7.2: 前端统计集成 → §8.2
│   └─ 访问趋势图, 地域分布, 设备分析
├─ 任务7.3: 日志服务开发 → §4.2
│   └─ 日志模块 (zerolog, 操作审计) 
└─ 任务7.4: 日志监控面板 → §8.2
    └─ 日志查看, 错误筛选, 异常告警

[检查点7] ════════════════════════════════════════════════════════════

阶段8: 搜索服务开发 (预计2天) 
├─ 任务8.1: Elasticsearch 集成 → §2.5
│   └─ 搜索模块 (ES 索引, 全文检索) 
├─ 任务8.2: 搜索 API 开发 → §7.2
│   └─ 关键词搜索, 高亮, 分面
└─ 任务8.3: 搜索功能联调 → §8.1
    └─ 前后端搜索联调, 搜索建议

[检查点8] ════════════════════════════════════════════════════════════

阶段9: 集成测试与优化 (预计3天) 
├─ 任务9.1: 前后端联调 → §7
│   └─ API 联调, 错误处理, 边界情况
├─ 任务9.2: 性能优化 → §2
│   └─ 缓存优化, 懒加载, 代码分割
├─ 任务9.3: SEO 优化 → §8.1
│   └─ Meta标签, 结构化数据, Sitemap
└─ 任务9.4: 无障碍优化 → §3.4
    └─ ARIA标签, 键盘导航, 颜色对比

[检查点9] ════════════════════════════════════════════════════════════

阶段10: 部署与上线 (预计2天) 
├─ 任务10.1: 生产环境配置 → §9
│   └─ 环境变量, 密钥管理, 配置文件
├─ 任务10.2: Docker 生产构建 → §9
│   └─ 多阶段构建, 镜像优化
├─ 任务10.3: CI/CD 流水线 → §9
│   └─ GitHub Actions, 自动部署
├─ 任务10.4: 监控告警配置 → §9
│   └─ Prometheus, Grafana, 告警规则
└─ 任务10.5: 上线验证 → §10
    └─ 功能验收, 性能测试, 安全检查

[检查点10 - 项目完成] ═══════════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

---

## 🗂️ 后端 Handler → 前端页面 映射表 (v1.1.0, 2026-04-04)

### 后端 Handler 全量列表（23个）

| Handler | 路由前缀 | 对应前端页面 |
|:--------|:---------|:------------|
| AuthHandler | `/v1/auth/*` | 登录页 |
| PostHandler | `/v1/admin/posts`, `/v1/public/posts` | PostsPage, CreatePostPage, EditPostPage |
| CommentHandler | `/v1/admin/comments`, `/v1/public/comments` | CommentsPage |
| MediaHandler | `/v1/admin/media` | MediaPage + media/components/* |
| FolderHandler | `/v1/admin/folders` | MediaPage (FolderTree) |
| PermissionHandler | `/v1/admin/permissions` | SettingsPage |
| CategoryHandler | `/v1/admin/categories`, `/v1/public/categories` | CategoriesPage |
| TagHandler | `/v1/admin/tags`, `/v1/public/tags` | CategoriesPage |
| AiHandler | `/v1/admin/ai/*` | AiWritingWorkspacePage, ai-tools/* |
| StatsHandler | `/v1/admin/stats/*` | DashboardPage, AnalyticsPage |
| SystemMonitorHandler | `/v1/admin/monitor/*` | MonitorPage |
| SiteHandler | `/v1/public/site` | Blog 前台（站点信息） |
| SiteSettingHandler | `/v1/admin/site-settings` | SettingsPage |
| FriendLinkHandler | `/v1/admin/friend-links`, `/v1/public/friend-links` | FriendsPage |
| ActivityHandler | `/v1/admin/activities` | DashboardPage（活动流） |
| StorageProviderHandler | `/v1/admin/storage-providers` | SettingsPage（存储配置）|
| ArchiveHandler | `/v1/public/archive` | Blog timeline/archive 页 |
| MigrationHandler | `/v1/admin/migration` | MigrationPage |
| MediaTagHandler | `/v1/admin/media-tags` | MediaPage (TagManager) |
| SystemHandler | `/v1/admin/system` | SettingsPage |
| VisitorHandler | `/v1/admin/visitors` | AnalyticsPage |
| VersionHandler | `/v1/version` | 系统信息 |

### Admin 前端页面 → 后端模块 映射

| 前端页面/模块 | 使用的后端 Handler | 说明 |
|:------------|:-----------------|:-----|
| DashboardPage | StatsHandler, ActivityHandler | 仪表盘统计 |
| PostsPage | PostHandler | 文章列表 |
| CreatePostPage / EditPostPage | PostHandler, AiHandler | 文章编辑 + AI 辅助 |
| AiWritingWorkspacePage | AiHandler | AI 写作工作台 |
| ai-config/AiConfigPage | 直连 ai-service:8000 | AI 供应商与模型配置 |
| ai-tools/* | AiHandler | 6个工具页（改写/QA/SEO/摘要/标签/清洗）|
| CategoriesPage | CategoryHandler, TagHandler | 分类+标签管理 |
| CommentsPage | CommentHandler | 评论管理 |
| FriendsPage | FriendLinkHandler | 友链管理 |
| MediaPage | MediaHandler, FolderHandler, MediaTagHandler | 媒体库完整功能 |
| SettingsPage | SiteSettingHandler, StorageProviderHandler, PermissionHandler, SystemHandler | 多类型设置 |
| MigrationPage | MigrationHandler | 数据迁移 |
| MonitorPage | SystemMonitorHandler | 系统监控 |
| AnalyticsPage | StatsHandler, VisitorHandler | 统计分析 |

### AI 服务路由（Nginx → ai-service:8000）

```
/api/v1/ai/*  → ai-service:8000（600s 超时，SSE 支持，关闭 proxy_buffering）
/api/*        → backend:8080（Go 后端）
```

### CHANGELOG v1.1.0
- Added: 后端 24 个 Handler 全量列表及路由前缀（含 ShareHandler、SearchHandler）。
- Added: Admin 前端页面 → 后端模块映射表。
- Added: ai-tools/ 页面列表（ContentRewriter, QA, SeoOptimizer, Summary, Tagger, TextCleaner）。
- Fixed: 任务1.2 描述从 Maven 改为 Go 模块初始化。

---

## 🗂️ 2026-02-08 任务映射增补 (v1.0.1)

| Task ID | 模块 | 关键文件 | 状态 |
|---|---|---|---|
| AI-ROUTING-001 | AI Service 启动兼容 | `start.sh`, `apps/ai-service/requirements.txt`, `apps/ai-service/eval_type_backport.py`, `apps/ai-service/app/api/routes/providers.py` | Done |
| AI-ADMIN-002 | 管理端 AI 图标规范 | `apps/admin/src/pages/ai-config/components/ProviderIcon.tsx`, `apps/admin/src/pages/ai-config/components/ProviderCard.tsx` | Done |
| OPS-STARTUP-003 | 启动脚本稳定性 | `start.sh` | Done |
| DOC-SYNC-004 | 规则与设计文档同步 | `.agent/rules/code-design.md`, `.agent/rules/code-structure.md`, `.agent/rules/code-tree.md`, `.agent/rules/code-map.md`, `.agent/rules/ui_rules.md`, `系统需求企划书及详细设计.md` | Done |
| DOC-MAINT-005 | 博客导入路径与文档维护 | `apps/blog/app/posts/(article)/[slug]/page.tsx`, `apps/blog/tsconfig.json`, `.agent/rules/task.md`, `.agent/rules/walkthrough.md` | Done |

### CHANGELOG
- Added: AI/运维/文档任务映射（含 `DOC-MAINT-005`）。
