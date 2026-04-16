# 05 · Components · 组件模式

> 所有**可被多处复用**的 UI 组件必须居于 `packages/ui`。业务组件(只有一个页面用)放在 `apps/<app>/components/`。
>
> 本文档规定每个 Primitive 的 API、视觉、动效。偏离这里的约定等于偏离设计系统。

---

## Primitive 清单(`packages/ui`)

| 组件 | 文件 | 新 API? |
|:---|:---|:---|
| Button | `Button.tsx` | ✅ +`variant="aurora"` |
| Card | `Card.tsx` | ✅ +`variant` prop |
| Input | `components/Input.tsx` | 保留 |
| Textarea | `components/Textarea.tsx` | 保留 |
| Modal | `components/Modal.tsx` | 迁移 `.surface-overlay` |
| ConfirmModal | `components/ConfirmModal.tsx` | 迁移 |
| Toast | `components/Toast.tsx` | 迁移 `.surface-raised` |
| Badge | `components/Badge.tsx` | 保留 |
| Tag | `components/Tag.tsx` | 保留 |
| Tooltip | `components/Tooltip.tsx` | 迁移 `.surface-raised` |
| Dropdown | `components/Dropdown.tsx` | 迁移 `.surface-raised` |
| Avatar | `components/Avatar.tsx` | 保留 |
| Toggle | `components/Toggle.tsx` | 保留 |
| Skeleton | `components/Skeleton.tsx` | 保留 |

---

## Button

### API

```tsx
<Button variant="primary" size="md">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="danger">Danger</Button>
<Button variant="aurora">Aurora</Button>      {/* 新增 */}
<Button variant="dark">Dark</Button>
```

### 视觉规则

| variant | 背景 | 文字 | 边框 | Hover |
|:---|:---|:---|:---|:---|
| primary | `--ink-primary` | `--bg-void` | 无 | 降低 10% alpha |
| secondary | `--bg-leaf` | `--ink-primary` | `--ink-primary` 10% | 极光边 |
| ghost | 透明 | `--ink-secondary` | 无 | `--bg-leaf` 底 |
| danger | `--signal-danger` | white | 无 | 亮 10% |
| **aurora** | 透明 | `--aurora-1` | 1px 极光 | 填充极光 10% |
| dark | black | white | 无 | - |

### 动效

- `whileTap={{ scale: 0.97 }}` + `spring.precise`
- focus-visible:`--focus-ring`
- loading:`<Loader2 />` 不变,但加 `--dur-instant` transition

---

## Card

### API

```tsx
<Card variant="leaf" padding="md">
  <Card.Header>
    <Card.Title>标题</Card.Title>
  </Card.Header>
  <Card.Content>内容</Card.Content>
</Card>

<Card variant="raised">...</Card>
<Card variant="overlay">...</Card>
<Card variant="luminous">...</Card>  {/* 稀有 */}

<Card variant="leaf" interactive>...</Card>  {/* hover 极光边 + 左侧光带 */}
```

### padding

| prop | rem |
|:---|:---|
| `none` | 0 |
| `sm` | 1rem(密集场景) |
| `md`(默认) | 1.5rem |
| `lg` | 2rem(Hero、主推) |

---

## Input / Textarea

### API

```tsx
<Input
  label="标题"
  placeholder="请输入..."
  size="md"
  error="..."
  helper="..."
  prefix={<Search />}
/>
```

### 视觉

- 背景:`--bg-leaf`
- 边框:`color-mix(ink-primary, 10%)`
- focus:极光边 + `--focus-ring`
- 字体:`font-sans`,禁止衬线

---

## Modal

### 视觉

- backdrop:`rgba(0,0,0,0.6)` + `backdrop-filter: blur(4px)`
- container:`.surface-overlay`,`padding: 2rem`
- `max-width: 32rem`(默认),`max-height: 85vh`
- 动效:`variants.scaleIn` + `transition.flow`
- Esc / 外部点击关闭

### 禁止

- 在 Modal 内嵌 Modal
- Modal 里放 `<Card variant="overlay">`(重复 surface)

---

## Dropdown / Tooltip

- surface:`.surface-raised`
- 箭头:CSS pseudo 元素,颜色与 surface 一致
- 动效:`scaleIn` + `transition.quick`
- 位置:Floating UI 计算,避开视口边缘

---

## DataTable(admin 专用,不在 packages/ui)

位置:`apps/admin/src/components/common/DataTable.tsx`

### 视觉规则(升级版)

- container:`.surface-leaf` + `rounded-xl`
- thead:背景透明,底部 1px `--ink-subtle` 分隔
- th:`font-mono text-caption uppercase tracking-wider` + `text-[var(--ink-muted)]`
- tr hover:**无背景色变化,改为左侧 2px 极光线**
- td:`font-sans text-body` + 数字列 `font-mono tnum`
- 分页:`surface-raised` + `font-mono`

```css
.data-table tr[data-interactive] {
  position: relative;
  transition: background-color var(--dur-quick) var(--ease-out);
}
.data-table tr[data-interactive]::before {
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 2px;
  background: var(--aurora-1);
  opacity: 0;
  transition: opacity var(--dur-quick) var(--ease-out);
}
.data-table tr[data-interactive]:hover {
  background: color-mix(in oklch, var(--aurora-1) 4%, transparent);
}
.data-table tr[data-interactive]:hover::before {
  opacity: 1;
  box-shadow: 0 0 6px var(--aurora-1);
}
```

---

## StatsCard(admin)

位置:`apps/admin/src/pages/dashboard/StatsCard.tsx`

### 结构

