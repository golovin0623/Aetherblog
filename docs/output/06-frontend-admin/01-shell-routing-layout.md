# 01 · 应用壳 / 路由 / 布局

> **范围**:`apps/admin/src/App.tsx`、`main.tsx`、`components/layout/*`、`components/auth/AuthGuard.tsx`、独立壳页面(Login / ChangePassword / AetherHub)的鉴权与路由控制。

---

## 1. 范围

- 启动序列(`main.tsx` → Provider 链 → `App`)
- 路由表与懒加载
- `AdminLayout` 的桌面 / 移动布局策略
- 侧边栏(`Sidebar`)分组、折叠、移动端抽屉、命令面板
- `MobileHeader` / `Header`(后者已被弃置但保留)
- 鉴权守卫(`AuthGuard`)与会话续期
- 路由权限(目前是粗粒度:登录 = 全功能,**没有**按 role 细分)

---

## 2. 入口与 Provider 链

### 2.1 `apps/admin/src/main.tsx:1-31`

```tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AdminThemeColorProvider>
          <AdminFontProvider>
            <App />
          </AdminFontProvider>
        </AdminThemeColorProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
```

| 层 | 来自 | 职责 |
| --- | --- | --- |
| `ThemeProvider` | `@aetherblog/hooks` | 暗 / 亮主题持久化(`aetherblog-theme`),提供 `useTheme()`、`view-transition-name` 切色动画 |
| `QueryClient` | `@tanstack/react-query` | `staleTime: 5min` / `retry: 1` |
| `AdminThemeColorProvider` | `components/AdminThemeColorProvider.tsx` | 把 `settings.theme_primary_color_light/dark` 派生成 CSS 变量,`<style id="aetherblog-admin-primary-color">` 注入 |
| `AdminFontProvider` | `components/AdminFontProvider.tsx` | 读 `settings.font_family`,挂 `FontPreviewProvider`,把字体应用到 `<body>` |

`QueryClient` 的 default config 在 `main.tsx:10-17`:

```ts
{ defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } } }
```

### 2.2 `App.tsx:53-107`

```tsx
function App() {
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return (
    <BrowserRouter basename={basename === '/' ? undefined : basename}>
      <Toaster richColors position="top-center" />
      <FocusModeProvider>
        <ErrorBoundary>
          <Suspense fallback={<LoadingSpinner size="lg" />}>
            <Routes>
              ...
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </FocusModeProvider>
    </BrowserRouter>
  );
}
```

- `import.meta.env.BASE_URL`:dev = `/`、prod = `/admin/`(`vite.config.ts:8`)。BrowserRouter 的 basename 自动剥离结尾斜杠并跳过 `'/'`,避免双 `/` 路径
- 全局 Toaster 挂一次,各页面 `import { toast } from 'sonner'` 直接用
- `FocusModeProvider` 在 BrowserRouter 内部 → `useFocusMode` 在路由切换时仍能访问
- `ErrorBoundary` 单层兜底,组件加载失败给"重新加载"CTA(`ErrorBoundary.tsx:46-72`)

---

## 3. 路由表

`App.tsx:11-33` 全部页面用 `lazy()` 懒加载,二级页面通过 `.then(m => ({ default: m.X }))` 处理命名导出:

```tsx
const AiTestPage = lazy(() => import('./pages/AiTestPage').then(module => ({ default: module.AiTestPage })));
const AiWritingWorkspacePage = lazy(() => import('./pages/posts/AiWritingWorkspacePage').then(module => ({ default: module.AiWritingWorkspacePage })));
```

### 3.1 路由分组

| 类别 | 路径 | 壳 |
| --- | --- | --- |
| 公共入口 | `/login` | 无壳(全屏 codex 双栏) |
| 鉴权后特例 | `/change-password` `/aetherhub` | AuthGuard,但**不进 AdminLayout**(自管全屏背景) |
| 主区(Outlet 共享 AdminLayout) | `/dashboard` `/analytics` `/posts` `/posts/new` `/posts/:id/edit` `/posts/ai-writing/new` `/posts/ai-writing/:id` `/media` `/media/folder/:folderId/permissions` `/storage/explorer` `/categories` `/comments` `/friends` `/settings` `/ai-tools` `/ai-test` `/ai-config` `/search-config` `/monitor` `/activities` | AuthGuard + AdminLayout |
| 重定向 | `/` → `/dashboard` | (隐式) |

