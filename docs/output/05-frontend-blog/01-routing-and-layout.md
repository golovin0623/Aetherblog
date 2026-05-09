# 01 · 路由约定与全局壳

> Next.js 15 App Router 的 special files 在 `apps/blog/app/` 顶层全部齐备:layout / template / providers / not-found / manifest / globals.css。本文逐文件描述责任与协作。

---

## 1 · 范围

- `apps/blog/app/layout.tsx`(根 layout,RSC + async)
- `apps/blog/app/template.tsx`(每次导航重渲染)
- `apps/blog/app/providers.tsx`(QueryClient + ThemeProvider)
- `apps/blog/app/components/ClientLayout.tsx`(TransitionProvider + 全局锚点拦截)
- `apps/blog/app/components/PageTransition.tsx`(滑动 / fade 路径过渡)
- `apps/blog/app/components/SiteSettingsProvider.tsx`(把 admin 设置应用到前台)
- `apps/blog/app/components/FontProvider.tsx`(动态字体覆盖)
- `apps/blog/app/components/BlogHeader.tsx`(全站 sticky header)
- `apps/blog/app/components/FloatingThemeToggle.tsx`(移动端右下角主题切换)
- `apps/blog/app/globals.css`(入口 CSS)
- `apps/blog/app/manifest.ts` / `not-found.tsx`

---

## 2 · 渲染管线总览(自顶向下)

```text
RootLayout(RSC, async)             ← layout.tsx
 ├─ <html lang=zh-CN>
 │   ├─ <head> themeFoucGuardStyle + themeInitScript + 字体 link
 │   └─ <body>
 │      └─ <Providers>             ← providers.tsx (Client)
 │         ThemeProvider (@aetherblog/hooks)
 │         └─ <QueryClientProvider>
 │            └─ <SiteSettingsProvider settings={...}>
 │               └─ <FontProvider initialFont={...}>
 │                  ├─ <BlogHeader />        ← sticky,响应 path 变化
 │                  ├─ <ClientLayout>       ← components/ClientLayout.tsx
 │                  │   <TransitionProvider>
 │                  │      <VisitTracker />
 │                  │      <ScrollToTop />
 │                  │      <main id=main-content>
 │                  │         <PageTransition>
 │                  │            {children}  ← template.tsx 包裹
 │                  │         </PageTransition>
 │                  │      </main>
 │                  │   </TransitionProvider>
 │                  ├─ <FloatingThemeToggle />
 │                  └─ ...
```

注意 `template.tsx` 是 Next.js 的 special file,**它本身就被框架包到 layout 与 page 之间**;`apps/blog/app/template.tsx:9` 简单地把 children 喂给 `<PageTransition>`。但 `ClientLayout` 内部又渲染了一层 `<PageTransition>`(`ClientLayout.tsx:54`),即同一棵树有**两个** PageTransition。看起来重复,实际上 `template.tsx` 才是会因路由变化重新挂载的那一层 —— 框架视角它每次切路由都会 unmount;而 `ClientLayout` 里的 PageTransition 跨路由保持 TransitionContext 一致。这是有意为之的"双层"动画框架,但有冗余风险,见 `已知限制`。

---

## 3 · `layout.tsx` —— 根 layout(RSC)

**入口:** `apps/blog/app/layout.tsx:61`

**职责清单:**

1. **生成 `<html>` 与 `<body>`**:`<html lang="zh-CN">` 永久写死中文。`suppressHydrationWarning` 容忍 themeInitScript 在水合前修改 className。
2. **viewport 配置**(`layout.tsx:20`):`themeColor` 用 `prefers-color-scheme` 双值,移动端 URL bar 跟随暗色背景。
3. **字体加载**(`layout.tsx:27`):`next/font/google` 加载 Inter / Playfair Display / Noto Serif SC,用 CSS 变量(`--font-inter` 等)在 body 上挂。`Noto_Serif_SC` 的 `preload: false` 是因为它体积大,留给需要中文衬线的页面按需加载。
4. **`generateMetadata()` 异步**(`layout.tsx:31`):RSC 拉一次 `getSiteSettings()` 拼出 title/description/keywords/icons;`metadataBase` 防止 OG 图相对路径报错。
5. **FOUC 防护双件套**(`layout.tsx:98`):
   - `<style dangerouslySetInnerHTML={{ __html: themeFoucGuardStyle }} />`:把 `.dark` / `.light` 类对应的背景色直接写在 inline style,在外部 CSS 加载完成前就上色。
   - `<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />`:从 localStorage / matchMedia 读出主题并立即给 `<html>` 加 class —— 必须在 inline style 之后,这样第一帧就匹配上规则。
   - 这两段都从 `@aetherblog/hooks` 导入(`packages/hooks/src/themeConstants.ts`),保证 admin 与 blog 同步。
