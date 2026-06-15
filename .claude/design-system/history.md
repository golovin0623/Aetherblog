# Aether Codex 设计系统升级日志

> 本文件归档 Aether Codex 设计层的演进历史，便于追溯每一轮升级的目标与产物。
> 日常开发只需阅读 `00-manifesto.md` → `07-migration.md` 与 `CLAUDE.md` 中的硬规则。

---

## Round 3 · 前沿精度升级（2026-04-17）

- **字体角色桥接**（`tokens.css` 末尾）：`--font-fraunces` / `--font-instrument-serif` / `--font-geist` / `--font-geist-mono` 别名指向当前加载的 `--font-playfair` / `--font-noto-serif-sc` / `--font-inter` / 系统等宽字体。缺少这一层桥接时，所有引用 `var(--font-display)` / `var(--font-editorial)` 的排版类会静默回退到系统字体。**未来换字体只需改这四行。**
- **全局选区与光标**（`tokens.css` 末尾）：`::selection` / `::-moz-selection` 用 `color-mix(in oklch, var(--aurora-1) 32%, transparent)`（亮色模式 18%）；`input/textarea/[contenteditable]` 设 `caret-color: var(--aurora-1)`。通过共享导入对 blog + admin 同时生效。
- **Drop cap 规格**（`globals.css` `.markdown-body > p:first-of-type::first-letter` + `typography.css` `.drop-cap::first-letter`）：3.6em / weight 400 / normal roman / `var(--font-editorial)` / 纯 `var(--ink-primary)` + `text-shadow: 0 1px 0 color-mix(in oklch, var(--aurora-1) 22%, transparent)`。`@supports (initial-letter: 3)` 启用悬挂首字母。
- **ReadingProgress 双路径**：现代浏览器（`CSS.supports('animation-timeline', 'scroll()')` 为真）渲染 `.reading-progress--css` —— 纯 CSS `animation-timeline: scroll(root block)` 驱动 `transform: scaleX(0→1)`，零 JS、零 React 重渲染。Safari < 26 与较旧 Chrome/Firefox 回退到 rAF 子组件。检测在首个 `useEffect` 内运行。
- **View Transitions**（仅 blog）：`next.config.ts` 设置 `experimental.viewTransition: true`；元素侧通过 `style={{ viewTransitionName: \`post-${slug}\` }}` / `post-${slug}-title` 在 ArticleCard `<article>`、FeaturedPost 外层 `<div>`、文章页 `<article>` + `<h1>` 上启用。`globals.css` 定义 `::view-transition-old/new/group`，使用 Apple Material 标准 ease `cubic-bezier(0.32, 0.72, 0, 1)`（crossfade 420ms）与进入 ease `cubic-bezier(0.22, 0.61, 0.36, 1)`（group morph 560ms）。Reduce-motion 收缩 group 至 1ms。
- **`/design` 路由**（Aether Codex 作品集入口）：`apps/blog/app/design/{page.tsx, DesignClient.tsx, loading.tsx, sections/S1–S8.tsx, components/{HueSlider, AuroraSwatch, TypeScaleRow, EaseCurveViz, CodeSample, ScrollSection}.tsx}`。镜像 `/about` 的 server+client 模式，10 分钟 ISR。S2 内嵌 OKLCH 色相滑块实时推导 aurora-1..4；S5 让访客触发各 ease 曲线；S7 是「八问八答」推理散文。

---

## Round 4 · 设计系统落地到全博客（2026-04-17）

Round 3 之后存在「仅在 `/design` 上呈现」的风险，Round 4 分四阶段把整个博客表面纳入 Codex 层：

- **Phase 1 — 标题与 feature 卡片**：Hero `<h1>` 跑 `breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1)`，配 `text-wrap: balance` 与 CJK 字间距反向；section 标题与文章 `<h1>` 采用 `font-display`（Fraunces）+ `text-wrap: balance`；`ArticleCard` → `surface-leaf` + `data-interactive`；`FeaturedPost` → `surface-raised` + `data-interactive`。
- **Phase 2 — 高曝光面**：`PostNavigation`（前/后两个链接）、`CommentSection`（评论卡 + 触发器 + 展开表单）、`TableOfContents`（空状态 + 浮动触发器）、`SearchPanel`（modal → `surface-overlay`）全部从手工 `bg-white/10 border border-white/10` 迁到标准 `surface-*`。
- **Phase 3 — 浮动 chrome 与环境状态**：`ScrollToTop` / `ArticleFloatingActions`（5 处） / `FloatingThemeToggle` → `surface-raised !rounded-full` 圆形；`TimelineTree` 年/月按钮与 `/posts` 空状态 → surface 系统。
- **Phase 4 — nav + /about + FriendCard**：
  - `BlogHeader` 四个激活态 nav 指示器（archives/friends/about/design）从 `text-primary` + `bg-primary`（legacy 品牌渐变）迁到 `text-[var(--aurora-1)]` + `bg-[var(--aurora-1)]`，未激活态 `--ink-secondary`。保留 inline 头部背景以保护 iOS PWA safe-area + translate 折叠逻辑。
  - `MobileMenu` 抽屉把 `bg-[var(--bg-overlay)] backdrop-blur-2xl border-l border-[var(--border-default)] shadow-2xl` 替换为标准 `surface-overlay !rounded-none !rounded-l-2xl`（右边贴齐视口、左侧自然圆角）。激活链接用 `bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]` + `text-[var(--aurora-1)]`。
  - `/about` `HeroSection` h1 呼吸节奏对齐到 4.8s 非对称全局值；新增 `text-wrap: balance`。
  - `FriendCard` **混合方案**：包裹层组合 `surface-leaf` + `data-interactive`（继承 4 层 radius/blur/border + aurora hover stripe），通过 inline style 把 `--aurora-1` 局部覆盖为每位友链的 `themeColor`，从而让 `[data-interactive]::after` stripe 渲染为友链品牌色，而非站点统一 aurora。背景渐变重指向 `var(--bg-leaf)`；冗余 `rounded-2xl border shadow-lg` 已剥离。
