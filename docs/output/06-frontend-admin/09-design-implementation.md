# 09 · Aether Codex 在后台的应用与偏差

> **范围**:`apps/admin/src/index.css`、`apps/admin/tailwind.config.ts`、各页面对设计 token 的实际使用、与 `.claude/design-system/` 规范的差距评估。

---

## 1. 范围

CLAUDE.md §3.4 列了 Aether Codex 六硬规则:不发明颜色、不手写玻璃、不绕过排版、不写裸 bezier、不写 `dark:`、新组件先看 `/design` 与 `/about`。本文盘点后台对这六条的执行状况:

- 哪些页面 / 表面满级 Codex 落地
- 哪些页面留 legacy token / `dark:` variant / Tailwind 直写颜色
- 自定义复合表面(`surface-admin-*` / `aetherhub-workspace`)的派生策略
- 后台为什么部分场景不能严格 Codex(数据密集页的折衷)

---

## 2. 设计 token 接入

### 2.1 全局 import(`apps/admin/src/index.css:1-9`)

```css
@import '../../../packages/ui/src/styles/tokens.css';
@import '../../../packages/ui/src/styles/surfaces.css';
@import '../../../packages/ui/src/styles/typography.css';

@tailwind base;
@tailwind components;
@tailwind utilities;
```

继承 `@aetherblog/ui` 的 3 个核心样式层:

- `tokens.css`:`--ink-*` / `--bg-{void,substrate,leaf,raised,overlay}` / `--aurora-1..4` / `--signal-*` / `--fs-*` / `--dur-*` / `--ease-*`
- `surfaces.css`:`.surface-leaf` / `.surface-raised` / `.surface-overlay` / `.surface-luminous` 与 `[data-interactive]` 的 hover stripe
- `typography.css`:`.font-display`(Fraunces)/ `.font-editorial`(Instrument Serif)/ `.font-mono`(Geist Mono)+ `.tnum` 等数字字体

### 2.2 admin 自定义复合表面

`index.css:11-50` 在 Codex 之上派生 4 个 admin 专属 class:

| Class | 派生策略 | 用途 |
| --- | --- | --- |
| `.surface-leaf.surface-admin-panel` | `bg-void 72% mix bg-substrate` | 文件夹树面板、profile 区 |
| `.surface-leaf.surface-admin-item` | `bg-void 86% mix bg-substrate` + `data-interactive` | 列表条目(storage / friends) |
| `.surface-leaf.surface-admin-card` | `var(--bg-leaf)` | 文章列表卡 |
| `.surface-leaf.surface-dashboard-card` | 同上 | dashboard 卡片 |

每个都同时定义了 `:root.dark` 翻转,显式而非依赖 token 翻转(因为不透明度 / 阴影需要单独调)。

### 2.3 AetherHub 专属变量

`index.css:53-100` 给 `.aetherhub-workspace` scope 定义 ~15 个 `--hub-*` 变量,全部基于 `--aurora-*` / `--ink-*` / `--bg-*` Codex token 派生:

```css
--hub-accent:  var(--aurora-1);
--hub-active:  color-mix(in oklch, var(--aurora-1) 14%, transparent);
--hub-border:  rgb(from var(--ink-primary) r g b / 0.10);
--hub-gradient: linear-gradient(135deg, var(--aurora-1), var(--aurora-3));
--hub-panel-strong: var(--bg-leaf);
--hub-on-accent: var(--bg-void);
--hub-card-shadow: 0 16px 44px -34px color-mix(in oklch, var(--aurora-1) 28%, black);
```

注释明说"**不**硬编码 hue,主题切换 / 站点 primary 调整即时生效"(`:55-58`)— 这是符合 Codex §1 "不发明新颜色"的标准做法。

### 2.4 Markdown 块级表面

AetherHub 内 markdown 渲染(`index.css:200+`)用 `surface-leaf` 包 pre / blockquote / hr,代替裸边框 — 与 Codex §2 "不手写玻璃,用 surface-* 类"对齐。

---

## 3. 后台对六硬规则的执行情况

### 3.1 #1 不发明新颜色 ❌ 部分违反

#### Pass(满级 Codex):

