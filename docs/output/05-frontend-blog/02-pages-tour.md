# 02 · Pages Tour · 各页职责与数据来源

> 自顶向下走一遍 9 条公开路由 + Agent 三页(landing / login / workspace)。每页给出渲染策略、入口文件、数据流、关键组件、设计系统应用、限制。

---

## 1 · 范围

- 公开页:`/`、`/posts`、`/posts/[slug]`、`/timeline`、`/about`、`/design`、`/friends`、`/agent`、`/agent/login`
- 半公开页(未登录访问会进 login):`/agent/workspace`

---

## 2 · `/` 首页

**入口:** `apps/blog/app/page.tsx:21` (RSC)

**渲染策略:** RSC + ISR(`revalidate = 300`,page.tsx:9)

**数据流:**

```
HomePage()
 ├─ Promise.all([
 │     getRecentPosts(6)        → /api/v1/public/posts?pageNum=1&pageSize=6
 │     getSiteSettings()        → /api/v1/public/site/info
 │  ])
 └─ 渲染:
    ├─ banner(showBanner==true 时)
    │   HeroParallaxContent { breath-soft H1 + welcome_subtitle + 双 CTA + scroll arrow }
    ├─ StackedParallax
    │   └─ 6× ArticleCard(grid 1/2/3 列)
    └─ SiteFooter
```

**ArticleCard 接收的字段:** `category` 取 `categoryName`(注意后端响应里直接给名字,不是关联对象)、`tags` 由 `tagNames` 数组重组成 `{name, slug}` 形式(`page.tsx:169`)。

**安全要点:** `safeInternalHref()`(`page.tsx:14`)对 admin 可写的 `welcome_primary_btn_link` / `welcome_secondary_btn_link` 校验 —— 必须是单 `/` 开头且不能是 `//`,防御 VULN-081(站长账号被盗后改成 `javascript:` / `//evil.com` 钓鱼)。

**设计系统应用:**
- 顶部 `<h1>`:`font-display`、`text-[clamp(3rem,7vw,5.5rem)]`、`font-semibold`、`bg-gradient-to-r from-[var(--text-primary)] via-[var(--text-secondary)] to-[var(--text-muted)] bg-clip-text text-transparent` —— 半透明渐变文字 + `breath-soft 4.8s` 呼吸节奏。
- `font-editorial italic` 副标(`page.tsx:74`)。
- "最新发布" caption 用 `font-mono text-[11px] uppercase tracking-[0.2em] tabular-nums`(`page.tsx:146`)。
- `theme-transition-glow` 类的环境光晕:`var(--ambient-glow-blur) / var(--ambient-glow-opacity)`,亮主题下 opacity=0(关闭),暗主题下显示。
- "叠层书页" 效果:`-mt-[100px] pt-[100px] rounded-t-[46px]` + 多层 box-shadow(`page.tsx:115`)—— 模拟纸张盖在 hero 之上的纵深。

**已知限制:**
- 文章卡只显示前 6 条,无分页 —— 走 `/posts` 才看完整列表。
- `getRecentPosts` 失败时返回 `[]`,首页只显示 hero,没有"暂无文章"的占位文案 —— 体验降级。

**性能注意点:**
- ISR 300s 是阅读体验最佳点:站长发布新文章 5 分钟内呈现,且 CDN 命中率高。
- HeroParallaxContent 用 `useScroll() + useTransform()`,移动端 GPU 友好;但低端机仍会丢帧,可考虑加 `prefers-reduced-motion` 短路。

---

## 3 · `/posts` 文章列表

**入口:** `apps/blog/app/posts/page.tsx:30` (Client,`'use client'`)

**渲染策略:** **Client + useQuery**,无 SEO,无 ISR。

**数据流:**

```
PostsPage()
 ├─ useSiteSettings()       ← Context (来自 SiteSettingsProvider)
 ├─ useState<currentPage>(1)
 ├─ useQuery(['featuredPost']) → /api/v1/public/posts?pageNum=1&pageSize=1
 │                         + /api/v1/public/posts/${item.slug}    (取 contentPreview)
 └─ useQuery(['posts', currentPage, PAGE_SIZE])
              → /api/v1/public/posts?pageNum=${currentPage}&pageSize=${effectivePageSize}
                effectivePageSize = PAGE_SIZE + (currentPage===1 ? 1 : 0)
                第一页 slice(1) 把推荐文章从列表中剔除
```

