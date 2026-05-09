# 03 · Content Rendering · Markdown 渲染管线

> 文章详情页主体由 `MarkdownRenderer.tsx` 负责。本文展开整条管线:plugins → component map → highlight → math → diagram → 安全消毒。

---

## 1 · 范围

- `apps/blog/app/components/MarkdownRenderer.tsx`(主组件)
- `apps/blog/app/components/AlertBlock.tsx`(自定义 directive)
- `apps/blog/app/components/MiniMarkdownPreview.tsx`(轻量预览,FeaturedPost / 卡片摘要用)
- `apps/blog/app/components/TableOfContents.tsx`(从同一份 markdown 抽取标题)
- `apps/blog/app/components/ProtectedPostContent.tsx`(密码验证后注入 content)
- `apps/blog/app/components/CommentSection.tsx`(评论是纯文本,但 nickname/website 也走 sanitizeUrl)
- `apps/blog/app/lib/remarkAlertBlock.ts`(remark plugin)
- `apps/blog/app/lib/headingId.ts`(标题 ID 预计算)

---

## 2 · 整体管线

```
backend 返回的 raw markdown(string)
        ↓
preprocessMarkdown()                ← MarkdownRenderer.tsx:251
  防御 ::: warning :::(连续两行)的 mdast 解析 bug → 注入 ​ 占位
        ↓
ReactMarkdown
  ├─ remarkPlugins:                 ← 顺序敏感
  │   ├─ remark-gfm                 (GFM:表格 / 任务列表 / 自动链接)
  │   ├─ remark-math                (识别 $...$ 与 $$...$$)
  │   ├─ remark-directive           (识别 :::name{attr=val})
  │   └─ remarkAlertBlock(本地)    (把 directive name in [info,note,warning,danger,tip] 映射成 <alert-block>)
  ├─ rehypePlugins:                 ← 顺序敏感
  │   ├─ rehype-raw                 (保留作者写的原始 HTML)
  │   ├─ [rehype-sanitize, sanitizeSchema]   ← 二次防御 XSS
  │   └─ [rehype-katex, { throwOnError:false, strict:'ignore' }]
  ├─ components: createComponents(highlighter, theme, headingIdMap)
  │   ├─ h1..h6 → 注入预计算 ID(scroll-mt-24)
  │   ├─ alert-block → AlertBlock
  │   ├─ p → 自动判断是否含块级图片,容器从 <p> 切到 <div>
  │   ├─ pre → ShikiCodeBlock 或 MermaidBlock
  │   ├─ code(行内)→ <code> + tokens
  │   ├─ img → next/image + figure/figcaption + alt|size 解析
  │   ├─ table/th/td → 包裹 overflow-x-auto
  │   ├─ blockquote → 4px 左边框,色由 token
  │   ├─ a → parseMarkdownLink + isExternal 决定 target/rel
  │   ├─ input[type=checkbox] → readOnly disabled 标签
  │   ├─ span.katex-error → "数学公式渲染失败" + tooltip
  │   └─ hr → my-8
  └─ FOUC 防护:Shiki 未 ready 前 <div> visibility:hidden
        ↓
最终 HTML
```

---

## 3 · remark / rehype 插件链

`MarkdownRenderer.tsx:90-95`:

```ts
const REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkMath,
  remarkDirective,
  remarkAlertBlock,
];
const REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: 'ignore' }],
];
```

**为什么 rehype-sanitize 在 rehype-katex 之前:** rehype-katex 输出 `<span class="katex">` 包大量数学符号 spans,而 sanitize 默认 schema 不允许这些 class 与 mathml 标签 —— 颠倒顺序会把公式洗掉。但 katex.error 仍会被保留(为什么:sanitize schema 允许 span + class,只是不允许 onclick 等危险属性)。

