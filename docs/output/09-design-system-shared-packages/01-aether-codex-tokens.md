# 01 · Aether Codex Design Tokens

> 本文档解读 `packages/ui/src/styles/tokens.css`(单一真源)的全部 token 命名空间、light/dark 切换机制、OKLCH 派生与 sunset 计划。

---

## 范围

- `packages/ui/src/styles/tokens.css`(全文 392 行) —— token 实际定义
- `.claude/design-system/01-tokens.md` —— 设计规范(权威说明)
- `.claude/design-system/deprecations.json` —— 8 条 lint 规则,2026-07-17 sunset
- 桥接消费方:`apps/blog/app/globals.css:7`、`apps/admin/src/index.css:2`(都是 `@import '../../../packages/ui/src/styles/tokens.css'`)

> tokens.css **必须**在 `@tailwind base` 之前被导入,否则 Tailwind utility 找不到 `--font-sans` / `--ink-primary` 等变量,会回退到默认主题。

---

## 1. 命名空间总览

源:`tokens.css:9-17`、`.claude/design-system/01-tokens.md:8-21`

| 前缀 | 语义 | 例子 | 变量个数 |
|:---|:---|:---|---:|
| `--ink-*` | 墨色(暗主题下的象牙色文字层次) | `--ink-primary` | 4 |
| `--bg-*` | 背景层级 | `--bg-void` / `--bg-leaf` | 4 + legacy |
| `--aurora-*` | 光源色 | `--aurora-1..4` | 4 |
| `--signal-*` | 信号色 | `--signal-{info,success,warn,danger}` | 4 |
| `--fs-*` | 字号阶梯 | `--fs-reading` | 10 |
| `--lh-*` | 行高 | `--lh-relaxed` | 4 |
| `--ease-*` | 缓动曲线 | `--ease-out` | 3 |
| `--dur-*` | 时长 | `--dur-flow` | 4 |
| `--radius-*` | 圆角(Codex 补充 `--radius-bleed`) | `--radius-bleed` | 1+(legacy 4) |
| `--space-*` | 8px baseline 9 级节奏 | `--space-4` | 11 |
| `--focus-ring` | 聚焦环(统一) | — | 1 |
| `--font-*` | 字体角色(桥接到 next/font 实际加载的字体) | `--font-display` | 4 + 桥接 4 |
| `--aurora-field` | 全站唯一极光背景几何 | — | 1 |

向后兼容:**`--color-*` / `--text-*` / `--border-*` / `--bg-card` / `--shadow-*`** 全部保留(在 `apps/blog/app/globals.css` 与 `apps/admin/src/index.css` 内 `:root` 中并存)。新令牌与之**并存**,逐步迁移,sunset 见 §6。

---

## 2. 文字 · Ink

源:`tokens.css:22-26`(亮)/ `:131-135`(暗)、`01-tokens.md:26-49`

```css
/* 亮主题(默认 + :root.light) —— 深墨色 */
--ink-primary:   #1C1A14;   /* 正文主色,冷墨黑 */
--ink-secondary: #4A463E;   /* 次级文字 */
--ink-muted:     #7A7468;   /* metadata / 辅助 */
--ink-subtle:    #C9C3B5;   /* 禁用 / 占位 */

/* 暗主题(:root.dark) —— 真正的象牙色,**不是纯白** */
--ink-primary:   #F4EFE6;   /* 正文主色,暖象牙 */
--ink-secondary: #B8B3A8;   /* 次级文字,米灰 */
--ink-muted:     #6B6862;
--ink-subtle:    #3A3932;
```

**对比度保证**(规范侧):
- `ink-primary` on `bg-void`(暗):17.2:1 · WCAG AAA
- `ink-secondary` on `bg-void`(暗):7.1:1 · WCAG AAA
- `ink-muted` on `bg-leaf`(暗):4.9:1 · WCAG AA

**禁忌**(`00-manifesto.md:121, 128`):暗主题主文字**禁止用 `#FFFFFF`**;使用 `#FFFFFF` 即视为偏离。

---

## 3. 背景 · Obsidian

