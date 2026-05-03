# Legacy 设计语言 · "Cognitive Elegance"

> ⚠️ **此设计层已废弃**，被 Aether Codex 取代（见 `00-manifesto.md`）。
> 旧 token（`.glass`、`--color-primary`、`--text-primary`、`bg-white/5`、`border-white/10`、`from-indigo-500 to-purple-600` 等）暂未删除，sunset 日期 **2026-07-17**（见 `deprecations.json`）。
>
> **新代码不得引用本文件中的任何样式。** 修改 legacy 组件时，须在同一 commit 中迁移到 Codex 标准（运行 `pnpm design-system:check` 验证）。

---

## UI 哲学
- **关键词：** Ethereal、Professional、Depth、Fluidity
- **风格：** 高端 SaaS（Linear、Raycast）+ 氛围网页（Vercel）
- **默认：** 暗色模式 + 富层次环境渐变
- **品牌：** 内敛奢华，避免「游戏化」霓虹，倾向极光软光晕

## 色板（暗色主题）
- **背景：** `#09090b`（Zinc-950）或 `#0a0a0c`
- **卡片层 1：** `bg-white/5` 或 `bg-black/40`
- **卡片层 2：** `bg-white/10`
- **边框：** `border-white/5` 或 `border-white/10`（克制）
- **强调色：** `from-indigo-500 to-purple-600`（Aether 渐变）
- **文字：** 标题 `text-white`，正文 `text-slate-400`，高亮 `text-slate-200`

## 组件模式

**Glass Cards（标准容器）：**
```tsx
<div className="relative bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden">
  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
  <div className="relative z-10">{/* Content */}</div>
</div>
```

**环境背景（页面级）：**
```tsx
<div className="absolute inset-0 overflow-hidden pointer-events-none">
  <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse" />
  <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]" />
</div>
```

## 动效标准（Framer Motion）
- 使用弹簧物理或自定义 bezier：`transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}`
- 列表项必须使用 stagger 动画
- Hover 效果：轻微抬起 `y: -2` 或缩放 `scale: 1.01`

## 加载体验
- **禁止：** 简单 spinner（全屏或局部）
- **要求：** 与最终布局匹配的骨架屏 + shimmer/pulse 效果
- **配色：** `bg-white/5` + 克制边框
- **目标：** 零延迟感知，无内容跳动

---

## 迁移到 Aether Codex 速查

| Legacy | Codex 替代 |
| --- | --- |
| `bg-white/5 backdrop-blur-2xl border border-white/10` | `.surface-leaf` |
| 顶栏 / 侧栏 / sticky | `.surface-raised` |
| Modal / Auth 卡 | `.surface-overlay` |
| 单页 ≤1 张签名卡 | `.surface-luminous` |
| `from-indigo-500 to-purple-600` | `var(--aurora-1..4)` + `color-mix(in oklch, ...)` |
| `text-white` / `text-slate-400` | `var(--ink-primary)` / `var(--ink-secondary)` |
| `border-white/10` | `var(--border-default)` |
| 自写 cubic-bezier | `import { spring, transition } from '@aetherblog/ui'` |
| `dark:` 变体 | 删除，token 通过 `:root.light` 自动翻转 |