**`sanitizeSchema` 的安全收紧:**(`MarkdownRenderer.tsx:57-88`)
1. 扩展 tagNames 增加排版语义(`mark / abbr / details / summary / video / audio` 等),但显式列出而非展开用户输入。
2. 全局 attributes `*` 不允许 `style`(防 CSS 注入),保留 `className/id/align/width/height`。
3. `img@src` 的 protocols 收窄到 `http / https / blob`,**移除 `data:`**(VULN-170:`data:image/svg+xml` 可以执行 inline `<script>`)。
4. `a` 允许 `target / rel / download`。
5. 自定义 `alert-block` 标签允许 `data-type / data-title`。

---

## 4 · `remarkAlertBlock` —— 自定义 directive

**位置:** `apps/blog/app/lib/remarkAlertBlock.ts:20`

**作用:** 把 `:::warning{title="foo"}` 这种 container directive 改写成 `<alert-block data-type="warning" data-title="foo">`,然后在 components map 中拦截渲染为 `<AlertBlock>` React 组件。

**支持的 5 种 type:** `info / note / warning / danger / tip`(`MarkdownRenderer.tsx:118`)。

**AlertBlock 视觉:** `AlertBlock.tsx:24` —— `border-l-[4px]` + 主题感知背景(亮主题蓝白绿,暗主题深色 desaturate),title 加粗 + lucide 图标,正文 leading-relaxed。

**预处理 hack:**(`MarkdownRenderer.tsx:251`)

```ts
function preprocessMarkdown(content) {
  // ::: warning\n::: 连续两行(空内容 directive)会让 mdast directive 插件
  // 误判,注入 ​ 零宽空格作为占位 child
  return content.replace(
    /(:::warning(?:\{[^\n]*\})?\s*\n)(:::\s*$)/gm,
    '$1​\n$2',
  );
}
```

之后 AlertBlock 在渲染时识别 `​` 为空内容(`AlertBlock.tsx:22`),不显示正文区域。

---

## 5 · 标题 ID 与 TOC

### 5.1 `headingId.ts` 预计算

**入口:** `apps/blog/app/lib/headingId.ts:39` `buildHeadingIdMap()`

**为什么不用 rehype-slug:**
- React 19 的并发渲染下,共享可变计数器(slugify 重名递增)会出现 ID 漂移(同一标题在不同渲染里得到不同 `-2` / `-3`)。
- 这个 Map 以 **AST 行号为 key**,每个 `<hN>` 组件用 `node.position.start.line` 查表得到稳定 ID,不依赖共享状态。

