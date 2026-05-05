# 灵境（移动端）对齐差距分析报告

> 范围：`apps/blog/app/agent/workspace`（已上线 Chat 模式）的移动端体验。
> 基线：2026-05-05 当前实现，对照真机测试（iPhone 13 mini / 320×568、iPhone 15 Pro / 393×852）。

## 1. 目标

- **从"基础可用"升级到"产品级单手操作"**：移动端工作台在 320–430px 屏宽下，关键控件（新建、发送、模型切换、停止）单手可达、触控区 ≥40×40，信息密度受控。
- **品牌心智收敛为「灵境」**：所有用户可见的文案（顶栏 caption、底栏脚注、Empty state mono prefix、Sidebar wordmark）从内部代号 "Agent" 升级为产品名「灵境」。代码注释、技术档名仍可保留 `agent/` 路径以维持文件路由稳定。
- **修复"模型选择不生效"的核心 bug**：在 EmptyState（无活跃会话）下切换模型，输入文本发送后，请求 payload 中的 `modelId/providerCode` 必须与用户选择一致。

## 2. 现状差距 — 6 维度盘点

### 2.1 模型选择不生效（核心 bug）

**现象**：用户在 EmptyState 打开模型下拉，从"自动选择"切到 `gpt-5.5`，关闭下拉后看到按钮文字仍是"自动 · gpt-5.4"，输入文本发送，后端用的还是默认模型。

**根因定位**：
- `WorkspaceClient.tsx` `handleModelChange` 第 230 行：`if (!activeId) return;` —— EmptyState 下 `activeId === null`，整个 handler 直接 return，连 `sessionModelOverride` 都没更新。
- `ModelPicker.tsx` 的 `value` prop 来源于 `activeSession?.modelId`（第 798 行），EmptyState 下 `activeSession` 是 `null`，画面只能落到"自动 · 默认模型"显示。
- `handleSend` 创建新 session 时（第 261-273 行），对象 literal 没有读取 `sessionModelOverride`，新 session 的 `modelId/providerCode` 隐式是 undefined。

**期望行为**：用户在 EmptyState 选 `gpt-5.5` 后，立刻被持久化到一个独立的"待发送 override"状态；进入发送时，无论 session 是新建的还是既有的，请求 payload 都带上这个 override。

### 2.2 移动端顶栏布局拥挤

**现象（iPhone 13 mini / 320px 屏宽实测）**：
- 左侧塞了：hamburger（36px）+ 桌面 collapse（hidden md:）+ 返回博客（hidden lg:）+ 标题（max-w-42vw ≈ 134px）+ mono caption "Agent · chat"。
- 右侧塞了：ModeSwitch（segmented 三档 ≈ 200px）+ ThemeToggle（28px）。
- 实际可用：320 - 36(hamburger) - 200(ModeSwitch) - 28(theme) - 12(gaps) = **44px 给标题** —— 标题被截到只剩 2-3 个汉字。

**根因**：ModeSwitch 在桌面端是合理的顶栏控件（chat 已上线、cowork/code 锁定 + InfoPopover 教育），但在移动端横向占用过多。当前没有响应式策略。

**期望**：
- 移动端隐藏 ModeSwitch（移到 hamburger 后的 drawer 顶部，或 Composer "+" overflow menu）。
- 顶栏右侧改为「+ 新建会话」一键按钮（移动端最高频操作），ThemeToggle 也下放到 drawer。
- 标题可见区扩大到 ≥150px。

### 2.3 Composer 移动端工具区拥挤

**现象**：Composer 底部工具行从左到右依次是：ModelPicker（max-w-200px）+ 分隔线 + @ 引用（28px）+ # 标签（28px）+ / 命令（28px）+ 麦克风（28px，disabled）+ 提示文案（hidden lg:）+ Maximize（hidden sm:）+ 发送/停止（36px）。

- iPhone 13 mini 上：ModelPicker 实际占 ≈140px（"模型 · 自动 · gpt-5.4"已截断）+ 4 个工具按钮 ≈ 124px + 发送 36px = **300px**，gap ≈20px → 总宽 320px 几乎贴满。
- 工具按钮 `w-7 h-7 = 28px` —— **低于 Apple HIG 的 44×44 触控目标**，密集排列时极易误触。

**根因**：现有 Composer 一刀切桌面 / 移动端，没有为单手操作场景做收纳。

**期望**：
- 移动端把 @ # / 三个工具按钮收纳到一个「+」overflow toggle，点击展开纵向 sheet 选择，不抢占主行宽度。
- 工具按钮触控区 28→40px（移动端 only）。
- 主行只保留：「+」工具菜单 + ModelPicker（精简文案）+ 发送/停止 + 麦克风（如启用）。

### 2.4 ModelPicker 文案在紧凑模式下溢出

**现象**：`<ModelPicker compact />` 当前显示 "模型 · 自动 · gpt-5.4 ▾"。
- "模型 · " 是当前 PR 加的"强化感知"前缀；
- "自动 · " 是 `currentLabel` 在 `value.modelId === null` 时的兜底；
- "gpt-5.4" 是默认模型 displayName。

三段叠加在 max-w-200px 容器里几乎必截断，触发按钮的实际识别度反而降低。

**根因**：前缀 "模型 · " 是冗余信息（按钮的 icon + dropdown 形态本就暗示"这是模型选择"），不需要再用文字标注。