### 3.2 动态路由 wrapper

`FolderPermissionsWrapper`(`App.tsx:37-51`):

```tsx
function FolderPermissionsWrapper() {
  const { folderId } = useParams<{ folderId: string }>();
  if (!folderId) return <Navigate to="/media" replace />;
  return <FolderPermissionsPage folderId={parseInt(folderId)} folderName={`文件夹 ${folderId}`} />;
}
```

⚠ `folderName` 暂用 ID 兜底,折叠状态下用户看不到真实文件夹名。规划:从 `folderService.getById` 取真名异步注入。

### 3.3 路由权限

**当前没有按角色过滤路由**。所有登录用户都能进所有页面;后端在每个 handler 自己做 RBAC 校验(参见 `permissionService` / `authService`)。`useAuthStore.user.role` 只有 `'ADMIN' | 'EDITOR' | 'USER'` 三档,但前端 sidebar / route 都不读它做 gate。

ChangePasswordPage 是个例外:它通过 `location.state.firstLogin === true` 决定是否锁死 "返回" 按钮(`ChangePasswordPage.tsx:407-418`)。

---

## 4. 鉴权守卫(`components/auth/AuthGuard.tsx`)

### 4.1 行为

```tsx
export function AuthGuard({ children }) {
  const { isAuthenticated, logout } = useAuthStore();
  const [isValidating, setIsValidating] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) { setIsValidating(false); return; }
    const validateSession = async () => {
      try {
        const res = await authService.getCurrentUser();
        if (res.code !== 200 || !res.data) { logout(); }
        else {
          // 重写 user 字段,确保 role / nickname / avatar 来自后端权威
          useAuthStore.setState({ user: { ... } });
        }
      } catch { logout(); }
      finally { setIsValidating(false); }
    };
    validateSession();
  }, [isAuthenticated, logout]);

  if (isValidating) return null;        // 静态白屏 → 防闪烁
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
```

### 4.2 与 token / session 的关系

- `useAuthStore` 仅持久 `isAuthenticated`(`authStore.ts:43-46`),**真正的鉴证介质是 backend 下发的 HttpOnly cookie**
- AuthGuard 看到 `isAuthenticated=true` → 主动调一次 `/v1/auth/me` 验真,400/401 → `logout()` + `<Navigate to="/login">`
- 同时把 `roles[0]` 退化为单数 `role`,写入 `user`。可见性高的字段(nickname / avatar)也实时刷新

### 4.3 Login 后的跳转

`LoginPage.tsx:39-62`:

```ts
const from = (location.state as any)?.from?.pathname || '/';
navigate(from, { replace: true });
```

被 redirect 进 login 时,AuthGuard 已通过 `<Navigate state={{ from: location }}>` 把目标路径塞进去 → 登录后回到原页面。

### 4.4 流式接口的 401 续期

`hooks/useStreamResponse.ts:134-145`:

- 第一发 401 → 静默调 `/v1/auth/refresh`(依赖 cookie)
- 成功 → 重建 RequestInit,**重读 token**(防止 stale)再发一次
- 失败 → 透传 HTTP 错误,UI 自行处理

---

## 5. 布局壳:`AdminLayout`

`components/layout/AdminLayout.tsx:12-64`

```tsx
export function AdminLayout() {
  const { isCollapsed, isAutoCollapsed } = useSidebarStore();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const location = useLocation();
  const isAppPage =
    location.pathname.startsWith('/media') ||
    location.pathname.startsWith('/posts/ai-writing');
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // ⌘K / Ctrl+K 全局命令面板
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setCmdkOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-dvh bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative z-0 overflow-hidden">
        <MobileHeader />
        <main className={cn(
          "flex-1 relative overflow-auto overscroll-contain",
          isAppPage ? "p-0" : "p-4 md:p-6"
        )}>
          <Suspense fallback={<LoadingSpinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette isOpen={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </div>
  );
}
```

关键点:

1. **`h-dvh`**(动态视口高度) — iOS 地址栏伸缩时不抽搐
2. **`isAppPage`**:媒体库 / AI 协同写作走"自管 padding + 自管滚动"策略;其他页面统一加 `p-4 md:p-6`
3. **二级 Suspense**:页面级 fallback,套在 App 顶层 Suspense 内 — 路由切换不会出现整页 reset
4. **`z-0` 层叠上下文**:防止页面里二级抽屉(媒体库 FolderTree / AI 协同写作 sidebar)透过去把主侧栏盖住
5. **CommandPalette** 由 layout 持有 + 全局 keydown 监听,任何子页面都能 ⌘K 唤出

