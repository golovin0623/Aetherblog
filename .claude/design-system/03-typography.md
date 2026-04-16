# 03 · Typography · 字体与排印

> 字体是 AetherBlog 设计系统中**唯一最能建立差异化**的维度。换对字体,整个产品气质瞬间上升一个档次。

---

## 字体角色(Font Roles)

四个角色,每个角色只选一款字体。

| 角色 | 字体 | CSS 变量 | 用途 |
|:---|:---|:---|:---|
| Display | **Fraunces** Variable | `--font-display` | Hero、大标题、品牌名、数字强调 |
| Editorial | **Instrument Serif** | `--font-editorial` | 文章正文(西文)、引言 |
| Sans | **Geist** | `--font-sans` | UI 文字、导航、表单、按钮 |
| Mono | **Geist Mono** | `--font-mono` | 代码、tabular 数字、marginalia |

中文字体系统(与西文**组合**使用):

| 中文角色 | 字体 | 用途 |
|:---|:---|:---|
| Display CN | **Source Han Serif SC / Noto Serif SC** | 中文大标题 |
| Reading CN | **LXGW WenKai(霞鹜文楷)** | 中文正文长段落 |
| UI CN | **PingFang SC / HarmonyOS Sans SC** | 中文 UI(跟随系统) |

---

## CSS 变量定义