**算法:**(`headingId.ts:39-85`)
1. 按行扫描 markdown,跟踪 ` ``` ` / `~~~` 围栏代码块状态(围栏内的 # 不算标题)。
2. 匹配 `/^(#{1,6})\s+(.+)$/`,清洗 inline markdown(去图片/链接/代码/HTML/星号波浪),得到 raw text。
3. `getHeadingId(rawText)` —— 依赖 `usedHeadingIds` Map 计数,首次返回 base,重复返回 `${base}-${n}`。
4. 入 Map:`map.set(行号, id)`。

### 5.2 `extractHeadingsFromMarkdown` 给 TOC 用

`headingId.ts:108`,与 `buildHeadingIdMap` 共用上述扫描逻辑,但返回 `ParsedHeading[]`(含 level / text / line)。

### 5.3 `TableOfContents.tsx`

- IntersectionObserver 用 `rootMargin: '-100px 0px -70% 0px'` 锁定"刚滚到 100px 以下、还差 70% 才到底"的标题为激活态。
- 用 Set 维护可见标题集合 + `headings.find()` 找第一个可见 —— 避免 `getBoundingClientRect` 的 reflow 开销。
- TocItemComponent 用 React.memo + `layoutId="active-indicator"` 让激活竖线在标题间 morph 移动。
- 三种 variant:`floating`(右下角浮动按钮 + drawer)、`icon`(嵌入文章 H1 旁的 7×7 圆形按钮)、`sidebar`(直接渲染列表,目前未使用)。

---

## 6 · 代码高亮 —— Shiki

### 6.1 单例 + 按需加载

**初始 8 语言:**(`MarkdownRenderer.tsx:127`)`javascript / typescript / jsx / tsx / json / html / css / bash` —— 包含核心 web 开发语言,首次加载 ~50KB。

**扩展 25 语言:**(`MarkdownRenderer.tsx:133`)`python / java / go / rust / c / cpp / scss / yaml / xml / sql / shell / powershell / markdown / dockerfile / nginx / php / ruby / swift / kotlin / vue / svelte / astro` —— 这些都通过 `bundledLanguagesInfo.find()` 动态 import(`ensureLanguageLoaded():197`)。

**别名映射:**(`LANGUAGE_ALIASES:145`)`js→javascript / ts→typescript / py→python / rb→ruby / yml→yaml / sh→bash / zsh→bash / ps1→bash / pwsh→bash / powershell→bash / docker→dockerfile`。

**单例策略:**(`MarkdownRenderer.tsx:160-191`)`highlighterInstance` + `highlighterPromise` 模块级,跨 MarkdownRenderer 实例共用。第二次进文章页时已经有 instance,无需 await。

### 6.2 Shiki transformer

**`compact-line-spacing` transformer:**(`MarkdownRenderer.tsx:580`)Shiki 默认输出每行 `<span>` 带 inline `line-height: ...` 与 `height: ...`,会导致 CJK 字符行间距过大。postprocess 阶段正则去除这些 inline style,让 CSS 接管。

### 6.3 fallback 链

`shikiStatus: pending → ready → failed`(`MarkdownRenderer.tsx:958`)

- pending:`<div style={{ visibility: 'hidden' }}>` 防 FOUC。
- ready:正常渲染。
- failed:**仍然显示 markdown,只是代码块降级为无高亮 `<pre>`**(`MarkdownRenderer.tsx:677`)。

这个 fallback 至关重要 —— 如果 Shiki 因 CSP 阻拦 WASM、或 jsdelivr 不通,而代码却让 visibility 永远 hidden,会出现"全部正文不可见"的灾难。这个分支用注释标了"VULN-..."级别的红线提醒。

### 6.4 ShikiCodeBlock 自带能力

- **Copy 按钮:**(`MarkdownRenderer.tsx:413,615`)`navigator.clipboard.writeText` + `legacyCopyText()` 降级到 `document.execCommand('copy')`(iOS 旧 Safari)。
- **超过 15 行自动折叠**:`shouldShowToggle = lineCount > 15`(`MarkdownRenderer.tsx:541`),折叠状态下用 `aria-expanded` + 折叠/展开按钮,初始 `useEffect` 自动设 isCollapsed。
- **DOMPurify 二次消毒**:`sanitizeHtml(highlightedHtml, SHIKI_SANITIZE_CONFIG)` —— 即使 Shiki 输出可信,也走 DOMPurify 防御 transformer 注入。

---

## 7 · 数学公式 —— KaTeX

**渲染插件:** `[rehype-katex, { throwOnError: false, strict: 'ignore' }]`(`MarkdownRenderer.tsx:94`)

**CSS 懒加载:**(`MarkdownRenderer.tsx:104,985`)只在内容含 `$...$` 或 `$$...$$` 时,首次 effect 内插 `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/katex.min.css">`。`katexCssLoaded` 模块级 flag 防重复。

**注释中已标 TODO:** 缺少 SRI integrity 哈希(`MarkdownRenderer.tsx:106`),CDN 被劫持时无防御。

**语法错误降级:** `span.katex-error` 被 components map 拦截(`MarkdownRenderer.tsx:929`),显示 "数学公式渲染失败" + tooltip 含原 source。这避免了红字 "ParseError" 直接出现在文章里。

**`serverExternalPackages: ['katex']`:**(`next.config.ts:53`)Next.js 不打包 katex 到 server bundle,运行时 require —— 减小 SSR build 大小。

---

## 8 · 图表 —— Mermaid

**入口:** `MarkdownRenderer.tsx:434` `MermaidBlock`

**懒加载:** `(await import('mermaid')).default` —— 只在文章含 `\`\`\`mermaid` 时才加载。

**主题切换:** `theme === 'dark' ? 'dark' : 'default'` + 暗色专属 themeVariables(primary indigo / 文字 slate-100 / lineColor slate-500 等)。

**先 `parse()` 再 `render()`:**(`MarkdownRenderer.tsx:471`)Mermaid 在语法错误时不抛,而是返回带"炸弹+Syntax error"图标的 SVG。先用 `mermaid.parse(code, { suppressErrors: true })` 校验失败 → 显示中文错误 + 原 source code。这比"炸弹图标污染文章"友好得多。

**安全:**
- `securityLevel: 'strict'`(`MarkdownRenderer.tsx:467`)Sentinel 安全要求,禁用 click/href interaction。
- SVG 输出经 DOMPurify `USE_PROFILES: { svg: true, svgFilters: true }` 二次消毒(`MarkdownRenderer.tsx:521`)。

---

## 9 · 图片渲染

**入口:** `MarkdownRenderer.tsx:805`

**alt|size 语法:**(`MarkdownRenderer.tsx:815-829`)`![alt|300px](url)` 或 `![alt|50%](url)`。支持 `px / % / vw / vh / em / rem`,纯数字默认 px。

**caption 自动隐藏:** `normalizeImageCaption()`(`MarkdownRenderer.tsx:234`)— 若 alt 是 "image-1.png" / "Snipaste_2026" 这种文件名格式,不显示 caption。

**next/image + unoptimized:** 由于 markdown 图片来源不可控(站长用户上传 / 外链),全部 `unoptimized` 跳过 Next.js 优化,但仍走 lazy 加载。`width={1200} height={800}` 是占位避免 layout shift,实际靠 CSS `width: 100%`。

---

## 10 · 链接处理

**`parseMarkdownLink`:**(`MarkdownRenderer.tsx:341`)

```
href                          → 输出
javascript: / data: / vbscript: / file:  → null(显示为虚线下划线灰色 span,无法点击)
//foo.com                     → external
#anchor / /path / ./ / ../ / ?  → internal
mailto:foo@bar / tel:+86       → internal
http://foo / https://foo       → external
其他                            → 内部 fallback
```

internal vs external 决定 `target="_blank"` + `rel="noopener noreferrer"`。

---

## 11 · 与 server-go 的契约

**Markdown 来源:** `GET /api/v1/public/posts/${slug}` 的 `data.content` 字段。后端不做任何 markdown 处理,纯字符串透传 —— 所有渲染由前端完成。

**为什么前端渲染:** 1) Shiki / KaTeX / Mermaid 都需要 client capability;2) 主题切换时无需重新打 backend;3) 同一份 raw markdown 在 Reading / TOC / search highlight 三处复用。

