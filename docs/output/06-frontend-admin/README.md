# 06 · Admin 前端总览

> 范围:`apps/admin/`(Vite 6 + React 19 + TypeScript 5.7)。
> 基线:与本仓 main 分支 `claude/sad-gould-35d3a6`(2026-05-08)对齐。
>
> 本目录的其它 9 份文档按"能力切片"展开,本 README 给出全模块的纲要、交叉关系和已知问题。

---

## 1. 模块定位

`@aetherblog/admin` 是 AetherBlog 的**控制台**:面向博主自己,而非读者。它跟前台 `apps/blog/`(Next.js)构成"读者端 + 作者端"的双前端,共享:

- 设计系统(`packages/ui` + Aether Codex tokens)
- 通用 hooks(`packages/hooks`,主题 / 媒体查询 / 节流等)
- 类型定义(`@aetherblog/types`,DB 实体共享形状)
- 工具函数(`@aetherblog/utils`,日期 / slug / 颜色派生)
- Markdown 编辑器(`@aetherblog/editor`,基于 CodeMirror 6)

后台**不消费** Next.js 的 SSR / RSC 能力,纯客户端渲染、SPA 路由,所有数据通过 axios → backend `/api/*` 拉取。AI 流式调用绕过 axios,直接用 `fetch + ReadableStream` 解析 SSE(详见 §08-state-and-services)。

---

## 2. 技术栈一览

| 维度 | 选择 | 备注 |
| --- | --- | --- |
| 构建 | Vite 6.4 + React 19.0 + TS 5.7 | `pnpm --filter @aetherblog/admin dev` 起 5173 |
| Base path | `/admin/` | `vite.config.ts:8`,生产由网关 nginx 在 `/admin/` 反代;开发 BrowserRouter 自动剥离 basename |
| 路由 | `react-router-dom@7.1.1` | `BrowserRouter` + 懒加载页面 + `AuthGuard` 包裹 |
| 状态(全局) | `zustand@5.0.2`(7 个 store) | `auth` / `sidebar` / `post` / `editor` / `settings` / `ui` / `font-preview-context` |
| 状态(服务端) | `@tanstack/react-query@5.62.8` | 设置类长缓存(60-300s)+ AI/Search 中频热查询 |
| 表单校验 | `react-hook-form@7.70` + `zod@4.3` + `@hookform/resolvers` | 集中在 FriendsPage / ChangePassword / Provider Dialog |
| 动画 | `framer-motion@11.15` | 页面入场 / Modal / 抽屉 / `layoutId` segmented tab |
| 通知 | `sonner@2.0` | `<Toaster richColors position="top-center" />` 在 App 顶层挂一次 |
| 拖拽 | `@dnd-kit/*` | Friends 排序 / AI 工具排序 / Provider 排序 / Model 排序 |
| 图表 | `recharts@2.15` | Dashboard / Analytics / SystemTrends |
| HTTP | `axios@1.7` | 单例 `apiClient` + 拦截器 + 401 → refresh → retry |
| 图标 | `lucide-react@0.469` + `@lobehub/icons@4.1` | Lobe 用于 AI provider 品牌图标 |

完整 deps 见 `apps/admin/package.json:14-62`。

---

## 3. 路由树

入口:`apps/admin/src/App.tsx`(110 行,所有路由都在这一个文件,**不分层**)。