源:`tokens.css:29-32`(亮)/ `:138-141`(暗)、`01-tokens.md:52-69`

```css
/* 亮主题 —— 米白纸色 */
--bg-void:       #FAF9F6;   /* 页面底,Codex bg-void 暖 off-white */
--bg-substrate:  #F4F2EC;
--bg-leaf:       #FFFFFF;
--bg-raised:     #FFFFFF;

/* 暗主题 —— 四层深空 */
--bg-void:       #05060A;   /* 页面底,最深 */
--bg-substrate:  #0B0D14;
--bg-leaf:       #12141D;   /* 卡片层 1 */
--bg-raised:    #1A1D28;    /* 卡片层 2 / 弹层 */
```

**已知坑**(`packages/ui/src/styles/surfaces.css:24-33` 注释):暗主题低色度的 `--bg-leaf` (#12141D) 在 `color-mix(in oklch, var(--bg-leaf) 85%, transparent)` 时 hue 变成 "powerless",渲染会偏红棕("咖啡色")。surfaces.css 已绕开 —— **改走 `rgb(from var(--bg-leaf) r g b / 0.85)`** 直接 sRGB 加 alpha。

---

## 4. 光源 · Aurora

源:`tokens.css:34-38`(亮 hex 保底)/ `:143-147`(暗 hex 保底)/ `:182-196`(OKLCH 派生),`01-tokens.md:73-105`

```css
/* 亮主题保底(无 oklch from 支持的旧浏览器) */
--aurora-1: #6366F1;   /* Indigo  主光源 */
--aurora-2: #7C6FF1;
--aurora-3: #8B84F0;
--aurora-4: #A598EC;

/* 暗主题保底 */
--aurora-1: #818CF8;   /* 暗主题下更明亮 */
--aurora-2: #9189F6;
--aurora-3: #9E87F3;
--aurora-4: #B0A0EC;
```

### 4.1 OKLCH 派生(关键决策)

`tokens.css:182-196`:

```css
@supports (color: oklch(from red l c h)) {
  :root,
  :root.light {
    --aurora-1: oklch(from var(--color-primary) l c h);
    --aurora-2: oklch(from var(--color-primary) calc(l + 0.02) calc(c * 0.92) calc(h + 18));
    --aurora-3: oklch(from var(--color-primary) calc(l + 0.05) calc(c * 0.82) calc(h + 36));
    --aurora-4: oklch(from var(--color-primary) calc(l + 0.08) calc(c * 0.68) calc(h + 60));
  }
  :root.dark { /* lightness 整体抬高 0.08-0.12 */ }
}
```

**派生策略**(同色系邻近,而非 180° 补色):
- aurora-1 = primary 本色(锚点)
- aurora-2 = hue +18° 同色系
- aurora-3 = hue +36° 同色系再远
- aurora-4 = hue +60° 邻近色

chroma 随 hue 推远逐步降低,避免高饱和度撞眼。**用户在 admin 后台改 `--color-primary` → 整个 aurora 体系跟着走** —— 这是 Codex"一个光源"原则的核心实现。

### 4.2 光源几何

`tokens.css:120-126`(亮)/ `:156-162`(暗):

```css
--aurora-field:
  radial-gradient(ellipse 80% 60% at 15% 0%,
    color-mix(in oklch, var(--aurora-1) 18%, transparent) 0%,
    transparent 50%),
  radial-gradient(ellipse 50% 40% at 85% 10%,
    color-mix(in oklch, var(--aurora-4) 8%, transparent) 0%,
    transparent 50%);
```

**使用规则**(`01-tokens.md:95-99`):
- 博客首页 `<body>::before` 铺一次(实际由 `.aurora-layer` 类承载,见 `tokens.css:228-234`)
- admin AdminLayout 主区铺一次
- **其他任何位置禁止使用 radial-gradient 做背景**

---

## 5. 信号色 · Signal

源:`tokens.css:41-44`(亮)/ `:150-153`(暗),`01-tokens.md:109-130`

**苹果级低饱和**:chroma 统一压至 0.12-0.14 附近,避免在 UI 中显得"廉价霓虹"。

```css
/* 亮主题 */
--signal-info:    oklch(0.58 0.12 235);   /* Blue */
--signal-success: oklch(0.55 0.12 150);   /* Emerald */
--signal-warn:    oklch(0.62 0.13 75);    /* Amber */
--signal-danger:  oklch(0.55 0.14 25);    /* Red */

/* 暗主题(亮度抬高,chroma 仍压制) */
--signal-info:    oklch(0.72 0.12 235);
--signal-success: oklch(0.72 0.12 150);
--signal-warn:    oklch(0.78 0.13 75);
--signal-danger:  oklch(0.70 0.14 25);
```

**禁忌**(`01-tokens.md:120-122`):
- ❌ `border-amber-500/20` 内联(应改为 `border-[var(--signal-warn)]/20`)
- ❌ 使用其他非信号色(如 Tailwind Orange)做警告

**搭配** —— 警告块标准用法:
```css
background: color-mix(in oklch, var(--signal-warn) 10%, var(--bg-leaf));
border:     1px solid color-mix(in oklch, var(--signal-warn) 30%, transparent);
color:      var(--signal-warn);
```

---

## 6. 字号阶梯 · Type Scale

源:`tokens.css:47-56`,`01-tokens.md:135-168`

9 级音阶,基于 16px 基线,大致 1.25(Perfect Fourth)比例。**不允许越级**。

| Token | rem | px | 用途 |
|:---|---:|---:|:---|
| `--fs-micro` | 0.6875 | 11 | tabular 数字 / 时间戳 |
| `--fs-caption` | 0.8125 | 13 | caption / marginalia |
| `--fs-body` | 1 | 16 | UI 默认 / 表单 |
| `--fs-reading` | 1.125 | 18 | 文章正文(桌面) |
| `--fs-lede` | 1.25 | 20 | 导语 / 摘要 |
| `--fs-h4` | 1.5 | 24 | h4 |
| `--fs-h3` | 1.875 | 30 | h3 |
| `--fs-h2` | 2.5 | 40 | h2 |
| `--fs-h1` | 3.5 | 56 | h1 |
| `--fs-display` | clamp(4, 8vw, 8.5) | 64-136 | Hero 大标题,流体 |

`packages/ui/src/styles/typography.css:17-34` 封装语义类 `.text-micro / .text-caption / .text-body / .text-reading / .text-lede / .text-h4 / .text-h3 / .text-h2 / .text-h1 / .text-display`,**JSX 永远用语义类,不写 `text-5xl`**。

---

## 7. 行高 · Line Height

源:`tokens.css:59-62`,`01-tokens.md:174-179`

```css
--lh-tight:   1.1;   /* display */
--lh-snug:    1.25;  /* headings */
--lh-normal:  1.5;   /* body UI */
--lh-relaxed: 1.75;  /* 长文阅读 / 中文段落默认 */
```

中文段落默认 `--lh-relaxed`(1.75)。

---

## 8. 动效 · Motion Primitives

源:`tokens.css:65-71`,详见 [03-motion-system.md](./03-motion-system.md)。

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);   /* 主曲线,Expo Out */
--ease-in:     cubic-bezier(0.7, 0, 0.84, 0);
--ease-in-out: cubic-bezier(0.87, 0, 0.13, 1);