**密码保护:**
- 后端响应里 `passwordRequired: true` 时不返回 content。
- 前端走 `<ProtectedPostContent>`(`ProtectedPostContent.tsx:13`),用户提交密码 → `POST /api/v1/public/posts/${slug}/verify-password` body `{password}` → 返回 `{code: 200, data: { content }}` → 注入 `<MarkdownRenderer content={...} />`。

**视图统计:** 详情页本身的访问由 `<VisitTracker>` 上报(`VisitTracker.tsx:21`),POST `/api/v1/public/visit` body `{path, postId}`。后端通过 `path` 解析或直接用 postId 累加。

---

## 12 · 设计系统应用点

| Codex 元素 | 在哪 | 文件:line |
|:---|:---|:---|
| `surface-leaf` | 评论卡片 | `CommentSection.tsx:61` |
| `surface-overlay` | 命令面板 (TOC drawer / SearchPanel) | `TableOfContents.tsx:286`、`SearchPanel.tsx:454` |
| `surface-raised` | floating TOC trigger / ScrollToTop | `TableOfContents.tsx:252`、`ScrollToTop.tsx:57` |
| `font-display` | 文章 H1 | `posts/[slug]/page.tsx:193` |
| `font-editorial` | PostNavigation 标题 / ArticleCard 摘要 | `PostNavigation.tsx:44`、`ArticleCard.tsx:134` |
| `font-mono uppercase tracking-[0.2em]` | marginalia / Prev/Next caption | `posts/[slug]/page.tsx:164`、`PostNavigation.tsx:42` |
| `--aurora-1` | 链接 hover / category 色 | `MarkdownRenderer.tsx:902` |
| `view-transition-name` | 文章卡片 → 详情页 H1 morph | `ArticleCard.tsx:106`、`posts/[slug]/page.tsx:157,196` |
| `breath-soft 4.8s` | (本管线不用,用在首页与 hero) | — |