**期望**：
- 紧凑模式按钮文案：仅显示当前生效模型的 displayName（"gpt-5.4" / "Claude Opus 4.7"），无任何前缀。
- 触发按钮左侧 icon 用 `Cpu` 提供视觉锚点；ChevronDown 提供"可点开"暗示。
- 当 `value.modelId === null`（自动模式）时，显示 displayName 但前面带一个 `自动 · ` mono caption（仅在自动状态下用，不与"模型 · " 并列）。

### 2.5 触控可达性

**问题盘点**：
| 控件 | 当前尺寸 | HIG 红线 | 修正策略 |
|------|---------|---------|---------|
| Composer ToolButton（@/#//mic） | 28×28 | 44×44 | 移动端 40×40，桌面端保持 28（hover 友好） |
| Sidebar SessionMenu trigger（…） | 20×20 (p-1 + 14px icon) | 44×44 | 移动端 36×36 |
| ModelPicker 紧凑触发按钮 | h-7 = 28 高 | 44 | 移动端 h-9 = 36 |
| 顶栏 hamburger | 36×36 | 44×44 | 已接近，调到 40×40 |
| 顶栏 ThemeToggle 区 | sm: 起显，移动端隐藏 | — | 下放到 Sidebar drawer |

**根因**：Composer / Sidebar 设计时偏向桌面 hover 形态，移动端没单独 sizing 表。

### 2.6 信息层级与品牌一致性

**品牌现状盘点（grep "Agent" 结果）**：
- ✅ `page.tsx` 第 6 行 `title: '工作台 · 灵境'`（已改）
- ❌ `WorkspaceClient.tsx` 第 720 行 顶栏 mono caption `Agent · {mode}`
- ❌ `WorkspaceClient.tsx` 第 816 行 底栏脚注 `Agent 可能出错 · 关键决定请二次核对`
- ❌ `WorkspaceClient.tsx` 第 874 行 EmptyState `{siteTitle.toUpperCase()} · AGENT`
- ❌ `Sidebar.tsx` 第 119 行 wordmark `<span className="aurora-text">Agent</span>`
- ❌ `ModeSwitch.tsx` 第 32 行 chat oneLiner `'同步问答 Agent · 已上线'`

**信息层级现状**：
- 顶栏 caption "Agent · chat" 用英文，断了与中文品牌的连续性。
- mode 字面值 `chat / cowork / code` 在 UI 直接显示，未做中文化（虽然 Cowork/Code SOON 是英文有产品考量，但 chat 在中文语境应作"对话"或"chat"二选一保持一致性）。

**期望**：
- 所有用户可见 "Agent" 文本（顶栏、底栏、wordmark、空态）→ "灵境"。
- mono caption 形态保留（小字 + 字距 + uppercase / mixed-case），便于设计系统统一。
- ModeSwitch 字面 `Chat / Cowork / Code` 不动（工程标识 + SOON 徽标已传达"产品 mode"语义）。

## 3. 不动的部分（避免 scope 蔓延）

- **ModeSwitch 三模式定位**：`docs/agent/README.md` 已锁定，本次不重排。
- **Sidebar 桌面端布局**：280px 常驻 + 折叠按钮已成熟，本次只为移动端 drawer 增强。
- **MessageBubble、流式 rAF 平滑、@/#// picker 弹层逻辑**：均为成熟模块，本次不动。
- **后端 `/api/v1/agent/models`、`/api/v1/agent/chat`**：本次纯前端改动，后端 schema 不变。

## 4. 验收标准

### 4.1 功能正确性
- [ ] EmptyState 选 `gpt-5.5` → 立刻输入 "测试" → 发送，DevTools Network payload 中 `modelId: "gpt-5.5"`、`providerCode` 与所选 provider 一致。
- [ ] 切换会话时，sessionModelOverride 正确同步到目标会话的 modelId/providerCode。
- [ ] 已自定义模型的会话再次进入，ModelPicker 高亮显示该模型。

### 4.2 移动端布局（iPhone 13 mini / 320px 实测）
- [ ] 顶栏：hamburger + 标题（≥150px 可见区）+ "+" 新建 三件套，无截断。
- [ ] Composer：单行高度 ≤96px（textarea + 工具行），主行只有「+」菜单、ModelPicker、发送，无横向溢出。
- [ ] 工具按钮触控区 ≥40×40。
- [ ] 切换 ModelPicker、点 "+" overflow menu，弹层不被键盘遮挡。

### 4.3 品牌一致性
- [ ] grep `\bAgent\b` 在 `apps/blog/app/agent/workspace/**/*.tsx` 中只命中代码符号（变量名 / 类型名），不出现在用户可见 JSX 文本里。
- [ ] 顶栏 caption、底栏脚注、Empty mono prefix 三处显示「灵境」。
- [ ] Sidebar wordmark 显示「灵境」，aurora-text 着色保留。

### 4.4 工程红线
- [ ] `pnpm --filter @aetherblog/blog typecheck` 通过 (0 error)。
- [ ] `pnpm design-system:check` 0 error（保留 warning / info）。
- [ ] 不引入裸色（`#xxx` / `rgb()`）、不写 `dark:` 变体（Codex token 已自翻转）。
- [ ] 不引入新依赖。
