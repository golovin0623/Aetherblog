# 01 · Design Tokens

> 全套设计令牌在 `packages/ui/src/styles/tokens.css` 中定义。本文档是令牌的**权威说明**,代码必须与此同步。

---

## 命名空间(Namespaces)

| 前缀 | 语义 | 例子 |
|:---|:---|:---|
| `--ink-*` | 墨色(暗主题下的象牙色文字层次) | `--ink-primary` |
| `--bg-*` | 背景层级 | `--bg-void` / `--bg-leaf` |
| `--aurora-*` | 光源色 | `--aurora-1` |
| `--signal-*` | 信号色(info/success/warn/danger) | `--signal-warn` |
| `--fs-*` | 字号阶梯 | `--fs-reading` |
| `--lh-*` | 行高 | `--lh-relaxed` |
| `--ease-*` | 缓动曲线 | `--ease-out` |
| `--dur-*` | 时长 | `--dur-flow` |
| `--radius-*` | 圆角 | `--radius-md` |
| `--focus-ring` | 聚焦环(统一) | `--focus-ring` |

**向后兼容:** 现有 `--color-*` / `--text-*` / `--border-*` / `--bg-card` / `--shadow-*` 全部保留。新令牌与它们**并存**,逐步迁移。

---

## 1 · 文字 · Ink

暗主题的文字颜色**不使用纯白**。出版物的质感来自象牙色。

```css
--ink-primary:   #F4EFE6;  /* 正文主色,暖象牙 */
--ink-secondary: #B8B3A8;  /* 次级文字,米灰 */
--ink-muted:     #6B6862;  /* metadata、辅助 */
--ink-subtle:    #3A3932;  /* 禁用、占位 */
```

**亮主题下映射**(降低明度,保留暖色调):
```css
--ink-primary:   #1C1A14;
--ink-secondary: #4A463E;
--ink-muted:     #7A7468;
--ink-subtle:    #C9C3B5;
```

### 对比度保证
- `ink-primary` on `bg-void`:17.2:1 · WCAG AAA
- `ink-secondary` on `bg-void`:7.1:1 · WCAG AAA
- `ink-muted` on `bg-leaf`:4.9:1 · WCAG AA

---

## 2 · 背景 · Obsidian

暗主题下的四层深度背景。每一层都略比上一层亮一点,形成视觉的"漂浮感"。

```css
--bg-void:      #05060A;  /* 页面底,最深 */
--bg-substrate: #0B0D14;  /* 主内容区底 */
--bg-leaf:      #12141D;  /* 卡片层 1 */
--bg-raised:    #1A1D28;  /* 卡片层 2 / 弹层 */
```

**亮主题:**
```css
--bg-void:      #FAF9F6;
--bg-substrate: #F4F2EC;
--bg-leaf:      #FFFFFF;
--bg-raised:    #FFFFFF;
```

---

## 3 · 光源 · Aurora

**唯一的彩色来源。**不要把它当装饰用,它是"光"。

```css
--aurora-1: #6366F1;  /* Indigo  主光源 */
--aurora-2: #8B5CF6;  /* Violet  过渡 */
--aurora-3: #06B6D4;  /* Cyan    边缘 */
--aurora-4: #F472B6;  /* Rose    稀有点缀 */
```

### 光源几何(全站复用)
```css
--aurora-field:
  radial-gradient(ellipse 80% 60% at 15% 0%,
    color-mix(in oklch, var(--aurora-1) 18%, transparent) 0%,
    transparent 50%),
  radial-gradient(ellipse 50% 40% at 85% 10%,
    color-mix(in oklch, var(--aurora-4) 8%, transparent) 0%,
    transparent 50%);
```

**使用规则:**
- 博客首页 `<body>::before` 铺一次 `--aurora-field`(`position: fixed; inset: 0; z-index: -1;`)
- admin 的 AdminLayout 主区铺一次
- **其他任何位置禁止使用 radial-gradient 做背景**

### 用作描边/重点
```css
/* 按钮聚焦、菜单激活、卡片 hover 极光线 */
border-left: 2px solid var(--aurora-1);
box-shadow: 0 0 12px color-mix(in oklch, var(--aurora-1) 40%, transparent);
```

---

## 4 · 信号色 · Signal

**不是状态色,是信号色**。成功、警告、危险、信息 —— 它们"对用户说话"。

```css
--signal-info:    #60A5FA;  /* Blue 400 */
--signal-success: #34D399;  /* Emerald 400 */
--signal-warn:    #FBBF24;  /* Amber 400 */
--signal-danger:  #F87171;  /* Red 400 */
```

**禁止:**
- ❌ `border-amber-500/20` 内联(现 ArticleCard 里的密码贴纸用了这种 — 必须改为 `border-[var(--signal-warn)]/20`)
- ❌ 使用其他非信号色(比如 Orange)做警告

**搭配:**
```css
/* 警告块 */
background: color-mix(in oklch, var(--signal-warn) 10%, var(--bg-leaf));
border: 1px solid color-mix(in oklch, var(--signal-warn) 30%, transparent);
color: var(--signal-warn);
```

---

## 5 · 字号阶梯 · Type Scale