```tsx
<Card variant="leaf" className="stat-card">
  <div className="flex items-start justify-between">
    <Icon className="text-[var(--aurora-1)]" />
    <Trend direction="up" value="+12%" />
  </div>
  <div className="mt-4">
    <div className="stat-number font-display text-h1">{value}</div>
    <div className="text-caption font-mono uppercase text-[var(--ink-muted)] mt-1">
      {label}
    </div>
  </div>
</Card>
```

### 特色

- 数字用 Fraunces Variable(`font-display`)
- hover:WONK 轴 0→1(见 [03-typography.md #StatsCard 数字微扭](./03-typography.md#statscard-数字微扭wonk-轴))
- 趋势 badge 使用 `--signal-success` / `--signal-danger`

---

## ArticleCard(blog)

位置:`apps/blog/app/components/ArticleCard.tsx`

### 结构

```tsx
<Link className="article-card surface-leaf" data-interactive>
  <div className="cover aspect-video rounded-t-lg overflow-hidden">
    <Image ... />
  </div>
  <div className="body p-5">
    <div className="metadata text-caption font-mono uppercase tracking-wider text-[var(--ink-muted)]">
      <span>{category}</span> · <time>{date}</time> · <span>{readingTime} min</span>
    </div>
    <h3 className="title font-display text-h4 mt-2 text-[var(--ink-primary)]">
      {title}
    </h3>
    <p className="summary text-body text-[var(--ink-secondary)] mt-2 line-clamp-3">
      {summary}
    </p>
    <div className="tags mt-4">
      {tags.slice(0, 3).map(...)}
    </div>
  </div>
</Link>
```

### 规则

- 容器 `.surface-leaf[data-interactive]`,hover 出现左侧极光光带
- 元信息用 mono(与 marginalia 呼应)
- 标题 Fraunces,限 2 行
- 摘要 Geist,限 3 行
- 密码保护贴纸用 `--signal-warn`(不是 amber)

---

## Badge / Tag

- `.surface-leaf` 底 + 1px border
- `font-mono` + `text-caption` + `uppercase`
- padding:`0.2em 0.6em`
- variants:`default | aurora | info | success | warn | danger`

---

## Loading · Skeleton(禁止 spinner)

**禁止** `<Loader2 className="animate-spin" />` 作为页面级/块级加载态。

页面/块级必须用 Skeleton:

```tsx
<Skeleton shape="text" lines={3} />
<Skeleton shape="card" />
<Skeleton shape="avatar" size="md" />
<Skeleton shape="image" aspect="video" />
```

实现用 shimmer 动画:

```css
@keyframes shimmer-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.skeleton {
  position: relative;
  overflow: hidden;
  background: color-mix(in oklch, var(--ink-primary) 4%, transparent);
  border-radius: var(--radius-md);
}
.skeleton::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(90deg,
    transparent,
    color-mix(in oklch, var(--aurora-1) 10%, transparent),
    transparent);
  animation: shimmer-sweep 1.8s var(--ease-in-out) infinite;
}
```

**唯一例外:** 按钮内 inline loading 可以继续用 `<Loader2 />`(很小,不占空间)。

---

## 空态 · Empty State

统一的视觉语言:

```tsx
<div className="empty-state">
  <Icon className="empty-icon" />  {/* size 48, --ink-muted */}
  <h3 className="empty-title font-display">这里空空如也</h3>
  <p className="empty-hint text-body text-[var(--ink-muted)]">说明文字</p>
  <Button variant="aurora" size="sm">CTA</Button>
</div>
```

- 居中,`padding: 6rem 2rem`
- Icon 用稍淡的极光色 tint

---

## Form

### Label + Input 节奏

```tsx
<label className="form-field">
  <span className="form-label">
    标题
    <span className="form-required">*</span>
  </span>
  <Input ... />
  <span className="form-helper">可选的辅助说明</span>
</label>
```

- label:`font-sans text-caption font-medium uppercase tracking-wider text-[var(--ink-secondary)]`
- required 星号:`--signal-danger`
- helper:`text-caption text-[var(--ink-muted)]`
- error 状态:input 边框 `--signal-danger`,helper 变 `--signal-danger`

### 字段间距:1.25rem · `space-y-5`

### 提交区域永远在右侧

```tsx
<div className="form-actions flex justify-end gap-3 pt-6 border-t border-[var(--ink-subtle)]">
  <Button variant="ghost">取消</Button>
  <Button variant="primary">保存</Button>
</div>
```

---

## Navigation · Sidebar(admin)

- `.surface-raised`
- 导航项 `padding: 0.6rem 1rem`
- 激活:**左侧 2px 极光线** + 文字 `--ink-primary`(不是整块底色)
- 图标 `--ink-muted`,激活时 `--aurora-1`
- 折叠态:只显图标,Tooltip 悬停出现

---

## Header(blog)

- `.surface-raised` + `sticky top-0`
- 底部 1px 极光渐变分隔线:
  ```css
  .blog-header::after {
    content: '';
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg,
      transparent 0%,
      color-mix(in oklch, var(--aurora-1) 40%, transparent) 50%,
      transparent 100%);
  }
  ```

---

## 禁忌

1. ❌ 在 `apps/<app>/components/` 创建与 `packages/ui` 重复的 Primitive
2. ❌ 给 Primitive 加上业务逻辑(如 Button 里调 fetch)
3. ❌ 通过 `className` 覆盖 Primitive 的核心视觉(如强制 Button 背景色)
4. ❌ 创建"一次性" Modal 变体(所有 Modal 必须走 `@aetherblog/ui` 的 Modal)
5. ❌ 自写 loading spinner
6. ❌ 浏览器原生 `confirm()` / `alert()`(必须用 ConfirmModal)
