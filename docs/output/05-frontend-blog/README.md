# 05 · Frontend Blog · 总体设计

> AetherBlog 公开访问端,Next.js 15.1.3 + React 19 + TypeScript 5.7,App Router,设计哲学 Aether Codex。本节文档仅覆盖 `apps/blog/`(发现层 + 阅读层 + Agent 入口),不含 admin 后台。

基线版本:Next.js 15.1.3 / React 19 / TS 5.7.2 / Tailwind 3.4.17,文档对齐工作目录 2026-05-08 commit。

---

## 1 · 模块定位

`apps/blog` 在三层产品中扮演的角色:

| 层 | 责任 | 主要消费方 |
|:---|:---|:---|
| **Reader Surface(本模块)** | 文章发现、阅读、评论、订阅、AI 问答前端 | 终端访客 |
| Editor Surface(`apps/admin`) | 文章/资源/AI/系统设置后台 | 站长、协作编辑 |
| Backend(`apps/server-go` + `apps/ai-service`) | API、JWT、对象存储、SSE 流、向量检索 | 上述两端 |

它是**面向匿名访客**的内容产品,因此:
- 默认全部公开路由 + Server Components;只有评论提交、密码验证、Agent 工作台需要登录。
- 渲染策略偏向 SSG / ISR(SEO),少数纯互动页(`/posts` 列表分页、`/friends` 视图切换、`/agent/workspace`)用 Client Components。
- 设计目标是 Apple-grade 阅读质感(Aether Codex),不是后台仪表盘。

工作目录入口:
- `apps/blog/app/`(整个 App Router 根)
- `apps/blog/next.config.ts:1` —— rewrites + headers + image whitelist
- `apps/blog/package.json:1` —— 依赖清单
- `apps/blog/tailwind.config.ts:1` —— 继承顶层 packages/ui 的 tokens

---

## 2 · 路由树(完整)