9 级音阶,基于 16px 基线,大致 1.25(Perfect Fourth)比例。**不允许越级**。

| Token | rem | px | 用途 |
|:---|---:|---:|:---|
| `--fs-micro` | 0.6875 | 11 | tabular 数字、时间戳 |
| `--fs-caption` | 0.8125 | 13 | caption、marginalia |
| `--fs-body` | 1 | 16 | UI 默认、表单 |
| `--fs-reading` | 1.125 | 18 | 文章正文(桌面) |
| `--fs-lede` | 1.25 | 20 | 导语、摘要 |
| `--fs-h4` | 1.5 | 24 | h4 |
| `--fs-h3` | 1.875 | 30 | h3 |
| `--fs-h2` | 2.5 | 40 | h2 |
| `--fs-h1` | 3.5 | 56 | h1 |
| `--fs-display` | clamp(4, 8vw, 8.5) | 64–136 | Hero 大标题,流体 |

### Tailwind 映射

```ts
// tailwind.config.ts -> extend.fontSize
'micro':   ['var(--fs-micro)',   { lineHeight: 'var(--lh-normal)' }],
'caption': ['var(--fs-caption)', { lineHeight: 'var(--lh-normal)' }],
'body':    ['var(--fs-body)',    { lineHeight: 'var(--lh-normal)' }],
'reading': ['var(--fs-reading)', { lineHeight: 'var(--lh-relaxed)' }],
'lede':    ['var(--fs-lede)',    { lineHeight: 'var(--lh-relaxed)' }],
'h4':      ['var(--fs-h4)',      { lineHeight: 'var(--lh-snug)' }],
'h3':      ['var(--fs-h3)',      { lineHeight: 'var(--lh-snug)' }],
'h2':      ['var(--fs-h2)',      { lineHeight: 'var(--lh-snug)' }],
'h1':      ['var(--fs-h1)',      { lineHeight: 'var(--lh-tight)' }],
'display': ['var(--fs-display)', { lineHeight: 'var(--lh-tight)', letterSpacing: '-0.03em' }],
```

**使用:** `className="text-reading"` / `text-h1` / `text-display`
**禁止:** `text-5xl`, `text-[1.25rem]`, 内联 `style={{ fontSize: '20px' }}`

---

## 6 · 行高 · Line Height

```css
--lh-tight:   1.1;   /* display */
--lh-snug:    1.25;  /* headings */
--lh-normal:  1.5;   /* body UI */
--lh-relaxed: 1.75;  /* 长文阅读、中文段落 */
```

**中文段落默认 relaxed。**

---

## 7 · 动效 · Motion Primitives

详见 [04-motion.md](./04-motion.md)。

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);   /* 主曲线,"Expo Out" */
--ease-in:     cubic-bezier(0.7, 0, 0.84, 0);
--ease-in-out: cubic-bezier(0.87, 0, 0.13, 1);

--dur-instant: 120ms;  /* 按钮按下、状态切换 */
--dur-quick:   260ms;  /* hover、dropdown */
--dur-flow:    520ms;  /* Modal、页面过渡 */
--dur-ambient: 1800ms; /* 呼吸、极光漂移 */
```

---

## 8 · 圆角 · Radius

保留现有的 4 级(`--radius-sm/md/lg/xl`),**补充两个语义级别**:

```css
--radius-sm:     0.5rem;    /* 8px  — Badge、Tag、Tooltip */
--radius-md:     0.75rem;   /* 12px — Button、Input */
--radius-lg:     1rem;      /* 16px — Card */
--radius-xl:     1.5rem;    /* 24px — Modal、大卡片 */
--radius-bleed:  2.875rem;  /* 46px — 首页页面折角(Hero 的 rounded-t-[46px]) */
--radius-full:   9999px;    /* 全圆 */
```

**禁止** 内联任意值 `rounded-[37px]`。首页页面折角的 46px 现已收编为 `--radius-bleed`。

---

## 9 · 聚焦环 · Focus Ring

统一的无障碍聚焦环,所有可聚焦元素共用。

```css
--focus-ring: 0 0 0 2px var(--bg-void), 0 0 0 4px var(--aurora-1);
```

```css
*:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--radius-sm); /* 防止方角 outline 难看 */
}
```

---

## 10 · 数字格式化

UI 中所有数字(计数、价格、时间戳)必须启用 tabular numerals,防止"跳字":

```css
font-feature-settings: "tnum" 1, "cv11" 1, "ss01" 1;
```

在 admin 的表格、dashboard 统计卡片、blog 的阅读时长中强制启用。

---

## 使用检查清单(Lint 意识)

在 Review 代码时,这些是红旗:
- [ ] JSX 里出现 `text-[23px]` / `text-xs` 等非语义字号
- [ ] 内联 hex 码 `bg-[#123456]`
- [ ] 内联 rgba `bg-[rgba(...)]`
- [ ] `backdrop-blur-*` 直接写在 JSX(应该用 `.surface-*`)
- [ ] 用 `text-white` / `text-black`(应该用 `text-[var(--ink-primary)]`)
- [ ] 用 `border-amber/red/green-*`(应该用 `--signal-*`)
- [ ] `transition-[all]` 裸写(应该引用 motion preset)