```
/login                                       → LoginPage(独立壳,无 AdminLayout)
/change-password                             → AuthGuard + ChangePasswordPage(独立壳)
/aetherhub                                   → AuthGuard + AetherHubWorkspacePage(独立壳, AI 对话工作台)
/                                            → AuthGuard + AdminLayout(共用壳)
  /                                          → Navigate to /dashboard
  /dashboard                                 → DashboardPage
  /analytics                                 → AnalyticsPage(AI 调用维度专题)
  /posts                                     → PostsPage(列表 + 高级筛选)
  /posts/new                                 → CreatePostPage(经典编辑器)
  /posts/:id/edit                            → CreatePostPage(同上,带 id)
  /posts/ai-writing/new                      → AiWritingWorkspacePage(AI 协同写作)
  /posts/ai-writing/:id                      → AiWritingWorkspacePage
  /media                                     → MediaPage(媒体库 + 文件夹 + 上传)
  /media/folder/:folderId/permissions        → FolderPermissionsWrapper → FolderPermissionsPage
  /storage/explorer                          → CloudExplorerPage(云端 bucket 浏览器)
  /categories                                → CategoriesPage(分类 / 标签合并 tab)
  /comments                                  → CommentsPage
  /friends                                   → FriendsPage(友链 + 拖拽排序)
  /settings                                  → SettingsPage(多 tab,内嵌 MigrationPage / StorageProviderSettings)
  /ai-tools                                  → AIToolsPage(系统 + 自定义工具,DnD 排序)
  /ai-test                                   → AiTestPage(开发期手测页面)
  /ai-config                                 → AiConfigPage(LobeChat 风格 provider/model/credential 配置中心)
  /search-config                             → SearchConfigPage(搜索 + Profile 管理)
  /monitor                                   → MonitorPage(SystemTrends + ContainerStatus + RealtimeLogViewer + JwtRotationCard)
  /activities                                → ActivitiesPage(审计事件)
```

**独立壳**(login / change-password / aetherhub)指**不渲染 Sidebar + MobileHeader**,自管全屏背景。

详细的路由权限 / 守卫 / 懒加载策略见 `01-shell-routing-layout.md`。

---

## 4. 状态管理拓扑