- LoginPage / ChangePasswordPage:全 `--aurora-*` + `color-mix` 派生
- AetherHubWorkspacePage:全 `--hub-*`(派生自 aurora)
- StorageProviderSettings 默认徽章:`color-mix(in oklch, var(--aurora-1) 18%, transparent)`
- PostsPage 高级筛选 chip / AI 协同写作 CTA:全 `color-mix(... var(--aurora-1) ...)`
- 文件夹左侧 panel 圆点装饰:`color-mix(... var(--aurora-1) 14% ...)`

#### Fail(混 Tailwind 直写):

- `SearchConfigPage.tsx:91-93` 状态徽章:
  ```ts
  INDEXED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  PENDING: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  FAILED:  'bg-red-500/10 text-red-400 border-red-500/20'
  ```
  应改为 `var(--signal-success)` / `--signal-warn` / `--signal-danger`
- `pages/posts/CreatePostPage.tsx:36-44` 标签色板:8 套 `bg-status-*-* dark:bg-status-*-*` 直接定义,违反 #1 + #5
- AiConfigPage 大量 `bg-black dark:bg-white text-white dark:text-black` 主按钮(`AiConfigPage.tsx:188`、`242`)— 把"主按钮"硬编码为 `black/white`
- ActivitiesPage / RecentActivity 的 `categoryConfig`:`bg-pink-500/10 / text-cyan-400 / border-pink-500/20` 直写

### 3.2 #2 不手写玻璃 ✅ 大部分通过

后台 / Sidebar / AdminLayout 的"半透明 + blur"全部用了 `bg-[var(--bg-overlay)] backdrop-blur-md`(`Sidebar.tsx:184` / `199`、`AdminLayout.tsx:36` / Header.tsx:11),没有手写 `rgba(...) blur(8px)`。

少量例外:
- `LoginPage.tsx` 的 `.codex-input` 样式段(`background: rgb(from var(--bg-leaf) r g b / 0.55)`)— 这是 token 派生,合规
- AetherHub 自定义 `--hub-panel`(`rgb(from var(--bg-substrate) r g b / 0.78)`)— 也是 token 派生

整体合规。

### 3.3 #3 不绕过排版阶梯 ⚠ 大部分通过

`font-display` / `font-editorial` / `font-mono` 在以下场景广泛使用:

- LoginPage / ChangePassword:title 用 `font-display`,italic lede 用 `font-editorial`,caption 用 `font-mono uppercase tracking-[0.22em]`
- Sidebar 分组 label:`font-mono text-[10px] uppercase tracking-[0.18em]`
- PostsPage 高级筛选 label:同上
- StatsCard / DashboardPage:数字部分用 `tnum`(等宽数字)

少量违例:
- DashboardPage / SettingsPage 标题用 `font-bold text-2xl text-[var(--text-primary)]`,**没有**走 `font-display`(系统 sans-serif)。这是早期实现,新页迁移会修
- 大部分 admin 的卡片标题仍用 sans-serif,只在签名页(Login / AetherHub)切到 Fraunces

### 3.4 #4 不写裸 bezier / spring ⚠ 部分违反

`@aetherblog/ui` 导出 `{ spring, transition, variants, stagger }`,这些被 LoginPage / ChangePasswordPage / CategoriesPage / FriendsPage 等正确使用。

但很多 framer-motion 动画**直接写 transition**:

```tsx
// PostsPage.tsx:38-46
const heightTransition = reduceMotion ? { duration: 0 } : { duration: 0.26, ease: [0.16, 1, 0.3, 1] as const };
const chipTransition   = reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };
const tabSpring        = reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 30 };
```

这是裸 cubic-bezier。注释里也说"用 `[0.16, 1, 0.3, 1]`",**没有**改成从 `@aetherblog/ui` 导入 `transition.flow` 或者 `spring.gentle`。其他例子:

- `AdminLayout.tsx` 抽屉动画:`transition: 'transform 300ms ease-in-out'`(裸)
- `Sidebar.tsx:194` motion.aside:`transition={{ duration: 0.3, ease: 'easeInOut' }}`(裸)
- `AnimatePresence` mode="wait" 子项的入场:`transition={{ duration: 0.15 }}` / `{ duration: 0.2 }` / `{ duration: 0.3 }` 散落在各页

