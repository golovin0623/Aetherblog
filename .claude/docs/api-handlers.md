# 后端 API Handler 速查

> **何时读：** 新增或修改 API 端点；前端找不到对应后端入口；排查 router 注册缺失；写迁移脚本前确认 schema。
>
> **真理源始终是 `apps/server-go/internal/server/server.go` 的 `setupRoutes()`（路由注册）与各 `handler/*.go`（业务逻辑）** —— 本表是高层导航，PR 后请同步更新。

---

## 1. Handler 总览（26 个模块，按职责分组）

> 表格中「Handler 文件」列是**源文件名（不含 `.go` 扩展名）**（Go 仓库习惯 snake_case，例：`auth_handler` → 实际文件 `auth_handler.go`），对应的 Go 类型名为 PascalCase（例：`AuthHandler`，符合 `CLAUDE.md` §4 后端命名约定）。这样写便于直接 grep 文件 / 跳定义。

### 鉴权与用户

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `auth_handler` | `/v1/auth/*` + `/v1/admin/auth/*` | `POST /login`、`/register`、`/refresh`、`/logout`；`GET /me`；`POST /change-password`；`PUT /profile`、`/avatar`；**admin only：** `POST /rotate-jwt-secret`（手动触发 JWT 签名密钥轮换） |

### 内容创作

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `post_handler` | `/v1/admin/posts/*` + `/v1/public/posts/*` | Admin CRUD + publish + auto-save + properties patch；5 个公共路由 + password verify |
| `comment_handler` | `/v1/admin/comments/*` + `/v1/public/*` | 12 个 admin 路由（含批量 approve / delete）+ 2 个公共路由（list + 带速率限制的 submit） |
| `category_handler` | `/v1/admin/categories/*` + `/v1/public/*` | 6 个端点 |
| `tag_handler` | `/v1/admin/tags/*` + `/v1/public/*` | 5 个端点 |
| `archive_handler` | `/v1/public/archives/*` | `list`、`stats` |

### 媒体与文件

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `media_handler` | `/v1/admin/media/*` | 18 路由：upload（单 + 批）、list、stats、batch-move、回收站管理、CRUD、content update |
| `media_tag_handler` | `/v1/admin/media-tags/*` | 9 路由：tags CRUD + popular + search + 批量；file-tag 关联（list / add / remove） |
| `folder_handler` | `/v1/admin/folders/*` | 7 路由：tree、CRUD、children、move |
| `permission_handler` | `/v1/admin/folders/*/permissions` | 4 路由：folder 权限管理 |
| `share_handler` | `/v1/admin/shares/*` | 5 路由：file 分享、folder 分享、查询、更新、删除 |
| `version_handler` | `/v1/admin/versions/*` | `list by file`、`restore`、`delete` |
| `storage_provider_handler` | `/v1/admin/storage/*` | 11 路由：list、default、CRUD、set-default、test、**objects(list)**、**import**、**objects(delete)** —— 后三个为 Phase 5 云端浏览/反向导入 |
| `sync_handler` | `/v1/admin/storage/sync/*` + `/v1/admin/media/:id/sync` | 5 路由：start（入队 + 启 worker）、cancel（优雅停）、status（workers + counts）、failed、retry；单文件入口 `POST /admin/media/:id/sync` |

### 知识库（Knowledge Base）

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `kb_handler` | `/v1/admin/kbs/*` | 12 路由：CRUD（list / create / get / update / delete）+ stats + 文件（list / upload / get / delete / reindex）+ 全库 reindex |
| `kb_profile_handler` | `/v1/admin/kbs/:id/profiles/*` | 5 路由：list / create / update / activate（指针切）/ migrate（蓝绿）/ delete |
| `kb_member_handler` | `/v1/admin/kbs/:id/members/*` | 3 路由：list（含 principalName 回填）/ upsert（USER/TEAM/ROLE）/ delete |
| `kb_agent_handler` | `/v1/agent/knowledge-bases` | 1 路由：picker 用，按 USE 权限过滤当前用户可见 KB |

KB 写路径速率桶：`rate:kb:write` 60/min/user；写操作落 `activity_events` 表 `kb.*` 事件家族（kb.create / kb.delete / kb.file.upload / kb.file.delete / kb.file.reindex / kb.reindex / kb.profile.activate / kb.profile.migrate / kb.member.upsert / kb.member.delete）。

下游 ai-service：
- `POST /api/v1/kb/{kb_id}/files/{fid}/index` — 单文件向量化（contentBytes base64 + mime；支持 targetProfileId / targetStatus=shadow 蓝绿写入）
- `POST /api/v1/kb/{kb_id}/reindex` — 全库重建 ack

### AI

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `ai_handler` | `/v1/admin/ai/*` | 9 个业务端点（summary / tags / titles / polish / outline / translate + stream 变体 + health） + 7 个配置端点（prompts + tasks CRUD） + provider 透传（`Any /*`） |
| `ai_handler` (proxy → ai-service) | `/v1/admin/providers/global-pricing/*` + `/v1/admin/providers/models/:id/sync-{from,global}-pricing` | **全局价格管理（透明转发到 FastAPI）：** `GET /global-pricing` 列表、`GET /coverage` model_id 覆盖率视图（默认 `enabled_only=true` 仅含「供应商启用」模型即 `m.is_enabled AND p.is_enabled`；传 `enabled_only=false` 看全量目录）、`GET/PUT/DELETE /global-pricing/{model_id:path}` upsert/删除、`POST /global-pricing/{model_id}/apply` 批量回填到所有同名 ai_models 行（可按 `provider_codes` 限制 + `overwrite_existing` 切换）、`POST /global-pricing/catalog/preview` 从 LiteLLM 内置价格表（`litellm.model_cost`，USD/1M，离线）匹配启用 model_id 出 diff 预览、`POST /global-pricing/catalog/sync` 按预览勾选的 `model_ids` 把数据源价格写入全局表（`overwrite_existing=false` 只补未配置项、true 才覆盖且保留 notes/display_name）、`POST /models/{id}/sync-global-pricing`（model→global）、`POST /models/{id}/sync-from-global`（global→单条 model）。catalog 两条路由声明顺序必须在 `{model_id:path}` 之前，避免被 path 转换器吞掉。所有路由仍走 `/providers/*` 通配符代理，不需要新增 Go handler。 |
| `agent_handler` | `/v1/agent/*` | 4 路由（`POST chat` SSE、`GET models`、`GET articles`、`GET tags`），任意已登录用户可访问；写 `ai.agent_chat` 审计 |

