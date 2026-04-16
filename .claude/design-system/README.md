# AetherBlog · Aether Codex 设计系统

> 一部悬浮在夜空中的发光典籍。

本目录是 AetherBlog 视觉系统的**单一真源(Single Source of Truth)**。所有涉及 UI、排印、色彩、动效、玻璃表面的决策都在这里收敛。

---

## 目录导读

| 文档 | 读它当你... |
|:---|:---|
| [00-manifesto.md](./00-manifesto.md) | 想理解"为什么是这套设计",想讲给团队听 |
| [01-tokens.md](./01-tokens.md) | 要新加一个颜色/字号/圆角,先来查有没有 |
| [02-surfaces.md](./02-surfaces.md) | 要做卡片/弹层/侧栏,分不清用哪种玻璃 |
| [03-typography.md](./03-typography.md) | 排印、字号、行高、中西文混排、代码字体 |
| [04-motion.md](./04-motion.md) | 做动画,不知道用哪条曲线、哪个时长 |
| [05-components.md](./05-components.md) | 开发新组件,查现有 Button/Card/Input/Modal 规约 |
| [06-signature-moments.md](./06-signature-moments.md) | Hero、文章页、命令面板、Admin 控制室、AI 工坊 5 个签名场景 |
| [07-migration.md](./07-migration.md) | 旧代码里 `.glass` / `bg-white/5` 怎么迁移到新 surfaces |

---

## 与 CLAUDE.md、`.agent/rules/` 的关系

```
CLAUDE.md                  ——  顶层工程守则(栈版本、命令、流程)
├── .agent/rules/           ——  代码结构、命名、行为规约
│   ├── code-design.md      ——  文档驱动开发流程
│   ├── code-structure.md   ——  包结构、tsconfig 模板
│   └── ui_rules.md         ——  UI 组件位置规则(与本目录互补)
│
└── .claude/design-system/   ——  视觉系统规约(本目录)
    ├── 00..07.md           ——  视觉决策、token、模式
    └── ...
```

- **`.agent/rules/ui_rules.md`** 规定"UI 组件**放在哪里**"(packages/ui vs apps/)
- **`.claude/design-system/`** 规定"UI 组件**长什么样**"(token、surface、motion、排印)

两者互不重叠。若发生冲突,以本目录为准。

---

## 核心原则(Non-negotiable)

1. **一个光源**:全站只有一处极光作为主光源(博客首页左上、admin 左上)。所有 surface 响应它。
2. **四层玻璃,不多不少**:`surface-leaf / raised / overlay / luminous`,见 [02-surfaces.md](./02-surfaces.md)。
3. **九级字号,不准越级**:见 [03-typography.md](./03-typography.md)。禁止在 JSX 内直接写 `text-5xl`。
4. **一条动效曲线**:`cubic-bezier(0.16, 1, 0.3, 1)`。其他曲线需在 PR 中说明理由。
5. **象牙色,不是纯白**:暗主题主文字 `#F4EFE6`,不用 `#FFFFFF`。这一条直接决定了整站气质。
6. **极光是光源,不是装饰**:禁止到处撒渐变。极光应该"照"到的地方才亮。
7. **中文段落启用 `text-wrap: pretty`**:避免孤字,出版物质感。

---

## 使用方式

### 我要写一个新组件
1. 打开 [05-components.md](./05-components.md) 看是否已有同类模式
2. 引入 `packages/ui` 已导出的 Primitive(Button/Card/Modal)
3. surface 选择走 [02-surfaces.md](./02-surfaces.md) 决策树
4. 动效引用 `@aetherblog/ui/motion` 预设,禁止自造 bezier
5. 字号只用 `text-display / text-h1..h4 / text-lede / text-reading / text-body / text-caption / text-micro`

### 我要改一个现有组件的颜色
1. 打开 [01-tokens.md](./01-tokens.md) 查颜色语义
2. 若是警告/信号 → 用 `--signal-*`
3. 若是文字 → 用 `--ink-*`(暗)或 `--text-*`(兼容旧)
4. 若是光源/重点 → 用 `--aurora-*`
5. 禁止直接写 hex 码

### 我要迁移旧代码
查 [07-migration.md](./07-migration.md),里面有 `.glass → .surface-leaf`、`text-white → text-[var(--ink-primary)]` 等映射表。

---

## 版本

- **v1.0** · 2026-04-15 · Aether Codex 设计主张首次发布
- 后续变更记录在 CHANGELOG.md,任何 Design Token 增删改都应进入该文件

---

**维护者约定:** 这个目录不是写完就扔的文档,它**必须**随代码变更同步更新。新增 token、新增 surface、改动动效曲线 —— 先改这里,后改代码。代码是规范的实现,规范是代码的合同。
