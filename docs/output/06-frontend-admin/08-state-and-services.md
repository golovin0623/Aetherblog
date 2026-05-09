# 08 · 状态层 / 服务层 / axios 拦截器 / Token 刷新 / 错误处理

> **范围**:`apps/admin/src/stores/*`、`contexts/*`、`hooks/*`、`services/*`、`lib/{logger,utils,aiMetrics}.ts`、错误归一与拦截器实现。

---

## 1. 范围

后台前端的"基础设施层"。本文展开:

1. Zustand stores 的 7 个清单与用途
2. 两个 React Context(focus / font preview)
3. `@aetherblog/hooks` + 本地 `hooks/*` 的 hook 清单
4. axios 单例 + 拦截器 + 401/403 → refresh → retry
5. SSE 流式实现的 3 套 + 1 套独立
6. React Query 用法、staleTime 策略、共享 query keys
7. 错误归一(`R<T>` vs `AiServiceResponse<T>`)
8. logger 与 toast 一致性

---

## 2. Zustand Stores 清单

| Store | 文件 | persist | 关键字段 | 实际消费方 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `useAuthStore` | `stores/authStore.ts` | ✅ 仅 `isAuthenticated` | `user / token / isAuthenticated / login() / logout() / updateUser()` | LoginPage / AuthGuard / Sidebar / ChangePassword / 各 service / 流式 hook | VULN-095 缓解:不持久 token / role |
| `useSidebarStore` | `stores/sidebarStore.ts` | ✅ 仅 `isCollapsed` | `isCollapsed / isAutoCollapsed / isMobileOpen / toggle / setCollapsed / setMobileOpen` | AdminLayout / Sidebar / MobileHeader / 编辑器(用 isCollapsed 计算 padding) | 三态合一(用户 / 自动 / 移动端抽屉) |
| `usePostStore` | `stores/postStore.ts` | ❌ | `posts / currentPost / loading / total / pageNum / pageSize` + setters | **无活跃消费方** | 死代码,曾经的列表 cache,现在 PostsPage 自己 useState |
| `useEditorStore` | `stores/editorStore.ts` | ✅ | `enableSelectionAi / enableSlashAi` | CreatePostPage(经典编辑器) | 仅经典编辑器开关 |
| `useSettingsStore` | `stores/settingsStore.ts` | ✅ `aetherblog-settings` | `siteName / siteDescription / siteUrl` | **无活跃消费方** | 死代码,真实站点设置走 React Query + settingsService |
| `useUIStore` | `stores/uiStore.ts` | ❌ | `isSidebarCollapsed / isLoading / theme + setters` | **无活跃消费方** | 死代码,与 useSidebarStore + ThemeProvider 重叠 |

**重叠 / 死代码总结**:7 个 store 中实际起作用的 4 个(auth/sidebar/editor/settings 部分);3 个未被消费(post/settings/ui)。

### 2.1 `useAuthStore` 的安全策略

```ts
// stores/authStore.ts:40-47
{
  partialize: (state) => ({
    isAuthenticated: state.isAuthenticated,
  }),
}
```

只持久化"已登录标记",`user` / `token` 不写 localStorage:
- 启动时 AuthGuard 调 `/v1/auth/me` 重新拉 user(`AuthGuard.tsx:30-66`)
- token 实际是后端 HttpOnly cookie,前端不落地
- `useAuthStore.getState().token` 在内存里(login 时 set,refresh 后由 `/auth/me` 不传,所以登录态期间一般是 null;axios 拦截器把它当可选 Bearer)

VULN-052 / VULN-095 都来自"localStorage role 篡改":通过 partialize 排除 user 字段彻底堵死前端层面的提权可能。

### 2.2 `useSidebarStore` 的状态合一

```
isCollapsed       persistent 用户偏好
isAutoCollapsed   transient,专注模式 / 移动端切桌面边界自动折叠
isMobileOpen      移动端抽屉显隐
effective = isCollapsed || isAutoCollapsed
```

