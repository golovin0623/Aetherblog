

# 🎨 AetherBlog 主题配色标准 (v1.0)

> **来源**: PR #293 (`c5db32e`) — 2026-03-14 固化
> **设计理念**: 亮色走 Apple 式极简黑灰，暗色走精致紫罗兰 — 双人格主题

---

## 设计预览

| 亮色主题 | 暗色主题 |
|:---------|:---------|
| ![Light Theme](.agent/rules/assets/light-theme-preview.png) | ![Dark Theme](.agent/rules/assets/dark-theme-preview.png) |

---

## 1. 核心色彩对照表

### 1.1 品牌色系统 (`--color-primary` 族)

| 变量 | ☀️ 亮色 (Light) | 🌙 暗色 (Dark) | 说明 |
|:-----|:----------------|:---------------|:-----|
| `--color-primary` | `#18181b` (Zinc 900) | `#818cf8` (Indigo 400) | 主色 |
| `--color-primary-hover` | `#27272a` (Zinc 800) | `#a5b4fc` (Indigo 300) | 悬停态 |
| `--color-primary-light` | `#52525b` (Zinc 600) | `#c7d2fe` (Indigo 200) | 浅变体 |
| `--color-primary-lighter` | `#e4e4e7` (Zinc 200) | `#e0e7ff` (Indigo 100) | 最浅变体 |
| `--color-accent` | `#3f3f46` (Zinc 700) | `#a78bfa` (Violet 400) | 渐变终点色 |

> [!IMPORTANT]
> **亮色 primary = 黑色系 (Zinc)，暗色 primary = 紫色系 (Indigo)**。这是 AetherBlog 的核心视觉差异化。

### 1.2 辅助强调色

| 变量 | ☀️ 亮色 | 🌙 暗色 |
|:-----|:--------|:--------|
| `--color-accent-blue` | `#3b82f6` | `#3b82f6` |
| `--color-accent-green` | `#10b981` | `#10b981` |
| `--color-accent-orange` | `#f59e0b` | `#f59e0b` |
| `--color-accent-purple` | `#52525b` (Zinc 600) | `#a78bfa` (Violet 400) |

> [!WARNING]
> 亮色主题下 `--color-accent-purple` **不是紫色**，而是 Zinc 600 中性灰。禁止在亮色模式下使用任何紫色调。

---

## 2. 渐变系统

### 2.1 主渐变

| 变量 | ☀️ 亮色 | 🌙 暗色 |
|:-----|:--------|:--------|
| `--gradient-primary` | `135deg, #18181b → #3f3f46` | `135deg, #818cf8 → #a78bfa` |
| `--decoration-gradient` | `90deg, #18181b → #3f3f46 → #52525b` | `90deg, #818cf8 → #a78bfa → #c084fc` |

### 2.2 组件渐变写法

```tsx
// ✅ 正确：使用语义 token，自动响应主题
<div className="bg-gradient-to-r from-primary to-accent" />

// ❌ 禁止：硬编码颜色值
<div className="bg-gradient-to-r from-indigo-500 to-purple-500" />
<div className="bg-gradient-to-r from-primary to-purple-500" />
<div className="bg-gradient-to-r from-primary to-purple-600" />
```

> [!CAUTION]
> **`to-purple-*` 已全面废弃。** 所有渐变终点必须使用 `to-accent`。

---

## 3. 阴影系统

| 变量 | ☀️ 亮色 | 🌙 暗色 |
|:-----|:--------|:--------|
| `--shadow-primary` | `rgba(24, 24, 27, 0.15)` | `rgba(129, 140, 248, 0.25)` |
| `--shadow-primary-lg` | `rgba(24, 24, 27, 0.2)` | `rgba(129, 140, 248, 0.35)` |
| `--focus-ring` | `rgba(24, 24, 27, 0.3)` | `rgba(129, 140, 248, 0.5)` |

```tsx
// ✅ 正确：使用语义阴影
<div className="shadow-[var(--shadow-primary)]" />
<div className="shadow-primary/20" />  // Tailwind opacity

// ❌ 禁止：硬编码 indigo 阴影
<div className="shadow-indigo-500/20" />
```

---

## 4. Tailwind 配置 Token 映射

`tailwind.config.ts` 中定义了以下语义 token，**所有组件必须使用这些 token**：

```typescript
colors: {
  primary: {
    DEFAULT: 'var(--color-primary)',      // 主色
    hover:   'var(--color-primary-hover)', // 悬停
    light:   'var(--color-primary-light)', // 浅色
    lighter: 'var(--color-primary-lighter)', // 最浅
  },
  accent: {
    DEFAULT: 'var(--color-accent)',        // 渐变终点 & 辅助强调
  },
}
```

> [!IMPORTANT]
> 已移除旧的 `primary-50`, `primary-500`, `primary-600` 硬编码色阶。禁止使用 `primary-500` 等数字色阶。

---

## 5. 组件配色规则

### 5.1 按钮 (Buttons)

```tsx
// 主按钮 — 渐变模式
<button className="bg-gradient-to-r from-primary to-accent text-white" />

// 主按钮 — 纯色模式
<button className="bg-primary text-white hover:bg-primary-hover" />

// 次级按钮
<button className="border border-[var(--border-default)] text-[var(--text-primary)]" />
```

