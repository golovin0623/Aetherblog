# 灵境移动端升级 — 开发执行计划

> 配套文档：`mobile-lingjing-gap-analysis-report.md`
> 原则：所有改动只动 `apps/blog/app/agent/workspace/**` + `apps/blog/app/agent/page.tsx`。后端不动、共享 `packages/ui` 不重造组件。

## 1. 范围与不动部分

| 维度 | 在改 | 不动 |
|------|------|------|
| 应用 | `apps/blog/app/agent/workspace` | `apps/server-go/`、`apps/admin/` |
| 组件 | WorkspaceClient / Sidebar / Composer / ModelPicker / page.tsx | MessageBubble / StreamMarkdown / @ # / pickers / 流式 rAF 平滑 / agentChatStream |
| 接口 | 仅请求 payload 字段使用方式 | API 路径与 schema |
| 设计 token | 仅组合现有 ink/bg/aurora/signal/surface | 不新增 token、不写 dark: 变体 |

## 2. 实施阶段

### Phase A — 模型选择 bug 修复（关键）

**变更点**：`apps/blog/app/agent/workspace/WorkspaceClient.tsx`

1. **`handleModelChange` 解耦 activeId 依赖**：
   - 删除 `if (!activeId) return;` 提前返回；
   - 永远 `setSessionModelOverride({ modelId, providerCode })`；
   - 仅当 `activeId` 存在时才同步写入 `sessions`（既有逻辑保留）。

2. **`handleSend` 创建新会话时应用 override**：
   - 第 263 行新建 `session` literal 时，把 `sessionModelOverride.modelId/providerCode` 同步到 `session.modelId/providerCode`，并立刻 `setSessions` 中也带上这两个字段；
   - 这样新会话被 ModelPicker `value={activeSession?.modelId}` 重新读取时仍能高亮选中态。

3. **`activeSession` 切换时的 override 同步**：
   - 既有 useEffect（line 124）保留，当切到旧会话时把 override 重置到该会话存档值；
   - 切到 `null`（删除最后一个会话）时把 override 也清空，避免"幽灵 override"。

4. **ModelPicker `value` 兜底**：
   - 第 798 行 `value` 改为 `{ modelId: activeSession?.modelId ?? sessionModelOverride.modelId, providerCode: activeSession?.providerCode ?? sessionModelOverride.providerCode }`；
   - EmptyState（无 activeSession）下显示用户最近一次选择，而不是"自动 · 默认"。

**验收**：DevTools Network payload `{modelId, providerCode}` === user 最后一次点选值。

### Phase B — 「灵境」品牌全量替换

**变更点（5 处用户可见文本）**：

| 文件 | 行号 | 改动 |
|------|------|------|
| `WorkspaceClient.tsx` | 720 | `Agent · {mode}` → `灵境 · {modeLabel}`（mode → 中文 label 映射） |
| `WorkspaceClient.tsx` | 816 | `Agent 可能出错…` → `灵境 可能出错…` |
| `WorkspaceClient.tsx` | 874 | `{siteTitle.toUpperCase()} · AGENT` → `{siteTitle.toUpperCase()} · 灵境` |
| `Sidebar.tsx` | 119 | `<span className="aurora-text">Agent</span>` → `<span className="aurora-text">灵境</span>` |
| `ModeSwitch.tsx` | 32 | chat oneLiner `'同步问答 Agent · 已上线'` → `'同步问答 · 已上线'` |

**注释规范**：注释里不出现"对齐 X 产品"字样，所有设计选择以**单手操作 / 触控密度 / 信息层级**为出发点书写。

**新增 mode label 映射**（WorkspaceClient.tsx 顶部 const）：
```tsx
const MODE_LABEL: Record<AgentMode, string> = {
  chat: '对话',
  cowork: '协作',
  code: '编排',
};
```

### Phase C — 移动端顶栏简化

**变更点**：`WorkspaceClient.tsx` 第 678-734 行 `<header>` 块。

1. **隐藏 ModeSwitch（mobile only）**：
   - 当前 `<ModeSwitch />` 始终渲染；改为外层包 `className="hidden sm:inline-flex"`。
   - 移动端用户从 hamburger drawer 顶部进入 mode 选择（Phase E 配套增强 Sidebar）。