任意手动 toggle 都清 `isAutoCollapsed`(`sidebarStore.ts:23-30`),保证用户的显式动作覆盖系统行为。

---

## 3. React Contexts

### 3.1 `FocusModeContext`(`contexts/FocusModeContext.tsx`)

- `isFocus / toggle / enter / exit`
- `⌘.` / `Ctrl+.` 切换;`Esc` 退出
- 切到 true → `document.documentElement` 加 `data-focus-mode="true"` → CSS 据此自动收缩 sidebar / 隐藏次级控件
- HMR 期间组件渲染在 Provider 之外时 `useFocusMode()` 优雅降级返回 noop(`:50-55`)

### 3.2 `FontPreviewContext`(`contexts/FontPreviewContext.tsx`)

- `previewFontId / startPreview / stopPreview / applyPreview / switchToNextPreview`
- 由 `<AdminFontProvider>` 在 main.tsx 包到全树
- 设置页选字体 → `startPreview(id)` → 立即应用到 body
- 点"应用" → `applyPreview(id)` → `onSaveFontId(id)`(=`settingsService.batchUpdate({ font_family })`)→ 失败回滚

---

## 4. Hooks 清单

### 4.1 来自 `@aetherblog/hooks`(via `hooks/index.ts:1`)

```ts
export * from '@aetherblog/hooks';
```

外部包提供:`useTheme` / `useMediaQuery` / `useDebounce` / `useViewTransition` / `ThemeProvider` 等。

### 4.2 admin 自有 hooks(`apps/admin/src/hooks/`)

| Hook | 用途 |
| --- | --- |
| `useAiPrediction` | AI 协同写作的 ghost text;依赖 `aiPredictionService`(mock,见 04) |
| `useAiToolTarget` | AI 工具箱"目标文章"统一抽象:targetPostId 持久化 + applyXxx 系列(localStorage,见 04) |
| `useHistoryManager` | AI 协同写作的内容快照管理(`@aetherblog/hooks` 不包含)+ `lib/history-storage.ts` 持久化 |
| `useMediaKeyboardShortcuts` | 媒体库快捷键(见 03) |
| `useReindexStream` | 搜索 profile reindex SSE 解析(见 06) |
| `useSearchProfiles` | 搜索 profile 的 React Query 集合(见 06) |
| `useSiteLogo` | 把 `settings.site_logo` 解析为完整 URL(`getMediaUrl` 包装) |
| `useSmartPolling` | visibility-aware 轮询(见 05) |
| `useStreamResponse` | 通用 AI SSE 解析(见 04) |
| `useWritingWorkflow` | AI 协同写作 stage 机 |

---

## 5. axios 单例与拦截器

### 5.1 `services/api.ts`(完整 ApiClient 类)

```ts
class ApiClient {
  private client: AxiosInstance;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: import.meta.env.VITE_API_URL || '/api',
      timeout: 120000,
      withCredentials: true,
      headers: { 'Content-Type': 'application/json' },
    });

    // 请求拦截器:注入 Bearer
    this.client.interceptors.request.use((config) => {
      const token = useAuthStore.getState().token;
      if (token) config.headers.set('Authorization', `Bearer ${token}`);
      return config;
    });

    // 响应拦截器:解包 + 401/403 处理
    this.client.interceptors.response.use(
      (response) => response.data,        // 直接返回 R<T>,业务代码不再 res.data.data
      async (error) => { ... }
    );
  }

  async get<T>(url, config) { return this.client.get(url, config); }
  // post / put / patch / delete 类似
}

export const apiClient = new ApiClient();
export default apiClient;
```

### 5.2 401 / 403 自动续期

