# 02 · Surfaces 与 Typography

> 本文档拆解 `packages/ui/src/styles/{surfaces,typography}.css` 两个工具样式表 ——
> surface 四层玻璃体系(全站统一卡片/弹层视觉)与 typography 工具类(语义字号、阅读列、首字下沉、AI 流式文字)。

---

## 范围

- `packages/ui/src/styles/surfaces.css` —— surface-leaf / raised / overlay / luminous + `[data-interactive]` aurora hover stripe + `.aurora-sweep` + `.aurora-divider`
- `packages/ui/src/styles/typography.css` —— `.text-*` / `.font-*` / `.reading-column` / `.marginalia` / `.drop-cap` / `.section-mark` / `.ai-stream` / `.aurora-text` / `.eyebrow` / `.reading-progress` / `.cmd-chip`
- 设计规范源:`.claude/design-system/02-surfaces.md`、`03-typography.md`
- 注入点:`apps/blog/app/globals.css:8-9`、`apps/admin/src/index.css:3-4`(`@import` 三件套之 2 / 3)

---

## 第一部分 · Surfaces · 四层玻璃

### 1. 四层 surface 决策树

源:`.claude/design-system/02-surfaces.md:11-37`

| Layer | CSS class | 用途 | Blur | Border | Shadow |
|:---|:---|:---|---:|:---:|:---:|
| 1 · Leaf | `.surface-leaf` | 文档流卡片、列表项(95% 场景) | 16px | 弱 | 无 |
| 2 · Raised | `.surface-raised` | sidebar / sticky header / floating panel | 24px | 中 | 微 |
| 3 · Overlay | `.surface-overlay` | Modal / 命令面板 / Dropdown | 40px | 强 | 重 + aurora 描边 |
| 4 · Luminous | `.surface-luminous` | 签名稀有卡片(一页 ≤1 张) | 40px | 极光 | 极光辉光 |

**决策树**:

```
我要做一个容器/卡片
│
├── 它是页面 Modal / 全屏弹层?
│   └── .surface-overlay
│
├── 它是 Hero 区或"这一页主要 CTA"?
│   └── .surface-luminous (稀有,一页不超过一个)
│
├── 它会 position: sticky / fixed 浮在内容之上?
│   └── .surface-raised
│
└── 否则 —— 95% 的情况
    └── .surface-leaf
```

### 2. 关键实现选择 —— 为什么是 sRGB 而不是 oklch mix

源:`packages/ui/src/styles/surfaces.css:14-33`(注释)

规范侧 `02-surfaces.md` 描述的是 `color-mix(in oklch, var(--bg-leaf) 85%, transparent)`,**实际实现却走 `rgb(from var(--bg-leaf) r g b / 0.85)`**。原因:

- `color-mix(in oklch, X, transparent)` 把 transparent 视为 `oklch(0 0 0 / 0)`,零色度让 hue 在 mix 时变成 "powerless / none";
- 当源色色度极低(如暗主题 `--bg-leaf` `#12141D`,R≈G、B 略高),结果 `oklch(L C none / α)` 浏览器把 none 当 hue=0 渲染,产生明显的红棕色偏("咖啡色")。
- 改走 sRGB 通道只加 alpha,不再经过 OKLCH 插值,色相完全忠于原始 hex。

surface-leaf / raised / overlay 三层全部用此方法。**新加 surface 务必沿用此模式**。

### 3. surface-leaf 实现

源:`surfaces.css:34-51`

```css
.surface-leaf {
  background: rgb(from var(--bg-leaf) r g b / 0.85);
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  backdrop-filter: blur(16px) saturate(120%);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-lg, 1rem);
  transition: border-color var(--dur-quick) var(--ease-out),
              box-shadow var(--dur-quick) var(--ease-out);
}

/* 亮模式 leaf —— 紧贴文档,几乎平铺,只有极轻 1px 落地阴影 */
:root.light .surface-leaf {
  background: #FFFFFF;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border: 1px solid rgb(from var(--ink-primary) r g b / 0.07);
  box-shadow: 0 1px 2px rgba(28, 26, 20, 0.04);
}
```

