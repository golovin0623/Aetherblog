# 02 · Surfaces · 四层玻璃体系

> 现有系统里 `.glass` / `.glass-high` / `.glass-premium` 三种玻璃的**使用语义模糊** —— 按 blur 值区分,不是按用途区分。结果:作者靠就近复制,最终视觉层级崩溃。
>
> 新体系按**在 DOM 深度上的位置**区分,不再按 blur 值。

---

## 四层 Surface

| Layer | CSS class | 用途 | Blur | Border 强度 | Shadow 强度 |
|:---|:---|:---|---:|:---:|:---:|
| 1 · Leaf | `.surface-leaf` | 文档流中的卡片、列表项 | 16px | 弱 | 无 |
| 2 · Raised | `.surface-raised` | 浮于流之上 — sidebar、sticky header | 24px | 中 | 微 |
| 3 · Overlay | `.surface-overlay` | 弹层 — Modal、命令面板、Dropdown | 40px | 强 | 重 |
| 4 · Luminous | `.surface-luminous` | 签名卡片(极光反射) — Hero CTA、主推 | 40px | 极光 | 极光辉光 |

---

## 层级决策树

```
我要做一个容器/卡片
│
├── 它是页面 Modal / 全屏弹层?
│   └── 用 .surface-overlay
│
├── 它是 Hero 区或"这个按钮就是这一页主要 CTA"?
│   └── 用 .surface-luminous(稀有,一页不超过一个)
│
├── 它会 position: sticky / fixed 浮在内容之上?
│   └── 用 .surface-raised
│
└── 否则 —— 95% 的情况
    └── 用 .surface-leaf
```

---

## CSS 实现

写在 `packages/ui/src/styles/surfaces.css`,由 blog 和 admin 的入口 CSS `@import`。

```css
/* =========================================================
   SURFACE 1 · Leaf
   紧贴文档流的内容层。不飘、不反光。
   ========================================================= */
.surface-leaf {
  background: color-mix(in oklch, var(--bg-leaf) 85%, transparent);
  backdrop-filter: blur(16px) saturate(120%);
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  border: 1px solid color-mix(in oklch, var(--ink-primary) 6%, transparent);
  border-radius: var(--radius-lg);
  transition: border-color var(--dur-quick) var(--ease-out);
}
.surface-leaf:hover {
  border-color: color-mix(in oklch, var(--ink-primary) 12%, transparent);
}

/* =========================================================
   SURFACE 2 · Raised
   浮于文档之上的固定/粘性容器。轻微阴影 + 上沿高光。
   ========================================================= */
.surface-raised {
  background: color-mix(in oklch, var(--bg-raised) 80%, transparent);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid color-mix(in oklch, var(--ink-primary) 10%, transparent);
  border-radius: var(--radius-lg);
  box-shadow:
    0 1px 0 inset color-mix(in oklch, var(--ink-primary) 8%, transparent),
    0 8px 24px -8px rgba(0, 0, 0, 0.4);
}

/* =========================================================
   SURFACE 3 · Overlay
   Modal、命令面板、Dropdown。强模糊 + 极光辉光边。
   ========================================================= */
.surface-overlay {
  background: color-mix(in oklch, var(--bg-raised) 70%, transparent);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid color-mix(in oklch, var(--ink-primary) 14%, transparent);
  border-radius: var(--radius-xl);
  box-shadow:
    0 1px 0 inset color-mix(in oklch, var(--ink-primary) 12%, transparent),
    0 20px 60px -20px color-mix(in oklch, var(--aurora-1) 20%, black),
    0 0 0 1px color-mix(in oklch, var(--aurora-1) 8%, transparent);
}

/* =========================================================
   SURFACE 4 · Luminous
   签名稀有卡片,极光作为内置光源反射到表面。
   一页最多一个。
   ========================================================= */
.surface-luminous {
  background:
    linear-gradient(135deg,
      color-mix(in oklch, var(--aurora-1) 12%, transparent) 0%,
      color-mix(in oklch, var(--bg-raised) 90%, transparent) 50%),
    var(--bg-raised);
  backdrop-filter: blur(40px) saturate(160%);
  -webkit-backdrop-filter: blur(40px) saturate(160%);
  border: 1px solid color-mix(in oklch, var(--aurora-1) 30%, transparent);
  border-radius: var(--radius-xl);
  box-shadow:
    0 1px 0 inset color-mix(in oklch, var(--aurora-1) 20%, transparent),
    0 20px 60px -10px color-mix(in oklch, var(--aurora-1) 30%, black);
  position: relative;
  overflow: hidden;
}
.surface-luminous::before {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(circle at top left,
    color-mix(in oklch, var(--aurora-1) 18%, transparent) 0%,
    transparent 50%);
  pointer-events: none;
}
```