```
apps/blog/app/
├─ layout.tsx                 // RSC · 站点壳(字体/Provider/Header/FOUC)
├─ template.tsx               // Client · 每次导航重渲染,触发 PageTransition
├─ providers.tsx              // Client · QueryClientProvider + ThemeProvider
├─ page.tsx                   // RSC · 首页(ISR 300s),HeroParallaxContent + 6 篇 ArticleCard
├─ not-found.tsx              // Client · 404
├─ manifest.ts                // RSC · PWA manifest(动态读取 site_settings)
├─ globals.css                // 入口 CSS,@import packages/ui 的 tokens/surfaces/typography
│
├─ posts/
│  ├─ page.tsx                // Client · 列表(useQuery + 分页),不走 ISR
│  ├─ loading.tsx             // 骨架屏
│  ├─ PostsLoading.tsx        // 共享骨架组件
│  └─ (article)/              // route group: 给详情页独立 Suspense 边界
│     ├─ layout.tsx           // pass-through,只是隔离 loading
│     ├─ loading.tsx          // 详情页骨架
│     └─ [slug]/
│        ├─ page.tsx          // RSC · cache:'no-store',直接 fetch backend
│        └─ loading.tsx       // 同上骨架
│
├─ timeline/
│  ├─ page.tsx                // RSC(ISR 300s),服务端分组归档
│  └─ loading.tsx
│
├─ about/
│  ├─ page.tsx                // RSC(ISR 600s),把 settings/stats 喂给 client
│  ├─ loading.tsx
│  ├─ AboutClient.tsx         // 8 节深浅交替的 ScrollSection
│  ├─ components/             // ScrollSection / FeatureCard / AnimatedCounter
│  └─ sections/               // Hero / Design / Ai / Search / Editor / TechStack / Security / AuthorCTA
│
├─ design/
│  ├─ page.tsx                // RSC(ISR 600s),设计推理链落地页
│  ├─ loading.tsx
│  ├─ DesignClient.tsx        // 8 节(Manifesto/Color/Type/Surface/Motion/Signature/Reasoning/CTA)
│  ├─ components/             // ScrollSection / TypeScaleRow / HueSlider / EaseCurveViz / ...
│  └─ sections/               // S1..S8
│
├─ friends/
│  ├─ page.tsx                // RSC(force-dynamic,revalidate=0)
│  ├─ FriendsList.tsx         // Client · 列表/蜂窝双视图,localStorage 记忆
│  └─ FriendsLoading.tsx
│
├─ agent/
│  ├─ page.tsx                // RSC(ISR 600s) Agent 入口落地页
│  ├─ loading.tsx
│  ├─ AgentLandingClient.tsx  // 5 节叙事:Hero → Manifesto → Capabilities → Modes → Enter
│  ├─ sections/               // Hero / Manifesto / Capabilities / Modes / Enter
│  ├─ login/
│  │   ├─ page.tsx            // RSC,把 next? 透传给 LoginClient
│  │   └─ LoginClient.tsx     // 复用后端 /api/v1/auth/login
│  ├─ workspace/              // 全屏 app shell(BlogHeader/Footer 全部隐藏)
│  │   ├─ page.tsx            // RSC,robots:noindex
│  │   ├─ WorkspaceClient.tsx // sidebar + topbar + composer + thread
│  │   └─ components/         // Sidebar / Composer / MessageBubble / ModeSwitch /
│  │                          //   ModelPicker / SlashCommandPicker / TagPicker /
│  │                          //   ArticlePicker / PickerPopover / StreamMarkdown /
│  │                          //   WorkspaceSkeleton
│  └─ lib/                    // agentAuth / agentChatStream / agentSessions /
│                             //   agentResources / agentModels / cjkMarkdown / smooth
│
├─ components/                // app 内私有组件(不导出给其他 app)
│  ├─ BlogHeader.tsx          // sticky,跨页
│  ├─ MobileMenu.tsx · MobileNavSwitch.tsx · MobileBottomPullNav.tsx
│  ├─ ClientLayout.tsx        // TransitionProvider + VisitTracker + ScrollToTop + 全局锚点拦截
│  ├─ PageTransition.tsx      // /posts ↔ /timeline 滑动,文章详情 fade
│  ├─ FontProvider.tsx · SiteSettingsProvider.tsx · FloatingThemeToggle.tsx
│  ├─ MarkdownRenderer.tsx    // ReactMarkdown + remark/rehype + Shiki + Mermaid + KaTeX
│  ├─ AlertBlock.tsx · ProtectedPostContent.tsx · CommentSection.tsx
│  ├─ TableOfContents.tsx · ArticleFloatingActions.tsx · ReadingProgress.tsx
│  ├─ SearchPanel.tsx         // ⌘K 全局,POST /api/v1/public/search + EventSource /qa
│  ├─ ArticleCard.tsx · FeaturedPost.tsx · AuthorProfileCard.tsx
│  ├─ FriendCard.tsx · FriendIconBubble.tsx
│  ├─ HeroParallaxContent.tsx · StackedParallax.tsx · FadeIn.tsx
│  ├─ TimelineTree.tsx · PostNavigation.tsx
│  ├─ MiniMarkdownPreview.tsx · BackButton.tsx · ScrollToTop.tsx
│  ├─ SiteFooter.tsx · ViewModeToggle.tsx · VisitTracker.tsx
│  └─ index.ts                // 导出 ArticleCard / FriendCard / SearchPanel / TimelineTree / TableOfContents / ScrollToTop(供测试用)
│
├─ hooks/
│  └─ useSpotlightEffect.ts   // 鼠标跟随径向高光,radial-gradient + rAF
│
└─ lib/
   ├─ api.ts                  // API_ENDPOINTS,根据 isServer 切换 Docker 内网 / 相对路径
   ├─ services.ts             // server-side fetch + React.cache + ISR 元数据(revalidate)
   ├─ adminUrl.ts             // NEXT_PUBLIC_ADMIN_URL 解析,失效时降级隐藏
   ├─ sanitizeUrl.ts          // sanitizeImageUrl + sanitizeUrl(VULN-079/081 防御)
   ├─ socialLinks.ts          // platform → iconify URL 映射,含暗色覆盖
   ├─ headingId.ts            // 预计算标题 id Map,避免 React 并发渲染下 ID 漂移
   ├─ remarkAlertBlock.ts     // :::warning{title} → <alert-block>
   └─ logger.ts               // 仅开发期 console.log,生产 noop
```