```css
:root {
  --font-display:
    'Fraunces',
    'Source Han Serif SC', 'Noto Serif SC',
    Georgia, serif;
  --font-display-settings: "opsz" 144, "SOFT" 60, "WONK" 1;

  --font-editorial:
    'Instrument Serif',
    'LXGW WenKai', 'Source Han Serif SC', 'Noto Serif SC',
    Georgia, serif;

  --font-sans:
    'Geist',
    'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei UI',
    -apple-system, BlinkMacSystemFont, sans-serif;
  --font-sans-settings: "ss01" 1, "ss02" 1, "cv11" 1;

  --font-mono:
    'Geist Mono', 'JetBrains Mono',
    ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

---

## 加载策略

### Next.js(博客)

`apps/blog/app/layout.tsx`:

```tsx
import { Fraunces, Instrument_Serif, Geist, Geist_Mono } from 'next/font/google';

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['SOFT', 'WONK', 'opsz'],
  style: ['normal', 'italic'],
});
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument-serif',
  weight: '400',
  style: ['normal', 'italic'],
});
const geist = Geist({ subsets: ['latin'], display: 'swap', variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-geist-mono' });
```

然后在 `<body>` 上:
```tsx
<body className={`${geist.variable} ${geistMono.variable} ${fraunces.variable} ${instrumentSerif.variable} ...`}>
```

在 globals.css 中把 `--font-display` 指向 `var(--font-fraunces)`,`--font-sans` 指向 `var(--font-geist)`,等。

### Vite(admin)

`apps/admin/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,100..900,0..100,0..1;1,9..144,100..900,0..100,0..1&family=Instrument+Serif:ital@0;1&family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap" />
```

**LXGW WenKai** 通过 CDN(按需 subset):
```html
<link rel="stylesheet" href="https://chinese-fonts-cdn.deno.dev/packages/lxgwwenkai/dist/LXGWWenKai-Regular/result.css" />
```

---

## Tailwind 映射

```ts
// tailwind.config.ts
theme: {
  extend: {
    fontFamily: {
      display:   ['var(--font-display)',   'serif'],
      editorial: ['var(--font-editorial)', 'serif'],
      sans:      ['var(--font-sans)',      'sans-serif'],  // 覆盖默认 sans
      mono:      ['var(--font-mono)',      'monospace'],
    },
  },
},
```

---

## 字号阶梯

见 [01-tokens.md #5](./01-tokens.md#5--字号阶梯--type-scale)。9 级,不准越级。

---

## 使用规范

### 按场景选字体

| 场景 | 字体 | 示例 |
|:---|:---|:---|
| 首页 Hero | `font-display` | "写作,是一种思考的痕迹" |
| 文章页标题 h1 | `font-display` | 文章大标题 |
| 文章页正文 | `font-editorial` | 段落、引言 |
| 文章页 h2/h3 | `font-display` + `font-medium` | 章节标题 |
| 导航、按钮、UI | `font-sans` | "首页" "归档" "关于" |
| 数据表格数字 | `font-mono` + tnum | 统计卡片数字 |
| 代码块 | `font-mono` | 行内 `code` 与块状代码 |
| marginalia | `font-mono` + `text-caption` | 侧边注释 |
| metadata(发布日期等) | `font-mono` + `text-caption` | "2026-04-15 · 8 min read" |

### 同一段落禁止混用字族

**错:**
```html
<p>
  这里是<span class="font-display">重点</span>,这里是正文。
</p>
```

**对:**
```html
<p>
  这里是<strong>重点</strong>,这里是正文。
</p>
<!-- <strong> 字重自然加重,无需切换字族 -->
```

唯一例外:正文中引用**代码标识符**时用 `<code>`(mono)。

---

## 可变字体 · 签名效果

### Fraunces "呼吸" 动画

Fraunces 有 SOFT 轴(0-100,字形柔度)。大号 Hero 标题可以慢速循环 SOFT:

```css
@keyframes breath {
  0%, 100% { font-variation-settings: "opsz" 144, "SOFT" 30, "WONK" 1; }
  50%      { font-variation-settings: "opsz" 144, "SOFT" 80, "WONK" 1; }
}

.hero-title {
  font-family: var(--font-display);
  animation: breath var(--dur-ambient) 4 var(--ease-in-out) infinite;
  /* var(--dur-ambient) * 4 = ~7.2s 循环 */
}

@media (prefers-reduced-motion: reduce) {
  .hero-title { animation: none; font-variation-settings: "opsz" 144, "SOFT" 50, "WONK" 0; }
}
```

### StatsCard 数字微扭(WONK 轴)

```css
.stat-number {
  font-family: var(--font-display);
  font-variation-settings: "opsz" 72, "wght" 600, "WONK" 0;
  transition: font-variation-settings var(--dur-quick) var(--ease-out);
}
.stat-card:hover .stat-number {
  font-variation-settings: "opsz" 72, "wght" 600, "WONK" 1;
}
```

---

## 编辑级文章排印

`.markdown-body` 应升级为以下规范(详细 CSS 见 [globals.css #article-reading](../apps/blog/app/globals.css)):

### 基本
- 容器:`max-width: 68ch`(约 650px,黄金阅读宽度)
- 字号:`font-size: var(--fs-reading)` = 18px(移动端 `var(--fs-body)` = 16px)
- 行高:`line-height: var(--lh-relaxed)` = 1.75
- 字体:`font-family: var(--font-editorial)`
- 段间距:`margin: 1.5em 0`(比原来 1em 更舒展)

### 首字下沉
```css
.markdown-body > p:first-of-type::first-letter {
  font-family: var(--font-display);
  font-size: 4.2em;
  line-height: 0.9;
  font-weight: 600;
  font-style: italic;
  float: left;
  margin: 0.1em 0.1em 0 -0.05em;
  color: var(--ink-primary);
  background: linear-gradient(135deg, var(--aurora-1), var(--aurora-2));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

### 章节标记 §
```css
.markdown-body h2::before {
  content: "§ ";
  color: var(--aurora-1);
  font-weight: 400;
  margin-right: 0.25em;
  opacity: 0.6;
}
```

### 引用:左边距而非左边框
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
  content: "" "";
  position: absolute;
  left: 0; top: -0.2em;
  font-size: 3em;
  color: var(--aurora-1);
  opacity: 0.3;
  font-family: var(--font-display);
  line-height: 1;
}
```

### 代码块:左边极光条
```css
.markdown-body .code-block-wrapper,
.markdown-body pre {
  position: relative;
  font-family: var(--font-mono);
}
.markdown-body .code-block-wrapper::before,
.markdown-body pre::before {
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 2px;
  background: linear-gradient(to bottom, var(--aurora-1), var(--aurora-2));
  border-radius: 2px 0 0 2px;
}
```

### 行内代码:极光色
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

### 链接:优雅下划线
```css
.markdown-body a {
  color: var(--ink-primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklch, var(--aurora-1) 40%, transparent);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: all var(--dur-quick) var(--ease-out);
}
.markdown-body a:hover {
  text-decoration-color: var(--aurora-1);
  text-decoration-thickness: 2px;
  color: var(--aurora-1);
}
```

---

## 中文优化

### 全局应用

```css
html {
  word-break: normal;
  line-break: strict;
  text-wrap: pretty;                     /* 避免孤字,现代浏览器支持 */
  font-feature-settings: "palt" 1;       /* 中文标点压缩 */
}

.markdown-body {
  /* 中英文之间自动加一点点隙 */
  text-spacing-trim: space-first;
}
```

### 中文段落避免禁则

```css
.markdown-body p {
  text-align: justify;
  text-justify: inter-ideograph;  /* 中文的两端对齐更美 */
  hanging-punctuation: first last;
}
```

---

## 禁忌

1. ❌ 使用 Inter 作为 Hero 标题字体
2. ❌ 使用 Playfair Display 作为正文(它是装饰字体,不适合长文)
3. ❌ 在同一 `<p>` 里切换 3 个字族以上
4. ❌ 使用 `<font>` 标签
5. ❌ 对中文加 `font-style: italic`(中文字体通常没有真斜体)
6. ❌ 在移动端使用 `var(--fs-reading)` = 18px(移动端正文用 16px)
7. ❌ 自己写 `@keyframes` 动画用于字体呼吸(必须引 `breath` preset)