### 5.2 标签/徽章 (Badges)

```tsx
// 分类标签
<span className="bg-gradient-to-r from-primary to-accent text-white text-[10px] rounded-full" />
```

### 5.3 标题悬停渐变

```tsx
// 标题 hover 渐变变色
<h2 className="group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-accent
               group-hover:bg-clip-text group-hover:text-transparent" />
```

### 5.4 装饰条/时间线

```tsx
<div className="bg-gradient-to-b from-primary to-accent rounded-full" />
```

### 5.5 Logo

```tsx
<div className="bg-gradient-to-br from-primary to-accent text-white rounded-lg" />
```

### 5.6 头像光效

```tsx
// ☀️ 亮色：无彩色光效，仅悬浮阴影
// 🌙 暗色：保留紫色渐变光晕
<div className="bg-gradient-to-tr from-primary/40 via-accent/40 to-primary/40" />
```

---

## 6. Hero 按钮特殊规则

Hero 按钮在暗色模式下使用 **独立的紫色渐变**（不走 CSS 变量），以获得更精致的效果：

```css
/* 暗色 Hero 按钮 */
:root.dark .hero-primary-btn {
  background: linear-gradient(135deg, #6366f1 0%, #7c3aed 50%, #8b5cf6 100%);
  box-shadow:
    0 4px 16px rgba(129, 140, 248, 0.25),
    0 8px 32px rgba(124, 58, 237, 0.15);
}

:root.dark .hero-primary-btn:hover {
  background: linear-gradient(135deg, #818cf8 0%, #8b5cf6 50%, #a78bfa 100%);
}
```

> [!NOTE]
> Hero 按钮是目前唯一允许硬编码紫色值的组件。其他组件必须走 `primary` / `accent` 变量。

---

## 7. Markdown 配色

| 变量 | ☀️ 亮色 | 🌙 暗色 |
|:-----|:--------|:--------|
| `--markdown-text-code` | `#18181b` | `#a78bfa` |
| `--markdown-border-quote` | `#18181b` | `#818cf8` |

---

## 8. 禁止清单 (Anti-Patterns)

| ❌ 禁止写法 | ✅ 正确替代 | 原因 |
|:------------|:-----------|:-----|
| `from-indigo-500` | `from-primary` | 亮色下主色非 indigo |
| `to-purple-500` / `to-purple-600` | `to-accent` | 必须通过变量随主题切换 |
| `shadow-indigo-500/20` | `shadow-primary/20` | 阴影色需跟随主色 |
| `text-indigo-400` | `text-primary-light` | 使用语义 token |
| `primary-500` / `primary-600` | `primary` / `primary-hover` | 已移除数字色阶 |
| `border-indigo-500` | `border-primary` | 边框色需主题感知 |
| `bg-purple-500/10` (在非 Hero 组件) | `bg-accent/10` | 统一走 accent |
| `rgba(99, 102, 241, *)` 硬编码 | CSS 变量 | 旧 Indigo 500 色值 |

---

## 9. 新增组件开发检查清单

开发新组件时，必须验证以下事项：

- [ ] 所有渐变使用 `from-primary to-accent`，不含硬编码颜色
- [ ] 阴影使用 `shadow-[var(--shadow-primary)]` 或 `shadow-primary/*`
- [ ] 彩色边框使用 `border-primary` 而非 `border-indigo-*`
- [ ] 文字强调色使用 `text-primary` 或 `text-primary-light`
- [ ] Focus ring 使用 `ring-primary` 或 `--focus-ring` 变量
- [ ] **亮色模式下无紫色元素**（切换到 light 主题验证）
- [ ] **暗色模式渐变使用 Indigo→Violet 光谱**

---

---

## 10. @lobehub/icons 集成规范（2026-04-04）

### 10.1 使用场景

`@lobehub/icons` 专用于 AI 供应商品牌图标（OpenAI, Anthropic, Google, Azure 等），不可用于通用 UI 图标。

```tsx
// ✅ 正确：AI 供应商图标使用 @lobehub/icons
import { OpenAI, Anthropic, Google } from '@lobehub/icons';

// ✅ 正确：通用 UI 图标使用 lucide-react
import { Settings, ChevronRight } from 'lucide-react';

// ❌ 禁止：用 Emoji 代表 AI 供应商
// ❌ 禁止：自定义 SVG 替代官方品牌图标
```

### 10.2 图标色彩规范

- `@lobehub/icons` 图标保留品牌原色（不随 primary/accent token 变化）。
- 在暗色主题下，部分图标自动调整亮度，无需手动覆盖颜色。
- 图标容器背景使用 `bg-white/5` 或 `bg-[var(--bg-card)]`，保持一致的毛玻璃风格。

### 10.3 版本约束

| 包 | 版本 | 说明 |
|:---|:-----|:-----|
| `@lobehub/icons` | `4.1.0` | 固定版本，升级需测试所有 ProviderIcon 显示 |

---

## CHANGELOG

- `v1.0` (2026-03-14): 从 PR #293 固化初版标准
- `v1.1` (2026-04-04): 补充 §10 `@lobehub/icons` 集成规范