```ts
async (error: AxiosError) => {
  const status = error.response?.status;
  const originalRequest = error.config as RetriableAxiosRequestConfig;
  const requestUrl = originalRequest?.url || '';

  // 1. 不是 auth 路径 + 没重试过 → 尝试 refresh
  if ((status === 401 || status === 403)
      && originalRequest && !originalRequest._retry
      && !this.isAuthRequest(requestUrl)) {
    originalRequest._retry = true;
    try {
      await this.tryRefreshToken();
      return this.client.request(originalRequest);  // 重发
    } catch { /* 继续 */ }
  }

  // 2. 仍是 401/403
  if (status === 401 || status === 403) {
    // AI 服务的认证错误不触发登出
    if (this.isAiRequest(requestUrl)) return Promise.reject(error.response?.data || error);
    // 已 retry 过的核心 API → logout
    if (authStore.isAuthenticated && originalRequest?._retry) {
      authStore.logout();
      window.location.replace(loginPath);
    }
  }

  return Promise.reject(error.response?.data || error);
}
```

### 5.3 关键决策

**`tryRefreshToken` 单飞**(`api.ts:100-114`):

```ts
private refreshPromise: Promise<void> | null = null;

private async tryRefreshToken(): Promise<void> {
  if (!this.refreshPromise) {
    this.refreshPromise = this.post('/v1/auth/refresh')
      .then((res) => { if (res?.code !== 200) throw new Error(...); })
      .finally(() => { this.refreshPromise = null; });
  }
  return this.refreshPromise;
}
```

并发 N 个 401 请求只会触发一次 refresh,其他 N-1 个 await 同一 promise。

**`isAiRequest` 边界**(`api.ts:87-98`):AI 路径(`/v1/admin/ai/`、`/v1/admin/providers`、`/ai-service/`、含 `admin/providers` / `admin/ai/`)的认证错误不触发登出 — 因为 ai-service 凭证错误不应该把管理员踢下线,只是该 AI 不可用。

**Auth 路径白名单**(`isAuthRequest`):`/v1/auth/login` / `refresh` / `logout` 不参与"401 → refresh → retry"循环,避免无限重试。

### 5.4 已知限制

1. ⚠ `apiClient` 没暴露 `client` getter,某些场景(`mediaService.upload` / SSE)绕开走原生 `axios.post` / `fetch`,拦截器不生效
2. ⚠ refresh 失败时只 `logger.warn`,前端没有"3 次失败强制 logout" 的兜底
3. ⚠ `withCredentials: true` 在跨域反代场景下需要 nginx 配 CORS;开发期 vite proxy 已处理

---

## 6. 流式实现(SSE)

后台前端有 **4 套独立**的 SSE 解析实现:

### 6.1 `useStreamResponse`(`hooks/useStreamResponse.ts`,309 行)

- 通用 AI 工具流(summary / tags / titles / polish / outline / translate)
- 事件:`delta` / `result` / `done` / `error`
- 节流 50ms 一次 setState
- 同源带 Bearer + cookie,跨域不带(VULN-085)
- 401/403 静默 refresh + 重建 RequestInit + 重读 token

### 6.2 `useReindexStream`(`hooks/useReindexStream.ts`,231 行)

- 搜索 profile reindex 流
- 事件:`start` / `progress` / `result` / `done` / `error`
- 性能:counters O(1) 累加,recent ring buffer 16 槽
- 失败行只 `console.error` 不终止

### 6.3 `migrationService.streamImport`(`services/migrationService.ts:150-219`)

- VanBlog 迁移流
- 事件:`phase` / `item` / `summary` / `fatal`
- 用 `useReducer` 在 `useMigrationWizard.ts` 聚合

### 6.4 `streamAgentChat`(`services/agent/chat.ts`)

- AetherHub 对话流
- 事件:`delta`(可带 `isThink`) / `sources` / `done` / `error`
- 早期协议有独立 `think` type,合并到 `delta.isThink`

### 6.5 共性 / 差异