```
┌────────────────────────────────────────────────────────────────────────────┐
│ main.tsx Providers(从外到内)                                              │
│   <ThemeProvider>          @aetherblog/hooks 提供;暗 / 亮主题 + view-transition │
│     <QueryClientProvider>  staleTime 5min, retry 1 (main.tsx:10-17)         │
│       <AdminThemeColorProvider>  读 settings.theme_primary_color_*,生成 CSS │
│         <AdminFontProvider>      读 settings.font_family,挂 FontPreviewProvider │
│           <App>                                                             │
│             <FocusModeProvider>  专注模式开关,⌘.快捷键                     │
│               <ErrorBoundary>                                               │
│                 <Suspense>      路由级 fallback                             │
│                   <Routes>      AuthGuard / AdminLayout / Outlet            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Zustand stores(`apps/admin/src/stores/`)

| Store | 文件 | persist? | 关键字段 | 备注 |
| --- | --- | --- | --- | --- |
| `useAuthStore` | `authStore.ts` | ✅(只持久 `isAuthenticated`,VULN-095) | `user / token / isAuthenticated / login() / logout()` | token 也存内存;角色每次启动从 `/auth/me` 重拉以阻止 localStorage 篡改提权 |
| `useSidebarStore` | `sidebarStore.ts` | ✅(只持久 `isCollapsed`) | `isCollapsed / isAutoCollapsed / isMobileOpen` | 桌面手动折叠 + 专注模式自动折叠 + 移动端抽屉,三态合一 |
| `usePostStore` | `postStore.ts` | ❌ | `posts / currentPost / pageNum` | **被 PostsPage 完全绕过**,直接 useState;留给后续 SSR 预加载用 |
| `useEditorStore` | `editorStore.ts` | ✅ | `enableSelectionAi / enableSlashAi` | 经典编辑器的 AI 辅助开关 |
| `useSettingsStore` | `settingsStore.ts` | ✅ | `siteName / siteDescription / siteUrl` | **基本未被消费** —— 真实站点设置走 react-query + `settingsService` |
| `useUIStore` | `uiStore.ts` | ❌ | `isSidebarCollapsed / theme` | 与 `useSidebarStore` 字段语义重叠,基本是历史包袱;未被任何活跃页面读 |

> ⚠ **状态重复**:`useUIStore.isSidebarCollapsed` 与 `useSidebarStore.isCollapsed`、`useUIStore.theme` 与 `@aetherblog/hooks` 的 ThemeProvider 语义重叠;`useSettingsStore` 的字段也由后端 settings 接管。建议拆掉两个 store,详见 `08-state-and-services.md` §6。

### 4.2 Contexts(`apps/admin/src/contexts/`)

| Context | 范围 | 用途 |
| --- | --- | --- |
| `FocusModeContext` | App 顶层 | `⌘.` / `Esc` 切换 `data-focus-mode="true"`;CSS 据此压缩 sidebar / 隐藏次级控件 |
| `FontPreviewContext` | `<AdminFontProvider>` 内 | 设置页字体选择的"预览 → 应用"事务,失败回滚到旧字体 |

### 4.3 React Query 命名空间

| Key | 来源 | staleTime |
| --- | --- | --- |
| `['settings']` | `useSiteLogo` / `AdminFontProvider` / `AdminThemeColorProvider` | 60s-300s |
| `['storage-providers']` | `StorageProviderSettings` / `CloudExplorerPage` | 默认 |
| `['cloud-objects', providerId, prefix, token]` | `CloudExplorerPage` | 默认 |
| `['friends']` | `FriendsPage` | 默认 |
| `['ai-providers'/'ai-models'/'ai-credentials']` | `pages/ai-config/hooks/*` | 默认 |
| `['search-profiles' / 'search-diagnostics' / 'search-stats']` | `useSearchProfiles` + `SearchConfigPage` | 30s |
| `['folder-permissions', folderId]` | `FolderPermissionsPage` | 默认 |
| `['friends']` | `FriendsPage` | 默认 |

非 Query 的 fetch + state(Posts / Categories / Comments / Migration / Monitor / Activities)直接 useState + useEffect,**没有迁到 Query**。

详见 `08-state-and-services.md` §3。

---

## 5. 服务层(axios wrappers)

`apps/admin/src/services/index.ts:1-15` 重新导出常用服务;独立 `import` 路径列表:

| 文件 | 后端命名空间 | 主要消费方 |
| --- | --- | --- |
| `api.ts` | (单例 `apiClient`) | 所有其他 service |
| `authService.ts` | `/v1/auth/*` + `/v1/admin/auth/*`(JWT meta / rotate) | LoginPage / AuthGuard / Sidebar / JwtRotationCard |
| `postService.ts` | `/v1/admin/posts` | PostsPage / Create / AI 工具应用 |
| `categoryService.ts` `tagService.ts` | `/v1/admin/categories` `/tags` | CategoriesPage / Posts 高级筛选 / 编辑器 |
| `commentService.ts` | `/v1/admin/comments` | CommentsPage |
| `mediaService.ts` | `/v1/admin/media`(上传含 retry/abort/phase) | MediaPage / SettingsPage / 编辑器图片粘贴 |
| `mediaTagService.ts` | `/v1/admin/media/tags` | MediaPage TagFilterBar |
| `folderService.ts` | `/v1/admin/media/folders` | MediaPage FolderTree / CloudExplorer |
| `permissionService.ts` | `/v1/admin/media/folders/{id}/permissions` | FolderPermissionsPage |
| `versionService.ts` | `/v1/admin/media/files/{id}/versions` | MediaPage VersionHistory |
| `shareService.ts` | `/v1/admin/media/shares/*` | MediaPage ShareDialog |
| `storageProviderService.ts` | `/v1/admin/storage/providers` + `/objects` + `/import` | StorageProviderSettings / CloudExplorerPage |
| `storageSyncService.ts` | `/v1/admin/storage/sync/*` | MediaPage SyncDialog |
| `friendService.ts` | `/v1/admin/friend-links` | FriendsPage |
| `settingsService.ts` | `/v1/admin/settings` | SettingsPage / AdminFontProvider / AdminThemeColorProvider |
| `aiService.ts` | `/v1/admin/ai/{summary,tags,titles,polish,outline,translate,health}` | AiTestPage / AI 工具的非流式回退 |
| `aiProviderService.ts` | `/v1/admin/providers` + `/v1/admin/ai/{tasks,prompts}` | AiConfigPage / AIToolsPage / SearchConfigPage |
| `aiPredictionService.ts` | (未对接后端,本地 mock) | AiWritingWorkspace 的 ghost text 实验 |
| `analyticsService.ts` | `/v1/admin/stats/*` | DashboardPage / AnalyticsPage |
| `activityService.ts` | `/v1/admin/activities/*` | ActivitiesPage / RecentActivity |
| `searchConfigService.ts` | `/v1/admin/search/{config,stats,index,...}` | SearchConfigPage |
| `searchProfileService.ts` | `/v1/admin/search/profiles/*` | SearchConfigPage(profile 子区) |
| `migrationService.ts` | `/v1/admin/migrations/vanblog/*`(含 SSE) | MigrationPage(嵌在 SettingsPage) |
| `systemService.ts` | `/v1/admin/system/*` | MonitorPage / DashboardPage 系统区 |
| `agent/` | ai-service 直连(`/api/v1/ai/agent/*`) | AetherHubWorkspacePage(独立 AI chat) |

**契约形状**:

```ts
// types/api.ts:2-9
interface R<T> {
  code: number;          // 200 表示成功
  message: string;
  data: T;
  timestamp: number;
  traceId?: string;
  errorCategory?: string;
}
```

AI provider 系列单独用了 `AiServiceResponse<T>`(`success: boolean` + `errorCode/Message`),因为最初借用 LiteLLM 的协议形状,目前两套并存,详见 §08。

---

## 6. 鉴权链路

### 6.1 登录(`pages/auth/LoginPage.tsx:18-72`)

1. `authService.login({ username, password })` POST `/v1/auth/login`
2. 后端在 `Set-Cookie` 里下发 HttpOnly JWT cookie(主路径),同时也把 access token 在 `data.accessToken` 字段里返回 — 但**前端不读**(authStore 持久化时把 `token` 字段 strip 掉了)
3. 写入 store:`useAuthStore.login(user)`,role 从 `userInfo.roles[0]` 推导(前端把数组退化成单数)
4. `mustChangePassword === true` → 强制跳 `/change-password`,否则跳 `location.state.from || '/'`

### 6.2 验证 + 续期(`AuthGuard.tsx:24-67`)

- 每次进入受保护路由,先 `authService.getCurrentUser()` 拉一次 `/v1/auth/me`,400/401/403 → `logout()` + 重定向 `/login`
- 拉成功后**重写 `user` 字段**(role / nickname / avatar / email)。这一步刻意:**store 里持久的 `isAuthenticated` 只是个标记位,真正的角色 / 资料每次启动都从后端取**,堵住"localStorage 改 role 提权 UI"的路径(对应 VULN-052 / VULN-095)

### 6.3 401/403 自动刷新(`services/api.ts:33-79`)

- `axios.interceptors.response` 检测到 401/403,且原请求不是 auth 路径(`/v1/auth/login|refresh|logout`),且未重试过 → 调一次 `POST /v1/auth/refresh`(后端依赖 HttpOnly refresh cookie)→ 重发原请求
- AI 路径(`/v1/admin/ai/` / `/v1/admin/providers` / `admin/ai/`)的认证错误**不触发登出**,只 reject(因为 ai-service 凭证错误不该把管理员踢下线)
- 刷新失败 + 已经重试过的请求 → `authStore.logout()` + `window.location.replace(loginPath)`(用 BASE_URL 拼前缀确保网关模式正确)

### 6.4 SSE / 流式接口的鉴权(`hooks/useStreamResponse.ts:82-145`)

- 流式不走 axios,自管 `fetch`
- **同源判断**:`new URL(url, origin).origin === window.location.origin`,跨域(管理员配置的第三方流式端点)**故意不带 Bearer / cookie**(VULN-085)
- 401/403 一次性触发 `/v1/auth/refresh` cookie 续期,然后**重建 RequestInit**(每次重读 `useAuthStore.getState().token`)再发一次 — 防止旧 token 被复用

### 6.5 JWT 签名密钥轮换(`components/security/JwtRotationCard.tsx`)

`MonitorPage` 第三行专门挂了 `JwtRotationCard`,管理员可以:

- 看 current 密钥的晋升时间 / 上一密钥宽限期到期 / 自动轮换间隔
- 二次确认后调 `POST /v1/admin/auth/rotate-jwt-secret`(对应 VULN-152)— 之前这个端点只能 curl,UI 缺失被审计标了红线

---

## 7. Aether Codex 在后台的落地

### 7.1 设计语言锚点

- **登录 / 改密页**:满级 Codex —— `surface-overlay` + `font-display`(Fraunces) + `font-editorial`(Instrument Serif) + `--aurora-1..4` + 暗 / 亮主题自适应,见 `LoginPage.tsx:74-572`(含约 200 行 scoped `<style>`)
- **AetherHubWorkspacePage**:同样满级
- **PostsPage / CategoriesPage 等数据密集页**:**部分 Codex** —— 列表卡片 / 筛选 chip 全部用 token,但 segmented tab、分页栏、表格头还混着 legacy `--text-*` / `--bg-secondary` / `bg-primary/10` 等老变量。这是历史负债,token 翻转后基本能跑;但严格遵循 §3.7 红线时迁移没收尾
- **SettingsPage / MonitorPage / DashboardPage**:数据卡片大量 `bg-status-*-light` 系列(legacy),与 Codex 表面规则有距离

### 7.2 共享原语

| 来源 | 在后台用法 |
| --- | --- |
| `@aetherblog/ui` Button / ConfirmModal / Toggle / Tooltip / Select / DateRangePicker | 表单 / 设置 / 编辑器 |
| `@aetherblog/ui` `spring / transition / variants` | 页面入场、Modal、segmented tab `layoutId` |
| `@aetherblog/ui` `AetherMark` | Sidebar / Login 品牌图形 |
| `@aetherblog/utils` `formatDate / formatRelativeTime / generateColorVars` | 监控、JWT 卡、主色覆盖 |
| `@aetherblog/hooks` `useTheme / useMediaQuery / useDebounce` | 全栈 |
| `@aetherblog/editor` `EditorWithPreview / MarkdownPreview / useEditorCommands / useImageUpload` | CreatePostPage / AiWritingWorkspace / AetherHub |

### 7.3 后台特例

- **没有 Spinner 红线**:CLAUDE.md §3.6 严禁 spinner,但 `LoadingSpinner.tsx` 还在,被 `App.tsx`(Suspense fallback)+ `AdminLayout`(Outlet fallback)+ `JwtRotationCard` 等多处用。这是后台目前的红线违规之一;骨架屏在 PostsPage / DashboardPage / SearchConfigPage 已落地
- **`dark:` variant 没有完全清干净**:CategoriesPage 的 tag 颜色映射、CommentsPage 的状态映射、Posts 编辑器的标签色板都还带 `dark:` 后缀,违反 Codex §3.4 #5。token 翻转能掩盖一部分但不彻底

详见 `09-design-implementation.md`。

---

## 8. 横向依赖与跨包共享点

| 共享方向 | 共享内容 |
| --- | --- |
| ← `packages/ui` | 组件、动画 token、AetherMark、Toaster 对齐 |
| ← `packages/hooks` | useTheme(view-transition 切色)、useMediaQuery、useDebounce、ThemeProvider |
| ← `packages/types` | `MediaFolder / MediaTag / MediaVersion / FolderPermission / StorageProvider / StorageProviderType / FolderTreeNode` |
| ← `packages/utils` | `formatDate / formatRelativeTime / formatFileSize / generateColorVars / colorVarsToCSS / slugify` |
| ← `packages/editor` | CodeMirror 6 适配 + Markdown 预览 + 图片上传 + 工具栏 hook |
| → backend `apps/server-go` | 通过 axios + SSE,见每个 service 文件顶部命名空间 |
| → ai-service(Python) | 通过 backend handler 透传,例外:AetherHub 走 `/api/v1/ai/agent/*` 直接打 ai-service |
| ↔ `apps/blog`(Next.js) | 不直接导入,只通过 `localStorage` 共享主题(`aetherblog-theme`)和站点设置(后端中继) |

---

## 9. 关键决策

1. **不上 Server-Side Rendering**。后台是单租户、登录后才看到的内部工具,SEO 不重要;CSR + Vite 的开发体验比 Next.js 简单很多。
2. **路由全集中在 `App.tsx`**,不分嵌套文件。代价是 `App.tsx` 行数膨胀,但路由表一眼能看完;懒加载放在同一处也避免遗漏。
3. **Zustand + React Query 并存而非二选一**。Auth / Sidebar / 编辑器偏好这种"用户偏好" → Zustand;后端拉取的实体 → React Query。但**没有强制迁移**,Posts / Comments / Categories / Monitor / Migration 仍是 useState + axios,造成"状态层不统一"是已知欠债。
4. **service 与 page 的命名约定不统一**:14 个 service 是单例对象 + 命名导出(`postService`),3 个是 class instance(`commentService` / `friendService` / `settingsService` / `analyticsService` / `activityService` / `systemService`)。后者多用类是为了用 `private readonly BASE_URL`;实际行为没差,但加了认知负担。
5. **AI 任务"系统 + 自定义"双源**:`AIToolsPage` 既硬编码 6 个系统工具(`SYSTEM_TOOLS`),又从 `aiProviderService.listTasks()` 拉自定义 task。系统 / 自定义的排序持久化在 localStorage,不上后端。
6. **流式调用绕过 axios**:axios 不擅长 SSE 增量解析,所有流式接口(AI 生成 / 索引 reindex / vanblog 迁移)都用 `fetch + ReadableStream` 自己拆 SSE 帧。三个文件实现(`useStreamResponse` / `useReindexStream` / `migrationService.streamImport`),协议帧格式相似但**事件类型不一致**,没抽公共层。

---

## 10. 已知问题 / 风险

1. ⚠ **`useUIStore` / `useSettingsStore` / `usePostStore` 是死代码**(或半死)。需要清理。
2. ⚠ **`pages/posts/AiWritingWorkspacePage.backup.tsx`**:旧版本备份,1300+ 行,被排除在 import 之外但仍在仓库里污染搜索。该删。
3. ⚠ **`aiPredictionService.ts` 是 mock 实现**(setTimeout 300ms + 关键词匹配模板),被 `useAiPrediction` 通过 ghost text extension 调用。后端没有对应端点。
4. ⚠ **CommentsPage 的"演示降级"**:每个 mutation 在错误时都 fall back 到本地 mock 数据(`Failed → 本地 setState 假装成功 + 演示模式 toast`)。生产环境给用户造成误导,建议改成 toast.error + 不改状态。
5. ⚠ **设计系统违规**:`LoadingSpinner` 仍在 5+ 个位置使用;部分 tag 颜色仍写 `dark:` variant;legacy `--text-*` / `--bg-secondary` / `bg-status-*-light` 在 Posts / Comments / Settings / Dashboard 大面积存在。
6. ⚠ **`apiClient` 没有公开 `client` getter**:某些复杂场景(如 `mediaService.upload`)绕过 wrapper 直接 `axios.post`,导致 retry / abort 自管。建议把 `axios` 实例暴露成 protected,统一拦截器。
7. ⚠ **`R<T>` 与 `AiServiceResponse<T>` 双协议**:消费方需要先看路径才能判断响应形状,没有运行时收敛。
8. ⚠ **`vite.config.ts` 的代理顺序敏感**:`/api/v1/admin/providers` → AI 服务,`/api/v1/ai` → AI 服务,`/api` → backend。一旦改顺序就会路由错;建议加注释或在 nginx 里统一。

---

## 11. 扩展点

| 想加的能力 | 接入位置 |
| --- | --- |
| 新增管理 API 端点 | (1) 在 `services/` 添 wrapper(2) 在 `App.tsx` 加路由(3) 必要时 sidebar 加项 |
| 新增 AI 任务 / 工具 | `AIToolsPage` 的自定义 task 路径,后端 `/v1/admin/ai/tasks` POST,无需前端硬编码 |
| 新增 AI provider | `AiConfigPage` `Provider Dialog`(支持 LobeChat 风格图标)+ 后端 `/v1/admin/providers` |
| 新增设置项 | `SettingsPage.SETTING_GROUPS` 加字段;字段类型见 `SettingFieldType` enum |
| 新增 storage provider | `StorageProviderSettings` 的 `PROVIDER_TYPES` + 后端注册 |
| 新增搜索 profile chunker | `SearchConfigPage` 的 `ChunkerKindSelector` + ai-service profiles 接口 |

---

## 12. 子文档导航

| 主题 | 文档 |
| --- | --- |
| 路由壳 / 布局 / 鉴权守卫 | `01-shell-routing-layout.md` |
| 文章 / 分类 / 评论 / 编辑器 | `02-content-management.md` |
| 媒体库 / 上传 / 文件夹 / 多 provider | `03-media-library.md` |
| AI 工具箱 / AI 测试 / AI 配置 | `04-ai-tools-and-config.md` |
| 监控 / 数据分析 / 活动记录 / 仪表盘 | `05-analytics-and-monitor.md` |
| 存储 provider / 云端浏览 / 搜索配置 | `06-storage-and-search-config.md` |
| 设置 / VanBlog 迁移 / 友链 / AetherHub | `07-settings-and-system.md` |
| 状态 / 服务层 / 拦截器 / 错误处理 | `08-state-and-services.md` |
| Aether Codex 在后台的落地与偏差 | `09-design-implementation.md` |