无 `apps/blog/components` 或 `apps/blog/hooks` 目录(顶层目录)—— 全部内置在 `app/` 下。Tailwind content 包括 `./components/**` 是 Next 模板默认值,实际不生效,无影响。

---

## 3 · 渲染策略矩阵

| 路由 | 形式 | 数据来源 | revalidate / cache |
|:---|:---|:---|:---|
| `/` | RSC | `getRecentPosts(6)` + `getSiteSettings()` | `revalidate = 300` |
| `/posts` | **Client** | useQuery + 分页 | client-side cache 5min |
| `/posts/[slug]` | RSC | 直接 fetch backend(`cache:'no-store'`) + adjacent(300s) | per-request |
| `/timeline` | RSC | `getTimelinePosts()` + 服务端分组 | `revalidate = 300` |
| `/about` | RSC + Client | `getSiteSettings` + `getSiteStats` → AboutClient | `revalidate = 600` |
| `/design` | RSC + Client | `getSiteSettings` → DesignClient | `revalidate = 600` |
| `/friends` | RSC | `getFriendLinks()` | `revalidate = 0`(force-dynamic) |
| `/agent` | RSC + Client | `getSiteSettings` → AgentLandingClient | `revalidate = 600` |
| `/agent/login` | RSC + Client | searchParams.next → LoginClient | per-request |
| `/agent/workspace` | RSC + Client | `getSiteSettings` → WorkspaceClient | metadata-only,robots:noindex |

**关键决策:**

1. **首页用 RSC + ISR 而非 SSG**:站长在 admin 修改 `welcome_*` 字段后,5 分钟内自动反映,不需要 webhook 触发 revalidatePath。
2. **`/posts` 反直觉地用 Client + useQuery**:列表分页交互(查看具体页 / 翻页平滑滚动)涉及客户端状态,完全 RSC 必须把分页变成 URL query 才合理,但作者选择 useQuery 复用首屏的 `staleTime: 5min` 缓存。代价是首屏没有 SEO,只能靠 `/`(收录最新 6 篇)兜底。
3. **`/posts/[slug]` 用 `cache: 'no-store'`**:文章页不走 ISR —— `viewCount` 必须实时,但 `getAdjacentPosts` 用 300s。这是性能 vs 实时性的折中。
4. **`/friends` 强制 dynamic**:友链是站长频繁手动调整的低频读路径,作者直接 `force-dynamic` 跳过缓存来避免"刚加的友链没出现"的支持工单。
5. **`/agent/workspace` 全屏接管**:`BlogHeader.tsx:36,270` 显式 `pathname.startsWith('/agent/workspace')` 时 return null;`FloatingThemeToggle.tsx:37` 同样规避。这是 PWA 内当独立 app 用的"app shell"模式。

---

## 4 · 数据获取链路

```
浏览器
  ↓                                     ↓
SSR(node)                             CSR(browser)
  ↓                                     ↓
lib/api.ts API_BASE_URL              ""  (相对路径)
  = process.env.API_URL               ↓
  = http://backend:8080         /api/v1/public/...
  (Docker 内网)                       ↓
  ↓                                Next.js rewrites
fetch ${API_BASE_URL}/api/...   = ${API_URL}/api/:path*
  ↓                              (next.config.ts:40)
backend(server-go)
```

`lib/api.ts:9` 通过 `typeof window === 'undefined'` 判断切换 BASE_URL —— 服务端走 Docker 内网,客户端走相对路径让 nginx 网关代理。同一个 `API_ENDPOINTS` 对象在两端用,避免每个调用方 if/else。

**与 server-go 的具体接口约定(全部 GET 除非标注):**