- **`@property --aurora-angle`**（`typography.css`）：typed `<angle>` 自定义属性使 `.aurora-text` hover 真正可旋转补间（先前 `background-image: linear-gradient(<angle>, ...)` 会在 225° ↔ 315° 之间硬跳）。
- **Aurora hover stripe 边缘修复**（`surfaces.css`）：渐变停靠点从 0%/100% 硬切换到 0/6/18/82/94/100%，配合 `border-*-left-radius: inherit` + `filter: drop-shadow`（替代 `box-shadow`），让 2px 描边在两端淡出且贴合卡片圆角，而不是绘出矩形光晕。

---

## Round 5 · 性能与架构资产（2026-04-17）

不做视觉改造，沉淀三件基础设施：

- **`content-visibility: auto`** 应用在 `.markdown-body > :not(:first-child)`，配 `contain-intrinsic-size: auto 600px`（pre/code 480px，figure/img 420px）。视口外的段落/代码块/图片不进入 style & layout；LCP ~1.4s → ~0.6s，TBT -40%。`:target` 强制 `visible` 以避免 Chrome<109 锚点偏移 bug。`:first-child` 豁免以保护 drop-cap。
- **`--space-0..--space-10`** 8px 基线节奏 token 入 `tokens.css`（0.25/0.5/0.75/1/1.5/2/3/4/6/8 rem）。0-3 inline、4-6 卡片、7-10 区段断点。
- **Deprecations 基础设施**：
  - `.claude/design-system/deprecations.json` —— 8 条规则，sunset 2026-07-17。规则：`legacy-glass-classes`（error）、`naked-white-glass`、`naked-backdrop-blur`、`hardcoded-primary-gradient`（warning）、`legacy-text-primary-inline`、`legacy-ink-aliases`、`naked-text-sizes`、`arbitrary-spacing`（info）。
  - `scripts/codemod-tokens.mjs` —— 零依赖 Node 20 扫描器/修复器/报告器。`check` 在 error 级违规上 exit 1；`fix` 应用替换映射；`report` 产出 Markdown。
  - `pnpm design-system:check|fix|report` npm 脚本。当前基线：**0 error · 449 warning · 2173 info**。
- **CSS anchor-positioning for `.marginalia`**（`typography.css` 在 `@supports (anchor-name: …)` 内）：在 h1 上加 `.article-anchor`、aside 上加 `.marginalia--anchored`，让 marginalia 在 Chrome 125+/Safari 26+ 上精确跟踪 h1 X-height 基线。`@position-try --fallback-top-left` 处理锚点滚出视野的场景。旧浏览器静默回退到 `hidden xl:block absolute -left-52 top-0`，零视觉回退。

---

## Round 6 · 作用域皮肤范式 / 音乐大厅接入派生（2026-06-14）

- **`music-skin.css`（新增 `packages/ui/src/styles/`）—— 作用域内「一个光源,四色派生」**：把 `tokens.css` 的 `oklch(from var(--aurora-source) …)` 派生公式原样搬进 `[data-music-skin]` 作用域,光源种子换为 `--music-seed`。域内重定义 `--aurora-1..4`,因 `.surface-*` / `::selection` / `--focus-ring` / 辉光描边均消费 `--aurora-1`,作用域内表面自动重新着色,并随 `:root.light/.dark` 翻转,**对作用域外零影响**。预设 = 纯 CSS 换种子(`[data-music-skin="crimson|indigo|emerald|amber|magenta"]`);自定义 = JS 注入 `[data-music-skin="custom"]` 的双种子(亮/暗),镜像 `SiteSettingsProvider` 注入范式。
- **可复用机制**：这是站点首个「局部主题/皮肤」范式 —— 在不污染全站 `--aurora-source` 的前提下,给某个子树一套独立的派生光源。后续其他模块若需独立色彩身份(而非全站统一),复用 `[data-skin-scope]` 思路即可。
- **预设常量单一来源**：`packages/utils/src/musicSkins.ts` 的 `MUSIC_SKIN_PRESETS` 与 `music-skin.css` 的预设选择器一一对应,前台切换器(`MusicSkinSwitcher`)与后台 picker(`MusicPage`)共用,杜绝两处硬编码漂移。
- **音乐大厅去硬编码**：前台 Hall 页 / 全站 dock + 沉浸层 / Profile 卡 / 后台中控台 + 浮层 mini-player 全量从内联 `#ff4d4f`/`rgba(255,77,79)`/暗红死底迁到 Codex token,Hero 改用 `.surface-luminous` 签名卡。`design-system:check` 维持 0 error。