---

## 6. 侧边栏(`components/layout/Sidebar.tsx`,574 行)

### 6.1 导航分组

`Sidebar.tsx:41-80` 把 17 个一级页面分成 4 组(Control Room 风格):

```ts
OVERVIEW       Dashboard, Analytics
CONTENT        Posts, Media, Cloud Explorer, Categories, Comments, Friends
INTELLIGENCE   AetherHub, AI Tools, AI Config, Search Config
SYSTEM         Monitor, Activities, Settings
```

折叠态下:分组 label 隐藏 → 改成短分隔线;按钮居中,只显示 icon。

### 6.2 折叠 / 抽屉状态

| 字段 | 值 | 来源 |
| --- | --- | --- |
| `isCollapsed` | 用户偏好(persist) | `useSidebarStore` |
| `isAutoCollapsed` | 临时覆盖(专注模式 / 移动端切桌面边界) | 同上 |
| `isMobileOpen` | 移动端抽屉显隐 | 同上 |

`effectiveCollapsed = isCollapsed || isAutoCollapsed`,渲染时只看 effective。手动 toggle 会清掉 `isAutoCollapsed`(`sidebarStore.ts:23-30`),让用户的显式操作覆盖系统自动态。

### 6.3 移动端抽屉

`Sidebar.tsx:171-191`:

- 抽屉宽度:`w-[65vw] max-w-[220px]`(从原来的 80vw 收紧;太宽时阅读区被挤掉一半)
- 半透明背景:`bg-background/80 backdrop-blur-sm`
- 用 `viewTransitionName: 'admin-sidebar-drawer'` 触发原生 view-transition,iOS Safari 支持后会有过渡
- 点击外部 / 点击关闭按钮 / 点击导航项都会调 `setMobileOpen(false)`

### 6.4 站内搜索

侧边栏顶端有 "搜索文章 / 媒体 / 分类 / 标签..." 输入(`Sidebar.tsx:329-380`):

- 搜索框输入 → 打开 `SidebarSearchPalette`(下方 portal,与输入框共享 anchorRef)
- Enter 兜底跳 `/posts?search=<q>`(防 palette debounce 还没填 items 时,Enter 也得有反应)
- ⌘K / Ctrl+K 由 AdminLayout 监听 → 打开 `CommandPalette`(全局命令)

> 两套搜索体验:Sidebar 输入是"对实体的语义检索",CommandPalette 是"对页面 / 操作的命令检索"。前者面向内容,后者面向能力。

### 6.5 用户区

底部用户头像 + 昵称 + role + 主题切换 + 退出。
- 头像走 `getMediaUrl(user.avatar)`(`mediaService.ts:210-219`)解析 cdnUrl / 本地路径
- 主题切换调 `useTheme().toggleThemeWithAnimation(x, y)`,基于点击坐标用 view-transition 做"圆形扩散"切色

---

## 7. `MobileHeader`(`components/layout/MobileHeader.tsx`,38 行)

只在 `md:hidden` 显示。包含汉堡按钮 + Logo + 站点名渐变文字。点汉堡 → `useSidebarStore.toggleMobile()`。

桌面端没有顶部 Header;`Header.tsx`(`components/layout/Header.tsx:6-72`)早期实现,**当前未被任何页面使用**(import 全无);保留可能为未来"通知 + 命令"留入口。建议清掉。

---

## 8. 命令面板(`components/common/CommandPalette.tsx`,243 行)

### 8.1 命令注册

写死 14 条命令(`CommandPalette.tsx:59-94`),分三组:

- `NAVIGATE`:dashboard / analytics / posts / media / categories / comments / friends / ai-tools / ai-config / search / monitor / settings(12 条)
- `CREATE`:新建文章
- `SYSTEM`:切换主题、退出登录

### 8.2 交互细节