**注释说明**(`surfaces.css:14-22`):
- 暗黑模式 surface 1-3 层的 border / inset-highlight 统一用**中性白 alpha** `rgba(255,255,255,N)`,不再走 `color-mix(ink-primary)`。
- 因为暗黑下 `--ink-primary` 是 #F4EFE6 暖象牙,低饱和铺在大面积暗卡边缘会被眼睛读成"暖棕尾迹",与 `--bg-void` 冷黑形成色相断层。
- 亮模式保持用 `--ink-primary`(#1C1A14 冷墨黑),在白底上是必要视觉锚。

### 4. surface-raised 实现

源:`surfaces.css:53-78`

```css
.surface-raised {
  background: rgb(from var(--bg-raised) r g b / 0.80);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: var(--radius-lg, 1rem);
  box-shadow:
    0 1px 0 inset rgba(255, 255, 255, 0.08),
    0 8px 24px -8px rgba(0, 0, 0, 0.4);
}

/* 亮模式 raised —— 明显"浮"在文档上,中距落地 12px 投影 + 上沿高光 */
:root.light .surface-raised {
  background: #FFFFFF;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border: 1px solid rgb(from var(--ink-primary) r g b / 0.05);
  box-shadow:
    0 1px 0 inset rgba(255, 255, 255, 0.95),
    0 2px 4px rgba(28, 26, 20, 0.04),
    0 12px 28px -10px rgba(28, 26, 20, 0.16);
}
```

### 5. surface-overlay 实现

源:`surfaces.css:80-107`

```css
.surface-overlay {
  background: rgb(from var(--bg-raised) r g b / 0.70);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--radius-xl, 1.5rem);
  box-shadow:
    0 1px 0 inset rgba(255, 255, 255, 0.12),
    0 20px 60px -20px color-mix(in oklch, var(--aurora-1) 20%, black),
    0 0 0 1px color-mix(in oklch, var(--aurora-1) 8%, transparent);
}

/* 亮模式 overlay —— 戏剧化 32px 落地投影 + aurora 描边环 */
:root.light .surface-overlay {
  background: #FFFFFF;
  /* ... 4 层投影叠加,带 aurora-1 18% 描边环 ... */
}
```

aurora 描边是 overlay 的**身份标识** —— 与 leaf / raised 的中性白边一眼可辨。

### 6. surface-luminous 实现

源:`surfaces.css:109-141`

```css
.surface-luminous {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(135deg,
      color-mix(in oklch, var(--aurora-1) 12%, transparent) 0%,
      rgb(from var(--bg-raised) r g b / 0.9) 50%),
    var(--bg-raised);
  -webkit-backdrop-filter: blur(40px) saturate(160%);
  backdrop-filter: blur(40px) saturate(160%);
  border: 1px solid color-mix(in oklch, var(--aurora-1) 30%, transparent);
  border-radius: var(--radius-xl, 1.5rem);
  box-shadow:
    0 1px 0 inset color-mix(in oklch, var(--aurora-1) 20%, transparent),
    0 20px 60px -10px color-mix(in oklch, var(--aurora-1) 30%, black);
}
.surface-luminous::before {
  /* 左上极光辐射光 */
  background: radial-gradient(circle at top left,
    color-mix(in oklch, var(--aurora-1) 18%, transparent) 0%,
    transparent 50%);
}
```

**纪律**(`02-surfaces.md:235-238`):
- ❌ 给 `.surface-luminous` 当普通容器用(它是稀有元素,**一页 ≤ 1 张**)
- ❌ 创造第五种 surface
- ❌ 单一视图中使用三种及以上 surface 层级

### 7. `[data-interactive]` Aurora hover stripe

源:`surfaces.css:143-191`

```html
<a class="surface-leaf" data-interactive>...</a>
<button class="surface-raised" data-interactive>...</button>
```

实现思路(经过 Round 4 重写):

```css
[data-interactive].surface-leaf::after,
[data-interactive].surface-raised::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  /* 顶/底淡出 → 中段 aurora 实色 → 再淡出,纵向极光 */
  background: linear-gradient(to bottom,
    transparent 0%,
    var(--aurora-1) 18%,
    var(--aurora-1) 82%,
    transparent 100%);
  /* 切到最左 2px,沿圆角天然包裹 */
  clip-path: inset(0 calc(100% - 2px) 0 0);
  opacity: 0;
  transition: opacity var(--dur-quick) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  [data-interactive].surface-leaf:hover,
  [data-interactive].surface-raised:hover {
    border-color: color-mix(in oklch, var(--aurora-1) 30%, transparent);
  }
  [data-interactive].surface-leaf:hover::after,
  [data-interactive].surface-raised:hover::after {
    opacity: 1;
  }
}
```

**关键设计**(`surfaces.css:148-154` 注释):
- `inset: 0` + `border-radius: inherit` + `clip-path: inset(0 calc(100% - 2px) 0 0)` —— 让 2px 光带左上/左下天然沿着卡片圆角弧线收束
- 不是 width:2px + border-*-left-radius:inherit(后者会被 radius 钳到 1px,光带变成扁柱形竖在卡片圆弧之外)
- `(hover: hover) and (pointer: fine)` 限定 —— 移动端触屏的 sticky :hover 会让光带残留(iOS Safari 的视觉错位元凶)

### 8. `.aurora-sweep` 与 `.aurora-divider`

源:`surfaces.css:193-230`

```css
/* hover 时从左到右扫过一道极光 */
.aurora-sweep::before {
  position: absolute; inset: 0;
  background: linear-gradient(110deg,
    transparent 40%,
    color-mix(in oklch, var(--aurora-1) 20%, transparent) 50%,
    transparent 60%);
  transform: translateX(-100%);
  transition: transform var(--dur-flow) var(--ease-out);
}
.aurora-sweep:hover::before {
  transform: translateX(100%);
}

/* 一条浅浅的极光渐变分隔线 */
.aurora-divider {
  height: 1px;
  background: linear-gradient(90deg,
    transparent 0%,
    color-mix(in oklch, var(--aurora-1) 40%, transparent) 50%,
    transparent 100%);
}
```

### 9. React 组件封装(规划)

`05-components.md:150-173` 描述的新 Card API:
```tsx
<Card variant="leaf">     // 默认
<Card variant="raised">
<Card variant="overlay">
<Card variant="luminous">
<Card variant="leaf" interactive>  // hover 极光带
```

但 **`packages/ui/src/Card.tsx:9-22` 尚未实施此 API**(详见 [04-package-ui.md](./04-package-ui.md) §3 Card 已知问题)。

### 10. surfaces 已知限制

1. **不允许嵌套同层 surface** —— `.surface-leaf` 嵌 `.surface-leaf` 视觉糊成一片
2. **Overlay 内可放 leaf** —— 命令面板是 overlay,结果行可以是无 surface 的列表项
3. **luminous + overlay 共存** —— 不被禁止但**强烈不推荐**(全场只该一处主光源)
4. **亮主题下 leaf 没有 backdrop-filter** —— 由 `:root.light .surface-leaf` 显式覆盖为 `none`,因为白底上 blur 不可见反而带性能成本

---

## 第二部分 · Typography · 字体阶梯与排印工具

### 11. 字体角色

源:`.claude/design-system/03-typography.md:9-25`,实际实现 `tokens.css:107-117` + `:354-359`

| 角色 | 字体 | CSS 变量 | 用途 |
|:---|:---|:---|:---|
| Display | **Fraunces** Variable | `--font-display` | Hero / 大标题 / 品牌名 / 数字强调 |
| Editorial | **Instrument Serif** | `--font-editorial` | 文章正文(西文) / 引言 |
| Sans | **Geist** | `--font-sans` | UI 文字 / 导航 / 表单 / 按钮 |
| Mono | **Geist Mono** | `--font-mono` | 代码 / tabular 数字 / marginalia |

中文配套(自动 fallback):

| 中文角色 | 字体 | 用途 |
|:---|:---|:---|
| Display CN | Source Han Serif SC / Noto Serif SC | 中文大标题 |
| Reading CN | LXGW WenKai(霞鹜文楷) | 中文正文长段落 |
| UI CN | PingFang SC / HarmonyOS Sans SC | 中文 UI(跟随系统) |

**当前真实加载**(`apps/blog/app/layout.tsx`):Inter + Playfair Display + Noto Serif SC + 系统 mono。这意味着规范侧的 Fraunces / Instrument Serif / Geist / Geist Mono **目前只是别名**,通过 `tokens.css:354-359` 的桥接层指向。

### 12. 语义字号类

源:`packages/ui/src/styles/typography.css:17-34`

```css
.text-micro   { font-size: var(--fs-micro);   line-height: var(--lh-normal); }
.text-caption { font-size: var(--fs-caption); line-height: var(--lh-normal); }
.text-body    { font-size: var(--fs-body);    line-height: var(--lh-normal); }
.text-reading { font-size: var(--fs-reading); line-height: var(--lh-relaxed); }
.text-lede    { font-size: var(--fs-lede);    line-height: var(--lh-relaxed); }
.text-h4      { font-size: var(--fs-h4);      line-height: var(--lh-snug); }
.text-h3      { font-size: var(--fs-h3);      line-height: var(--lh-snug); }
.text-h2      { font-size: var(--fs-h2);      line-height: var(--lh-snug); letter-spacing: -0.01em; text-wrap: balance; }
.text-h1      { font-size: var(--fs-h1);      line-height: var(--lh-tight); letter-spacing: -0.02em; text-wrap: balance; }
.text-display { font-size: var(--fs-display); line-height: var(--lh-tight); letter-spacing: -0.03em; text-wrap: balance; }
```

**中文 letter-spacing 反向**(`typography.css:29-34`):
```css
:where(.text-h2):lang(zh-Hans) { letter-spacing: 0.02em; }
:where(.text-h1):lang(zh-Hans) { letter-spacing: 0.03em; }
:where(.text-display):lang(zh-Hans) { letter-spacing: 0.04em; }
```
拉丁排印规则要紧字距,中文反向放开 —— 这是中文质感的关键。

### 13. font-* 角色类

源:`typography.css:36-40`
```css
.font-display   { font-family: var(--font-display); }
.font-editorial { font-family: var(--font-editorial); }
.font-sans      { font-family: var(--font-sans); }
.font-mono      { font-family: var(--font-mono); }
```

**中英文融合策略**(`typography.css:42-65`):

```css
/* Display 含中文需要更足字重显"白色利落感" */
:where(.font-display):lang(zh-Hans) {
  font-weight: 700;
  letter-spacing: -0.015em;
}

/* Editorial 中文不用假斜体(中文真斜体看起来像故障) */
:where(.font-editorial):lang(zh-Hans) {
  font-style: normal;
  font-synthesis: none;   /* 防止浏览器对中文做假斜体 */
  letter-spacing: 0.02em;
}
```

**禁忌**(`03-typography.md:351-358`):
1. 使用 Inter 作为 Hero 标题字体
2. 使用 Playfair Display 作为正文(它是装饰字体,不适合长文)
3. 同一 `<p>` 切换 3 个字族以上
4. 对中文加 `font-style: italic`(中文字体通常没真斜体)

### 14. 阅读列 `.reading-column`

源:`typography.css:75-81`
```css
.reading-column {
  max-width: 68ch;
  margin-inline: auto;
}
```

**68ch ≈ 650px** 是黄金阅读宽度,文章详情页 / 长文 modal 全部用这个。**禁止 > 80ch**(`06-signature-moments.md:192`)。

### 15. 边注 `.marginalia`

源:`typography.css:97-126`

```css
.marginalia {
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  line-height: var(--lh-normal);
  color: var(--ink-muted);
  font-feature-settings: "tnum" 1;
}
.marginalia .marginalia-item[data-active="true"] {
  border-left-color: var(--aurora-1);
  color: var(--ink-primary);
}
.marginalia-label {
  font-size: var(--fs-micro);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-muted);
  opacity: 0.6;
}
```

**anchor-positioning 已撤回**(`typography.css:128-141` 注释):曾尝试用 `anchor-name` / `position-anchor` 让 marginalia 与文章 h1 基线对齐;Chrome 125+ / Safari 26+ 在某些视口下 `right: calc(anchor(left) + 13rem)` 解析为 0,触发 fallback 把 marginalia 直接推到了 article 内部覆盖 h1。现行方案保留组件内联 `hidden xl:block absolute -left-52 top-0`。

### 16. 首字下沉 `.drop-cap`

源:`typography.css:143-176`(Round 3 Frere-Jones 重构)

```css
.drop-cap::first-letter {
  font-family: var(--font-editorial);
  font-size: 3.6em;        /* 3 × line-height,精确基线锁定,不再 4.2em 伸进第 4 行 */
  line-height: 1;
  font-weight: 400;        /* Book/Regular —— 不能用 600/700 把首段"堵"住 */
  font-style: normal;      /* 取消 italic —— italic 让 drop cap 从"锚"变成"飘" */
  float: left;
  color: var(--ink-primary);
  text-shadow: 0 1px 0 color-mix(in oklch, var(--aurora-1) 22%, transparent); /* 极细描金 */
}

@supports (initial-letter: 3) or (-webkit-initial-letter: 3) {
  .drop-cap::first-letter {
    initial-letter: 3 drop 2;   /* 现代浏览器走真 hanging cap */
    float: none;
    font-size: inherit;
  }
}

/* 中文走 editorial(LXGW WenKai/Source Han Serif),不用 Fraunces 拉丁字形 */
.drop-cap:lang(zh-Hans)::first-letter {
  font-family: var(--font-editorial);
  font-style: normal;
}
```

工艺规则参考 Butterick《Practical Typography》与 Frere-Jones —— **roman 正体 + Book 字重 + 纯墨色 + 极细金色 text-shadow**,而不是 aurora 渐变。

### 17. 章节标记 `.section-mark`

源:`typography.css:178-187`
```css
.section-mark::before {
  content: "§ ";
  color: var(--aurora-1);
  font-weight: 400;
  margin-right: 0.15em;
  opacity: 0.55;
}
```
markdown h2 自动加 § —— 编辑级文章排印的 marginalia 配套。

### 18. AI 流式 `.ai-stream` + `.delta`

源:`typography.css:189-215`

```css
.ai-stream {
  font-family: var(--font-editorial);
  font-size: var(--fs-reading);
  line-height: var(--lh-relaxed);
  color: var(--ink-primary);
}
.ai-stream .delta {
  display: inline;
  animation: ink-bleed 220ms var(--ease-out) both;
  will-change: opacity, transform, filter;
}
.ai-stream .think-block {
  /* 思考块用 mono + 弱化 + 左侧 ink-subtle 实色边 */
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  color: var(--ink-muted);
  opacity: 0.7;
  border-left: 2px solid var(--ink-subtle);
  background: rgb(from var(--ink-primary) r g b / 0.02);
}
```

`@keyframes ink-bleed` 定义在 `tokens.css:273-284`(opacity 0→1 + translateY 2px→0 + blur 1.5px→0)。

签名时刻 5(AI 工坊)的核心 —— admin 的 AiWritingWorkspace 把流式响应分块包成 `<span class="delta">`,墨水一滴滴渗入纸张。

### 19. 极光渐变文字 `.aurora-text`

源:`typography.css:217-258`(Round 4 `@property` 升级)

```css
@property --aurora-angle {
  syntax: '<angle>';
  inherits: true;
  initial-value: 135deg;
}

.aurora-text {
  --aurora-angle: 135deg;
  background: linear-gradient(var(--aurora-angle),
    var(--aurora-1) 0%,
    var(--aurora-2) 50%,
    var(--aurora-4) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  transition: --aurora-angle var(--dur-ambient, 1800ms) var(--ease-out, ...);
  will-change: --aurora-angle;
}

@media (hover: hover) {
  .aurora-text:hover,
  *:hover > .aurora-text,
  .group:hover .aurora-text {
    --aurora-angle: 315deg;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aurora-text { transition: none; }
}
```

**`@property` 关键性**(`typography.css:222-225` 注释):未注册 `<angle>` 类型,CSS 变量在 transition 中是字符串插值,会出现 135deg → 315deg "硬跳";注册后浏览器知道这是 angle,用真补间。Chrome 85+ / Safari 16.4+ / Firefox 128+ 支持,不支持的浏览器看到 135deg 静态渐变,不报错。

### 20. 眉标 `.eyebrow`

源:`typography.css:260-271`
```css
.eyebrow {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: var(--fs-caption);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--aurora-1);
  opacity: 0.75;
}
```
Hero 上方那行 `AETHERBLOG · A LUMINOUS CODEX` 即用此类。Aurora Codex 标识。

### 21. 阅读进度条 `.reading-progress` + `.reading-progress--css`

源:`typography.css:273-318`(Round 3 双路径实现)

```css
/* 基础类 —— 任何浏览器,JS 注入 --reading-progress 变量 */
.reading-progress {
  position: fixed; top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg,
    var(--aurora-1) 0%,
    var(--aurora-2) 50%,
    var(--aurora-4) 100%);
  transform: scaleX(var(--reading-progress, 0));
  transform-origin: left center;
  z-index: 100;
  box-shadow: 0 0 8px color-mix(in oklch, var(--aurora-1) 60%, transparent);
  transition: transform 100ms linear;
}

/* 现代浏览器(Chrome 115+)纯 CSS scroll-timeline,零 JS re-render */
@supports (animation-timeline: scroll()) {
  .reading-progress--css {
    transform: scaleX(0);
    animation: reading-progress-fill linear forwards;
    animation-timeline: scroll(root block);
    transition: none;
  }
  @keyframes reading-progress-fill {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
}
```

组件在 client 端 `CSS.supports('animation-timeline', 'scroll()')` 检测:支持则两个 class 都加;不支持只加基础类 + JS rAF 注入 `--reading-progress`。

### 22. 命令面板 chip `.cmd-chip`

源:`typography.css:320-336`
```css
.cmd-chip {
  display: inline-flex;
  padding: 0.25em 0.55em;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: var(--radius-sm, 0.5rem);
  background: color-mix(in oklch, var(--aurora-1) 15%, transparent);
  color: var(--aurora-1);
  border: 1px solid color-mix(in oklch, var(--aurora-1) 30%, transparent);
  font-weight: 500;
}
```
对应签名时刻 3(命令面板)的 `[NAV] / [ASK] / [CMD] / [SEARCH]` 模式 chip。

---

## 第三部分 · 编辑级文章排印(规范侧规划)

> 以下来自 `03-typography.md:209-316`,部分已落地到 `apps/blog/app/globals.css` 的 `.markdown-body` 段。

### 23. 基本规则

- 容器:`max-width: 68ch`(约 650px)
- 字号:`font-size: var(--fs-reading)` = 18px(移动端 `var(--fs-body)` = 16px)
- 行高:`line-height: var(--lh-relaxed)` = 1.75
- 字体:`font-family: var(--font-editorial)`
- 段间距:`margin: 1.5em 0`(比 1em 更舒展)

### 24. 引用 blockquote(左溢出而非左边框)

```css
.markdown-body blockquote {
  font-family: var(--font-display);
  font-style: italic;
  font-size: var(--fs-lede);
  color: var(--ink-secondary);
  border-left: none;        /* 放弃边框 */
  padding-left: 2em;
  margin-left: -2em;        /* 向左溢出,marginalia 感 */
  position: relative;
}
.markdown-body blockquote::before {
  content: """;             /* Fraunces 斜体大引号 */
  position: absolute; left: 0; top: -0.2em;
  font-size: 3em;
  color: var(--aurora-1);
  opacity: 0.3;
}
```

### 25. 行内代码(极光色)

```css
.markdown-body code:not(pre code) {
  font-family: var(--font-mono);
  font-size: 0.92em;
  padding: 0.15em 0.4em;
  background: color-mix(in oklch, var(--aurora-1) 10%, transparent);
  color: var(--aurora-1);
  border-radius: var(--radius-sm);
  border: 1px solid color-mix(in oklch, var(--aurora-1) 20%, transparent);
}
```

### 26. 链接(优雅下划线)

```css
.markdown-body a {
  color: var(--ink-primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklch, var(--aurora-1) 40%, transparent);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
.markdown-body a:hover {
  text-decoration-color: var(--aurora-1);
  text-decoration-thickness: 2px;
  color: var(--aurora-1);
}
```

### 27. content-visibility 长文剪裁(Round 5)

`history.md` 记录:`.markdown-body > :not(:first-child)` 默认 `content-visibility: auto` + `contain-intrinsic-size: auto 600px`,视口外段落不进入 style & layout,LCP ~1.4s → ~0.6s,TBT -40%。

- `<pre>` / `.code-block-wrapper` 给 480px 估算高度
- `<figure>` / `<img>` / 单图段落给 420px
- `:target` 强制 `visible`(避免 Chrome <109 锚点偏移)
- `:first-child` 豁免(保护 drop-cap)

---

## 28. 关键代码引用

| 文件 | 行号 | 内容 |
|:---|---:|:---|
| `packages/ui/src/styles/surfaces.css` | 34-51 | `.surface-leaf` 定义 + 亮主题覆盖 |
| `packages/ui/src/styles/surfaces.css` | 53-78 | `.surface-raised` 定义 + 亮主题 |
| `packages/ui/src/styles/surfaces.css` | 80-107 | `.surface-overlay` 定义 + aurora 描边 |
| `packages/ui/src/styles/surfaces.css` | 109-141 | `.surface-luminous` 定义 + ::before 极光辐射 |
| `packages/ui/src/styles/surfaces.css` | 143-191 | `[data-interactive]` aurora hover stripe |
| `packages/ui/src/styles/surfaces.css` | 193-217 | `.aurora-sweep` |
| `packages/ui/src/styles/surfaces.css` | 219-230 | `.aurora-divider` |
| `packages/ui/src/styles/typography.css` | 17-34 | 9 级语义字号类 |
| `packages/ui/src/styles/typography.css` | 36-65 | font-* 角色 + 中文优化 |
| `packages/ui/src/styles/typography.css` | 75-81 | `.reading-column` |
| `packages/ui/src/styles/typography.css` | 97-126 | `.marginalia` |
| `packages/ui/src/styles/typography.css` | 143-176 | `.drop-cap`(Frere-Jones 工艺) |
| `packages/ui/src/styles/typography.css` | 178-187 | `.section-mark` § |
| `packages/ui/src/styles/typography.css` | 189-215 | `.ai-stream` + `.delta` + `.think-block` |
| `packages/ui/src/styles/typography.css` | 217-258 | `.aurora-text` + `@property --aurora-angle` |
| `packages/ui/src/styles/typography.css` | 260-271 | `.eyebrow` |
| `packages/ui/src/styles/typography.css` | 273-318 | `.reading-progress` + `--css` 双路径 |
| `packages/ui/src/styles/typography.css` | 320-336 | `.cmd-chip` |

---

## 29. 引用的子文档与原始规范

- `.claude/design-system/02-surfaces.md` —— surface 决策树与禁忌
- `.claude/design-system/03-typography.md` —— 字体角色 / 字号阶梯 / 编辑级排印 / 中文优化
- `.claude/design-system/06-signature-moments.md` —— 文章阅读 / Hero / Drop cap 在签名时刻中的位置
- `.claude/design-system/history.md` —— Round 3 drop-cap / scroll-timeline / Round 5 content-visibility 落地记录

---

## 30. 使用方与扩展点

### 30.1 谁消费 surfaces.css

- 任何带 `.surface-leaf / raised / overlay / luminous` 类的元素 —— blog ArticleCard / FeaturedPost / TableOfContents / SearchPanel,admin Sidebar / CommandPalette / 各 Dialog
- `[data-interactive]` 标记的可点击 surface —— ArticleCard / FriendCard / TimelineTree 月年按钮 / PostNavigation
- `.aurora-sweep` —— blog 的 CTA / hover 大块
- `.aurora-divider` —— blog header 底部、admin section 分隔

### 30.2 谁消费 typography.css

- `.text-*` —— 任何文本元素的字号(替代 `text-5xl`)
- `.font-display / editorial / sans / mono` —— 页面布局选字体
- `.reading-column` —— 文章详情、AI 输出长文
- `.marginalia` —— blog 文章页桌面端 ≥1280px 边注
- `.drop-cap` —— 文章首段(由 `.markdown-body > p:first-of-type::first-letter` 自动应用)
- `.section-mark` —— h2 自动加 §
- `.ai-stream / .delta` —— admin AiWritingWorkspace
- `.aurora-text` —— Hero 标题中的英文部分
- `.eyebrow` —— Hero 上方眉标
- `.reading-progress` —— 文章页顶部进度条
- `.cmd-chip` —— 命令面板模式 chip

### 30.3 加新 surface(再次强调)

**默认禁止**。规范要求只有四层。任何新加都意味着层级失败。

### 30.4 加新字号

加到 tokens.css 的 `--fs-*` 命名空间,然后在 typography.css 中加对应的 `.text-X { font-size: var(--fs-X); ... }` 类,同步 `01-tokens.md` 与 `03-typography.md`。

### 30.5 加新 utility class

放 typography.css(若与文字 / 排印相关)或 tokens.css(若是更基础的全局类)。**永远不要**把 utility class 写到组件文件 inline。

---

## 31. 已知限制

1. **暗主题 surface 1-3 的 border 用 `rgba(255,255,255,N)`** —— 不跟随 `--ink-primary` 翻转,亮主题覆盖时手动写新值;意味着两套实现需要同步维护。
2. **`[data-interactive]` 不覆盖 surface-overlay / luminous** —— 只对 leaf / raised 生效,因为 overlay / luminous 已有自己的 hover/状态语言。
3. **`.drop-cap initial-letter`** —— Chrome 110+ / Safari 16.4+ 才支持真 hanging cap;旧浏览器吃 float fallback,字号是 3.6em 但基线对齐稍弱。
4. **`.aurora-text` 的 `@property`** —— Firefox 128 之前不补间,会硬跳。当前 Firefox ESR 仍在 115,Linux 用户面较大概率看不到旋转。
5. **`.reading-progress--css`** —— Chrome 115+ / Safari 暂不支持 `animation-timeline: scroll()`(Safari 18+ 才有 view-timeline,scroll-timeline 还要再等)。
6. **content-visibility 的 `auto 600px` 估算值是经验** —— 文章中段落差异巨大,有时会触发 IntersectionObserver 反复 layout,严重时反而拖累性能。需要按实际监测调整。
