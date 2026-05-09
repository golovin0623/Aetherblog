# 08 · Legacy 与 Migration

> v1 Cognitive Elegance → v2 Aether Codex 的并存阶段总览。本文档清点 legacy token 全集、deprecations.json 8 条规则、codemod 红线、迁移步骤、当前基线。

---

## 范围

- `.claude/design-system/legacy-cognitive-elegance.md`(v1 主张存档)
- `.claude/design-system/07-migration.md`(法定迁移手册)
- `.claude/design-system/deprecations.json`(8 条机器可读规则)
- `.claude/design-system/history.md`(Round 3/4/5 落地记录)
- `scripts/codemod-tokens.mjs`(check / fix / report 实现)
- `apps/blog/app/globals.css` + `apps/admin/src/index.css`(legacy token 实际驻留地)
- `package.json:19-21`(`design-system:check / fix / report` npm script)

---

## 1. Legacy 主张:Cognitive Elegance

源:`.claude/design-system/legacy-cognitive-elegance.md`

### 1.1 哲学

- **关键词**:Ethereal、Professional、Depth、Fluidity
- **风格**:高端 SaaS(Linear、Raycast)+ 氛围网页(Vercel)
- **默认**:暗色模式 + 富层次环境渐变
- **品牌**:内敛奢华,避免"游戏化"霓虹,倾向极光软光晕

### 1.2 标准容器(legacy Glass Card)

```tsx
<div className="relative bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden">
  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
  <div className="relative z-10">{/* Content */}</div>
</div>
```

### 1.3 环境背景(legacy)

```tsx
<div className="absolute inset-0 overflow-hidden pointer-events-none">
  <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse" />
  <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[100px]" />
</div>
```

`.claude/design-system/00-manifesto.md:46-49` 已**明确反对**这种"AI 紫色渐变 + 粒子"美学。

---

## 2. Legacy → Codex 替代速查

源:`legacy-cognitive-elegance.md:55-67`

| Legacy | Codex 替代 |
|:---|:---|
| `bg-white/5 backdrop-blur-2xl border border-white/10` | `.surface-leaf` |
| 顶栏 / 侧栏 / sticky | `.surface-raised` |
| Modal / Auth 卡 | `.surface-overlay` |
| 单页 ≤ 1 张签名卡 | `.surface-luminous` |
| `from-indigo-500 to-purple-600` | `var(--aurora-1..4)` + `color-mix(in oklch, ...)` |
| `text-white` / `text-slate-400` | `var(--ink-primary)` / `var(--ink-secondary)` |
| `border-white/10` | `var(--border-default)`(legacy 名,但 `--ink-primary` 10% 等价) |
| 自写 cubic-bezier | `import { spring, transition } from '@aetherblog/ui'` |
| `dark:` 变体 | 删除,token 通过 `:root.light` 自动翻转 |

