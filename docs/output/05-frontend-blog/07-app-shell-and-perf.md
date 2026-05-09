# 07 · App Shell & Performance · 应用壳与性能

> Blog 在 PWA / 真机 / 弱网 / iOS WKWebView 这些复杂环境下要做到"无 FOUC、无白屏、骨架屏先行"。本文枚举所有这些机制。

---

## 1 · 范围

- `apps/blog/next.config.ts` —— rewrites / headers / images / experimental
- `apps/blog/app/layout.tsx` —— FOUC guard / next/font / metadata / 字体覆盖
- `apps/blog/app/manifest.ts` —— PWA manifest
- `packages/hooks/themeConstants.ts`(由 layout 引用)—— FOUC inline script
- 所有 `loading.tsx` —— 骨架屏
- `apps/blog/Dockerfile` —— standalone build

---

## 2 · `next.config.ts` 全景

### 2.1 关键配置

| 字段 | 值 | 含义 |
|:---|:---|:---|
| `output: 'standalone'` | | Docker 用最小化 server bundle,不含 node_modules 全量 |
| `experimental.optimizePackageImports` | `['shiki', 'lucide-react', 'framer-motion', 'mermaid', 'date-fns']` | tree-shake 大库,只打包用到的 export |
| `experimental.viewTransition` | true | 启用 Next 15 原生 view transitions |
| `outputFileTracingRoot` | `path.join(__dirname, '../..')` | monorepo 找依赖时回到仓库根 |
| `images.remotePatterns` | (见下) | 受信任的图片域名白名单 |
| `serverExternalPackages` | `['katex']` | katex 不打包到 server bundle,运行时 require |

### 2.2 图片域名白名单(`next.config.ts:14-37`)

```ts
remotePatterns: [
  // 头像
  { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
  { protocol: 'https', hostname: '*.githubusercontent.com' },
  { protocol: 'https', hostname: '*.gravatar.com' },
  { protocol: 'https', hostname: 'cravatar.cn' },
  { protocol: 'https', hostname: 'github.com' },
  // 社交平台 logo —— socialLinks.ts 的 PLATFORM_ICON_URLS 全部指向此域
  { protocol: 'https', hostname: 'api.iconify.design' },
  // dev only
  ...(process.env.NODE_ENV === 'development' ? [
    { protocol: 'http', hostname: 'localhost' },
    { protocol: 'http', hostname: '127.0.0.1' },
  ] : []),
  // 运行时配置追加
  ...(process.env.NEXT_PUBLIC_IMAGE_DOMAINS
    ? process.env.NEXT_PUBLIC_IMAGE_DOMAINS.split(',').map(h => ({ ... }))
    : []),
],
```

**安全要点:**
- `api.iconify.design` 是 socialLinks 强制域,改 `socialLinks.ts:9` 时务必同步白名单。
- `NEXT_PUBLIC_IMAGE_DOMAINS` 让 production 通过 env 追加可信 CDN(如 OSS / S3),不用改代码。

### 2.3 rewrites(`next.config.ts:40-51`)

```ts
async rewrites() {
  return [
    {
      source: '/api/:path*',
      destination: `${process.env.API_URL || 'http://localhost:8080'}/api/:path*`,
    },
    {
      source: '/uploads/:path*',
      destination: `${process.env.API_URL || 'http://localhost:8080'}/api/uploads/:path*`,
    },
  ];
},
```

**关键点:**
- `/api/:path*` → backend(本地开发用,生产由 nginx 网关接管)。
- `/uploads/:path*` → backend `/api/uploads/:path*` —— 后端 context-path 是 /api,但上传逻辑可能返回 `/uploads/...`(无 /api 前缀),为避免 image not found 加这条 rewrite。

### 2.4 安全 headers(`next.config.ts:58-103`)

VULN-091 防护:Next.js 层下发基线安全头,**即使绕过 nginx 直连 Next.js 也有最低保护**。

```ts
const baselineSecurityHeaders = [
  { key: 'X-Content-Type-Options',  value: 'nosniff' },
  { key: 'X-Frame-Options',         value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-XSS-Protection',        value: '0' },  // 现代浏览器已禁用,显式 0 避免被滥用
];
```

**Cache-Control: no-cache** 应用于:`/`、`/posts/*`、`/timeline`、`/archives`、`/friends`、`/about`。

**为什么页面路由 no-cache:** iOS PWA(standalone)的 WKWebView 激进缓存 HTML,发版后样式 / 字体更新延迟 —— 设 no-cache 强制每次导航向服务器验证(304 复用仍然生效),`_next/static` 静态资源不受影响保持 immutable cache。

---

## 3 · FOUC 防护双件套

### 3.1 inline `<style>`(themeFoucGuardStyle)

`layout.tsx:98`:

```tsx
<style dangerouslySetInnerHTML={{ __html: themeFoucGuardStyle }} />
```

**themeFoucGuardStyle** 来自 `@aetherblog/hooks`(`packages/hooks/src/themeConstants.ts`)。形态大概是:

```css
html.dark { background: #05060A; color: #F4EFE6; }
html.light { background: #FAF9F6; color: #1C1A14; }
```

**作用:** 外部 CSS 加载到达前(可能 200-500ms),class 已经被 themeInitScript 加上,这段 inline style 立即匹配并上色,防止暗色用户看到白闪。

### 3.2 inline `<script>`(themeInitScript)

`layout.tsx:100`:

```tsx
<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
```

**themeInitScript** 形态:

```js
(function(){
  try {
    var stored = localStorage.getItem('aetherblog-theme');
    var theme = stored || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
  } catch(e) {}
})();
```

**关键约束:**
- 必须放在 `<style>` 之后(让 class 立即匹配规则)。
- 必须 inline(外部 script 会等 HTML 解析完才执行)。
- 必须 try/catch(localStorage 在隐私模式 / file:// 协议下抛错)。

### 3.3 字体 FOUC

**system 字体不需要防护**,Inter / Playfair Display 通过 `next/font/google` 预加载 + `display: 'swap'` —— FOUT 而非 FOIT,可接受。

**Lora / Merriweather 需要客户端动态加载:**(`layout.tsx:103-107`)

```tsx
{isCustomFont && fontFamily === 'lora' && (
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora..." />
)}
```

这是 SSR 阶段直接渲染 `<link>` —— 客户端 hydrate 后字体已经在加载,首屏可能短暂 fallback 到 Georgia 但不会闪烁过多。

**FontProvider** 在 client 又应用一次(`FontProvider.tsx:77`):动态读取 settings.font_family,如果与 SSR 不同则覆盖。这是冗余路径,99% 情况两边一致。

### 3.4 Markdown FOUC(Shiki)

`MarkdownRenderer.tsx:1018`:

```tsx
<div style={{ visibility: isReady ? 'visible' : 'hidden' }}>
```

Shiki ready 之前正文不显示。`shikiStatus` 三态保证:`pending` → 隐藏;`ready` → 显示;`failed` → 显示(代码块降级为无高亮)。

---

## 4 · 字体加载策略

### 4.1 默认 system 字体

`layout.tsx:27-29`:

```ts
const inter      = Inter({         subsets:['latin'], display:'swap', variable:'--font-inter' });
const playfair   = Playfair_Display({ subsets:['latin'], display:'swap', variable:'--font-playfair', weight:['400','700'] });
const notoSerifSC = Noto_Serif_SC({ display:'swap', variable:'--font-noto-serif-sc', weight:['400','700'], preload: false });
```

- **Inter** —— Sans 主字体,通过 `--font-inter` 暴露,body 上挂 className。
- **Playfair Display** —— Display 主字体(Codex 规范是 Fraunces,这里用 Playfair 替代,见 `05-design-implementation.md` §5)。
- **Noto Serif SC** —— 中文衬线,**`preload: false`** 是因为体积大(~120KB),不强制加载到首屏。

### 4.2 字体覆盖路径

服务端在 `layout.tsx:67-91` 检查 settings.font_family,若非 system,设 `<html.font-override style="--font-sans-override: ...">`。`globals.css:23` 接管 body / prose / markdown 字体。

如此一来 SSR 输出的 HTML 已经是最终字体,客户端 FontProvider 仅是冗余确认。

### 4.3 字体加载性能

- next/font/google 自动 self-host,生成 `/_next/static/media/[hash].woff2`,响应头 `cache-control: public, immutable, max-age=31536000`。
- variable: '--font-inter' 让多个字体可在同一 stylesheet 共享,减少 CSS 文件数。
- **Noto Serif SC `preload: false`:** 不出现 `<link rel="preload">`,只在元素实际使用 `font-noto-serif-sc` 时才请求。

---

## 5 · 骨架屏(零 spinner 政策)

CLAUDE.md 第 3.6 节:**"禁止 spinner;必须用与最终布局匹配的骨架屏 + shimmer/pulse。"**

### 5.1 共用 shimmer keyframe

`globals.css` 内:

```css
@keyframes shimmer {
  100% { transform: translateX(100%); }
}
```

应用方式:容器 `relative overflow-hidden`,内部 `<div class="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-[var(--shimmer-color)] to-transparent">`。

### 5.2 各页 loading.tsx

| 文件 | 与最终布局对应 |
|:---|:---|
| `app/posts/loading.tsx` → `PostsLoading.tsx` | FeaturedPost + AuthorProfileCard + 3 列网格骨架 |
| `app/posts/(article)/loading.tsx` & `[slug]/loading.tsx` | BackButton + 标题 + 元数据 + tags + 段落 + 大图 + 段落 |
| `app/timeline/loading.tsx` | 标题 + 渐变竖条 + 2 年 × 3 月 × 2 文章项骨架 |
| `app/about/loading.tsx`, `app/design/loading.tsx`, `app/agent/loading.tsx` | (未读全文,但形态类似 ScrollSection 骨架) |
| `app/friends/FriendsLoading.tsx` | 网格 + 标题 + 视图切换骨架 |

### 5.3 详情页骨架的"独立 Suspense"

`app/posts/(article)/layout.tsx:5`:

```tsx
export default function ArticleLayout({ children }) {
  return <>{children}</>;
}
```

route group `(article)` 加这个 pass-through layout,只是为了创建一个独立的 Suspense 边界 —— 防止详情页 loading 时显示父级 `/posts` 的 loading.tsx(那个是文章列表骨架,不匹配详情页布局)。

### 5.4 Workspace Skeleton

`app/agent/workspace/components/WorkspaceSkeleton.tsx` —— 严格同形于最终布局(sidebar + topbar + thread + composer),Auth loading 期间显示。这是为了"零 flash"的最高要求。

### 5.5 Markdown 内嵌骨架

`MarkdownRenderer.tsx:493-508`:

```tsx
if (isLoading) return (
  <div className="my-4 flex justify-center bg-[var(--markdown-bg-code)] rounded-lg p-8">
    <div className="text-[var(--text-muted)] animate-pulse">加载流程图...</div>
  </div>
);
```

mermaid 图表加载时用 `animate-pulse` 占位 —— 这是少数允许的 spinner-like 视觉,但因为 mermaid 真的会异步处理,无法预知最终大小,不能做严格骨架。

---

## 6 · 图片优化

### 6.1 next/image 的两种用法

- **可控来源(头像 / Logo):** 用 `<Image>` 含完整尺寸 + sizes,享受 Next 优化(自动 webp/avif、srcset)。例:`BlogHeader.tsx:340` site logo,`MobileMenu.tsx` 头像。
- **不可控来源(markdown 图片 / 友链 logo):** `unoptimized={true}` + 占位 width/height + CSS `width: 100%`,只享受 lazy。例:`MarkdownRenderer.tsx:838`、`FriendCard.tsx`。

### 6.2 图片 URL 验证

`lib/sanitizeUrl.ts:17` `sanitizeImageUrl(url, fallback)`:
- 允许 `http: / https: / data:image/* / 同源相对路径`
- 拒绝 `javascript: / vbscript: / data: 非图片` 等
- 自动给 `//foo` 补 `https:`

`BlogHeader.tsx:47`、`MobileMenu.tsx`、`AuthorProfileCard` 全部包裹 sanitize。这是 admin 字段进入 blog 渲染的强制关卡。

### 6.3 平台图标暗色覆盖

`socialLinks.ts:54` `PLATFORM_ICON_URLS_DARK`:
- GitHub 黑色 logo 在暗主题完全消失,覆盖为白色(`#ffffff`)。
- 其他单色 logo 类似处理。

消费者(渲染社交链接的组件)需要根据当前主题选择 `iconUrl` 还是 `iconUrlDark`,实现见 `MobileMenu.tsx`、`SiteFooter.tsx`。

---

## 7 · PWA / iOS Standalone

### 7.1 manifest.ts

`apps/blog/app/manifest.ts:4` —— Next.js metadata API,build 时调用一次,生成 `/manifest.webmanifest`。

`display: 'standalone'` —— 用户从主屏幕启动时无浏览器 chrome。
`background_color / theme_color: '#09090b'` —— 启动 splash 暗色。
`scope: '/'` + `start_url: '/'` —— 整站为应用范围。

### 7.2 layout.tsx 的 PWA meta

`layout.tsx:88-93`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- `viewport-fit=cover` —— 让内容延伸到刘海屏 / Dynamic Island 区域。
- `maximum-scale=1` + `formatDetection.telephone=false` —— 禁用 iOS 双击缩放与电话号识别。
- `mobile-web-app-capable` 是 Chrome 90+ 标准化版本,`apple-mobile-web-app-capable` 是 iOS 兼容 —— 双写避免 console deprecation 警告。
- `black-translucent` —— 状态栏背景透明,内容延伸到状态栏下;layout 顶部 padding 用 `env(safe-area-inset-top)` 避让(`BlogHeader.tsx:298`)。

### 7.3 iOS WKWebView 适配

代码里多处显式判断 `isStandalone` 与 `isMobile`,把动画降级:

- **PageTransition** `(window.navigator as any).standalone === true` 时关掉 transform 滑动,改纯 opacity(`PageTransition.tsx:177`)。
- **BlogHeader** `contain: layout style`(`BlogHeader.tsx:311`)隔离布局影响 —— 降低 WKWebView 在路由切换时重建合成层概率。
- **FloatingThemeToggle MOBILE_HEAVY_PAGES**(`FloatingThemeToggle.tsx:15`)—— 重页面用 fade 而非 clip-path 扩散。

### 7.4 安全区(safe-area-inset)

- BlogHeader top padding(`BlogHeader.tsx:298`)
- SiteFooter bottom padding(从注释)
- ArticleFloatingActions / ScrollToTop bottom 位置

---

## 8 · 构建 / 部署相关

### 8.1 standalone build

`output: 'standalone'` 让 Next.js 在 build 后输出 `.next/standalone/` 目录,内含最小化 server.js + 必要 node_modules。Docker `Dockerfile` 用这个目录构建镜像,产物只 ~150MB(对比传统 1GB+)。

### 8.2 outputFileTracingRoot

`outputFileTracingRoot: path.join(__dirname, '../..')` 告诉 Next 在 monorepo 中找依赖时回到仓库根 —— 否则 standalone build 会漏掉 `packages/ui` / `packages/hooks` 等 workspace 包。

### 8.3 Turbopack(开发期)

`package.json:6` `"dev": "next dev --port 3000 --turbopack"` —— Next 15 的 Turbopack stable,首次启动比 webpack 快 5x,hot reload 100ms 级别。

### 8.4 production 入口

`package.json:9` `"start": "next start"` —— standalone build 后,用 `node .next/standalone/server.js` 也可,Dockerfile 选其一。

---

## 9 · 性能可观测点

| 指标 | 影响因素 |
|:---|:---|
| FCP(First Contentful Paint) | next/font display:swap 让字体不阻塞,FOUC 双件套保证背景立即正确,理论上 <1s |
| LCP(Largest Contentful Paint) | 首页 H1 是 LCP 元素;hero 区有大字号 + 渐变,文本 LCP 通常 <2s |
| CLS(Cumulative Layout Shift) | next/image 占位 width/height 防止 markdown 图片 layout shift;骨架屏 → 真实内容时形状一致最关键 |
| INP(Interaction to Next Paint) | SearchPanel 防抖 300ms;翻页 useQuery placeholderData 让 paint 不等 |
| TTFB(Time to First Byte) | RSC 串行 fetch 累加,services.ts 的 5s 超时是 worst case |

---

## 10 · 已知限制

1. **`maximum-scale=1`** 对视障用户的 zoom 不友好;iOS 16+ 已无视此设置,但仍是不推荐的 anti-pattern。
2. **`black-translucent` 状态栏** 在亮主题下文字会变白,看不清 —— 需要 `<meta>` 动态根据主题切换,目前没做。
3. **manifest 的 `theme_color: '#09090b'`** 与 layout viewport.themeColor 双值不一致 —— manifest 是 standalone 启动 splash,viewport 是浏览器 chrome,理论上应同步。
4. **`unoptimized: true`** 让 markdown 图片完全失去 Next 优化,大图渲染卡顿。可考虑接 `<Image loader>` 通过自建 image proxy 处理。
5. **`outputFileTracingRoot: '../..'`** 会包含 monorepo 中所有 packages 的依赖,即使没用上 —— standalone bundle 比预期大。可加 `outputFileTracingExcludes` 收窄。
6. **HTTP/3 / Brotli 配置不在 Next 层**,要看 nginx 网关。生产环境的 HTTP/3 启用与否未知。
7. **图片 CDN 未启用**:仍由 backend 直接 serve,带宽压力都在中心节点。可接入 Cloudflare R2 / OSS。

---

## 11 · 性能注意点 / 取舍

- **RSC 默认零客户端 JS:** 静态页面仅几 KB hydration payload。但本模块大量 `'use client'`(BlogHeader / FloatingThemeToggle / SearchPanel / MarkdownRenderer 全是 Client),实际 bundle 偏重。
- **shiki/oniguruma WASM** 是体积大头(~250KB),通过 `optimizePackageImports` 树摇,实际只加载用到的 8 核心语言。
- **dompurify SSR-safe lazy:** SSR 不打包 dompurify,client 才 import,server bundle 减重。
- **mermaid 1MB+ 仅在含 mermaid block 的文章触发动态 import** —— 不影响主 bundle。
- **`Cache-Control: no-cache` 页面路由** vs **immutable static asset** 是 PWA 安全的关键平衡:HTML 必须 revalidate(防止旧 hash 引用消失的资源),静态资源永久缓存(性能)。
- **`React.memo` 大量使用**(ArticleCard / FeaturedPost / SearchPanel / TableOfContents / ScrollToTop / TimelineTree.PostItem 等):对 ArticleCard 这种密集列表项有意义,对 SearchPanel 这种全屏 modal 价值低 —— 实际收益要 profile。