--dur-instant: 120ms;   /* 按钮按下 / 状态切换 */
--dur-quick:   260ms;   /* hover / dropdown */
--dur-flow:    520ms;   /* Modal / 页面过渡 */
--dur-ambient: 1800ms;  /* 呼吸 / 极光漂移 */
```

CSS 端 → Framer Motion 端有 1:1 镜像(`packages/ui/src/motion.ts:18-35`)。

---

## 9. 间距 · Spatial Rhythm(Round 5 新增)

源:`tokens.css:88-98`,`01-tokens.md` 未列(在 history.md / 07-migration.md 中追加)

8px baseline 的 9 级节奏尺度 —— `--space-0..--space-10`:

```css
--space-0:  0;
--space-1:  0.25rem;  /*  4px — hairline,图标微调 */
--space-2:  0.5rem;   /*  8px — 基准,chip / 徽章 inline */
--space-3:  0.75rem;  /* 12px — 按钮内缩 */
--space-4:  1rem;     /* 16px — 卡片内默认 */
--space-5:  1.5rem;   /* 24px — 卡片章节间 */
--space-6:  2rem;     /* 32px — 卡片外边距 */
--space-7:  3rem;     /* 48px — 小 section 间 */
--space-8:  4rem;     /* 64px — section 默认 */
--space-9:  6rem;     /* 96px — 大 section 间 */
--space-10: 8rem;     /* 128px — Hero / 路由切分 */
```

使用约定:0-3 inline、4-6 卡片、7-10 section 断点。新组件优先引用 `--space-*`,不再随手写 `p-3、mt-[17px]、gap-5` 这种"软随机"值。`deprecations.json` 中的 `arbitrary-spacing`(info)规则正是为此而设。

---

## 10. 圆角 · Radius

源:`tokens.css:74`,`01-tokens.md:204-215`

Codex 在保留 legacy 4 级 `--radius-sm/md/lg/xl` 的同时,新增了**一个语义级别**:

```css
--radius-bleed: 2.875rem;   /* 46px — 首页页面折角(Hero rounded-t-[46px] 的归宿) */
```

**禁止** 内联任意值 `rounded-[37px]` / `rounded-[46px]`。

---

## 11. 聚焦环 · Focus Ring

源:`tokens.css:101-102`(亮)/ `:165`(暗),`01-tokens.md:219-233`

```css
--focus-ring: 0 0 0 2px var(--bg-void), 0 0 0 4px var(--aurora-1);
```

全局应用(`tokens.css:213-218`):
```css
*:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--radius-sm, 0.5rem);
  transition: box-shadow var(--dur-instant) var(--ease-out);
}
```

所有可聚焦元素共用同一个聚焦环 —— 暗黑底用 `--bg-void` 暗外环,亮主题下顺序不变(色值由 `:root.light` 自动翻转)。

---

## 12. 字体 · Font Roles + 桥接层

源:`tokens.css:107-117`(角色)/ `:354-359`(桥接),详见 [02-surfaces-and-typography.md](./02-surfaces-and-typography.md) §3 与 [05-package-hooks.md](./05-package-hooks.md) §6。

```css
/* 字体角色(规范命名) */
--font-display:   var(--font-fraunces),         'PingFang SC', 'HarmonyOS Sans SC', ..., system-ui, sans-serif;
--font-editorial: var(--font-instrument-serif), 'LXGW WenKai',  'Source Han Serif SC', ..., Georgia, serif;
--font-sans:      var(--font-geist),            'PingFang SC', ..., -apple-system, sans-serif;
--font-mono:      var(--font-geist-mono),       'JetBrains Mono', ui-monospace, monospace;