6. **字体覆盖系统**(`layout.tsx:67-91`):站长在 admin 选了 `serif-elegant` / `lora` / `merriweather` 时,服务端就把 `--font-sans-override` 写到 `<html style>`,并打 `font-override` class。`globals.css:23` 通过 `html.font-override body { font-family: var(--font-sans-override) !important }` 覆盖整站字体。这样在 SSR 阶段已经是最终字体,无 hydration 闪。Lora / Merriweather 仍要客户端 `<link rel=stylesheet>` 加载,layout.tsx:103 直接渲染 `<link>` 标签,跟系统 `next/font` 走两条路。
7. **核心 Provider 嵌套**(`layout.tsx:110`):
   - `<Providers>` —— ThemeProvider + QueryClientProvider
   - `<SiteSettingsProvider settings={...}>` —— 接 admin 主色 / 自定义 CSS / 强制暗黑
   - `<FontProvider initialFont={...}>` —— 双向同步,服务端 SSR 已经设好,客户端只是 hydration

为什么 SiteSettings 在 Providers 之后:它 `useEffect` 里要操作 DOM(`document.head.appendChild`、`document.documentElement.classList.add`),所以必须是 Client。但 ThemeProvider 内部也 setupTheme,顺序很重要 —— SiteSettings 的 `force-dark` 要先于 ThemeProvider 的 localStorage 读取,所以 SiteSettingsProvider 只 set localStorage 不 set class,让 ThemeProvider 在挂载时读到正确值。

---

## 4 · `template.tsx`(`template.tsx:9`)

整个文件只有 11 行:

```tsx
'use client';
import { PageTransition } from './components/PageTransition';
export default function Template({ children }) {
  return <PageTransition>{children}</PageTransition>;
}
```

Next.js 的 `template.tsx` **每次路由变化都会 remount**,而 `layout.tsx` 跨路由保持。把 PageTransition 放在 template,是为了让 `<motion.div key={pathname}>` 的 `AnimatePresence` 触发 exit 动画 —— 否则同一个 motion.div 在 layout 中始终存在,framer-motion 检测不到 unmount,exit 动画就不发生。

但同样的 PageTransition 也被 `ClientLayout.tsx:54` 挂在 ClientLayout 里。这是**冗余的**:从代码读起来 ClientLayout 里那一层 `<PageTransition>` 实际上每次路由变化也 remount(因为 template 重建整棵子树),所以两层动画会**叠加**。实测视觉上不易察觉,因为 PageTransition 的 motion.div 大多数情况下 `shouldAnimate` 为 false。建议未来精简为只在 template 里一层。

---

## 5 · `providers.tsx`(`providers.tsx:7`)

```tsx
ThemeProvider(@aetherblog/hooks)
  └─ QueryClientProvider
     └─ children
```

QueryClient 用 `useState` lazy init,SSR 友好(每次请求新建,避免跨请求泄漏)。默认 `staleTime: 5min` / `gcTime: 10min` / `refetchOnWindowFocus: false` —— 博客读多写少,这套配置避免无谓刷新。

---

## 6 · `ClientLayout.tsx`(`components/ClientLayout.tsx:14`)

放在 layout 内、template 之前,**跨路由持久化**。三个职责:

1. **`TransitionProvider`** —— `PageTransition.tsx:42`,管理 popstate 检测、direction 计算、popNavPendingRef 标记。详见 §7。
2. **副作用挂载**:`<VisitTracker>` 上报访问、`<ScrollToTop>` 右下角浮动按钮。
3. **全局锚点拦截**(`ClientLayout.tsx:18`):`useEffect` 在 document 上挂 click handler,捕获 `<a href="#xxx">`,调 `target.scrollIntoView({ behavior: 'smooth' })` 并把焦点移到目标元素(临时 tabindex=-1)。这是为了对 `prefers-reduced-motion: reduce` 用户改成 `auto`,无障碍合规。