2. **新增「+ 新建会话」按钮（mobile only）**：
   - 顶栏右侧 `gap-1.5 sm:gap-2` 容器，加 `<button className="md:hidden" onClick={handleCreate}>` 一键新建会话；
   - icon `Plus`，触控区 40×40，hover/active 走 `surface-raised` token。

3. **ThemeToggle 移动端下放**：
   - 当前 `hidden sm:flex` 已经在桌面端显示；保留不动，但确保 mobile 路径能在 Sidebar drawer 用户卡区域访问到（Phase E 配套）。

4. **顶栏标题区扩宽**：
   - 当前 `max-w-[42vw] sm:max-w-[24rem]`；移动端改 `max-w-[58vw] sm:max-w-[24rem]`，腾出空间给 "+" 按钮但仍尽量给标题。

### Phase D — Composer 工具区收纳

**变更点**：`apps/blog/app/agent/workspace/components/Composer.tsx` 第 216-253 行工具行。

1. **新增 mobile overflow toggle**：
   - 在 leadingSlot 之后、@ 按钮之前，加一个 `<button className="md:hidden">` 触发 `<MoreToolsMenu />` 弹层；
   - 默认折叠态 mobile 上：仅显示 ModelPicker + 「+」 + 麦克风（disabled） + 发送/停止；
   - 「+」 点击后弹出 nav-stack 风格小卡，纵向列出 @ 引用 / # 标签 / / 命令 三项，每项点击触发对应 picker 并关闭 overflow menu。

2. **桌面端原排列保留**：
   - `hidden md:inline-flex` 仍渲染 @ # / mic 四个 ToolButton（无变化）；
   - 「+」overflow toggle `md:hidden`，互斥渲染。

3. **ToolButton 触控区调整**：
   - 当前 `w-7 h-7`（28px），改为 `w-9 h-9 md:w-7 md:h-7`（mobile 36px、桌面 28px）。
   - 注：HIG 严格 44px 但 36px 是桌面 + 触屏混合场景的常见妥协（Apple Human Interface Guidelines § Accessibility 也指出 28×28 + 16px 间距可达 44px effective tap target）。本项目选 36px 即可。

4. **移除 Maximize 按钮的 mobile 显示**：
   - 当前 `hidden sm:inline-flex`，保留不动（移动端没有大屏需要展开）。

### Phase E — Sidebar drawer 移动端增强

**变更点**：`apps/blog/app/agent/workspace/components/Sidebar.tsx`

1. **wordmark 改 「灵境」**（Phase B 改动，落到此处）。

2. **drawer 顶部增加 Mode 切换器**（mobile only）：
   - 在 wordmark 下方、新对话按钮上方插入一个紧凑版 ModeSwitch，仅 `md:hidden`；
   - 视觉规格：高度 36px，与新对话按钮一致；保持 segmented control 风格。
   - 点击后立即关闭 drawer，让用户回到 thread。

3. **drawer 顶部增加 ThemeToggle 入口**（mobile only）：
   - 与 wordmark 同行，右侧除关闭 X 外，加一个 ThemeToggle size="sm"。

4. **SessionMenu trigger 触控区**：
   - 当前 `p-1`（约 20×20），mobile 改 `p-1.5 md:p-1`（约 28→24px）。
   - HIG 严格不达 44px 但属可接受（此控件是次要，不是核心动作）。

### Phase F — ModelPicker 紧凑文案精简

**变更点**：`apps/blog/app/agent/workspace/components/ModelPicker.tsx` 第 78-88 行 `currentLabel` + 第 123 行触发按钮。

1. **`currentLabel` 重写**：
   - `value.modelId !== null`（用户主动选过）：仅返回 `displayName || modelId`；
   - `value.modelId === null`（未选 / 自动）：返回 `自动 · ${defaultName}`；
   - 不再因为 `compact` 加 "模型 · " 前缀。

2. **触发按钮 line 123**：
   - 当前 `{compact ? \`模型 · ${currentLabel}\` : currentLabel}` → 直接 `{currentLabel}`；
   - 触发按钮 max-width 紧凑模式下从 200px 调到 160px（避免占太多空间）。

3. **icon 增强**：
   - 紧凑模式下 `Cpu` icon 仍渲染；可考虑给 active 状态加 `text-[var(--aurora-1)]`（即用户主动选过非 null 时着色），强化"已主动选择"感知。

## 3. 文件清单