/* 桥接层(必须存在,否则 var(--font-fraunces) unset → display 字体回退到系统) */
:root {
  --font-fraunces:         var(--font-playfair);
  --font-instrument-serif: var(--font-noto-serif-sc);
  --font-geist:            var(--font-inter);
  --font-geist-mono:       ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace;
}
```

**桥接层意义**:`apps/blog/app/layout.tsx` 实际通过 `next/font/google` 加载 Inter / Playfair Display / Noto Serif SC,会注入 `--font-inter` / `--font-playfair` / `--font-noto-serif-sc` 三个变量。Codex 的 `--font-display` 等角色变量通过桥接层指向这三个 next/font 变量,**未来切换到真正 Fraunces / Instrument Serif / Geist 只改 4 行**。

---

## 13. 全局基础样式

源:`tokens.css:201-340`

### 13.1 中文优化(`tokens.css:202-207`)
```css
html {
  word-break: normal;
  line-break: strict;
  text-wrap: pretty;                /* 现代浏览器避免孤字 */
  font-feature-settings: "palt" 1;  /* 中文标点压缩 */
}
```

### 13.2 数字等宽(`tokens.css:221-225`)
```css
.tnum,
[data-tnum] {
  font-feature-settings: "tnum" 1, "cv11" 1;
  font-variant-numeric: tabular-nums;
}
```
admin 表格、dashboard 统计卡、blog 阅读时长**强制启用**。

### 13.3 全局选区与光标(`tokens.css:366-391`)

```css
::selection,
::-moz-selection {
  background: color-mix(in oklch, var(--aurora-1) 32%, transparent);
  color: var(--ink-primary);
  text-shadow: none;
}
:root.light ::selection { /* 亮主题 18% 更淡 */ }