为什么不用 `<html data-scroll-behavior="smooth">`(layout.tsx:83 已经设了)?CSS scroll-behavior 在 Next.js 路由切换时会让 `scrollTo(0,0)` 也变成平滑,与 PageTransition 的瞬时切换冲突,看起来"页面在退场时还在滚"。所以 CSS 只对锚点跳转生效是不可控的,作者用 JS 拦截显式控制。

---

## 7 · `PageTransition.tsx` 的两层结构

### 7.1 `TransitionProvider`(`PageTransition.tsx:42`)

- 用 `usePathname()` + `useRef` 比较前后 pathname,计算 direction。
- 监听 `popstate` 事件 → 设 `popNavPendingRef.current = true` + `<html data-nav-type="pop">` —— 让 globals.css 里的 `[data-nav-type=pop] [data-fade-in] { animation: none }` 跳过入场动画(对应浏览器返回时 bfcache 已经恢复内容,不需要再 fade)。
- 2 帧后 `requestAnimationFrame` 内清理 `dataset.navType` 与 `popNavPendingRef`,即使 hash/query popstate 也能干净恢复。

### 7.2 `PageTransition`(`PageTransition.tsx:171`)

- 仅对 `/posts` ↔ `/timeline` 与"进/出文章详情"两种切换做动画。
- 移动端 + iOS PWA standalone 检测后强制降级成纯 opacity,避免 transform 引起的 WKWebView 合成层闪烁(`PageTransition.tsx:177`)。
- `motion.div` 用 `key={pathname}` 配合 `AnimatePresence mode="wait"` 串行 exit→enter。

### 7.3 与 viewTransition 的关系

`next.config.ts:11` 启用了 Next.js 15 实验性 `experimental.viewTransition`,文章卡片到详情页的标题用 CSS `view-transition-name` 实现 morph(`ArticleCard.tsx:106`、`posts/(article)/[slug]/page.tsx:157`)。这个 morph 与 PageTransition 的 fade 是**同时**发生的:fade 控制整个 page 的入场,view-transition 控制具体 H1 元素的位置 morph,两者不冲突。

---

## 8 · `BlogHeader.tsx` —— 全局 sticky header

入口:`components/BlogHeader.tsx:26`,长度近 580 行。要点:

1. **路径感知导航**(`BlogHeader.tsx:53,67`):`activePage` 状态由 pathname 推导;切路由时立即乐观更新(`handleNavClick:99` 调用 `router.push(..., { scroll: false })`),避免 `aria-current` 闪烁。
2. **Agent 工作台豁免**(`BlogHeader.tsx:36,270`):`pathname.startsWith('/agent/workspace')` 时整个 header `return null`。但 `return` 必须放在所有 hooks 之后(React Rules of Hooks),所以代码刻意把 early return 放到 268 行,保留前面所有 useEffect / useCallback 调用。
3. **滚动隐藏(仅文章详情页)**(`BlogHeader.tsx:185`):向下滚 18px 折叠,向上滚 28px 恢复。`requestAnimationFrame` 节流。
4. **聚光灯效果**(`BlogHeader.tsx:128`):`useSpotlightEffect({ fixed: true })` —— fixed 元素直接用 `clientX/clientY`,无需 `getBoundingClientRect`。
5. **Cmd/Ctrl+K 全局搜索**(`BlogHeader.tsx:147`):捕获快捷键打开 SearchPanel。
6. **iOS 21 segmented control**(`BlogHeader.tsx:373`):首页/时间线胶囊滑块,80px 宽度精确像素值,亮暗双胶囊用 opacity 切换。
7. **admin 入口的优雅降级**(`BlogHeader.tsx:542`):`buildAdminUrl()` 失败时按钮 disabled + tooltip 解释原因(`getAdminLinkConfig().reason`)。详见 `lib/adminUrl.ts`。

设计系统应用点:
- `surface-leaf`(MobileNavSwitch 容器);
- `--aurora-1` 作为 active 状态色(`text-[var(--aurora-1)]`,`BlogHeader.tsx:455`);
- `breath-soft 2.4s` 呼吸光点(`BlogHeader.tsx:459`);
- `aurora-divider` 伪元素细线分割 header / content(`BlogHeader.tsx:570`);
- `header-shadow` token + `var(--bg-overlay)` 背景 + `backdrop-filter: blur(24px) saturate(140%)`。