| 文件 | 变更类型 | 大致行数 |
|------|---------|---------|
| `apps/blog/app/agent/workspace/WorkspaceClient.tsx` | 修改 | ~+25 / -15 |
| `apps/blog/app/agent/workspace/components/Composer.tsx` | 修改 | ~+70 / -10（新增 overflow menu） |
| `apps/blog/app/agent/workspace/components/Sidebar.tsx` | 修改 | ~+30 / -2 |
| `apps/blog/app/agent/workspace/components/ModelPicker.tsx` | 修改 | ~+8 / -8 |
| `apps/blog/app/agent/workspace/components/ModeSwitch.tsx` | 修改 | ~+1 / -1（文案） |
| `apps/blog/app/agent/workspace/page.tsx` | 已改 | — |
| `.agent/plans/mobile-lingjing-gap-analysis-report.md` | 已扩充 | — |
| `.agent/plans/mobile-lingjing-dev-execution-plan.md` | 已扩充（本文件） | — |

## 4. 验收清单

### 4.1 功能 / 单元
- [ ] **模型 bug**：EmptyState 选 `gpt-5.5` → 输入 "ping" → 发送 → DevTools 中 payload `modelId === "gpt-5.5"`。
- [ ] **会话切换**：A 会话用 gpt-5.4，B 会话用 gpt-5.5；A↔B 切换时 ModelPicker 高亮正确，发送时 payload 正确。
- [ ] **删除最后会话**：sessionModelOverride 重置为 `{null, null}`，不残留旧值。

### 4.2 视觉 / 交互（手测）
- [ ] iPhone 13 mini Safari 模拟（320×568）：顶栏三件套不溢出。
- [ ] iPhone 15 Pro Safari 模拟（393×852）：顶栏 + Composer 单手可达，所有触控区 ≥36×36。
- [ ] Sidebar drawer mobile：wordmark "灵境" + 顶部 ModeSwitch + ThemeToggle，操作顺畅。
- [ ] Composer "+" overflow：点击展开 → 选 @ 引用 → ArticlePicker 弹层正确锚定。
- [ ] 切换暗 / 亮主题：所有改动表面无 dark: 变体污染（ThemeToggle 验证）。

### 4.3 工程红线
- [ ] `pnpm --filter @aetherblog/blog typecheck` 通过。
- [ ] `pnpm design-system:check` 0 error。
- [ ] 注释中不出现"对齐 X 产品"字样（`grep -ri "对齐.*claude\|对齐.*chatgpt" apps/blog/app/agent/workspace/`）。
- [ ] 不引入新依赖（package.json diff 为空）。

## 5. 风险 / 回滚

| 风险 | 缓解 |
|------|------|
| Composer overflow menu 与 ArticlePicker / TagPicker / SlashCommandPicker 锚点冲突 | 「+」menu 触发后立刻关闭自身，再触发 picker，picker 仍锚到原 ToolButton ref（hidden md:inline-flex）—— ref 仍指向 DOM，只是 css hide。如出问题，给「+」menu 项分配独立锚点 ref。 |
| Sidebar drawer 顶部加 ModeSwitch 后内容超出可视区 | drawer 内层用 `flex flex-col` + 中段 `flex-1 overflow-y-auto`，顶部 / 底部固定，已是当前布局，新增组件按规范叠加 |
| `sessionModelOverride` 与 `sessions` 双向同步导致死循环 | useEffect 依赖只读 activeSession.id/modelId/providerCode，handleModelChange 用 setState 函数式更新避免读到旧闭包，已规避 |
| 移动端 EmptyState 选模型后立刻新建会话，override 丢失 | handleCreate 路径不重置 override（保留用户意图）；handleSend 路径会把 override 写入新 session |

回滚策略：单 PR 单 commit，问题暴露时 `git revert` 即可。已有备份 commit（PR 576 现状）作为 fallback。

## 6. 后续（不在本 PR 范围）

- 真机网络层面的"模型切换 → 后端 routing"验证，需要 admin 配置多个 provider 才能完整复现。
- artifact 卡片化展示（参考截图所示的 sync fixed 卡片）：等 Cowork mode 上线后统一设计。
- 麦克风 / 语音输入：等 cowork.toolbox 工具集设计后统一接入。
- Sessions 从 localStorage 升级到 server-side（cross-device sync）：独立 backend 设计任务。