| 端点 | 调用方 |
|:---|:---|
| `/api/v1/public/site/info` | `services.getSiteSettings()` (`lib/services.ts:88`) |
| `/api/v1/public/site/stats` | `services.getSiteStats()` |
| `/api/v1/public/posts?pageNum&pageSize` | 首页 / `/posts` / `/timeline` |
| `/api/v1/public/posts/[slug]` | 详情页(`page.tsx:55`)+ FeaturedPost 内容预览 |
| `/api/v1/public/posts/[slug]/adjacent` | `getAdjacentPosts()` (300s revalidate) |
| `POST /api/v1/public/posts/[slug]/verify-password` | `ProtectedPostContent.tsx:28` |
| `/api/v1/public/friend-links` | `services.getFriendLinks()` |
| `/api/v1/public/comments/post/[postId]` (GET/POST) | `CommentSection` |
| `/api/v1/public/search?q&mode=hybrid&limit` | SearchPanel 文章 tab |
| `EventSource /api/v1/public/search/qa?q` | SearchPanel 问答 tab(EventSource GET) |
| `/api/v1/public/search/features` | 决定 `keywordEnabled` / `semanticEnabled` / `aiQaEnabled` |
| `POST /api/v1/public/visit` | `VisitTracker.tsx:21` |
| `/api/v1/auth/me` / `POST /api/v1/auth/login` / `POST /api/v1/auth/logout` | Agent 登录 |
| `POST /api/v1/agent/chat`(SSE) | `agentChatStream.ts:47` |

详细契约见 `02-pages-tour.md` 与 `06-data-fetching-and-caching.md`。

---

## 5 · Aether Codex 落地总览

设计系统规范在仓库顶层 `.claude/design-system/` 共 9 章。本模块的落地点:

| 规范层 | 在 blog 中怎么用 | 关键文件 |
|:---|:---|:---|
| Tokens(`01-tokens.md`) | `app/globals.css:7` `@import` `packages/ui/src/styles/tokens.css`,`SiteSettingsProvider.tsx:66` 还会基于 admin 的主色生成 OKLCH 派生变量并注入 `<style id="aetherblog-primary-color">` | `lib/services.ts` 拉到的 `theme_primary_color_*` |
| Surfaces(`02-surfaces.md`) | `surface-leaf`(ArticleCard / PostNavigation / 评论卡)、`surface-raised`(ScrollToTop / TableOfContents floating trigger / FloatingThemeToggle)、`surface-overlay`(SearchPanel / TocDrawer)、`surface-luminous`(预留给 hero CTA,目前未使用) | `app/components/*.tsx` |
| Typography(`03-typography.md`) | `font-display` / `font-editorial` / `font-mono`。SearchPanel 当前不再使用旧 `cmd-chip`,但 metadata / marginalia / `eyebrow` 仍依赖 mono 系。 | `ArticleCard.tsx` / `SearchPanel.tsx` |
| Motion(`04-motion.md`) | spring/transition/variants 由 `packages/ui` 导出,blog 在 PageTransition / FloatingThemeToggle 等处直接 inline 使用同一组 bezier `[0.16,1,0.3,1]`、`[0.22,1,0.36,1]` | `PageTransition.tsx:232` |
| Signature(`06-signature-moments.md`) | breath-soft 4.8s 呼吸节奏(首页 H1、Hero、Agent Hero)、aurora-text、ink-cursor、ai-stream | `globals.css` + `page.tsx:66`、`HeroSection.tsx:46`、`SearchPanel.tsx:526` |

**注意一处妥协:** `tailwind.config.ts:48` 把 `font-serif` 仍配为 Playfair + Noto Serif SC,而不是规范里的 Fraunces / Instrument Serif —— blog 当前继续用 `next/font/google` 加载 Playfair 当 display 字体,Codex 规范里的 Fraunces / Instrument Serif **没有真正落到 blog**,只是 token 与样式类(`.font-display` / `.font-editorial`)在 typography.css 中以 Variable 字体的方式声明。这件事在 `03-content-rendering.md` 与 `05-design-implementation.md` 重点说明。

---

## 6 · 横向依赖