- `↑↓` 移动 active idx,`Enter` 执行,`Esc` 关闭
- `query` 模糊匹配 label / hint / keywords 任一字段
- 选中项左侧画一条 `from-aurora-1 via-aurora-2 to-aurora-3` 的渐变指示线(`CommandPalette.tsx:205-210`)
- 退出登录:先 `authService.logout()`(失败也继续) → `useAuthStore.logout()` → `navigate('/login')` → `onClose()`

### 8.3 局限

- 命令是硬编码的,不能从权限里推 — 没登录管理员的角色禁用某项命令
- 不支持 fuzzy(只是 substring),"Posts" 搜不到 "wenzhang"

---

## 9. 焦点 / 专注模式(`contexts/FocusModeContext.tsx`)

- `⌘.` / `Ctrl+.` 切换;`Esc` 退出
- 切到 true → `document.documentElement` 加 `data-focus-mode="true"` → CSS 选择器自动收缩 sidebar / 隐藏次级控件
- 不是 react-state 控的视觉 — 通过属性钩 `tokens.css` 的 reduced 变体,降低多层 re-render 负担
- HMR 期间组件渲染在 Provider 之外时,`useFocusMode()` 优雅降级返回 noop(`FocusModeContext.tsx:50-55`)

---

## 10. 数据流示例:首页登录→进 Dashboard

```
1. 用户访问  /admin/             (生产 nginx 反代到 SPA)
   ├─ Vite-built index.html → main.tsx
   ├─ Provider 链 inflate
   └─ <App><BrowserRouter basename="/admin">

2. /  (匹配根) → AuthGuard
   ├─ useAuthStore 读 localStorage("aetherblog-auth")
   │   ├─ 存在 isAuthenticated=true → 进入  validateSession()
   │   │   └─ authService.getCurrentUser() → /v1/auth/me
   │   │       └─ 200 → 重写 user → setIsValidating(false) → 渲染子树
   │   └─ 不存在 → setIsValidating(false) → <Navigate to="/login" state={{from}}>
   └─ 子树渲染 AdminLayout → <Outlet/> → DashboardPage

3. DashboardPage 挂载
   ├─ useEffect 拉 analytics.getDashboard() / .getAiDashboard() / .getVisitorTrend()
   ├─ 所有失败回退到 mockData(防演示环境白屏)
   └─ 渲染 8 张 StatsCard + 5 张图表 + 系统监控区(SystemTrends 等)
```

---

## 11. 设计系统应用点

| 元素 | 来源 |
| --- | --- |
| Sidebar 表面 | `bg-[var(--bg-overlay)] backdrop-blur-md`(`surface-overlay` 的近亲变体) |
| 抽屉过渡 | `viewTransitionName: 'admin-sidebar-drawer'` —— browser-native view transitions |
| Active nav item | `bg-primary text-white` —— 这里 `bg-primary` 是 admin scope 的 `--color-primary`(近黑) |
| Group label | `font-mono text-[10px] uppercase tracking-[0.18em]` —— Codex caption 范式 |
| Footer 用户区 | `--bg-card-hover` / `--text-secondary` / `bg-status-success`(未读小绿点) |
| Toaster | `richColors position="top-center"` —— sonner 内置主题已和 token 对齐 |

---

## 12. 已知限制 / 待改进

1. **无路由级权限**。`role: USER` 可见所有 sidebar 项;靠后端 403 兜底。修建议:在 `Sidebar.navSections` 上加 `requiredRoles?: User['role'][]`,渲染时 filter。
2. **`Header.tsx` 是死代码**。建议删除。
3. **`FolderPermissionsWrapper` 用 ID 当文件夹名**。可以用 `folderService.getById` 注入真名,或者把权限 UI 内嵌到 MediaPage 的 detail drawer 而不是独立路由。
4. **AuthGuard 在 `isValidating` 时返回 `null`**。极端慢网络(2-3s 验证延迟)用户会看到白屏。考虑改成"短暂闪现 LoadingOverlay"或者用 React Query 的 `keepPreviousData`。
5. **`isAppPage` 是路径前缀启发式**,以后新增需要"自管布局"的页面时容易漏(比如新加 `/storage/explorer` 没纳入 → 拿到 `p-4 md:p-6`,实际 CloudExplorerPage 内部又自管 padding,造成嵌套)。建议改成路由 metadata `{ fullbleed: true }`。
6. **Sidebar 行内常量**(导航项)、`CommandPalette` 命令表 是两套独立列表。新增页面要两处都改。可以共享一份 `Page Registry`。