### 站点配置与统计

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `site_handler` | `/v1/admin/site/*` | `info`、`stats`、`author` |
| `site_setting_handler` | `/v1/admin/settings/*` | `list`、`group`、`batch-update`、`get-by-key`、`update-by-key` |
| `friend_link_handler` | `/v1/admin/friends/*` + `/v1/public/*` | 10 路由：admin CRUD + batch-delete + toggle-visible + reorder + page；1 公共 |
| `stats_handler` | `/v1/admin/stats/*` | 7 路由：dashboard、top-posts、visitor-trend、archives、ai-dashboard、ai-pricing-gaps、ai-cost-archive |
| `visitor_handler` | `/v1/admin/visitors/*` | `create`、`today` |
| `activity_handler` | `/v1/admin/activities/*` | `recent`、`list`、`by-user` |

### 系统监控

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `system_monitor_handler` | `/v1/admin/monitor/*` | 14 路由：metrics、storage、health、overview、containers、container logs、logs、log files、log download、network test、history、history stats、history delete、alerts、config |
| `log_level_handler` | `/v1/admin/system/log-level` | `GET` 当前 backend / ai-service 日志级别；`PUT` 在线调整两端 root logger（详见 `backend-runtime.md` §4） |
| `system_handler` | `/v1/system/*` | `GET /system/time` |

### 检索

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `search_handler` | `/v1/public/search/*` + `/v1/admin/search/*` | `GET search`（hybrid / keyword / semantic）、`GET qa`（SSE）、配置 CRUD、stats、reindex、retry-failed、embedding-status |

### 数据迁移

| Handler 文件 | 路由前缀 | 关键端点 |
| --- | --- | --- |
| `migration_handler` | `/v1/admin/migrations/vanblog/*` | `POST /analyze`（dry-run）、`POST /import/stream`（NDJSON/SSE）、`POST /import?mode=dry-run\|execute`（兼容） —— 详见 `backend-runtime.md` §5 |

---

## 2. 前端 Service 层（22 个文件）

`apps/admin/src/services/`，命名规范 `{module}Service.ts`，axios `api.ts` 基础客户端。

| 模块 | 职责 |
| --- | --- |
| `authService` | 登录、注册、refresh、profile |
| `postService` | Posts CRUD + auto-save + publish |
| `categoryService` | Categories CRUD |
| `tagService` | Tags CRUD |
| `commentService` | 评论审核（approve / reject / spam / batch） |
| `mediaService` | 媒体上传 + CRUD + 回收站 |
| `mediaTagService` | 媒体文件打标签 |
| `folderService` | 文件夹树 + CRUD + move |
| `permissionService` | 文件夹权限 ACL |
| `shareService` | 文件 / 文件夹分享 |
| `versionService` | 文件版本历史 |
| `storageProviderService` | 存储 provider CRUD + test |
| `analyticsService` | 仪表盘统计 + AI 分析 |
| `aiService` | AI 写作工具（summary / tags / titles / polish / outline / translate） |
| `aiProviderService` | AI provider / model / credential / prompt / task 配置 |
| `aiPredictionService` | AI 预测工具 |
| `friendService` | 友链 CRUD + reorder |
| `settingsService` | 站点设置（group、batch update） |
| `systemService` | 系统监控（metrics、containers、logs、alerts） |
| `activityService` | 活动事件流 |
| `searchConfigService` | 检索配置 |

---

## 3. Admin 前端页面

`apps/admin/src/pages/`，主页面 16+：

```
Dashboard · Posts · CreatePost · EditPost · AiWritingWorkspace
Categories · Comments · Friends · Media · Settings
Migration · Monitor · Analytics · AiConfig · AiTools
SearchConfig · Activities
```

**子模块：**

- `ai-config/`（16 组件 + hooks + utils）
- `ai-tools/`（7 个工具页：Summary / Tagger / ContentRewriter / SeoOptimizer / QA / TextCleaner + workspace）
- `media/`（13+ 组件）
- `posts/components/`（8+ 组件，含 SlashCommandMenu / SelectionAiToolbar / AiSidePanel）
- `auth/`（Login / ChangePassword）
- `dashboard/`（12 组件，含 AiUsageTrendChart / ContainerStatus / RealtimeLogViewer）
- `settings/`（StorageProviderSettings）

## 4. Blog 前端页面

`apps/blog/app/`，4 个路由组（home / posts/[slug] / timeline / friends）+ 35+ 组件。

**核心组件：** ArticleCard、FeaturedPost、CommentSection、SearchPanel、TimelineTree、MarkdownRenderer、TableOfContents、HeroParallaxContent、StackedParallax、ProtectedPostContent、FloatingThemeToggle、MobileBottomPullNav、FriendCard、VisitTracker。

**Libs：** `api.ts`（API 客户端）、`services.ts`（数据获取）、`sanitizeUrl.ts`、`remarkAlertBlock.ts`（自定义 markdown 插件）、`socialLinks.ts`、`headingId.ts`、`logger.ts`。