```
@aetherblog/blog
  ├── @aetherblog/ui          // Button/Avatar/AetherMark/spring/transition/variants/styles
  ├── @aetherblog/hooks       // useTheme/ThemeProvider/ThemeToggle/useDebounce/useLocalStorage/useIntersectionObserver/useIsMobile + themeInitScript/themeFoucGuardStyle
  ├── @aetherblog/utils       // generateColorVars/colorVarsToCSS/formatDate/slugify
  ├── @tanstack/react-query   // /posts 列表 + BlogHeader/MobileMenu 的 settings 缓存
  ├── framer-motion           // 几乎所有动画
  ├── react-markdown          // MarkdownRenderer
  ├── remark-gfm/math/directive + rehype-katex/raw/sanitize  // 渲染管线
  ├── shiki(core + oniguruma) // 代码高亮,核心 8 语言,扩展 25 语言按需加载
  ├── mermaid                 // 图表
  ├── katex                   // 数学公式
  ├── lucide-react            // 图标
  ├── dompurify               // mermaid SVG / shiki HTML 二次消毒(SSR-safe lazy import)
  └── next                    // 15.1.3 standalone build
```

`packages/ui` 与 `packages/hooks` 是 workspace dependencies,版本号 `workspace:*` —— 改这两个包后必须 `pnpm install` 重新链。详见 `09-design-system-shared-packages` 模块文档。

---

## 7 · 关键决策

### 为什么 Next 15 + React 19?
- React 19 的 `Suspense` 已经稳定,搭配 RSC 可以让 `getSiteSettings()` 在 layout 与每个 page 共享(`React.cache` 包裹)而不重复打 backend。
- Next 15.1 引入实验性 `viewTransition`(`next.config.ts:11`),配合 CSS `::view-transition-*` 把 ArticleCard → 文章详情页的标题做成原生 morph 动画,不再依赖 framer-motion 的 layoutId。这是 Aether Codex 的"签名时刻"之一。
- Turbopack 开发期 hot reload 比 webpack 快 5x,首页冷启从 8s 降到 1.5s。

### 为什么 RSC?
- SEO 是博客的命脉,首页 / 详情页 / about / design / agent 全部需要服务端 HTML。
- `lib/services.ts` 的 `cache()` 让多个 RSC 段共享同一次 fetch —— 否则 layout.generateMetadata + RootLayout + page 三个地方各拉一次 `/site/info`,3x QPS。
- ISR(`revalidate = 300/600`)让构建产物不必每次 deploy,后台改了文案 5 分钟内全 CDN 节点同步。

### 为什么用 React.cache(`lib/services.ts:88`) 而不是 `unstable_cache`?
- `React.cache` 作用域是单次请求的渲染树,够用又零配置。
- `unstable_cache` 跨请求共享,但需要 cache key 设计 + key 失效策略,首页只需一份 settings,过度工程化。

### 为什么 SearchPanel 用 EventSource 而不是 fetch + ReadableStream?
- AI 问答 SSE 是 GET,不需要 body,EventSource 原生支持。
- Agent 工作台 `/api/v1/agent/chat` 反过来用 fetch + ReadableStream(`agentChatStream.ts:42`)—— 因为它要 POST 多轮 messages 并要 AbortController 干净中断。两边场景不同,用不同 API 是有意为之。

---

## 8 · 已知问题 / 妥协