| 维度 | useStreamResponse | useReindexStream | migrationService | streamAgentChat |
| --- | --- | --- | --- | --- |
| 协议帧 | `data: <json>` + `\n\n` | 同 | 同 | 同 |
| 节流 | ✅ 50ms | ❌(累加 O(1)) | ❌(reducer 直接 dispatch) | useSmoothStream 平滑吐字 |
| 鉴权 | 同源 Bearer + cookie / 跨域 omit | Bearer + credentials:'include' | Bearer + credentials:'include' | credentials:'include' |
| 401 重试 | 自动 refresh + 重建 init | ❌ | ❌ | ❌(直接 onError) |
| Abort | ✅ AbortController | ✅ | ✅(signal 透传) | ✅ |
| 错误 | console.warn malformed | console.error malformed | 静默 | onError |

**结论**:差异主要是事件类型,基础解析("`\n\n` 拆帧 + `data:` 前缀去除 + JSON.parse")可以抽公共 util。

---

## 7. React Query 命名空间与 staleTime

| Key | 来源 | staleTime |
| --- | --- | --- |
| `['settings']` | useSiteLogo / AdminFontProvider / AdminThemeColorProvider / SettingsPage | 60s-300s |
| `['storage-providers']` | StorageProviderSettings / CloudExplorerPage | 默认 5min(QueryClient default) |
| `['cloud-objects', providerId, prefix, token]` | CloudExplorerPage | 默认 |
| `['friends']` | FriendsPage | 默认 |
| `['ai-providers'/{enabledOnly}]` | useProviders | 默认 |
| `['ai-models'/...]` | useModels / useProviderModels | 默认 |
| `['ai-credentials']` | useCredentials | 默认 |
| `['search-profiles']` | useSearchProfiles | 30s |
| `['search-diagnostics' / 'search-stats']` | SearchConfigPage | 默认 |
| `['folder-permissions', folderId]` | FolderPermissionsPage | 默认 |
| `['media', 'list', params]` | MediaPage | 默认 |
| `['media', 'trash', 'count']` | MediaPage | 默认 |
| `['folders']` | FolderTree | 默认 |

非 Query 的页面(直接 useState + axios):

- PostsPage / CategoriesPage / CommentsPage / DashboardPage / AnalyticsPage / MonitorPage / MigrationPage / ActivitiesPage / SearchConfigPage(部分)/ AetherHub

迁移建议:逐步把这些迁移到 React Query。已有 `useSearchProfiles` 是好样板。

---

## 8. 错误归一

### 8.1 双协议

```ts
// types/api.ts
interface R<T> {              // 标准
  code: number;               // 200 = 成功
  message: string;
  data: T;
  timestamp: number;
  traceId?: string;
  errorCategory?: string;
}

interface AiServiceResponse<T> {  // ai-service 风格
  success: boolean;
  data: T;
  code?: number;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
}
```

`R<T>` 用于 backend,`AiServiceResponse<T>` 用于 ai-service 直连(`aiProviderService` 全部、AetherHub 部分接口)。消费方需要根据路径判断。

### 8.2 错误消息归一(`pages/ai-config/utils/errorMessage.ts`)

```ts
resolveAiServiceErrorMessage(error: unknown, fallback: string): string
```

依次尝试:`error.response?.data?.message` → `error.errorMessage` → `error.errorCode` → fallback。

### 8.3 各页面 catch 的 4 种风格

1. **直接 `toast.error(err.message || 'fallback')`** — 最常见
2. **`logger.error + toast.error`** — PostsPage / DashboardPage 等
3. **演示降级**(假装成功)— CommentsPage,**反模式**
4. **静默 fallback 到 mock**(toast.error 但 setData 假数据)— DashboardPage / CommentsPage 部分

### 8.4 logger(`lib/logger.ts`)