**为什么这么绕?** 推荐文章独占第 1 个 slot,普通列表共享同一份分页 —— 但后端没有"排除某 ID"的过滤参数,只能在前端动手脚。`total` 也减 1(`page.tsx:115`)以保证页码计算准确。

**关键组件:**
- `<FeaturedPost post={featuredPost} />` —— 推荐文章大图卡(占 lg:col-span-3,420px 高)。
- `<AuthorProfileCard />` —— 作者卡(占 lg:col-span-1,420px 高)。
- `<ArticleCard>` × n —— 网格 1/2/3 列。

**翻页交互:** `handlePageChange()`(`page.tsx:139`):
1. `isUserPaging = true` 标记仅用户翻页(区分组件挂载/路由回退)。
2. `setCurrentPage(page)`。
3. `postsListRef.current.scrollIntoView` 平滑回到列表顶部。
4. `useEffect` 监听 currentPage,把激活页码按钮 `scrollIntoView` 到 pageNumbersRef 容器中央。
5. `prefers-reduced-motion` 用户走 `behavior:'auto'`。

**设计系统应用:**
- 全屏 fixed 环境光4 个 blob(`page.tsx:175`):top/bottom × left/right,统一冷紫调,避免顶部 hero 区与下方 ArticleCard 区色调断层。
- 空状态用 `surface-leaf` 卡片包大圆 icon(`page.tsx:208`)。
- 分页按钮:`bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]`,激活态 `bg-primary text-white`。

**已知限制:**
- 没有 SEO 友好版本。建议为 SEO 提供 `/sitemap.xml` 把所有文章 URL 列出,谷歌爬虫绕过列表页直读详情。
- `useQuery(['featuredPost'])` 与 RootLayout 的 `getRecentPosts` 是不同 fetch,数据不共享。
- 没有 prefetch 上一页/下一页,翻页时仍需走网络。

---

## 4 · `/posts/[slug]` 文章详情

**入口:** `apps/blog/app/posts/(article)/[slug]/page.tsx:123` (RSC)

**渲染策略:** RSC,`cache: 'no-store'`(详情页要实时 viewCount)。`getAdjacentPosts` 用 `revalidate: 300`。

**数据流:**

```
PostDetailPage({ params })
 ├─ slug = await params.slug
 ├─ post = slug === '__markdown_audit__'
 │           ? await getMarkdownAuditPost()    ← 读本地文件作 regression sample
 │           : await getPost(slug)             ← /api/v1/public/posts/${slug}
 ├─ settings = await getSiteSettings()
 ├─ adjacentPosts = slug !== '__markdown_audit__'
 │                    ? await getAdjacentPosts(slug)   ← /adjacent
 │                    : {}
 └─ 渲染:
    ├─ ReadingProgress (animation-timeline 现代浏览器,rAF 降级)
    ├─ <article> + viewTransitionName: 'post-${slug}'
    │   ├─ <aside marginalia> (xl+ 显示):Published / Reading / Views / Section
    │   ├─ BackButton
    │   ├─ <h1 article-anchor> + viewTransitionName: 'post-${slug}-title'
    │   ├─ 元数据行:date · category · viewCount · admin edit · TOC trigger
    │   ├─ tags(#tag chips)
    │   ├─ post.passwordRequired
    │   │   ? <ProtectedPostContent />            ← 表单 + POST /verify-password
    │   │   : <MarkdownRenderer content={...} />  ← 主渲染管线
    │   ├─ PostNavigation { prevPost, nextPost }   ← 上一篇/下一篇
    │   └─ CommentSection                          ← 评论区(GET/POST /comments/post/${id})
    ├─ ArticleFloatingActions(移动端 + PC)
    └─ MobileBottomPullNav(纯移动端,iOS 风格上滑导航)
```

**Markdown audit 容错:** slug 等于 `__markdown_audit__` 时不打 backend,而是读 `docs/blog-markdown-regression-sample.md`(`page.tsx:88`),供 PR review 验证 markdown 渲染。这是测试 hatch,生产环境无影响。