---

## 亮主题适配

亮主题下 `--ink-primary` 是深墨色,直接复用 `color-mix` 的百分比会反向产生深色描边,视觉逻辑依然正确,但需微调:

```css
:root.light .surface-leaf,
:root.light .surface-raised,
:root.light .surface-overlay {
  /* 亮模式下减弱模糊,加强阴影 */
  backdrop-filter: blur(8px) saturate(110%);
  background: color-mix(in oklch, var(--bg-leaf) 92%, transparent);
}
:root.light .surface-raised {
  box-shadow:
    0 1px 0 inset rgba(255, 255, 255, 0.6),
    0 8px 24px -8px rgba(0, 0, 0, 0.08);
}
```

---

## React 组件封装(`packages/ui`)

### `Card` 新 API

```tsx
<Card variant="leaf">      {/* 默认,等同于省略 */}
<Card variant="raised">    {/* 浮起 */}
<Card variant="overlay">   {/* 弹层 */}
<Card variant="luminous">  {/* 签名 */}
```

实现(摘要):
```tsx
const SURFACE_CLASS = {
  leaf:     'surface-leaf',
  raised:   'surface-raised',
  overlay:  'surface-overlay',
  luminous: 'surface-luminous',
} as const;

export function Card({ variant = 'leaf', className, children, ...rest }) {
  return (
    <div className={cn('p-6', SURFACE_CLASS[variant], className)} {...rest}>
      {children}
    </div>
  );
}
```

---

## 嵌套规则

- **不允许嵌套 surface**。`surface-leaf` 里放 `surface-leaf` → 视觉糊成一片,禁止。
- **允许** `surface-leaf` 里放普通 `<div>`(无 surface)作为子块。
- **Overlay 内可以有 leaf**(命令面板是 overlay,其结果行可以是没有 surface 的简单 list item)。

---

## 光源交互(Hover)

所有 surface 的 hover 效果**不是加深底色**,而是"极光微亮"。

```css
.surface-leaf[data-interactive="true"]:hover,
a.surface-leaf:hover,
button.surface-leaf:hover {
  border-color: color-mix(in oklch, var(--aurora-1) 30%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--aurora-1) 20%, transparent),
    0 8px 24px -8px color-mix(in oklch, var(--aurora-1) 15%, transparent);
}
```

对卡片型 ArticleCard,还可以加"左侧极光光带"签名效果:
```css
.surface-leaf[data-interactive="true"]::before {
  content: '';
  position: absolute; left: 0; top: 12px; bottom: 12px;
  width: 2px;
  background: var(--aurora-1);
  opacity: 0;
  transition: opacity var(--dur-quick) var(--ease-out);
  border-radius: 2px;
}
.surface-leaf[data-interactive="true"]:hover::before {
  opacity: 1;
  box-shadow: 0 0 8px var(--aurora-1);
}
```

---

## 迁移表(详见 07-migration.md)

| 旧类 | 新类 |
|:---|:---|
| `.glass` | `.surface-leaf` |
| `.glass-high` | `.surface-raised` |
| `.glass-premium` | `.surface-overlay` |
| `bg-white/5 backdrop-blur-2xl border border-white/10` | `.surface-leaf` |
| `bg-black/40 backdrop-blur-sm` | `.surface-leaf`(如在文档流)或 `.surface-raised` |

---

## 禁忌

1. ❌ 在 JSX 里直接写 `backdrop-blur-*` + `bg-*` 组合(必须用 `.surface-*`)
2. ❌ 创造第五种 surface
3. ❌ 在单一视图中使用三种及以上 surface 层级
4. ❌ 嵌套相同 surface
5. ❌ 给 `.surface-luminous` 当普通容器用(它是稀有元素)
