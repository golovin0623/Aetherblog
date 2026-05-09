# 06 · Data Fetching & Caching · 数据获取与缓存策略

> Blog 是读多写少的产品,缓存策略决定了用户感知与 backend 压力。本文把每条 fetch 路径、它的 cache 时长、失败降级、metadata 生成全部摊开。

---

## 1 · 范围

- `apps/blog/app/lib/services.ts`(server-side fetch + React.cache)
- `apps/blog/app/lib/api.ts`(API_ENDPOINTS 端点表,服务端/客户端切换)
- `apps/blog/app/lib/logger.ts`(失败时的日志策略)
- 各 page 的 `revalidate` 声明
- `next.config.ts:40` 的 rewrites
- 客户端侧的 React Query 缓存(`providers.tsx:8`)
- `SiteSettingsProvider.tsx`(后台设置应用 + Context 分发)

---

## 2 · 服务端 / 客户端 base URL 切换

`lib/api.ts:9-14`:

```ts
const isServer = typeof window === 'undefined';
const API_BASE_URL = isServer 
  ? (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080')
  : '';  // 客户端使用空字符串,让请求变成相对路径
```

**两侧策略不同:**

- **服务端(Node.js / RSC):** 走 Docker 内网 `http://backend:8080`(由 `API_URL` 环境变量提供),不经 nginx,延迟低。
- **客户端(浏览器):** 用空字符串,让 fetch URL 变成 `/api/v1/public/posts`。Next.js `next.config.ts:40` 的 rewrites 会把 `/api/:path*` 重写为 `${API_URL}/api/:path*`(本地开发回到 backend);生产环境由 nginx 网关 `/api/` → backend 已经处理,Next.js rewrites 实际不命中(因为请求被 nginx 抢先)。

为什么要这样:
- 服务端走内网避免 nginx HTTP/1.1 限流。
- 客户端走相对路径自动跟着用户访问的 host(例如手机 PWA 无法解析 `localhost`,只有相对路径才能正确指向网关)。

**两种 base URL 的常量导出:**(`api.ts:43-45`)

```ts
export const SERVER_API_URL = process.env.API_URL || ...;
export const CLIENT_API_URL = '';
```

某些 server-side fetch(如 `posts/[slug]/page.tsx:14,55`)直接用 `SERVER_API_URL` 强调"必须服务端"。

---

## 3 · `services.ts` 全量端点封装

| 函数 | 端点 | revalidate | 超时 | fallback |
|:---|:---|:---|:---|:---|
| `getSiteSettings()` | `/api/v1/public/site/info` | 10s | 3s | DEFAULT_SITE_SETTINGS hardcode |
| `getRecentPosts(limit)` | `/api/v1/public/posts?pageNum=1&pageSize=${limit}` | 300s | 5s | `[]` |
| `getFriendLinks()` | `/api/v1/public/friend-links` | 60s | 5s | `[]` |
| `getComments(postId)` | `/api/v1/public/comments/post/${postId}` | `cache: 'no-store'` | (无) | `[]` |
| `createComment(postId, data)` | POST `/api/v1/public/comments/post/${postId}` | (POST 不缓存) | (无) | throw |
| `getSiteStats()` | `/api/v1/public/site/stats` | 600s | 5s | `{posts:0, categories:0, tags:0}` |

**`React.cache()` 包裹的只有 `getSiteSettings`:**(`services.ts:88`)

```ts
export const getSiteSettings = cache(async function getSiteSettings(): Promise<SiteSettings> { ... });
```

理由:它在 layout.generateMetadata + RootLayout + 多个 page 中被多次 await,如果不 cache 会发 4-5 次相同请求。其他函数被单页面调用,缓存收益小。

**`AbortSignal.timeout(3000)` 用于 settings:** 这是构建时(SSR)的关键 —— 后端不可用时迅速 fallback,避免阻塞 5-15s 的 build。其他端点用 5s 超时,因为它们在 user-perceived path 上,稍长可接受。

---

## 4 · `api.ts` 端点常量表

`api.ts:16-41`:

```ts
export const API_ENDPOINTS = {
  posts: `${API_BASE_URL}/api/v1/public/posts`,
  postBySlug: (slug) => `${API_BASE_URL}/api/v1/public/posts/${slug}`,
  verifyPostPassword: (slug) => `${API_BASE_URL}/api/v1/public/posts/${slug}/verify-password`,
  friendLinks: `${API_BASE_URL}/api/v1/public/friend-links`,
  archives: `${API_BASE_URL}/api/v1/public/archives`,
  settings: `${API_BASE_URL}/api/v1/public/site/info`,
  stats: `${API_BASE_URL}/api/v1/public/site/stats`,
  comments: (postId) => `${API_BASE_URL}/api/v1/public/comments/post/${postId}`,
  adjacentPosts: (slug) => `${API_BASE_URL}/api/v1/public/posts/${slug}/adjacent`,
  search: `${API_BASE_URL}/api/v1/public/search`,
  searchQA: `${API_BASE_URL}/api/v1/public/search/qa`,
};
```

`archives` 端点声明但未使用 —— `/timeline` 自己拉 posts 分组(为了拿到 passwordRequired 字段)。

---

## 5 · ISR 矩阵

| 路由 | revalidate | 触发 | 备注 |
|:---|---:|:---|:---|
| `/` | 300s | `page.tsx:9` `export const revalidate = 300` | 与 getRecentPosts 一致 |
| `/posts` | (无) | Client useQuery | staleTime 5min |
| `/posts/[slug]` | (`cache: 'no-store'`) | 详情页内部 fetch | 实时 viewCount |
|   ↳ adjacent | 300s | 内联 `next: { revalidate: 300 }` | |
| `/timeline` | 300s | `page.tsx:5` | 与首页一致 |
| `/about` | 600s | `page.tsx:5` | 与 getSiteStats 对齐 |
| `/design` | 600s | `page.tsx:6` | 与 about 对齐 |
| `/friends` | 0 (force-dynamic) | `page.tsx:6,7` | 友链改动频繁 |
| `/agent` | 600s | `page.tsx:5` | 与 about 对齐 |
| `/agent/login` | (无) | searchParams 透传 | |
| `/agent/workspace` | (无) | metadata-only | robots:noindex |

**为什么 `/friends` 走 force-dynamic:** 友链是站长频繁手动调整的页面,300s 缓存窗口会让"新加的友链没出现"成为支持工单。直接每次请求都拉新数据。

---

## 6 · client-side React Query 缓存

