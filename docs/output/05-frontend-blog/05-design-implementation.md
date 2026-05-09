# 05 · Design Implementation · Codex 在 Blog 的落地

> 本文聚焦"Aether Codex 设计系统"的规则在 blog 模块如何被具体使用,以及与 legacy 颜色变量的共存策略。

---

## 1 · 范围

- `apps/blog/app/globals.css`(token 入口)
- `apps/blog/tailwind.config.ts`(Tailwind theme.extend)
- `packages/ui/src/styles/tokens.css` / `surfaces.css` / `typography.css`(由 `@import` 引入)
- 设计规范出处:仓库根 `.claude/design-system/01-tokens.md` ~ `06-signature-moments.md`
- 落地点:`app/components/` 下绝大多数组件

---

## 2 · 三层级 token 接入

`app/globals.css:1-9` 加载顺序:

```css
@import '../../../packages/ui/src/styles/tokens.css';     /* Codex tokens */
@import '../../../packages/ui/src/styles/surfaces.css';   /* 4-layer surfaces */
@import '../../../packages/ui/src/styles/typography.css'; /* font-display 等语义类 */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**为什么必须早于 `@tailwind base`:** Tailwind preflight 会重置 default styles,如果 token 在 base 之后,自定义 CSS 变量优先级仍正确,但 keyframes / 自定义 class 会被 preflight 覆盖。早 import 是稳妥方案。

之后在 `app/globals.css:46~` 还有一份 **legacy token 集**(`--color-primary` / `--text-primary` / `--bg-primary` 等),与 Codex token 共存。这是 CLAUDE.md 第 3.7 节 "legacy 颜色变量未删除,sunset 2026-07-17" 的具象化。

---

## 3 · 三套色系并存

### 3.1 Codex `--ink-*` / `--bg-{void,substrate,leaf,raised}` / `--aurora-*`

由 `packages/ui/src/styles/tokens.css` 提供,`:root` / `:root.light` / `:root.dark` 三套实现 light/dark 翻转。本模块的现代化组件读这套(`ArticleCard.tsx:80-205` 大量使用)。

### 3.2 Legacy `--color-primary` / `--text-{primary,secondary,muted}` / `--bg-{primary,secondary,tertiary,card}`

由 `app/globals.css` 自身定义,亮色 / 暗色两套独立配。`SiteSettingsProvider.tsx:66` 还会基于 admin 主色生成 OKLCH 派生变量并注入 `<style id="aetherblog-primary-color">`,**写入的也是 legacy `--color-primary` 名称**(由 `generateColorVars` 决定)。

### 3.3 Tailwind `bg-primary` / `text-primary` / `border-default`

`tailwind.config.ts:13-44` 把 Tailwind 颜色 alias 到 legacy token:

```ts
colors: {
  primary:    { DEFAULT: 'var(--color-primary)', hover: 'var(--color-primary-hover)', ... },
  background: { DEFAULT: 'var(--bg-primary)', secondary: 'var(--bg-secondary)', ... },
  foreground: { DEFAULT: 'var(--text-primary)', secondary: 'var(--text-secondary)', ... },
  border:     { DEFAULT: 'var(--border-default)', hover: 'var(--border-hover)' },
}
```

**结果:** `<div className="bg-primary text-foreground">` 实际等于 `var(--color-primary)` + `var(--text-primary)`,接的是 **legacy** 系统。Codex token 必须用 `style={{ color: 'var(--ink-primary)' }}` 或 `text-[var(--ink-primary)]` 这种"内联 var" 形式访问。

---

## 4 · 4 层 Surface 在 blog 的实际使用

### 4.1 `.surface-leaf`(95% 场景)

**用途:** 文档流中的卡片、列表项、平面容器。

**落地点:**
- `ArticleCard.tsx:62` —— 文章卡片(实际是 `.surface-raised`,见 4.2)
- `CommentSection.tsx:61` —— 评论卡片
- `PostNavigation.tsx:35,57` —— 上/下一篇导航
- `friends/FriendsList.tsx` —— 友链卡片(由 FriendCard 内部)
- `posts/page.tsx:208` —— 空状态卡片
- `TableOfContents.tsx:182` —— TOC 空目录占位

### 4.2 `.surface-raised`(浮于流之上)

**用途:** sticky / fixed 容器、悬浮按钮、需要轻微阴影的卡片。

**落地点:**
- `ArticleCard.tsx:62` —— 文章卡片(浮于背景之上,带 hover translate-y)
- `ScrollToTop.tsx:57` —— 右下角圆形按钮
- `FloatingThemeToggle.tsx:57` —— 移动端右下角主题切换
- `TableOfContents.tsx:252` —— floating TOC trigger

### 4.3 `.surface-overlay`(全屏弹层)

**用途:** Modal、命令面板、Dropdown。

**落地点:**
- `SearchPanel.tsx:454` —— 全局搜索面板

### 4.4 `.surface-luminous`(签名稀有)

**用途:** Hero CTA、主推卡片(一页 ≤1)。

**落地点:** **当前 blog 没有任何组件使用**。规范要求保留但作者还未找到合适应用点。Hero 的 CTA(`page.tsx:84` 的 `hero-primary-btn`)是自己一套渐变 + shimmer 实现,不走 surface-luminous —— 这是设计与实现的小漂移。

### 4.5 `data-interactive` 装饰

**作用:** 给元素提供 aurora hover stripe(左侧极光细带)。

**落地点:**
- `ArticleCard.tsx:64` —— hover 时左侧出现 aurora 渐变细线
- `PostNavigation.tsx:36,59` —— 上/下一篇 hover 同上

---

## 5 · 字体阶梯

### 5.1 9 级字号 token

`tokens.css` 定义(摘自 03-typography.md 规范):

```
--fs-micro    9px
--fs-caption  11px
--fs-body     16px
--fs-reading  17.5px / 1.7
--fs-lede     22px
--fs-h4       28px
--fs-h3       40px
--fs-h2       56px
--fs-display  88px
```

`typography.css` 把每档曝光为 `.text-micro / .text-caption / ... / .text-display` 类。

### 5.2 4 角色字体

| 角色 | 字体 | 在 blog 的实际用法 |
|:---|:---|:---|
| Display | Fraunces variable(规范) | **Blog 实际加载的是 Playfair Display**(`layout.tsx:28`),通过 typography.css 的 `.font-display { font-family: var(--font-display) }` 抹平差异 |
| Editorial | Instrument Serif | 同上,blog 通过 token 间接获得,实际字体不一定加载 |
| Sans | Geist | **Blog 用 Inter 替代**(`layout.tsx:27`)—— `--font-sans` 在 tokens.css 里定义 fallback 链含 Inter |
| Mono | Geist Mono | `tailwind.config.ts:49` 写死 `'JetBrains Mono', monospace`,与 Codex token 不一致 |

**这是一处妥协:** blog 模块的字体加载早于 Codex 设计系统升级,作者通过 token fallback 链实现"声明用 Fraunces / Geist,实际渲染 Playfair / Inter"。视觉差距小,但严格说不合规。建议:把 `next/font/google` 切到 Fraunces / Instrument_Serif / Geist / Geist_Mono,并将 `tailwind.config.ts:49` 的 `mono` fallback 同步为 `var(--font-mono)`。

### 5.3 中文字体

- Display CN:Source Han Serif SC / **Noto Serif SC**(`layout.tsx:29` 已加载)
- Reading CN:**LXGW WenKai 未加载** —— Codex 规范要求长段中文用霞鹜文楷,blog 没接。
- UI CN:PingFang SC / HarmonyOS Sans SC,通过 fallback 自动接系统字体,无需主动加载。

---

## 6 · Aurora 着色规约

**规则:** 不直接用 `var(--aurora-1)` 当背景,而是 `color-mix(in oklch, var(--aurora-1) X%, transparent)`。

**落地示例:**
- `ArticleCard.tsx:81` category 文字:`color: 'color-mix(in oklch, var(--aurora-1) 90%, transparent)'`
- `ArticleCard.tsx:125` Lock chip 警告色:`background: 'color-mix(in oklch, var(--signal-warn) 8%, transparent)'`
- `ArticleCard.tsx:204` Pinned 印章:`background: 'color-mix(in oklch, var(--aurora-1) 14%, transparent)'`
- `BlogHeader.tsx:451,463` 灵境/友链 active 状态:`text-[var(--aurora-1)]` + 底部 `bg-[var(--aurora-1)]` 0.5px 横线

---

## 7 · Motion 实践

### 7.1 一条主曲线 `cubic-bezier(0.16, 1, 0.3, 1)`

落地:
- `posts/page.tsx:147` 翻页 scroll
- `about/components/ScrollSection.tsx:28` 节入场
- `HeroSection.tsx:21` Hero stagger 子项

### 7.2 三档时长 120 / 260 / 520ms

落地:
- `--dur-quick 260ms`:`ArticleCard.tsx:62` `transition-transform duration-[var(--dur-flow,520ms)]`(注意:此处与规范不一致,实际用了 flow 而非 quick;hover y-translate 也合理)
- `transition-colors duration-[var(--dur-quick,260ms)]`:`ArticleCard.tsx:99,189` 文字色变
- `--dur-flow 520ms`:卡片 hover 移动

### 7.3 一种弹簧:`{ stiffness, damping }` 预设

落地:
- `friends/FriendsList.tsx:106` `type: 'spring', stiffness: 400, damping: 30`(视图切换胶囊)
- `TableOfContents.tsx:285` `damping: 25, stiffness: 200`(drawer 滑入)
- `PageTransition` 不用 spring,只用 tween + duration。

### 7.4 1 档氛围 1.8s

落地:
- `globals.css` 的 `breath-soft 4.8s` —— 注意 4.8s 是 hero 专用呼吸节奏(规范定义为非对称 4.8s),不等于 ambient 的 1.8s。
- 极光漂移 / 卡片极光带由 surface.css 的 `data-interactive` 内置。

### 7.5 framer-motion variants 来源

- `@aetherblog/ui` 导出 `{ spring, transition, variants, stagger }`(`packages/ui/src/motion.ts`)。
- 但 blog 现实里大多数组件**没有 import 这些预设**,而是 inline 写 cubic-bezier 与 stiffness。例如 `HeroSection.tsx:20`:

```ts
const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};
```

**这违反 CLAUDE.md 第 3.4 节的规则 4:"不要写裸 bezier / spring 数值。"** 实际代码与规范有偏差,后续应统一从 `@aetherblog/ui` import。

---

## 8 · 签名时刻 5 个

`.claude/design-system/06-signature-moments.md`(未读全文,从代码反推):

| 签名 | 在 blog 哪里 | 文件:line |
|:---|:---|:---|
| **breath-soft 4.8s** 呼吸 | 首页 H1 / about Hero / agent Hero / BlogHeader 灵境光点 | `page.tsx:66`、`HeroSection.tsx:46`、`BlogHeader.tsx:459` |
| **aurora-text** 极光渐变文字 | about Hero "以太之上,思想成形" | `about/sections/HeroSection.tsx:47` |
| **ink-cursor** 流式光标 | SearchPanel AI 回答末尾 | `SearchPanel.tsx:526` |
| **ai-stream** 流式动画 | SearchPanel AI 回答容器 | `SearchPanel.tsx:521` |
| **aurora-divider** 横向极光分隔 | BlogHeader 底部 | `BlogHeader.tsx:570` |
| **view-transition** 卡片 → 详情 morph | ArticleCard → 文章详情 H1 | `ArticleCard.tsx:106`、`posts/[slug]/page.tsx:157` |

view-transition 严格说是第 6 个签名,由 Next.js 15 实验性 API 启用。

---

## 9 · 间距与圆角

`tokens.css` 定义:
```
--radius-sm  6px
--radius-md  10px
--radius-lg  14px
--radius-xl  22px
--radius-2xl 28px
```

**实际使用:**
- ArticleCard rounded-2xl(`ArticleCard.tsx:58`)
- SearchPanel rounded(由 surface-overlay 内部决定)
- 评论卡 rounded-xl
- 翻页按钮 rounded-lg

间距上,blog 大量用 Tailwind `gap-6 / gap-12 / mb-8 / pt-24` 等,token 系统 `--space-*` 没怎么用 —— 这是 Tailwind 默认 scale 与 Codex 8pt grid 高度重合的结果(都基于 4px),不强制迁移。

---

## 10 · 主题切换

**驱动方:** `@aetherblog/hooks` 的 `ThemeProvider` + `useTheme` 钩子(在 providers.tsx)。

**两种动画:**
- **clip-path 圆形扩散**(`toggleThemeWithAnimation`):点击位置为圆心,扩散出新主题。视觉惊艳。
- **fade**(`toggleThemeWithFade`):简单淡入淡出,移动端重页面用。

**移动端重页面降级:** `FloatingThemeToggle.tsx:15`

```ts
const MOBILE_HEAVY_PAGES = ['/', '/timeline', '/friends', '/posts'];
```

这些页面有大量 backdrop-filter / blur,clip-path 扩散叠加会让 GPU 满载,改 fade。**这是性能 vs 美感的妥协,反映在文件注释里**。

**强制暗色:** `SiteSettingsProvider.tsx:46` —— 站长打开 `enable_dark_mode` 时 `<html data-force-dark="true">` + 强制 localStorage `aetherblog-theme=dark`,ThemeProvider 在此基础上不允许切回亮色。

**FOUC 防护:** layout.tsx:98 inline `<style>` 与 `<script>` 的双件套,在 React hydrate 之前就上色,详见 `01-routing-and-layout.md` §3。

---

## 11 · 无障碍 (a11y)

- **focus-ring 统一:** `--focus-ring` token,`focus-visible:ring-2 focus-visible:ring-primary` 几乎所有按钮 / 链接都用。
- **跳过到主要内容:** `BlogHeader.tsx:276` `<a href="#main-content" className="sr-only focus:not-sr-only ...">`。
- **`prefers-reduced-motion`:** ClientLayout 锚点拦截、posts 翻页 scroll、FloatingThemeToggle 都判断了 `matchMedia('(prefers-reduced-motion: reduce)')`,但 framer-motion 的 spring 与 keyframes 没普遍接管。改进空间。
- **ARIA:** SearchPanel 用 `role="combobox" aria-controls aria-activedescendant` 等完整;TOC 用 `aria-expanded aria-controls`;评论区有 `role="alert"` 错误提示。

---

## 12 · 已知妥协 / 未对齐项

1. **legacy + Codex 两套 token 并存**:globals.css 的 `:root` legacy 与 tokens.css 的 Codex token 各自独立。任何主题切换都要保证两套一致。
2. **`tailwind.config.ts` mono 字体不统一**:`'JetBrains Mono'` 写死,与 Codex token `--font-mono`(Geist Mono)不一致。
3. **首页 H1 用 `font-display` class 但底层加载的是 Playfair**:视觉接近,但严格说与 Fraunces variable 不同 —— 缺少 SOFT/WONK/opsz 三轴变形。
4. **没用 `surface-luminous`**:Hero CTA 是自己一套渐变,签名稀有卡片在 blog 缺位。
5. **不少组件 inline 写 bezier/spring 数值**:违反"不要写裸数值"规则。
6. **Codex 字号阶梯类 `text-h2 / text-display` 在文章详情页有用,但 ArticleCard 仍用 `clamp()` 自己算字号**(`ArticleCard.tsx:102`):一致性差。
7. **`FontProvider` 与 layout.tsx SSR 字体逻辑双写**:layout 在 SSR 阶段已经设置好,但 FontProvider 在 client 又应用一次。注释明确不在 cleanup 移除字体样式来防止 iOS PWA 字体闪现 —— 这种"双写但后端胜"的耦合需要 small refactor。
8. **`data-interactive` 没普及**:只有 ArticleCard / PostNavigation 用,FeaturedPost / FriendCard / 评论卡 也是"卡片"语义但未享受 aurora hover stripe。
9. **`SiteSettingsProvider` 注入的是 legacy `--color-primary`**:站长改主色时,Codex `--aurora-1` 不变 —— 主题色与极光色是分离的两个概念。这是有意的(aurora 是设计 token,不可被站长改),但需要在文档里明示。

---

## 13 · 性能注意点

- **`backdrop-filter` 是 surface 的核心:** Leaf 16px / Raised 24px / Overlay 40px。每多一层 surface 即多一次合成层,移动端 GPU 满载。建议:首屏可见的 surface 数量控制在 5 个以内。
- **`color-mix(in oklch, ...)`:** 现代浏览器原生支持(Chrome 111+),Safari 16.4+。低端设备 fallback 到 sRGB。
- **`view-transition` 实验性:** Next 15.1 标记 experimental,Safari 26+ / Chrome 125+ 才有完整效果。低版本浏览器静默 fallback 到瞬时切换 —— 不会破坏。
- **`animation-timeline: scroll()`:** ReadingProgress 优先使用,Safari < 26 走 rAF fallback(`ReadingProgress.tsx:22`)。
- **CSS anchor positioning:** `marginalia--anchored` Chrome 125+,旧版 fallback 到硬编码绝对定位(`posts/[slug]/page.tsx:163`)。

总体上,blog 模块是 Codex 落地的"先行者",几乎所有 surface / token / signature 都有实际用例,但 motion 规范的"不要 inline 数值"还没贯彻。