```ts
const isDev = import.meta.env.DEV;

export const logger = {
  debug: isDev ? console.debug.bind(console) : noop,
  info:  isDev ? console.log.bind(console)   : noop,
  warn:  console.warn.bind(console),    // 始终可见
  error: console.error.bind(console),    // 始终可见
};
```

约定:开发期 `logger.debug/info` 自动消失,线上只保留 warn/error。

---

## 9. 服务清单(完整)

`services/` 目录下 26 个文件:

| 文件 | 形式 | 后端 base |
| --- | --- | --- |
| `api.ts` | 单例 class `ApiClient` | (拦截器,所有其他 service 的依赖) |
| `index.ts` | barrel export 14 个常用 service | — |
| `authService.ts` | `const authService = { ... }` | `/v1/auth/*` + `/v1/admin/auth/*` |
| `postService.ts` | `const postService = { ... }` | `/v1/admin/posts` |
| `categoryService.ts` | `const categoryService = { ... }` + default | `/v1/admin/categories` |
| `tagService.ts` | `const tagService = { ... }` + default | `/v1/admin/tags` |
| `commentService.ts` | `class CommentService` 实例 | `/v1/admin/comments` |
| `mediaService.ts` | `const mediaService = { ... }` | `/v1/admin/media` |
| `mediaTagService.ts` | `const mediaTagService = { ... }` | `/v1/admin/media/tags` |
| `folderService.ts` | `const folderService = { ... }` | `/v1/admin/media/folders` |
| `permissionService.ts` | `const permissionService = { ... }` | `/v1/admin/media/folders/{id}/permissions` |
| `versionService.ts` | `const versionService = { ... }` | `/v1/admin/media/files/{id}/versions` |
| `shareService.ts` | `const shareService = { ... }` | `/v1/admin/media/shares/*` |
| `storageProviderService.ts` | `const storageProviderService = { ... }` | `/v1/admin/storage/providers` |
| `storageSyncService.ts` | `const storageSyncService = { ... }` | `/v1/admin/storage/sync/*` + `/media/{id}/sync` |
| `friendService.ts` | `class FriendService` 实例 | `/v1/admin/friend-links` |
| `settingsService.ts` | `class SettingsService` 实例 | `/v1/admin/settings` |
| `systemService.ts` | `const systemService = { ... }` | `/v1/admin/system/*` |
| `analyticsService.ts` | `class AnalyticsService` 实例 | `/v1/admin/stats/*` |
| `activityService.ts` | `class ActivityService` 实例 | `/v1/admin/activities/*` |
| `aiService.ts` | `const aiService = { ... }` | `/v1/admin/ai/*`(非流式) |
| `aiProviderService.ts` | `const aiProviderService = { ... }` | `/v1/admin/providers` + `/v1/admin/ai/{tasks,prompts}` |
| `aiPredictionService.ts` | `class AiPredictionService` 实例 | (mock,无后端) |
| `searchConfigService.ts` | `const searchConfigService = { ... }` | `/v1/admin/search/{config,stats,...}` |
| `searchProfileService.ts` | `const searchProfileService = { ... }` | `/v1/admin/search/profiles` |
| `migrationService.ts` | `const migrationService = { ... }` + 顶层 `streamImport()` | `/v1/admin/migrations/vanblog/*` |
| `agent/index.ts` | barrel(chat / sessions / models / resources / smooth / cjkMarkdown) | `/api/v1/agent/*` + `/api/v1/admin/...`(AetherHub 用) |

### 9.1 命名约定不一致

- 14 个用 `const xxxService = { ... }` 单例对象
- 6 个用 `class XxxService` + 实例(`commentService` / `friendService` / `settingsService` / `analyticsService` / `activityService` / `aiPredictionService`)

class 形式只为了用 `private readonly BASE_URL`,但同时也意味着 `xxxService.method(...)` 需要 bind。建议统一成对象单例,把 BASE_URL 改成模块顶层 const。

---

## 10. 拦截器与 service 之间的协同陷阱