---

## 9 · `globals.css` 注入顺序

`app/globals.css:1-9`:

```css
@import '../../../packages/ui/src/styles/tokens.css';
@import '../../../packages/ui/src/styles/surfaces.css';
@import '../../../packages/ui/src/styles/typography.css';
@tailwind base;
@tailwind components;
@tailwind utilities;
```

顺序很关键:Codex 三件套必须在 `@tailwind base` 之前 —— Tailwind preflight 会重置一些值,如果在 token 之前加载,自定义 CSS variables 会被 preflight 之后的浏览器默认覆盖。

之后的 globals.css 主要是:
- `html.font-override` 字体覆盖(`globals.css:23-39`)
- `:root` / `:root.light` / `:root.dark` 完整 token 集(legacy + Codex 共存)
- 各种 `@keyframes`(shimmer / fadeInUp / breath-soft / theme-transition-glow / spotlight 等)
- `[data-nav-type="pop"] [data-fade-in]` 跳过动画规则
- `aurora-divider` 等签名细节伪元素
- markdown body 排印细则(`.prose` 覆盖)

详细颜色对照 → `05-design-implementation.md` §3。

---

## 10 · `manifest.ts` & `not-found.tsx`

- **`manifest.ts`**(`manifest.ts:4`):`MetadataRoute.Manifest` 函数,Next.js 在 build 时调用一次。读 `getSiteSettings()` 后写入 name/short_name/description,**icons 仅在 settings 提供 avatar 时填**;否则 PWA 安装会缺少图标(可接受,因为 `apple-touch-icon` 已经在 layout.tsx:46 通过 metadata.icons 提供了)。
- **`not-found.tsx`**(`not-found.tsx:8`):Client 组件,framer-motion `motion.div` + lucide `FileQuestion` 图标 + `router.back()` + Cmd/Ctrl+K 提示。Codex 应用:`bg-clip-text bg-gradient-to-r from-primary/20 to-accent/20` 让 "404" 字符成为半透明大字。

---

## 11 · 已知限制

1. **PageTransition 双层挂载**:template.tsx 与 ClientLayout.tsx 各挂一次,实际生效的是 template 那层。建议精简。
2. **`<link rel="stylesheet">` 直接写在 `<head>` 中**(layout.tsx:103):Lora / Merriweather 等 Google Font 还是会触发 render-blocking 请求,没有走 `next/font` 的 self-host。这是因为站长可以"运行时"选字体,而 `next/font/google` 是构建时优化,无法配合。可接受的取舍。
3. **`generateMetadata` 与 RootLayout 各 `await getSiteSettings()`**:虽然 `React.cache()` 保证只发一次请求,但 typescript 类型上还是两次 await,代码里要小心二者实现一致。
4. **`<html data-scroll-behavior="smooth">`(layout.tsx:83)与 ClientLayout 的 JS 拦截重复**:JS 实际上覆盖了 CSS 设置,可删 dataset。
5. **`AbortSignal.timeout(3000)` 仅用于 `getSiteSettings`**(`services.ts:93`),首页冷启快;但 `getRecentPosts` 是 5000ms,一旦后端慢,首屏 5s 后才走 fallback,SSR 阶段卡。这个值需要根据 server-go 实际响应时间分位数调优。

---

## 12 · 性能注意点

- **FOUC 防护**:themeFoucGuardStyle + themeInitScript 必须 inline,不能放到 external。一旦延迟,暗色主题用户在"白屏闪烁"中看到 200~500ms 的反色页面。
- **避免在 layout 引入大型 client 组件**:目前 layout.tsx 里只有 BlogHeader / ClientLayout / FloatingThemeToggle,合理。新增"全站功能"前先评估是否能做成路由内的局部 client。
- **TransitionContext 的 ref 而非 state**:`PageTransition.tsx:43-47` 全用 `useRef`,改 ref 不触发 re-render,让 PageTransition 内部 motion.div 的 props 重算靠 React 的同步渲染机制。如果改成 useState 会出现"导航后多渲染一帧"的浪费。