1. **`package.json` 重复声明 `dompurify`**(`apps/blog/package.json:20,22`)—— pnpm 会取后者,结果一致,但 lint 不友好,应删一行。
2. **Tailwind v3 而非 v4**:整个项目还在 Tailwind 3.4.17。Tailwind v4 的 `@theme` 与 OKLCH 亲和度高,迁移收益大,但 admin 也得同步,工作量未排。
3. **legacy 颜色变量未清退**:`globals.css:46-200` 的 `--color-primary` / `--text-primary` / `--bg-card` / `--shadow-*` 仍是亮色 / 暗色两套独立配,没有改成 Codex `--ink-*` / `--bg-*` 的派生。`SiteSettingsProvider` 通过 `generateColorVars` 注入新变量,但读取这些新变量的组件少,大多数仍读 legacy。这就是 CLAUDE.md 中"sunset 2026-07-17"的原因。
4. **MarkdownRenderer 的 KaTeX CSS 用 jsdelivr 公网链接**(`MarkdownRenderer.tsx:104`)—— 没有 SRI(Subresource Integrity),代码注释里已经标 TODO。同时如果 admin 站点开了严苛 CSP `style-src 'self'`,数学公式会无样式。
5. **首页 H1 仍用 `font-display` + 渐变**(`page.tsx:64`),但 `tailwind.config.ts:47` 的 `font-display` 不存在(只有 `font-serif`),这条 class 实际依赖 `packages/ui/src/styles/typography.css` 里 `.font-display { font-family: var(--font-display) }` 才生效。规范层与 Tailwind 工程层有命名漂移。
6. **`/posts` 全 Client 没有 SEO**:Google 爬不到第 2 页之后的文章列表。生产路径目前依赖 `/timeline` 的全量列表(SSG)做 sitemap 兜底。
7. **AbortController 与 React 19 双 mount**:开发模式下 React 19 strict mode 双挂会触发两次 `searchAbortRef.current?.abort()`(`SearchPanel.tsx:217`)—— 实测无副作用但会在 devtools 看到一次额外的 ABORT,不要误判成 bug。
8. **`fetch` 没有 `User-Agent` 头**:RSC 服务端 fetch 后端时没带 UA,server-go 的访问日志统一显示 "node",难以区分 SSR 流量与外部爬虫流量。

---

## 9 · 扩展点

| 想加什么 | 改什么 |
|:---|:---|
| 新增公开页面(如 `/changelog`) | `app/<name>/page.tsx`,RSC + 必要时 client wrapper;BlogHeader 添加导航项;MobileMenu 同步 |
| 让某条 backend API 进入前台 | `lib/api.ts:16` 加端点 + `lib/services.ts` 包一层 cache,然后在 RSC page 里 await |
| 新加 markdown directive(如 `:::quote`) | 1) `lib/remarkAlertBlock.ts` 模式新增 plugin;2) `MarkdownRenderer.tsx:90` REMARK_PLUGINS 注册;3) `MarkdownRenderer.tsx:728` createComponents 加 'alert-block' / 自定义 tag 渲染 |
| 接入新 OAuth Provider | `agent/lib/agentAuth.ts` 是模块入口,但实际改动主要在 server-go,前端只是消费 `/auth/me` 的 user 形状 |
| 调整 ISR 节奏 | 各页 `export const revalidate` 单独改,不要从 layout 改(layout 没声明 revalidate 时 page 各自决定) |
| 把 `/posts` 改成 RSC + 服务端分页 | 把 `useQuery` 替换为 server-side fetch;currentPage 升级成 `searchParams.page`;失去翻页平滑滚,要再做一遍 ScrollIntoView 的 RSC 版 |
| 新加 Agent 模式(chat / cowork / code 之外) | `agent/lib/agentSessions.ts:13` AgentMode 类型 + workspace 的 ModeSwitch |

---

## 10 · 文档导航

| 章节 | 用途 |
|:---|:---|
| `01-routing-and-layout.md` | layout / template / providers / globals.css 注入顺序 |
| `02-pages-tour.md` | 9 个公开页 + Agent 三页的逐页职责与数据来源 |
| `03-content-rendering.md` | MarkdownRenderer 管线 / Shiki / KaTeX / Mermaid / TOC / 与后端契约 |
| `04-discovery-and-search.md` | SearchPanel 的文章/问答双模式 + 关键词/语义/AI QA + tag/category 聚合缺口 |
| `05-design-implementation.md` | 4 surface / 字体阶梯 / token / motion 在 blog 里的具体使用点 |
| `06-data-fetching-and-caching.md` | services.ts 里每个函数的 cache 时长 + ISR 矩阵 + 失败降级策略 |
| `07-app-shell-and-perf.md` | manifest / FOUC guard / next/font / 骨架屏 / 图片白名单 / Standalone build |