完整映射表在 [07-migration.md](#) 各小节(下同)。

---

## 3. 详细映射表

### 3.1 颜色

源:`07-migration.md:18-34`

| 旧 | 新 |
|:---|:---|
| `--text-primary`(暗) | `--ink-primary` |
| `--text-secondary`(暗) | `--ink-secondary` |
| `--text-tertiary`(暗) | `--ink-muted` |
| `--text-muted`(暗) | `--ink-subtle` |
| `text-white` | `text-[var(--ink-primary)]` |
| `text-slate-400` | `text-[var(--ink-muted)]` |
| `text-slate-300` | `text-[var(--ink-secondary)]` |
| `--bg-primary`(暗) | `--bg-substrate` |
| `--bg-card` | 不用内联,用 `.surface-leaf` |
| `--color-primary`(暗紫) | `--aurora-1`(当作重点色时) |
| `bg-[#09090b]` / `bg-zinc-950` | `bg-[var(--bg-void)]` |
| `border-amber-500/20` | `border-[var(--signal-warn)]/20` |

### 3.2 玻璃

| 旧 | 新 |
|:---|:---|
| `.glass` | `.surface-leaf` |
| `.glass-high` | `.surface-raised` |
| `.glass-premium` | `.surface-overlay` |
| `bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl` | `<Card variant="leaf">` 或 `.surface-leaf` |
| `bg-black/40 backdrop-blur-sm` | `.surface-leaf`(在流)/ `.surface-raised`(浮起) |

### 3.3 字号

| 旧 | 新 |
|:---|:---|
| `text-xs`(12px) | `text-caption` |
| `text-sm`(14px) | `text-body`(辅助信息用 `text-caption`) |
| `text-base`(16px) | `text-body` |
| `text-lg`(18px) | `text-reading`(文章)/ `text-lede` |
| `text-xl`(20px) | `text-lede` |
| `text-2xl`(24px) | `text-h4` |
| `text-3xl`(30px) | `text-h3` |
| `text-4xl`(36px) | `text-h2`(40px,接近) |
| `text-5xl`(48px) | `text-h1`(56px,接近) |
| `text-7xl`(72px) | `text-display` |
| `text-[46px]` 等内联 | 归入最近阶梯(需讨论) |

### 3.4 字体

| 旧 | 新 |
|:---|:---|
| `font-sans`(= Inter) | `font-sans`(= Geist,自动升级) |
| `font-serif`(= Playfair) | `font-display`(Fraunces)/ `font-editorial`(Instrument Serif) |
| 内联 `style={{ fontFamily: 'Inter' }}` | `font-sans` |
| `font-mono`(= JetBrains Mono) | `font-mono`(= Geist Mono,自动升级) |

**注**:Tailwind 类名不变,只是底层 CSS 变量换了。

### 3.5 动效

| 旧 | 新 |
|:---|:---|
| `transition-all duration-300` | `transition-all duration-quick ease-aether` |
| `ease-out` / `ease-in-out`(Tailwind) | `ease-aether` |
| `duration-200` | `duration-quick`(260ms) |
| `duration-500` | `duration-flow` |
| 内联 `cubic-bezier(0.22, 1, 0.36, 1)` | `ease-aether` |
| `whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}` 缺 transition | 引 `spring.precise` |

### 3.6 圆角

| 旧 | 新 |
|:---|:---|
| `rounded-lg` | `rounded-lg`(`--radius-lg` = 16px) |
| `rounded-xl` | `rounded-xl`(`--radius-xl` = 24px) |
| `rounded-2xl` | `rounded-xl`(合并) |
| `rounded-[46px]` | `rounded-bleed` |
| 其他任意值 | 归入标准或讨论新增 |

---

## 4. Sunset 名录 · deprecations.json

源:`.claude/design-system/deprecations.json`

```json
{
  "version": 1,
  "sunsetDate": "2026-07-17",
  "sunsetPolicy": "sunsetDate 之后,legacy token 不再由 tokens.css 定义;代码中残留引用会渲染为 unset。在此之前,legacy 与 codex 并存,但 `pnpm design-system:check` 会将所有 legacy 使用列为 warning,CI 不强制失败。",
  "rules": [/* 8 条 */]
}
```

### 4.1 规则全集

| ID | 严重度 | 模式 | 替代 |
|:---|:---:|:---|:---|
| `legacy-glass-classes` | **error** | `className=".*\\b(glass\|glass-high\|glass-premium)\\b"` | `surface-leaf / raised / overlay / luminous` |
| `naked-white-glass` | warning | `bg-white/(5\|10\|20)` / `border-white/(5\|10\|20)` | `surface-*` 组合 |
| `naked-backdrop-blur` | warning | `backdrop-blur-(sm\|md\|lg\|xl\|2xl\|3xl)` 未配 `surface-*` | `surface-*` 内置 |
| `legacy-text-primary-inline` | info | `text-[var(--color-primary)]` | `text-[var(--aurora-1)]` |
| `legacy-ink-aliases` | info | `var(--text-(primary\|secondary\|tertiary\|muted))` | `var(--ink-*)` |
| `hardcoded-primary-gradient` | warning | `(from\|to\|via)-(indigo\|purple)-N` | `color-mix(in oklch, var(--aurora-1..4) N%, transparent)` |
| `naked-text-sizes` | info | `\\btext-(5xl\|6xl\|7xl)\\b` | `text-h1` / `text-display` |
| `arbitrary-spacing` | info | `\\b(p\|m\|...)-\\[Npx\\|rem\\|em\\]` | `--space-*` 9 级 |

### 4.2 严重度分级

- **error** —— `legacy-glass-classes` 一条。代码中**禁止**用 `.glass / glass-high / glass-premium` 类名。CI 应阻断。
- **warning** —— 三条:裸白色玻璃 / 裸 backdrop-blur / 硬编码品牌渐变。**不阻断,但持续进入需 0 增长**。
- **info** —— 四条:`text-[var(--color-primary)]` / `var(--text-*)` / `text-5xl/6xl/7xl` / 任意值间距。**机会主义迁移,触碰相关组件时一并改**。

### 4.3 replace map(可自动化)

只有 3 条规则有 `replace` 映射(可一键 fix):

```json
"legacy-text-primary-inline":
  { "text-[var(--color-primary)]": "text-[var(--aurora-1)]" }

"legacy-ink-aliases":
  { "var(--text-primary)": "var(--ink-primary)",
    "var(--text-secondary)": "var(--ink-secondary)",
    "var(--text-tertiary)": "var(--ink-muted)",
    "var(--text-muted)": "var(--ink-muted)" }

"naked-text-sizes":
  { "text-5xl": "text-h1",
    "text-6xl": "text-display",
    "text-7xl": "text-display" }
```

其余 5 条 `replace: null` —— 因为替换需要语义判断(如 `bg-white/5` 在不同上下文要换不同 surface),**不能机械替换**。

---

## 5. codemod 工具

源:`scripts/codemod-tokens.mjs`(186 行,纯 Node 20)

### 5.1 三种模式

```bash
pnpm design-system:check       # 默认,扫描列违例,error 级别阻断(CI 推荐)
pnpm design-system:fix         # 按 replace map 自动替换,写回磁盘
pnpm design-system:report      # 输出 Markdown 报告到 stdout(适合 PR 描述)
```

### 5.2 实现要点

源:`codemod-tokens.mjs:1-15`

```js
// 无第三方依赖,纯 Node 20 + fs.glob 实现,目标 < 0.5s 完成全量扫
import { readFile, writeFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

const deprecations = JSON.parse(await readFile(deprecationsPath, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const sunsetDate = deprecations.sunsetDate;
const daysToSunset = Math.ceil(
  (new Date(sunsetDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24),
);
```

每条规则按 `match.files` glob → 跳过 `node_modules / .next / dist / build / .turbo` → 用 `RegExp(rule.match.pattern, 'gm')` 全局匹配。

### 5.3 npm script 暴露

源:`package.json:19-21`
```json
"design-system:check": "node scripts/codemod-tokens.mjs check",
"design-system:fix":   "node scripts/codemod-tokens.mjs fix",
"design-system:report":"node scripts/codemod-tokens.mjs report"
```

---

## 6. 当前基线(2026-04-17 测得)

来自 `history.md` Round 5 + `07-migration.md:317-318`:

| 严重度 | 数量 | 红线 |
|:---|---:|:---|
| error | **0** | 必须保持 0 |
| warning | 449 | 距 sunset 91 天,目标:每周减 30+ |
| info | 2173 | 机会主义迁移 |

距 `2026-07-17 sunset`:**91 天(2026-04-17 起)** / 现在已剩约 70 天(2026-05-09 起,~69 天)。

按现在这个速率,sunset 前 warning 应能降到 0 左右,info 仍会有 1000+ 残留。**Sunset 之后 info 级问题虽不阻断但 token 已 unset,UI 会出错,所以 sunset 之前必须**降到 0**。

---

## 7. 残留分布(从 `07-migration.md:256-271` 得知)

### 7.1 Admin Tier-2 · Dashboard 图表

- `dashboard/components/RecentActivity.tsx / SystemTrends.tsx / VisitorChart.tsx / RealtimeLogViewer.tsx / DeviceChart.tsx` —— 各 1 处 `bg-white/5 / slate-grad`
- `AiUsageTrendChart.tsx / AiUsageRecordsTable.tsx / TopPosts.tsx` —— 同上
- `Sidebar.tsx / Header.tsx / MobileHeader.tsx` —— 3 处 `text-[var(--color-primary)]` 可升级到 `--aurora-1`

### 7.2 Admin Tier-3 · Media / Posts / AI-Config / Settings 长尾

- `pages/media/components/*.tsx` —— MediaViewer / MediaDetail / MediaList / MediaGrid / TagManager / TagFilterBar / MoveDialog / TrashDialog / ShareDialog / FolderDialog / FolderTree / ImageEditor / VersionHistory / VirtualMediaGrid / UploadProgress · **共 ~120 处 `bg-white/N`**
- `pages/posts/CreatePostPage.tsx / EditPostPage.tsx / AiWritingWorkspacePage.tsx / components/AiSidePanel.tsx / SlashCommandMenu.tsx / AiToolbar.tsx` —— 约 30 处
- `pages/ai-config/components/*.tsx` —— ProviderDialog / ProviderDetail / ModelConfigDialog / ConnectionTest / CredentialForm —— 约 15 处
- `pages/settings/StorageProviderSettings.tsx` —— 12 处 `text-primary`(Tailwind alias 已正确映射,但可升级到 aurora)

### 7.3 packages/ui 内部残留(P0 红线)

- **`Button.tsx:16-22`** —— variants 仍写 `dark:` + 用 `--text-primary / --bg-card / --border-default / bg-red-500`
- **`Card.tsx:9-22`** —— 没有 `variant` prop,用 `bg-[var(--bg-card)] backdrop-blur-sm border` 裸组合
- **`Toast.tsx:19-24`** —— variant 用 `bg-green-500/20` 等
- **`Badge.tsx:13-18`** —— variant 用 `bg-primary/20 / bg-green-500/20`
- **`Tag.tsx:21-25`** —— 默认色 `#8b5cf6` 硬编码 hex
- **`ConfirmModal.tsx:39-52`** —— variantStyles 用 `bg-red-500/20 / bg-yellow-500/20 / bg-blue-500/20`
- **`Skeleton.tsx`** —— 用 `bg-[var(--bg-card)]`
- **`Input.tsx / Textarea.tsx`** —— `bg-[var(--bg-card)] border border-[var(--border-default)]` 全 legacy
- **`Toggle.tsx`** —— `bg-primary` checked 状态

### 7.4 packages/editor 内部残留

- `MarkdownPreview.tsx:701-757` —— `--alert-info-bg` 等用硬编码 rgba,未走 `--signal-*`
- `MarkdownEditor.tsx:289` —— 外框用 `border-slate-200 / border-white/10 bg-white/5`
- `MarkdownEditor.tsx:319` —— 拖拽覆盖层 `bg-primary/10 border-primary`
- `components/UploadProgress.tsx` —— 大量 `bg-white/5 / text-gray-300/500 / text-green-500`

### 7.5 packages/hooks 内部残留

- `ThemeToggle.tsx:143, 160` —— `text-[var(--text-secondary)]`(应迁 `--ink-secondary`)
- `ThemeToggle.tsx` 下拉菜单:`bg-[var(--bg-secondary)] backdrop-blur-xl border border-[var(--border-default)] shadow-lg`(应迁 `surface-overlay`)

---

## 8. 迁移顺序 · `07-migration.md:96-131`

### Stage 1 · Primitives(packages/ui)

1. `Button.tsx` —— 引 `spring.precise`,添 `aurora` variant,删 `dark:`,用 `--ink-* / --aurora-1 / --signal-danger`
2. `Card.tsx` —— 加 `variant` prop,内部用 `.surface-*`,删除当前裸组合
3. `Modal.tsx` / `ConfirmModal.tsx` —— 容器走 `surface-overlay`,variantStyles 改 `--signal-*`
4. `Toast.tsx` / `Tooltip.tsx` / `Dropdown.tsx` —— 用 `surface-raised`
5. `Badge.tsx` / `Tag.tsx` —— variant 改 `--signal-*` + `--aurora-1`
6. `Input.tsx` / `Textarea.tsx` / `Toggle.tsx` —— 走 `--ink-*` + 极光 focus

### Stage 2 · 入口布局

7. `apps/blog/app/layout.tsx` —— `<body>` 加极光光源 + 新字体变量(已部分完成)
8. `apps/admin/src/main.tsx + AdminLayout.tsx` —— 同上(部分已完成)

### Stage 3 · 博客高曝光页(已完成 Round 4)

9. `page.tsx`(首页) → Hero 极光日晷 ✓
10. `components/ArticleCard.tsx` → `.surface-leaf[data-interactive]` ✓
11. `components/BlogHeader.tsx` → `.surface-raised` + 极光分隔 ✓
12. `components/SearchPanel.tsx` → 命令路由 + 墨水光标 ✓
13. `globals.css` `.markdown-body` → 编辑级排印升级 ✓
14. `posts/(article)/[slug]/page.tsx` → 加 marginalia + 阅读进度 ✓

### Stage 4 · Admin(部分完成 Round 4 Tier-1)

15. `Sidebar.tsx` / `AdminLayout.tsx` —— `.surface-raised`,专注模式
16. `DataTable.tsx` —— 极光 hover 线,tnum
17. `StatsCard.tsx` / `DashboardPage.tsx` —— Fraunces 数字 + `surface-leaf data-interactive` ✓
18. 新建 `CommandPalette.tsx`(全局 ⌘K)(已完成)
19. 新建 `FocusModeContext.tsx`(⌘.)
20. `AiWritingWorkspacePage.tsx` —— ink-bleed 流式

### Stage 5 · 零散页面

逐页迁移:categories / tags / settings / analytics 等。每迁移一页视觉回归一次。

---

## 9. 视觉回归清单(`07-migration.md:159-168`)

每次迁移后过一遍:

- [ ] 启动 `./start.sh --gateway`
- [ ] 博客首页 `http://localhost:7899/` 渲染无异常
- [ ] 文章详情页 `http://localhost:7899/posts/xxx` 渲染无异常
- [ ] Admin `http://localhost:7899/admin/` 登录流程正常
- [ ] 主题切换(亮 / 暗)仍工作
- [ ] FontProvider(后台"字体设置")仍工作
- [ ] 控制台无 `undefined CSS variable` 警告
- [ ] Tailwind 未意外 purge 关键类(建 safelist)
- [ ] 移动端(devtools 375px)关键页面可用
- [ ] Lighthouse 性能分不低于基线 85

---

## 10. 已知不迁移项

`07-migration.md:172-180`:

- Markdown 渲染器 Shiki 配置(代码高亮颜色)
- mermaid / katex 的内建样式
- 时间线页 TimelineTree 特殊布局(已足够独特)
- PageTransition 的 View Transitions 切换机制

---

## 11. 何时允许破坏旧令牌

`07-migration.md:184-194` —— 必须满足:

1. 所有 `packages/ui` primitive 完成迁移
2. 博客前台 8 个高曝光页面完成迁移
3. Admin 核心 5 页(Dashboard / Posts / AI Tools / Settings / Analytics)完成迁移
4. CLAUDE.md 设计系统章节同步更新
5. 至少一次正式验证通过

此时可 PR 删除旧令牌(`.glass / --color-primary` 等),并升级 CHANGELOG 到 v2.0。

> **在此之前绝不删除旧令牌。**

---

## 12. 关键代码引用

| 文件 | 行号 | 内容 |
|:---|---:|:---|
| `.claude/design-system/legacy-cognitive-elegance.md` | 全文 | v1 主张存档 |
| `.claude/design-system/07-migration.md` | 96-131 | 5 阶段迁移顺序 |
| `.claude/design-system/07-migration.md` | 159-168 | 视觉回归清单 |
| `.claude/design-system/07-migration.md` | 184-194 | 删除旧令牌的 5 个前置条件 |
| `.claude/design-system/07-migration.md` | 256-288 | Admin Tier-2/Tier-3 残留分布 |
| `.claude/design-system/deprecations.json` | 全文 | 8 条规则 + sunset 2026-07-17 |
| `.claude/design-system/history.md` | 全文 | Round 3/4/5 落地记录 |
| `scripts/codemod-tokens.mjs` | 1-15 | check / fix / report 三模式 |
| `package.json` | 19-21 | npm script 暴露 |
| `package.json` | 31-36 | pnpm.overrides CodeMirror 锁定 |
| `apps/blog/app/globals.css` | 53-101 | blog 端 legacy 主色 / 文字 / 边框 / 阴影 / 渐变 / 状态色定义(并存) |
| `apps/admin/src/index.css` | 1-60 | admin 端入口 + Codex token @import + 自定义 surface-* 扩展类 |
| `packages/ui/src/Button.tsx` | 16-22 | P0 待迁:variants 用 `dark:` + legacy token |
| `packages/ui/src/Card.tsx` | 9-22 | P0 待迁:无 variant prop,裸 backdrop-blur |

---

## 13. 引用的子文档与原始规范

- `.claude/design-system/legacy-cognitive-elegance.md`
- `.claude/design-system/07-migration.md`
- `.claude/design-system/deprecations.json`
- `.claude/design-system/history.md`
- `CLAUDE.md` §3.7 —— Legacy token 迁移立场("修改 legacy 组件时须在同一 commit 迁移到 Codex")
- `CLAUDE.md` §3.4 第 5 条 —— "不要在 Codex 已迁移的表面写 `dark:` 变体"

---

## 14. 使用方与扩展点

### 14.1 何时跑 codemod

- 提 PR 前:`pnpm design-system:check`(确认 0 error)
- 改了 legacy 组件:`pnpm design-system:fix`(自动替换可机械修复的 3 类)
- 周会前:`pnpm design-system:report` 看趋势

### 14.2 加新 deprecation 规则

1. 在 `.claude/design-system/deprecations.json` 加 rule:
   ```json
   {
     "id": "<unique-id>",
     "severity": "error" | "warning" | "info",
     "match": { "type": "regex", "pattern": "...", "files": ["apps/**/*.{ts,tsx}", ...] },
     "replace": null | { "before": "after" },
     "note": "<人类可读说明>"
   }
   ```
2. 跑 `pnpm design-system:report` 看影响面
3. 同步 `.claude/design-system/07-migration.md` 的迁移表
4. CI 配置中加该规则的告警阈值

### 14.3 一段 Codex 标准的"反例 → 正例"

**反例**(legacy):
```tsx
<div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden">
  <h3 className="text-xl text-white font-bold">标题</h3>
  <p className="text-sm text-slate-400 mt-2">描述</p>
  <button className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-base px-4 py-2 rounded-lg transition-all duration-300">
    操作
  </button>
</div>
```

**正例**(Codex):
```tsx
<div className="surface-leaf p-6">
  <h3 className="text-h4 text-[var(--ink-primary)] font-display">标题</h3>
  <p className="text-caption text-[var(--ink-muted)] mt-2 font-mono uppercase tracking-wider">描述</p>
  <Button variant="aurora" size="md" className="mt-4">操作</Button>
</div>
```

每一处的对比:
- `bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl` → `surface-leaf`
- `text-xl` → `text-h4`(语义字号)
- `text-white` → `text-[var(--ink-primary)]`(Codex token)
- `font-bold` → `font-display`(Fraunces)
- `text-sm text-slate-400` → `text-caption text-[var(--ink-muted)] font-mono uppercase tracking-wider`
- `bg-gradient-to-br from-indigo-500 to-purple-600 ... transition-all duration-300` → `<Button variant="aurora">`(aurora 描边款)

---

## 15. 已知限制

1. **codemod 是基于 regex 而非 AST** —— 在 `// bg-white/5` 注释 / 字符串字面量中也会误报。每条 fix 必须人肉复核。
2. **`replace: null` 的 5 条规则不能自动修** —— 需要语义判断(`bg-white/5` 上下文是流 / 浮 / 弹层)。
3. **基线 449 warning + 2173 info 多数在 admin/Tier-2/Tier-3** —— blog 已经基本完成,admin 长尾 dialog 是大头。
4. **`packages/ui` 自身的 P0 偏差**(Button / Card / Toast / ConfirmModal / Badge / Tag / Skeleton / Input / Textarea / Toggle) —— Stage 1 的 6 步**整体**未完成,这是 Codex 落地的卡点。
5. **`packages/editor` 的 `MarkdownPreview` alert 块未走 `--signal-*`** —— 全文档主题切换时 alert 颜色不变,与正文割裂。
6. **legacy token 仍在 `apps/blog/app/globals.css` 与 `apps/admin/src/index.css` 内** —— 不在 `packages/ui/src/styles/tokens.css` 内。删除时要小心:Tailwind alias `bg-primary` 等仍 alias 到 `--color-primary`,删除会让一大批 admin 组件视觉跌入 fallback。
7. **`--color-primary` 是 OKLCH aurora 派生的锚点** —— sunset 前**不能**删除 `--color-primary`,只能把它从"Tailwind 直接 alias"逐步迁回"仅 token 派生用的内部变量"。
8. **`pnpm design-system:fix` 当前可修的只有 3 条 info 规则** —— 真正难的 5 条 warning 仍是手工活,这是 sunset 前 91 天到 0 warning 的最大瓶颈。