`providers.tsx:8`:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
```

- **staleTime 5min**:5 分钟内多次访问相同 query key 直接走 cache。
- **gcTime 10min**:不再被订阅 10 分钟后清。
- **refetchOnWindowFocus: false**:Tab 切换不重拉,博客是阅读型产品,无需新鲜度。
- **retry: 1**:失败重试一次,避免瞬态网络波动报错。

**实际使用 useQuery 的地方:**

| 文件 | queryKey | 用途 |
|:---|:---|:---|
| `posts/page.tsx:42` | `['featuredPost']` | 推荐文章 + content 预览 |
| `posts/page.tsx:86` | `['posts', currentPage, PAGE_SIZE]` | 分页文章列表 |
| `BlogHeader.tsx:43` | `['siteSettings']` | header 拉 site_logo,staleTime 10min |
| `MobileMenu.tsx:69` | `['siteSettings']` | 同上,共享 cache |
| `AuthorProfileCard.tsx:8` | `['siteSettings']` + `['siteStats']` | 作者卡 |

**注意 BlogHeader / MobileMenu / AuthorProfileCard 都用 `['siteSettings']` 同 key**:同一份 cache 被三个组件复用,但服务端 SSR 阶段它们各自的 RSC 父级也通过 `getSiteSettings()` 拿到 settings —— **server 与 client 是两份 cache**(SSR 已经把 HTML 渲染好,不需要 client 再 fetch;但 useQuery 仍会在 mount 时探测一次,看 staleTime 决定是否去 backend)。

**潜在重复请求:** 首页 SSR `getSiteSettings()` → client mount BlogHeader 的 `useQuery(['siteSettings'])` 会再发一次。可通过 `dehydrate` + `Hydrate` 把服务端 cache 注水给客户端,但目前没做。可接受 —— `getSiteSettings()` 极轻量。

---

## 7 · `SiteSettingsProvider` 的 Context 分发

`SiteSettingsProvider.tsx:32-127`:

- 接受 server-side fetch 的 settings 作为 prop。
- 子树通过 `useSiteSettings()` 同步访问 `postPageSize / showBanner / settings`。
- 三个 useEffect 副作用:
  1. **强制暗色:** `enable_dark_mode === 'true'` 时 `<html.dark + style.colorScheme=dark + localStorage.aetherblog-theme=dark>`,并设 `data-force-dark`。
  2. **主色派生:** 用 `@aetherblog/utils.generateColorVars(color, isDark)` 生成 OKLCH 派生变量,注入 `<style id="aetherblog-primary-color">` 到 head。
  3. **自定义 CSS:** 注入 `<style id="aetherblog-custom-css">`,内容来自 admin 的 `custom_css` 字段。

**作用范围:** 全 blog 子树。但 useQuery 的 `['siteSettings']` 不读 Context,而是 fetch —— 两套数据源。可以改进成 useQuery 用 `initialData={contextSettings}` 减少冗余。

---

## 8 · metadata 生成

### 8.1 站点级(layout.tsx:31)

```ts
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return {
    title: { default: settings.siteTitle, template: `%s | ${settings.siteTitle}` },
    description: settings.siteDescription,
    keywords: settings.siteKeywords?.split(/[,，]/),
    metadataBase: new URL(settings.siteUrl || 'http://localhost:3000'),
    icons: avatarUrl ? { icon: avatarUrl, apple: avatarUrl } : undefined,
    appleWebApp: { capable: true, ... },
    formatDetection: { telephone: false },
  };
}
```

**`metadataBase` 必须有效 URL**,否则 Next.js OG 图相对路径会报错。fallback 到 localhost 防止 production 配置漏写时崩。

**title.template:** 子页面通过 `metadata.title = '关于'` 自动拼成 "关于 | AetherBlog"。

### 8.2 页级 metadata

| 页面 | metadata 来源 | 字段 |
|:---|:---|:---|
| `/about` | `about/page.tsx:7` `generateMetadata` | title 与 description |
| `/design` | `design/page.tsx:8` | title + description + openGraph |
| `/agent` | `agent/page.tsx:7` | title + description |
| `/friends` | `friends/page.tsx:8` `metadata` 静态对象 | title + description |
| `/agent/workspace` | `workspace/page.tsx:5` `metadata` 静态 | title + robots:noindex |
| `/agent/login` | `login/page.tsx:5` 静态 | 同上 |

**首页 / `/posts` / `/timeline` 没单独 metadata**,继承 layout 的 default。详情页也没有单独 metadata —— 这是 SEO 缺口,详情页应该有 `generateMetadata` 用文章 title 与 summary 提供更精准 OG 图。

---

## 9 · `manifest.ts` 的特殊性

`manifest.ts:4-28`:

```ts
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSiteSettings();
  return {
    name: settings.siteTitle,
    short_name: settings.siteTitle,
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: avatarUrl ? [{ src: avatarUrl, sizes: 'any', type: 'image/png' }] : [],
  };
}
```

**Next.js 在 build 时调用一次,生成 `/manifest.webmanifest`。** 由于是异步函数,首次构建会 await getSiteSettings()(实际由 ISR 触发);如果 backend 不可用,fallback 到 DEFAULT_SITE_SETTINGS。

`background_color: '#09090b'` 是硬编码暗色 —— PWA 启动时显示的 splash 背景。这个值与 Codex 的 `--bg-void` 不一致(Codex 暗主题是 `#05060A`),为历史遗留。

---

## 10 · 失败降级策略

`services.ts` 每个函数的 `try/catch`:

```ts
try {
  const res = await fetch(url, { next: { revalidate: N }, signal: AbortSignal.timeout(M) });
  if (!res.ok) throw new Error(...);
  return res.json().then(j => j.data || ...);
} catch (error) {
  logger.warn('xxx', error);
  return FALLBACK;
}
```

**几种 fallback:**
- `getSiteSettings()` → DEFAULT_SITE_SETTINGS hardcode(标题 / 副标 / 描述全英文,认为后台不可用时也能渲染)
- 其他列表型 → `[]`
- stats → 全 0
- comments POST 不 fallback,直接 throw 让 UI 提示错误

**logger 行为:**(`logger.ts:25`)
- `logger.info` / `logger.debug` 仅开发期可见。
- `logger.warn` / `logger.error` 始终输出 —— 生产环境不静默,让 sentry / cloudwatch 抓住。

---

## 11 · POST / 写操作

| 操作 | 端点 | 调用方 |
|:---|:---|:---|
| 提交评论 | POST `/api/v1/public/comments/post/${id}` | `services.createComment` (`CommentSection`) |
| 验证文章密码 | POST `/api/v1/public/posts/${slug}/verify-password` | `ProtectedPostContent` |
| 上报访问 | POST `/api/v1/public/visit` | `VisitTracker` |
| Agent 登录 | POST `/api/v1/auth/login` | `agentAuth.loginAgent` |
| Agent 登出 | POST `/api/v1/auth/logout` | `agentAuth.logout` |
| Agent 对话(SSE) | POST `/api/v1/agent/chat` | `agentChatStream.streamAgentChat` |

**所有写操作都不缓存**,默认 fetch behavior。createComment 失败时抛错让 UI 显示,VisitTracker 失败静默 `console.debug`。

---

## 12 · 性能注意点

- **`React.cache()` 是请求级 memoize:** 单次 SSR 渲染内同一参数只发一次,跨请求不共享。够用,不需要 `unstable_cache`。
- **`AbortSignal.timeout`** 让 SSR 不会因后端慢卡住整个 build。
- **`next: { revalidate: N }` 对 fetch 的影响:** 这是 Next.js fetch 的扩展,使该 fetch 结果进入 ISR cache。`cache: 'no-store'` 与之互斥。
- **客户端 useQuery 的 staleTime > 0**: tab 切换不重拉,但 mount 时仍探测,服务端 prefetch + dehydrate 才能完全跳过。
- **避免在 client useQuery 用大对象做 queryKey:** 当前所有 key 都是字符串 / [字符串, 数字],无问题。
- **`logger.debug` / `logger.info` 在 production 是 noop:** 不会打 console.log 噪音,production bundle size 也几乎不变(noop 函数极小)。

---

## 13 · 已知限制

1. **详情页缺 generateMetadata:** OG 标签只继承 layout default,不利于社交分享。补一个 `[slug]/page.tsx` 的 generateMetadata 用 `getPost(slug)` 拿 title/summary/coverImage。
2. **`getRecentPosts(6)` SSR 5s 超时:** 真实生产环境需要对 backend 响应做 P95 监控,把超时调到合理值。3s 超时的 settings 兜底还可以,文章列表 5s 超时但 fallback `[]` 让首页变空 —— 用户感知差。
3. **client useQuery 与 server fetch 双重数据流:** BlogHeader 重新拉 settings 是浪费,可加 dehydrate/hydrate。
4. **`force-dynamic` 友链:** 当前没观测过 friend-links QPS,如果未来流量上来,这个端点会成为瓶颈。建议短缓存(60s)。
5. **`comments` 是 `cache: 'no-store'`:** 详情页每次请求都打 backend。可改 60s revalidate(评论延迟 1 分钟可接受),减压。
6. **archive 端点闲置:** 后端有 `/archives` 但前端没用 —— 维护负担。要么砍掉 backend 端点,要么前端切换。
7. **`/api/v1/public/visit` 在 client 触发,服务端无法记录:** SSR 阶段没有调,意味着首屏访问只有客户端水合后才上报。对统计精度有影响,但不大。