完全合规会带来"全部从 spring 字典选"的代价 — 当前后台仍处在迁移中。

### 3.5 #5 不写 `dark:` variant ❌ 严重违反

`grep -rln "dark:" apps/admin/src/pages/` 返回 **21 个文件**含 `dark:` variant。统计:

- CommentsPage.tsx:3 处(`bg-status-*-light dark:bg-status-*/20`)
- 大量 dashboard 子组件:status-* 系列 light 变体 + dark 反色
- AiConfigPage.tsx:`bg-black dark:bg-white text-white dark:text-black`
- pages/posts/CreatePostPage.tsx 第 36-44 行:8 行标签色直接写 `dark:`
- ActivitiesPage / RecentActivity:`bg-pink-500/10`(亮)/ `dark:` 没写就是 token 翻转兜底 — 但配色逻辑不一致

正确做法(Codex §3.4 #5):颜色都从 token 取(`--ink-*` / `--bg-*` / `--signal-*`),`:root.light` / `:root.dark` 在 tokens.css 翻转,JSX 里**永远不写** `dark:`。

#### 历史原因

后台早期(Cognitive Elegance v0.1 → v0.5)的颜色系统是 Tailwind primary/accent + status-* light variant + `dark:` 反色。Aether Codex 6 月规范出来后,LoginPage 等签名页率先迁,数据密集页 deferred。`apps/blog/app/design` 已是参考实现;后台还需要"一次清理,长期不写 dark:" 的决心。

#### 缓解策略

`packages/ui/src/styles/tokens.css` 在 `:root.light` 中**翻转 ink/bg/signal/aurora**,理论上即使 admin 仍写 `dark:`,token 变量在两个主题下都能用。所以 admin 现在跑得起来,但偏离规范、且新增颜色时容易选错。

### 3.6 #6 新组件 / 页面前先看 `/design` 与 `/about` ❌ 部分违反

`apps/blog/app/about/` 是 Apple-grade Codex 落地范例(`signature card` / `aurora text` / 排版阶梯)。AetherHub / LoginPage 风格清晰对齐。

但 PostsPage / SearchConfigPage / DashboardPage 等数据密集页的"卡片网格 + 状态徽章"模式 `/about` 没覆盖。设计师 + 工程在这块需要补"管理后台版" Codex 子规范(参考 Linear / Vercel admin):

- 表格 / 列表行的 hover 状态如何用 `[data-interactive]` 表达
- 状态徽章用 `--signal-*` 还是新增 admin-scope token
- 数字密集场景的 `tnum` + `font-mono` 混合规则
- 进度条 / 图表的色阶规则

---

## 4. legacy token 渗透盘点

后台 src 中以下 legacy 变量大面积存在:

```
--text-primary / --text-secondary / --text-muted / --text-tertiary / --text-inverse
--bg-primary / --bg-secondary / --bg-tertiary
--bg-card / --bg-card-hover
--bg-input / --bg-quaternary
--border-default / --border-subtle
--bg-overlay
status-success / status-warning / status-danger / status-info(及 -light / -border)
primary / accent / accent-light(Tailwind 主题色)
```

定义在 `index.css:540-700+`(本文未读完整)+ `tailwind.config.ts`。

### 4.1 legacy 与 Codex 的映射

| Legacy | Codex 等价 |
| --- | --- |
| `--text-primary` | `--ink-primary` |
| `--text-secondary` | `--ink-secondary` |
| `--text-muted` | `--ink-muted` |
| `--bg-primary` | `--bg-void` |
| `--bg-secondary` | `--bg-substrate` |
| `--bg-card` | `var(--bg-leaf)` 或 `surface-leaf` 类 |
| `--bg-overlay` | `surface-overlay` 类 |
| `--border-subtle` | `rgb(from var(--ink-primary) r g b / 0.1)` |
| `text-status-success` | `text-[var(--signal-success)]` |
| `bg-status-success-light` | `bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)]` |
| `text-primary` | `text-[var(--color-primary)]` 或 `text-[var(--aurora-1)]`(if accent) |

`packages/ui/src/styles/tokens.css` 在两套之间提供了 alias,所以**不删除 legacy 仍可工作**。CLAUDE.md §3.7 给的是"sunset 2026-07-17",此前可逐步迁移。

### 4.2 迁移红线

CLAUDE.md §3.7:**修改 legacy 组件时须在同一 commit 迁移到 Codex,不留半 Codex 半 legacy**。`pnpm design-system:check` 暴露违规,**红线 = 保持 0 error**。

实际:目前后台部分文件是"半 Codex"(头部已迁,尾部仍 legacy),违反"同 commit 全迁"红线。待 audit 跟进。

---

## 5. 数据密集页的折衷决策

### 5.1 为什么 PostsPage / DashboardPage 没有满级 Codex

#### 视觉密度

`/about` 的"签名卡 + 留白"范式在数据列表里行不通:

- 一行 24px 的表格行不能用 `surface-leaf`(它带 16px padding + shadow)
- 100 张 statsCard 全部走 `surface-overlay` 会把页面变成毛玻璃地狱
- 大量 chip / 徽章如果都用 aurora-1 渐变,用户区分不出"激活的标签"和"分类徽章"

#### 信息可读性

数据密集页的核心是**让数字快速被读取**。Codex 强调"诗意 / 雕刻感",对数字界面是抗冲突的:

- `font-display`(Fraunces)在数字上很难读 → 必须留 sans-serif
- aurora 渐变文字配合数字会让小字号失锐 → 必须留 solid color

#### 妥协方案

后台在数据密集页采取的实际策略:

1. **表面用 Codex**:`surface-admin-card / panel / item` 都从 `--bg-leaf / --bg-substrate / --ink-*` 派生
2. **图标 / chip / 装饰用 aurora**:激活态、空态图标、CTA 边框
3. **状态色用 signal**:`--signal-success/warn/danger/info` 或 legacy `--status-*` 等价 token
4. **数字 / body 文字保留 sans + tnum**:不强迫切 Fraunces
5. **`dark:` variant 暂保留**:等设计师补"admin 数据密度子规范"再统一清理

这个折衷在 `apps/blog/app/design/` 没有标准范例,后台是设计实验场。

---

## 6. spinner 红线违规

CLAUDE.md §3.6:**禁止 spinner(无论全屏或局部),必须用骨架屏 + shimmer/pulse**。

`grep -rln "LoadingSpinner"` 找到 4 处使用:

- `App.tsx:5`(顶层 Suspense fallback)
- `AdminLayout.tsx:6`(二级 Outlet fallback)
- `LoadingSpinner.tsx`(组件本体)
- `components/common/index.ts`(导出)

`grep -rln "Loader2"` 命中 **38 个文件**,绝大多数是动画图标(`Loader2 animate-spin`)用作:

- 按钮 loading 状态(submit / saving)
- 列表 / 抽屉的 fallback
- 上传中 mini icon
- AI 流式 "生成中"

骨架屏已在 PostsPage / DashboardPage / SearchConfigPage / FriendsPage 落地;**仍需迁移的场景**:

- AdminLayout / App 顶层 Suspense fallback(应该改成"占位骨架壳")
- 各页面的"submit 按钮 loading":可以保留(按钮内 22px 旋转 icon 通常不视为页面级 spinner)
- 模态 / 抽屉 fallback:全部改骨架

---

## 7. 后台对 `/design` 与 `/about` 的具体偏离

### 7.1 LoginPage 与 `/design` 比对

LoginPage **完全对齐**,作为 admin 唯一一个"满级 Codex" 实例:

- `surface-overlay` 主体
- ambient blob 暗主题 / 极淡网格 + aurora line 亮主题
- `font-display` Fraunces 标题
- `font-editorial` italic lede
- `font-mono` caption
- aurora-1..3 派生
- 双主题自适应(scoped style block)
- 表单 input 用 `.codex-input` 派生

唯一加分项:scoped `<style>` 提供了 admin 主色(`--color-primary` 是近黑)下 aurora 派生的"近黑单色序列",**不 override token**,完全走 token.css 的 OKLCH 派生 — 这是 Codex 哲学的最佳实践。

### 7.2 ChangePasswordPage 与 LoginPage 一致

同样满级,加 "首登 (mandatory)" 语境用 `--aurora-3 / --aurora-4` 暖橙渐变,**不发明新色**,走 token 序列。

### 7.3 AetherHubWorkspacePage 的复合 token 派生

AetherHub 的 `--hub-*` 变量是后台**唯一**完整的"次级 token 体系" — 其他页面没有这种正式抽象。可以作为未来"admin 子规范"的样板。

---

## 8. 改进建议

### 8.1 短期(不改设计语言,只清违规)

1. 删除所有 `confirm()` / `alert()`(StorageProviderSettings、AIToolsPage、CloudExplorerPage)→ 用 `ConfirmModal`
2. 删除 dead stores(`useUIStore` / `usePostStore` / `useSettingsStore`)
3. 删除 mock fallback 反模式(CommentsPage / DashboardPage)
4. 把 `dark:bg-* / dark:text-*` 转为 `--signal-* / --ink-*` 等 token,删 `dark:` variant
5. AdminLayout / App 顶层 spinner 替换为占位骨架
6. `confirm()` 删除按钮统一走 ConfirmModal

### 8.2 中期(抽公共层)

1. SSE 4 套实现 → 抽 `parseSSE(body, onEvent, signal, eventTypes)` util
2. service 命名约定统一(全部用 const 单例对象)
3. axios 拦截器解包 + 协议规整化(把 `AiServiceResponse<T>` → `R<T>` 统一)
4. legacy token alias 收敛 — 在 tokens.css 写明哪些是 alias、哪些是 sunset 候选

### 8.3 长期(补 admin 子规范)

1. 设计师 + 工程联合补一个 `apps/admin/app/design/` 或 `.claude/design-system/admin-density.md`,覆盖:
   - 列表 / 表格 hover 模式
   - 状态徽章 / 信号色规则
   - 数字密集场景的字体混合
   - 图表色阶
   - 表单字段的 input / textarea / select / picker 视觉规范
2. 把 SystemTrends / DashboardPage / ContainerStatus / RealtimeLogViewer 这套监控组件做"admin 数据系列样板",对外公开为新 Codex 子分支
3. 大型重构(R<T> + AiServiceResponse 双协议归一、stores 清理、SSE 解析层)排进里程碑

---

## 9. 设计系统违规速查

| 违规类别 | 已知位置 | 优先级 |
| --- | --- | --- |
| spinner 全屏 | App / AdminLayout | P1 |
| `confirm()` / `alert()` | AIToolsPage / StorageProviderSettings / CloudExplorerPage | P0 |
| `dark:` variant | 21 个 page 文件 | P1 |
| Tailwind 直写颜色(emerald/amber/red/pink/cyan) | SearchConfigPage / RecentActivity / ActivitiesPage / CreatePostPage 标签色 | P1 |
| 演示降级反模式 | CommentsPage 全 mutation | P0 |
| `bg-black dark:bg-white` 主按钮 | AiConfigPage | P1 |
| 裸 cubic-bezier transition | PostsPage / Sidebar / AdminLayout 等 motion 动画 | P2 |
| 未走 spring/transition import | 大量 framer-motion 用法 | P2 |
| 字体未走 font-display | DashboardPage / SettingsPage 等标题 | P2 |

P0 = 立即修;P1 = 同 sprint 修;P2 = 跟随 admin 子规范出来后批量改。

---

## 10. 总结

后台对 Aether Codex 的执行是 **"明显部分实现、签名页满级、数据密集页折衷"**:

- LoginPage / ChangePasswordPage / AetherHubWorkspacePage:满级 Codex
- 自定义复合表面(`surface-admin-*`、`--hub-*`):派生策略合规
- 数据密集页(Posts / Dashboard / Comments / SearchConfig 等):legacy token + `dark:` + 部分 Tailwind 直写颜色,占绝大部分代码量
- 关键违规:spinner / `confirm()` / 演示降级 / 大量 `dark:`,在 P0/P1 等级,需要专项清理

**核心改进路径**:
1. 清掉 P0/P1 违规(数周);
2. 抽 SSE / service / token 公共层(数月);
3. 补"admin 数据密度子规范"(配设计资源,持续半年级别);
4. 后台 `/admin/design` 对应 blog `/design` — 不存在,可考虑补。