### 10.1 axios 拦截器解包 R<T> 后,service 函数签名仍写 `R<T>`

```ts
// services/api.ts 拦截器
this.client.interceptors.response.use((response) => response.data);
// 注:这里 response.data 是后端返回的 R<T> 整体

// services/postService.ts
getList: (params) => apiClient.get<R<PageResult<PostListItem>>>('/v1/admin/posts', { params })
// 返回类型 R<PageResult<PostListItem>>:整个响应

// 调用方
const res = await postService.getList(params);
if (res.code === 200) setPosts(res.data.list);
```

但有些 service(`settingsService.getAll`)直接 `return res.data || {}` 抹平了协议:

```ts
async getAll(): Promise<SettingsMap> {
  const res = await api.get<R<SettingsMap>>(this.BASE_URL);
  return res.data || {};                 // 拆出 data 直接返回
}
```

**两种风格混在一起**,调用方需要先看 service 签名才能写对类型。

### 10.2 mediaService.upload 绕过 wrapper

```ts
async function uploadOnce({ url, formData, onProgress, signal }) {
  const response = await axios.post<R<T>>(url, formData, { ... });
  // 直接用裸 axios,拦截器不生效
  return response.data.data;              // 双重 .data
}
```

原因:axios 实例的 `onUploadProgress` 在拦截器之前消费,需要直接控制;同时 retry/abort 也是自管。

代价:Bearer 注入在这里不会自动跑;`mediaService.upload` 本来就需要 cookie 鉴权(withCredentials: true),后端两边都接,但这是个静默约定,新人容易踩。

---

## 11. lib/* 工具汇总

| 文件 | 用途 |
| --- | --- |
| `lib/utils.ts` | `cn` (clsx + twMerge) / `formatNumber` / `formatDate` / `formatFileSize` / `debounce` / `POST_SUMMARY_PLACEHOLDER` |
| `lib/logger.ts` | dev-aware logger |
| `lib/aiMetrics.ts` | `getAiResponseRateSummary(total, success, error)` 派生显示行 |
| `lib/aiToolDiff.ts` | AI 工具应用前的内容 diff(用于 ApplyPreviewModal) |
| `lib/ghost-text-extension.ts` | CodeMirror 6 ghost text 扩展 |
| `lib/history-storage.ts` | AI 协同写作历史快照本地存储 |
| `lib/tagColor.ts` | 标签名 → hex 颜色派生(哈希) |

---

## 12. 已知限制 / 待改进

1. ⚠ **死代码 stores**:`usePostStore` / `useSettingsStore` / `useUIStore` 应该删除(或合并)
2. ⚠ **service 命名约定不统一**:14 个 const 单例 + 6 个 class 实例;统一成 const 形式更易理解
3. ⚠ **`R<T>` / `AiServiceResponse<T>` 双协议**:消费方需要先看路径;考虑在 axios 拦截器里规整化
4. ⚠ **service 返回类型混风格**:大部分返 `R<T>`,少数直接拆出 data 返 `T`;统一会改善 IDE 类型提示
5. ⚠ **SSE 4 套独立实现**:可抽公共 util `parseSSE(body, onEvent, signal)`
6. ⚠ **mediaService.upload 绕过 wrapper**:无 Bearer 注入,只靠 cookie;有跨域/部署变更时容易踩坑
7. ⚠ **`useStreamResponse` 是同源/跨域分流的唯一处**;其他 SSE 都没做
8. ⚠ **演示降级反模式**:CommentsPage 假装成功;DashboardPage / CommentsPage 的 mock fallback 体积无谓
9. ⚠ **`apiClient` 缺 `axios` 实例 getter**:复杂场景(SSE / 上传)不能复用拦截器
10. ⚠ **logger 只到 console**:没接 Sentry / 远端;线上故障难排
11. ⚠ **没有全局 error boundary 上报**:`ErrorBoundary` 只 console.error,没把堆栈往后端送