input, textarea, [contenteditable], [contenteditable="true"] {
  caret-color: var(--aurora-1);
}
```

每次输入都是品牌瞬间。blog + admin 双端共享(都 `@import tokens.css`)。

### 13.4 极光层 + 关键帧(`tokens.css:228-294`)

定义了 `.aurora-layer`、`@keyframes aurora-drift / breath / breath-soft / ink-bleed / ink-blink / shimmer-sweep`,与 `.ink-cursor` 类一起注册为可全局复用的签名动画。

### 13.5 减动效模式(`tokens.css:309-320`)
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .ink-cursor { animation: none; opacity: 0.6; }
  .aurora-layer { animation: none !important; }
}
```

### 13.6 触控目标(`tokens.css:323-331`)
```css
@media (hover: none) and (pointer: coarse) {
  button, [role="button"], a.btn, .touch-target {
    min-height: 44px;
    min-width: 44px;
  }
}
```

### 13.7 高对比度(`tokens.css:334-340`)
```css
@media (prefers-contrast: more) {
  :root, :root.dark {
    --border-default: rgb(from var(--ink-primary) r g b / 0.40);
    --border-subtle: rgb(from var(--ink-primary) r g b / 0.28);
  }
}
```

---

## 14. light/dark 切换机制

### 14.1 基本原理

```
HTML <html> 类                效果
────────────────────         ─────────────────────────
<html.light> 或 <html>        :root, :root.light 块生效 (亮主题)
<html.dark>                   :root.dark 块生效 (暗主题,覆盖 :root)
```

**Codex 不再写 Tailwind `dark:` 变体**(硬规则 5):token 通过 `:root.light / :root.dark` 切换会自动翻转。这意味着:`text-[var(--ink-primary)]` 在亮主题下是 `#1C1A14`,在暗主题下是 `#F4EFE6`,**写法不变**。

### 14.2 类切换的执行方

`packages/hooks/src/useTheme.tsx:46-62` 中的 `applyTheme(resolvedTheme)`:
```ts
if (resolvedTheme === 'dark') {
  root.classList.add('dark');
  root.classList.remove('light');
} else {
  root.classList.add('light');
  root.classList.remove('dark');
}
root.style.colorScheme = resolvedTheme;
```

### 14.3 FOUC 防护

首帧白闪由 `packages/hooks/src/themeConstants.ts` 的 `themeFoucGuardStyle` + `themeInitScript` 联合处理,详见 [05-package-hooks.md](./05-package-hooks.md) §5。

### 14.4 跨标签页同步

`useTheme.tsx:305-320` 监听 `storage` 事件 —— Blog 修改主题后,Admin 标签页自动同步。两边都用 `localStorage.setItem('aetherblog-theme', ...)`。

---

## 15. Legacy token 与 Sunset 计划

### 15.1 仍在的 legacy token(并存阶段)

源:`apps/blog/app/globals.css` 与 `apps/admin/src/index.css` 仍维护一份 legacy 变量 —— 例如 `apps/blog/app/globals.css:53-101` 的 `:root, :root.light` 块定义了:

```css
--color-primary: #18181b;
--color-primary-hover / --color-primary-light / --color-primary-lighter / --color-accent
--bg-primary / --bg-secondary / --bg-tertiary / --bg-quaternary / --bg-card / --bg-card-hover / --bg-overlay / --bg-code / --bg-code-block
--text-primary / --text-secondary / --text-tertiary / --text-muted / --text-inverse
--border-default / --border-hover / --border-subtle
--shadow-xs/sm/md/lg/xl + --shadow-primary / --shadow-primary-lg
--gradient-primary / --gradient-accent / --gradient-subtle
--decoration-bar-height / --decoration-gradient
--color-success / --color-warning / --color-error / --color-info
--markdown-* (代码 / 行内 / 边框)
```