字号阶梯走 `text-h2 / text-h3` 等 Codex 类(typography.css 定义),不写硬编码 px。

---

## 13 · 已知限制

1. **KaTeX CSS 公网 CDN + 无 SRI**(`MarkdownRenderer.tsx:106`):TODO 已标。建议 self-host 到 `/public/katex.min.css` 或加 integrity。
2. **rehype-sanitize 顺序敏感**:rehype-katex 之前必须保留 sanitize,但作者注释中明确"rehype-sanitize 默认 schema 已禁 iframe/object/embed/form,不再依赖用户输入"。任何添加 plugin 都要审顺序。
3. **`alert-block` 是非标 HTML 标签**:浏览器对未知元素默认渲染为 inline,需要 React 转换;但 sanitize 必须显式白名单(`MarkdownRenderer.tsx:81`)。新加 directive 时务必同步 schema。
4. **mermaid bundle 体积大(~1MB)**:即使懒加载,首次进入含 mermaid 的文章会卡顿一下。建议监控 LCP。
5. **Shiki 单例 instance 跨主题切换不重建**:主题切换只是改 `codeToHtml(... { theme: 'github-dark' | 'github-light' })`,这是正确做法。但理论上 transformer postprocess 的 `replace` 在大型代码块上有 N×M 成本,可观察。
6. **KaTeX 公式右键复制是 latex源 + html mathML 双层**:无法纯文本拷贝公式,可考虑加自定义"复制公式"按钮。
7. **图片 `unoptimized: true`** 让 next/image 形同虚设(只剩 lazy 与 alt),失去自动 webp/avif、自动 sizes、fragment srcset。但取舍合理,因为 markdown 图片源不可控。
8. **MiniMarkdownPreview** 没读 —— 它用于 FeaturedPost 与卡片摘要的轻量渲染,不走 Shiki/KaTeX/Mermaid,纯 marked 同步渲染 + sanitize。性能优先于功能。

---

## 14 · 性能注意点

- **Shiki ready 之前 visibility:hidden**(`MarkdownRenderer.tsx:1018`):用户实际看到正文需要等 highlighter 加载完毕,这是阅读体验的关键瓶颈。`highlighterInstance` 模块级单例做初值,SPA 切换第二篇时无 1 帧闪烁(注释 `MarkdownRenderer.tsx:953`)。
- **`useMemo` 链:**`normalizedContent → headingIdMap → components` —— 三级 memo 让主题切换只重建 components,内容不变时上游不重算。
- **不要把 setState 写到 `MarkdownRenderer` 的 props 链**:它被 `React.memo` 包裹,父组件 prop 变化才重渲染。详情页 `CommentSection` 状态变化不触发 markdown 重算。
- **DOMPurify 仅在客户端 import**(`MarkdownRenderer.tsx:33`):SSR 阶段返回 null,服务端不消毒(因为初始 state 是 pending,不会到达 sanitize 路径)。这避免 dompurify 的 jsdom 依赖膨胀 SSR bundle。