**reading time 估算:** `Math.max(1, Math.ceil(post.content.length / 500))`(`page.tsx:145`)—— 简单按 500 字/分钟。

**adminEditUrl 优雅降级:** `buildAdminPostEditUrl(post.id)` 失败时显示文字 "编辑入口未配置" + tooltip 解释(`page.tsx:144,219`)。

**设计系统应用:**
- `font-display` 大标题(`page.tsx:193`)。
- `text-h3 / text-h2` 是 Codex 字号阶梯类(typography.css 定义)。
- `marginalia` + `marginalia--anchored` —— Chrome 125+ / Safari 26+ 用 CSS anchor positioning 让边注精确对齐 H1 基线;旧浏览器走硬编码 `-left-52 top-0`(`page.tsx:163`)。
- 元数据行用 `italic`(date / category)+ `font-mono` margins(标签 #tag pills)。
- TOC trigger 走 `variant="icon"`,渲染成 H7×7 圆形按钮(`TableOfContents.tsx:231`)。

**与 server-go 接口:**
- `GET /api/v1/public/posts/${slug}` —— 主内容(返回 `{code, data: {id, title, slug, content, summary, coverImage, categoryName, tags, viewCount, publishedAt, passwordRequired}}`)
- `GET /api/v1/public/posts/${slug}/adjacent` —— `{prevPost, nextPost}` 各为 PostBrief
- `POST /api/v1/public/posts/${slug}/verify-password` body `{password}` —— ProtectedPostContent
- `GET /api/v1/public/comments/post/${id}` / `POST` —— CommentSection

**已知限制:**
- `cache: 'no-store'` 让所有详情页都打 backend,性能压力都到 server-go。可加一层 `unstable_cache` 用 tag 失效。
- TOC drawer 在 xl+ 是 PC 端 sliding panel,但在 < xl 仍 fixed bottom-right —— 移动端目录的 sticky 按钮 + drawer 体验不如 floating actions。
- adjacent 接口被 `next: { revalidate: 300 }` 缓存 —— 5 分钟内新发的文章不会作为相邻文章出现。可接受。

**性能注意点:**
- MarkdownRenderer 用 `React.memo` 包裹(`MarkdownRenderer.tsx:1032`)防止 sibling 状态(如评论展开)触发整个 markdown 重渲染。
- ReadingProgress 优先用 `animation-timeline: scroll()`(零 JS,合成器线程 120fps),Safari < 26 才走 rAF + state(`ReadingProgress.tsx:22`)。

---

## 5 · `/timeline` 时间轴

**入口:** `apps/blog/app/timeline/page.tsx:83` (RSC)

**渲染策略:** RSC + ISR(`revalidate = 300`)。

**数据流:**

```
TimelinePage()
 ├─ posts = await getTimelinePosts()  ← /api/v1/public/posts?pageSize=100
 ├─ archives = groupPostsByDate(posts)  // 服务端分组,降低客户端 CPU
 └─ <TimelineTree archives={archives} />  ← Client 组件,负责展开/折叠/高亮
```

**为什么不复用 `/api/v1/public/archives`:** 后端确实有 `/archives` 端点,但本页拉 `posts?pageSize=100` 后自己分组 —— 因为想要每篇文章的 `passwordRequired` 字段,而 `/archives` 只回数量。

**分组算法:**(`page.tsx:51-81`)
1. 按 year/month 把 posts 装进 `Record<year, Record<month, post[]>>`。
2. year 倒序,month 倒序,生成 `Archive[]`。
3. 每年总数 = 所有月份数 reduce 求和。

**TimelineTree 关键状态:**(`TimelineTree.tsx:35-40`)
- SessionStorage 持久化:`timeline_expanded_years` / `timeline_expanded_months` / `timeline_expanded_posts_months` / `timeline_last_clicked_post`。
- 大量月份默认折叠 + 默认仅显示前 10 篇,避免一次渲染几百个 motion.div。
- 文章被点击后,从详情页返回时 `timeline_last_clicked_post` 标记的文章会有 highlight + 渐隐动画。

**设计系统应用:**
- 标题左侧渐变竖条 `bg-gradient-to-b from-primary to-accent`(`page.tsx:95`)。
- 月份块用 `border-l-2 border-white/10` 缩进 + 树状结构。
- PostItem 用 `surface-leaf` hover translate-x-1。

**已知限制:**
- `pageSize=100` 上限 —— 文章超过 100 篇后第 101 篇起就丢了。需要后端支持 cursor-based pagination 或前端循环拉取。
- 时间轴页是用户高频访问的归档页,但全文 fetch 在 SSR 阶段一次完成,首屏 TTFB 受 backend 响应时间影响。

---

## 6 · `/about` 关于页

**入口:** `apps/blog/app/about/page.tsx:15` (RSC) + `AboutClient.tsx` (Client)

**渲染策略:** RSC 父喂 settings/stats,Client 子做 8 节滚动叙事。`revalidate = 600`(与 getSiteStats cache 对齐)。

**数据流:**

```
AboutPage()
 ├─ Promise.all([getSiteSettings(), getSiteStats()])
 └─ <AboutClient settings={...} stats={...} />
       ← 8 个 ScrollSection 深浅交替:
         S1 Hero(bg-void)
         S2 Design(bg-substrate)
         S3 Ai(bg-void)
         S4 Search(bg-substrate)
         S5 Editor(bg-void)
         S6 TechStack(bg-substrate)
         S7 Security(bg-void)
         S8 AuthorCTA(bg-substrate)
```

**ScrollSection 模式:**(`about/components/ScrollSection.tsx:13`)

```tsx
const [ref, isVisible] = useIntersectionObserver({ threshold: 0.15, freezeOnceVisible: true });
return (
  <section ref={ref} className="min-h-screen flex items-center justify-center">
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
      {typeof children === 'function' ? children(isVisible) : children}
    </motion.div>
  </section>
);
```

`freezeOnceVisible: true` —— 一旦进入视口就锁定,避免来回滚动反复触发动画。子节点接收 `isVisible` 决定内部 stagger 是否开始(用法见 `about/sections/HeroSection.tsx:24`)。

**关键节点:**
- `HeroSection.tsx:46` —— `aurora-text` + `breath-soft 4.8s` "以太之上,思想成形"。
- `AnimatedCounter.tsx` —— 数字滚动(被 stats 填充)。
- `AuthorCTASection` —— 接 settings.authorAvatar / authorName / authorBio + stats(总文章数等)。

**设计系统应用:**
- `bg-void` / `bg-substrate` 交替带:Codex 标准做法,不套 surface-leaf。
- `eyebrow`(typography.css 定义,小写 → `font-mono text-[11px] uppercase tracking-[0.2em]`)。
- `text-h1 / text-display / text-h4 / text-lede / text-body` —— Codex 字号阶梯类。
- 极光环境光晕:`bg-[var(--aurora-1)]/10 ... blur-[120px]`(HeroSection 顶部)。

---

## 7 · `/design` 设计推理链

**入口:** `apps/blog/app/design/page.tsx:24` (RSC) + `DesignClient.tsx` (Client)

**渲染策略:** RSC 父填 siteTitle,Client 渲染 8 节。`revalidate = 600`,与 about 对齐。

**8 节内容:**(`DesignClient.tsx:21`)

```
S1 Manifesto      bg-void       (设计宣言)
S2 Color          bg-substrate  (OKLCH hue slider 互动)
S3 Typography     bg-void       (9 级字号阶梯 + 4 角色)
S4 Surface        bg-substrate  (4 层玻璃实物展示)
S5 Motion         bg-void       (ease 曲线 + 时长档位可视化)
S6 Signature      bg-substrate  (5 个签名时刻)
S7 Reasoning      bg-void       (八问八答 推理链)
S8 CTA            bg-substrate  (引导回首页 / 查看 about)
```

**特殊组件:**(`design/components/`)
- `HueSlider.tsx` —— OKLCH 色相旋钮,实时改 `--aurora-1`,展示 token 系统的活力。
- `AuroraSwatch.tsx` —— 极光色样。
- `TypeScaleRow.tsx` —— 字号 → 实际渲染对照。
- `EaseCurveViz.tsx` —— SVG 画 cubic-bezier 曲线 + 一个跟随的 ball 模拟该曲线节奏。
- `CodeSample.tsx` —— 代码块展示(可能复用 Shiki)。
- `ScrollSection.tsx` —— 与 about 的 ScrollSection 形态相同,**这里是独立副本**(没有共用),设计上是有意"design 页可以更激进地改 ScrollSection 样式而不影响 about"。

**这一页是设计系统的活样板,任何 UI 改动前都应先看它。** CLAUDE.md 第 3.4 节明确要求。

---

## 8 · `/friends` 友链

**入口:** `apps/blog/app/friends/page.tsx:13` (RSC) + `FriendsList.tsx` (Client)

**渲染策略:** RSC + `force-dynamic` + `revalidate = 0`。

**数据流:**

```
FriendsPage()
 └─ friends = await getFriendLinks()  ← /api/v1/public/friend-links
    <FriendsList initialFriends={friends} />
```

**双视图:**
- `list` —— 1/2/3 列网格的 FriendCard,逐个 fade-in(stagger delay)。
- `icon` —— Apple Watch 风格蜂窝网格,偶数行 6 个,奇数行 5 个,`justify-center` 自动错位。

**视图持久化:** `useLocalStorage<ViewMode>('friends-view-mode', 'list')`(`FriendsList.tsx:29`)。但 SSR 时不能读 localStorage,所以 `hasMounted` flag 启动后才切到客户端持久化值,避免水合不匹配(`FriendsList.tsx:33-35`)。

**视图切换胶囊:**(`FriendsList.tsx:97`)
- `motion.div` 滑动指示器,`type: 'spring', stiffness: 400, damping: 30`。
- 移动端 / 桌面端用不同 padding 的常量:`TOGGLE_PADDING_MOBILE: 2 | DESKTOP: 4`,精确像素对齐。

**设计系统应用:**
- 标题左侧 `Users` lucide icon + `text-primary`。
- 环境光晕:顶部右上极光 + 左侧蓝色光晕(色温对比)。
- "想要交换友链" CTA 链到 GitHub Issues(硬编码,不在 settings 中可配)。

**已知限制:**
- `force-dynamic` 让每次请求都打 backend,无 CDN 优势。但友链改动频率低,实际请求量也低。
- 蜂窝网格不响应窗口 resize 时的列数重新分组 —— `useMemo([initialFriends, cols])` 但 cols 由 `useIsMobile()` 触发。

---

## 9 · `/agent` Agent 入口落地页

**入口:** `apps/blog/app/agent/page.tsx:15` (RSC) + `AgentLandingClient.tsx` (Client)

**渲染策略:** RSC + ISR 600s。

**叙事结构:**(5 节 ScrollSection,复用 about 的 ScrollSection)

```
S1 Hero          bg-void       (hero with breath-soft "以太之上")
S2 Manifesto     bg-substrate  (灵境哲学)
S3 Capabilities  bg-void       (能力列表)
S4 Modes         bg-substrate  (3 模式:Chat / Cowork / Code)
S5 Enter         bg-void       (CTA 进入工作台)
```

**与 `/about` 的区别:** 节数更少(5 vs 8),叙事更聚焦,不展示数据/统计。`AgentLandingClient.tsx:26` 注释明确"参照 /about + /design 两条规范",但每节的 sections/ 完全独立。

---

## 10 · `/agent/login`

**入口:** `apps/blog/app/agent/login/page.tsx:10` (RSC) + `LoginClient.tsx` (Client)

**渲染策略:** RSC,主要把 `searchParams.next` 透传。

**数据流:**

```
AgentLoginPage({ searchParams })
 ├─ settings = await getSiteSettings()
 ├─ next = searchParams.next || ''
 └─ <LoginClient siteTitle={...} next={next} />
```

**复用 admin 的 `/auth/login`:** `agent/lib/agentAuth.ts:84` 的 `loginAgent()` 直接 POST /api/v1/auth/login,与 admin 同一个端点。差别仅在前端 —— Agent 不要求 role==admin,任何已登录用户都进。

**Cookie 策略:** HttpOnly Bearer + refresh token,前端永远拿不到 token,只通过 `credentials: 'include'` 间接使用。

---

## 11 · `/agent/workspace`

**入口:** `apps/blog/app/agent/workspace/page.tsx:10` (RSC) + `WorkspaceClient.tsx` (Client,长达 600+ 行)

**渲染策略:** RSC 仅做 metadata + siteTitle 透传,主体 client。`metadata.robots = { index: false, follow: false }`。

**Layout:**(`WorkspaceClient.tsx:67`)

```
┌─ Sidebar(desktop fixed,mobile drawer)
│   ├─ wordmark
│   ├─ + 新对话
│   ├─ 搜索
│   ├─ 会话分组(localStorage 加载)
│   └─ user / logout
└─ Section
    ├─ TopBar:back · 标题 · ModeSwitch · ThemeToggle · me
    ├─ Thread(max-w-3xl,scrollable):MessageBubble 列表
    └─ Composer(max-w-3xl,sticky bottom):textarea + Slash/Tag/Article picker + ModelPicker
```

**关键 lib:**
- `agentAuth.ts:52` `useAgentAuth()` —— hook 形式拿登录态,guest 时跳 `/agent/login?next=...`。
- `agentSessions.ts` —— localStorage 持久化会话(每个 user namespace),无后端依赖。MVP 不上 DB。
- `agentChatStream.ts:42` `streamAgentChat()` —— fetch + ReadableStream + AbortController 的 SSE 客户端;不用 EventSource 因为要 POST 多轮 messages 与干净中断。
- `agentResources.ts` —— @ 文章 picker / # 标签 picker 的数据获取。
- `agentModels.ts` —— ModelPicker 的可选模型清单。
- `cjkMarkdown.ts` —— 中文 markdown 流式渲染辅助。
- `smooth.ts` —— stream 动画模式。

**与 server-go 接口:**
- `GET /api/v1/auth/me` —— 鉴权
- `POST /api/v1/auth/login` / `POST /api/v1/auth/logout`
- `POST /api/v1/agent/chat`(SSE) —— 主对话流
- 可能还有 `/api/v1/public/posts`(供 ArticlePicker)、`/api/v1/public/tags`(供 TagPicker)

**WorkspaceSkeleton:** 鉴权 loading 期间显示一个与最终布局严格同形的骨架(`WorkspaceSkeleton.tsx`),确保零 flash。

**SSE 事件类型:**(`agentChatStream.ts:97`)
- `delta` —— 增量内容
- `think` —— 思考过程(可折叠展示)
- `sources` —— RAG 引用源
- `done` —— 结束
- `error` —— 异常

**设计系统应用:**
- 整页是 surface-overlay 风格?**不是** —— 工作台用 bg-void / bg-substrate 双层,Sidebar 是 surface-raised(浮于内容),Composer 浮在 thread 之上也是 surface-raised。
- mode switch 用 segmented control(类似 BlogHeader 的 iOS 21 风格)。
- StreamMarkdown 是 MarkdownRenderer 的精简流式版本。

**已知限制:**
- 会话仅 localStorage,跨设备不同步,清缓存即丢。后续打算迁到 `/api/v1/agent/sessions`(接口已预留)。
- Composer 的 @/# 触发逻辑与 SearchPanel 的 `>/?/`/` 前缀路由是两套独立解析器,有重复。

---

## 12 · 共性观察

1. **RSC 父 + Client 子的模式**:about / design / agent 三页的实现高度一致 —— RSC 拉数据,Client 用 ScrollSection 做 8 节叙事。这种模式可考虑抽 helper。
2. **ScrollSection 没有进 packages/ui**:about 与 design 各有一份近乎相同的实现,作者评价"不抽出来是为了让 design 页可以激进改而不连累 about"。可以接受的复制。
3. **`getSiteSettings()` 在多个页面被 await**:`React.cache()` 在单次请求内去重,但跨页面无效。5/9 个页面都需要 settings —— 这是为什么 `revalidate: 10` 而不是 60(`services.ts:91`),站长改完 10 秒内反映。
4. **password-protected 文章的特殊处理**:`page.tsx:253` 走 `<ProtectedPostContent>`,`MarkdownRenderer` 在密码验证后才渲染,这避免了源文 HTML 被 view-source 看到。