**这些 legacy token 不在 packages/ui/src/styles/tokens.css 内**,而是**直接写在两个 app 的入口 css 里**;Codex token(`--ink-* / --aurora-* / --signal-* / ...`)在 `packages/ui/src/styles/tokens.css` 内通过 `@import` 注入。两层并存,互不污染。

### 15.2 deprecations.json sunset 名录

源:`.claude/design-system/deprecations.json` —— 8 条规则,sunset date `2026-07-17`。

| Rule ID | 严重度 | 模式 | 替代方案 |
|:---|:---|:---|:---|
| `legacy-glass-classes` | error | `className=".*\b(glass\|glass-high\|glass-premium)\b"` | `surface-leaf / raised / overlay / luminous` |
| `naked-white-glass` | warning | `bg-white/(5\|10\|20)` / `border-white/(5\|10\|20)` | `surface-*` 组合或 `color-mix(in oklch, var(--ink-primary) N%, transparent)` |
| `naked-backdrop-blur` | warning | `backdrop-blur-(sm\|md\|lg\|xl\|2xl\|3xl)` 但未配 `surface-*` | `surface-*` 内置 |
| `legacy-text-primary-inline` | info | `text-[var(--color-primary)]` | `text-[var(--aurora-1)]` |
| `legacy-ink-aliases` | info | `var(--text-(primary\|secondary\|tertiary\|muted))` | `var(--ink-*)` |
| `hardcoded-primary-gradient` | warning | `(from\|to\|via)-(indigo\|purple)-N` | `color-mix(in oklch, var(--aurora-1..4) N%, transparent)` |
| `naked-text-sizes` | info | `\btext-(5xl\|6xl\|7xl)\b` | `text-h1` / `text-display` |
| `arbitrary-spacing` | info | `\b(p\|m\|...)-\[Npx\\|rem\\|em\]` | `--space-*` 9 级 |

**sunset 之后的策略**(`deprecations.json:6`):2026-07-17 之后,`legacy token` 不再由 tokens.css 定义;代码中残留引用会渲染为 unset。在此之前,legacy 与 codex **并存**,但 `pnpm design-system:check` 会将所有 legacy 使用列为 warning,CI 不强制失败(红线 = `0 error`)。

### 15.3 `pnpm design-system:check / fix / report`

源:`scripts/codemod-tokens.mjs`(186 行,纯 Node 20 + `fs.promises.glob`,无第三方依赖)。

- `check` —— 默认,扫描列违例,error 级别阻断(退出码 1)
- `fix` —— 按规则的 `replace` map 做字面量替换,写回磁盘
- `report` —— 输出 Markdown 报告,适合写入 PR description

`package.json:19-21` 已暴露三个 npm script。

**当前基线(2026-04-17 测得,距 sunset 91 天)**:
- 0 error
- 449 warning
- 2173 info

红线:**`0 error` 必须保持**;warning / info 实时数量跑 `pnpm design-system:report` 查看。

---

## 16. 关键代码引用

| 文件 | 行号 | 内容 |
|:---|---:|:---|
| `packages/ui/src/styles/tokens.css` | 22-127 | 亮主题 token 全部定义 |
| `packages/ui/src/styles/tokens.css` | 130-166 | 暗主题 token 全部定义 |
| `packages/ui/src/styles/tokens.css` | 182-196 | OKLCH `oklch(from var(--color-primary))` 派生 |
| `packages/ui/src/styles/tokens.css` | 354-359 | 字体桥接层 (Fraunces → Playfair etc.) |
| `packages/ui/src/styles/tokens.css` | 366-391 | `::selection` + `caret-color` |
| `apps/blog/app/globals.css` | 7-9 | Codex tokens / surfaces / typography 注入 |
| `apps/admin/src/index.css` | 2-4 | 同上(admin 也注入) |
| `.claude/design-system/01-tokens.md` | 1-258 | 设计规范权威 |
| `.claude/design-system/deprecations.json` | 全文 | 8 条 lint 规则 |
| `scripts/codemod-tokens.mjs` | 1-186 | check / fix / report 实现 |
| `package.json` | 19-21 | npm script 暴露 |

---

## 17. 使用方与扩展点

### 17.1 谁消费 tokens.css

- `apps/blog/app/globals.css:7` —— blog 端入口
- `apps/admin/src/index.css:2` —— admin 端入口
- `packages/editor/src/MarkdownEditor.tsx:88-99` —— CodeMirror 高亮也用 `var(--ink-primary)` 等(`tokens.css` 提供)
- `packages/editor/src/bearDecorations.ts:26-45` —— Alert block 的 `var(--signal-info)` / `var(--ink-muted)`

### 17.2 加新 token 流程

1. 在 `packages/ui/src/styles/tokens.css` 同时给 `:root,:root.light` 与 `:root.dark` 加值
2. 同步 `.claude/design-system/01-tokens.md` 命名空间表
3. 若是颜色,务必带对比度报告(对 `bg-void` / `bg-leaf`)
4. 若是动效曲线,同步 `packages/ui/src/motion.ts` 的 `ease` 对象
5. 在 `.claude/design-system/00-manifesto.md` 的"五个一"决定是否升级

### 17.3 `--color-primary` 升级后的连锁反应

后台改 `--color-primary` → tokens.css 的 OKLCH `@supports` 块自动派生 `--aurora-1..4` → 整站极光体系跟着走。`packages/utils/src/color.ts` 的 `generateColorVars` 还会同步 `--color-primary-hover/light/lighter/--color-accent/--shadow-primary*/--gradient-primary/--focus-ring`,由 `apps/blog/app/components/SiteSettingsProvider.tsx:5` 消费并通过 `<style>` 注入。

---

## 18. 已知限制

1. **OKLCH 派生只在支持 `oklch(from … l c h)` 的浏览器生效** —— Chrome 119+ / Safari 16.4+ / Firefox 128+。旧浏览器吃 `:34-38` / `:144-147` 的 hex 保底值,不会跟随 `--color-primary` 变化。
2. **桥接层是单向的** —— `--font-fraunces` → `--font-playfair`,反过来不行。如果加载层没注入 `--font-playfair`,`--font-display` 的栈会回退到 `'PingFang SC'` 等中文字体。
3. **anchor-positioning 已在 typography.css:128-141 撤回** —— marginalia 的精确锚定在 Chrome 125+ / Safari 26+ 的某些视口下解析为 0 触发 fallback,反把 marginalia 推到文章内部覆盖 h1。
4. **tnum 类不在所有数字使用点** —— admin DataTable / dashboard StatsCard 已加,blog 的阅读时长/计数显示需在组件层主动添加 `class="tnum"` 或 `data-tnum`。
5. **`prefers-contrast: more` 只增强了 `--border-*`** —— 文字色没有对应增强(如 `ink-primary` 不会变更深)。屏幕阅读器场景下需自查 AAA 对比度。
6. **`--font-mono` 桥接层降级到 `ui-monospace`** —— 若用户系统没装 Geist Mono,实际显示会是 SFMono / Menlo / Courier New。规范 PR 中要求加载真正 Geist Mono 是未来的事。

---

## 19. 引用的子文档与原始规范

- `.claude/design-system/00-manifesto.md` —— 哲学 / 五个一 / 禁忌十条
- `.claude/design-system/01-tokens.md` —— token 权威说明
- `.claude/design-system/deprecations.json` —— 8 条 lint 规则
- `.claude/design-system/history.md` —— Round 3/4/5 升级日志
- `.claude/design-system/legacy-cognitive-elegance.md` —— v1 主张存档
- `.claude/design-system/07-migration.md` —— legacy → codex 迁移表
- `CLAUDE.md` §3.4 —— 六硬规则速查
- `CLAUDE.md` §3.7 —— Legacy token 迁移立场
