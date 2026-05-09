# 09 · 设计系统(Aether Codex)与共享 packages 模块摸底

> 本目录记录 AetherBlog monorepo 中"非业务"层的所有共享资产 ——
> 设计系统单一真源(`.claude/design-system/`)与 5 个工作区包
> (`packages/{ui,hooks,types,utils,editor}`)。该层是 blog 与
> admin 两个 app 之外**所有视觉、交互、契约**的发源地。

---

## 范围

本套文档覆盖以下源:

- 设计系统单一真源
  `.claude/design-system/{00-manifesto, 01-tokens, 02-surfaces, 03-typography, 04-motion, 05-components, 06-signature-moments, 07-migration}.md`
  + `history.md` + `legacy-cognitive-elegance.md` + `deprecations.json` + `README.md`
- 共享包源码
  `packages/ui/src/{Button.tsx, Card.tsx, components/, motion.ts, styles/, utils.ts, index.ts}`
  `packages/hooks/src/`(19 个 Hook + ThemeToggle 组件 + themeConstants)
  `packages/types/src/{api, models, ai}/`
  `packages/utils/src/{format, helpers, storage, url, validation, color, format.ts, helpers.ts}`
  `packages/editor/src/`(CodeMirror 6 Markdown 编辑器 + Bear 风格 WYSIWYG)
- monorepo 配置
  `pnpm-workspace.yaml`、根 `package.json`(含 `pnpm.overrides`)、根 `tsconfig.json`
- 落地参考
  `apps/blog/app/design/`(活样板)、`apps/blog/app/about/`(Apple-grade 参考)
- 样式注入点
  `apps/blog/app/globals.css:7-9`、`apps/admin/src/index.css:2-4`

---

## 子文档

| 文档 | 主题 |
|:---|:---|
| [01-aether-codex-tokens.md](./01-aether-codex-tokens.md) | 颜色 / 信号 / 字号 / 间距 token + light/dark 切换机制 + sunset 计划 |
| [02-surfaces-and-typography.md](./02-surfaces-and-typography.md) | surface 四件套 + 字体角色阶梯 + 编辑级排印工具类 |
| [03-motion-system.md](./03-motion-system.md) | Spring / transition / variants / stagger / `[data-interactive]` |
| [04-package-ui.md](./04-package-ui.md) | `@aetherblog/ui` 17 个组件 + cn 工具 + 与 motion / surfaces 关系 |
| [05-package-hooks.md](./05-package-hooks.md) | 19 个 Hook + ThemeProvider/ThemeToggle + FOUC guard 常量 |
| [06-package-types-and-utils.md](./06-package-types-and-utils.md) | 共享 TS 模型 / API / AI 类型 + 格式化 / 校验 / 存储工具 |
| [07-package-editor.md](./07-package-editor.md) | CodeMirror 6 Markdown 编辑器 + Bear WYSIWYG + Shiki/Mermaid/Katex 预览 |
| [08-legacy-and-migration.md](./08-legacy-and-migration.md) | Legacy token 清单 + 2026-07-17 sunset + codemod red-line |

---

## 1. 设计系统定位与演进史

### 1.1 设计哲学的两次跃迁

AetherBlog 的视觉语言经历了两次重大重写:

```
v0  (古老遗物)        v1  Cognitive Elegance     v2  Aether Codex
────────────────     ─────────────────────      ────────────────────
Inter + 紫色渐变       Linear/Vercel 风          "漂浮夜空中的发光典籍"
通用 SaaS 模板         深色 + 玻璃卡片           Editorial × Cinematic
                      bg-white/5                surface-leaf/raised/...
                      from-indigo-500           --aurora-1..4 (OKLCH)
                      backdrop-blur-2xl         不再有 dark: 变体
```

- **v1 · Cognitive Elegance** —— 已**废弃**,但 token 与类名保留至 `2026-07-17`
  sunset。文档:`.claude/design-system/legacy-cognitive-elegance.md`。
- **v2 · Aether Codex** —— 现行。哲学源自三组核心张力:**纸 × 光 / 古典 × 几何 / 禅 × 锐**
  (`.claude/design-system/00-manifesto.md:53-77`)。
- 视觉坐标:**Editorial × Technical 第一象限,稍偏 Cinematic**
  (`.claude/design-system/00-manifesto.md:17-50`)。

### 1.2 按时间轴的升级 round(摘自 history.md / 07-migration.md)

| Round | 日期 | 核心交付 |
|:---|:---|:---|
| Round 3 | 2026-04-17 | 字体变量桥接 / Drop cap Frere-Jones 重构 / `animation-timeline: scroll()` / 全局 `::selection` + `caret-color` / View Transitions / `/design` 路由 |
| Round 4 | 2026-04-17 | Hero 呼吸 4.8s 非对称 / ArticleCard 等 13 处迁 surface / `@property --aurora-angle` / aurora hover stripe 几何修正 |
| Round 5 | 2026-04-17 | `content-visibility: auto` 长文剪裁 / `--space-0..10` / `deprecations.json` + codemod / CSS anchor-positioning(已撤回) |

### 1.3 单一真源结构

```
.claude/design-system/
├── 00-manifesto.md          ← 哲学 / 禁忌 / 五个一
├── 01-tokens.md             ← --ink / --bg / --aurora / --signal / --fs / --lh / --ease / --dur / --radius
├── 02-surfaces.md           ← 四层玻璃 surface-leaf/raised/overlay/luminous
├── 03-typography.md         ← Fraunces / Instrument Serif / Geist / Geist Mono + 中文优化
├── 04-motion.md             ← cubic-bezier(0.16, 1, 0.3, 1) Expo Out + spring 预设
├── 05-components.md         ← Primitive 视觉规约 (Button / Card / Modal / Skeleton ...)
├── 06-signature-moments.md  ← 五个签名时刻 (Hero / 文章 / ⌘K / Admin / AI)
├── 07-migration.md          ← legacy → codex 映射 + Round 3/4/5 实施记录
├── history.md               ← Round 升级日志
├── legacy-cognitive-elegance.md  ← 旧主张存档
├── deprecations.json        ← 8 条 lint 规则(机器可读)
└── README.md                ← 本目录索引
```

---

## 2. 六硬规则速览(Codex Hard Rules)

源:`CLAUDE.md` §3.4 与 `.claude/design-system/00-manifesto.md`。任何 UI 改动**必须**满足:

1. **不要发明新颜色** —— 只组合 `--ink-*` / `--bg-{void,substrate,leaf,raised}` / `--aurora-1..4` / `--signal-{success,warn,danger,info}`。Aurora 着色用 `color-mix(in oklch, var(--aurora-N) X%, transparent)`。
2. **不要手写玻璃效果** —— 用 `.surface-leaf`(95% 卡片) / `.surface-raised`(侧栏 / sticky) / `.surface-overlay`(modal / auth) / `.surface-luminous`(每页 ≤1 张签名卡)。
3. **不要绕过排版阶梯** —— 标题 `.font-display` (Fraunces);italic lede `.font-editorial` (Instrument Serif);标签 / caption `.font-mono` (Geist Mono) + `tracking-[0.2em] uppercase`。字号从 `--fs-micro..display`(9 阶)取。
4. **不要写裸 bezier / spring 数值** —— 从 `@aetherblog/ui` 导入 `{ spring, transition, variants, stagger }`。短交互 `transition.quick`(260ms)、入场 `spring.soft`、按钮按下 `spring.precise`。
5. **不要在 Codex 已迁移的表面写 `dark:` 变体** —— Token 通过 `:root.light` 自动翻转。新颜色须加到 `tokens.css`,不要 inline。
6. **新增组件 / 页面前先看 `/design` 与 `/about`** —— 找不到对应模式 → 设计规范该升级,**不是**你该即兴发挥。

红线之外,还有 Manifesto 列出的 10 条禁忌(`.claude/design-system/00-manifesto.md:118-129`),均可被代码审查机械验证。

---

## 3. packages 全景

### 3.1 包清单

| 包 | 角色 | 主要消费方 |
|:---|:---|:---|
| `@aetherblog/ui` | UI Primitive + motion 预设 + 共享样式 + cn 工具 | blog / admin |
| `@aetherblog/hooks` | React Hook 集合 + ThemeProvider/ThemeToggle | blog / admin |
| `@aetherblog/types` | 共享 TypeScript 模型(Post / User / Comment / Media / FriendLink / API / AI) | blog / admin / 第三方调用方 |
| `@aetherblog/utils` | 纯函数工具(format / validate / url / storage / color / helpers) | blog / admin |
| `@aetherblog/editor` | CodeMirror 6 Markdown 编辑器 + Shiki/Mermaid/Katex 预览 + Bear WYSIWYG | admin |

### 3.2 包大小与文件数

| 包 | 文件数 | 主要 LOC | 依赖 |
|:---|---:|---:|:---|
| ui | ~30(15 components + Button/Card + 3 css + motion + utils + index) | ~3500 | framer-motion 11 / lucide-react 0.469 / @radix-ui/react-tooltip / clsx / tailwind-merge |
| hooks | 19 hooks + ThemeToggle + themeConstants | ~1800 | react ^19 (peer); framer-motion / lucide-react 可选 |
| types | 14 文件(api×3 + models×5 + ai×2 + index) | ~600 | 0(纯 TS 接口) |
| utils | 21 文件(format / helpers / url / validation / storage / color) | ~700 | date-fns ^4 |
| editor | 11 文件(MarkdownEditor / MarkdownPreview / EditorWithPreview + 3 hook + 2 component + bearDecorations) | ~3600 | @codemirror/state 6.5.4 + view 6.26.0 + lang-markdown / @uiw/react-codemirror / shiki / mermaid / katex / marked / dompurify |

### 3.3 配置规则(`CLAUDE.md` §3.1-§3.3)

- **每个 `packages/*` 必须在自己的 `package.json` 声明所有依赖** —— 不从根或其他包继承。
- **每个 `packages/*` 必须有完整独立的 `tsconfig.json`** —— project references 模板见 `.agent/rules/code-structure.md` §8.1。
- **根 `pnpm.overrides`** 锁定 `@codemirror/state@6.5.4` / `@codemirror/view@6.26.0`(`package.json:31-36`)以避免 CodeMirror 多版本冲突。
- 必需:Node ≥ 20.0.0、pnpm ≥ 9.0.0(`packageManager: pnpm@9.15.0`)。

---

## 4. 横向依赖关系(谁导入谁)

```
                       apps/blog ──┐
                       apps/admin ──┼─► @aetherblog/ui ──────► framer-motion / lucide-react / @radix-ui
                                    │                          clsx / tailwind-merge
                                    ├─► @aetherblog/hooks ───► react (peer) (framer-motion 可选)
                                    ├─► @aetherblog/types ───► (无运行时依赖)
                                    ├─► @aetherblog/utils ───► date-fns
                                    └─► @aetherblog/editor ──► @codemirror/* / shiki / mermaid / katex / marked / dompurify

                       css 注入(@import 三件套):
                       apps/blog/app/globals.css:7-9       ──┐
                                                              ├──► packages/ui/src/styles/{tokens,surfaces,typography}.css
                       apps/admin/src/index.css:2-4        ──┘
```

包间**几乎不互相导入**:

- `ui` 不依赖 `hooks` / `types` / `utils` / `editor`
- `hooks` 不依赖任何其他包(只有 react + 可选 framer-motion / lucide-react)
- `types` / `utils` 完全独立
- `editor` 不依赖其他包(自带 CodeMirror、Shiki、Mermaid、Katex 全套)

唯一例外:**`apps/blog/app/components/SiteSettingsProvider.tsx:5`** 同时引用 `@aetherblog/utils`(`generateColorVars`、`colorVarsToCSS`)与 hooks/ui,但都通过 app 层组合,**不**让 packages 之间互相 import。

---

## 5. 关键决策

### 5.1 Token 与 OKLCH

- **`--aurora-1..4` 通过 `oklch(from var(--color-primary))` 派生**(`packages/ui/src/styles/tokens.css:182-196`)。
  用户在后台调整主色 → 整个装饰色体系跟着走 → 不会再出现"紫 + 橙 + 绿 + 红"撞色。
- **保底 hex 值并存** —— `tokens.css:35-38, 144-147` 同时给暗 / 亮主题准备 `#6366F1`、`#818CF8` 等 hex,旧浏览器(无 oklch from 相对色)直接用 hex。
- **`@property --aurora-angle`**(`packages/ui/src/styles/typography.css:226-230`)注册 `<angle>` 类型,让 `.aurora-text` hover 时 `--aurora-angle` 真正在 135° → 315° 之间补间。

### 5.2 Surface 实现选择 sRGB 而非 oklch mix

`02-surfaces.md` 描述用 `color-mix(in oklch, var(--bg-leaf) 85%, transparent)`;实际实现(`packages/ui/src/styles/surfaces.css:34-38`)却走 `rgb(from var(--bg-leaf) r g b / 0.85)`。

**原因**(`surfaces.css:24-33` 注释):`color-mix(in oklch, X, transparent)` 把 transparent 视作 `oklch(0 0 0 / 0)`,零色度让 hue 在 mix 时变成 "powerless / none";暗主题低色度的 `--bg-leaf` (#12141D) 经此渲染会出现红棕色偏("咖啡色")。改走 sRGB 通道只加 alpha,绕开 oklch 插值,色相忠于 hex。

### 5.3 字体桥接层

`packages/ui/src/styles/tokens.css:354-359` 显式设定:

```css
:root {
  --font-fraunces: var(--font-playfair);
  --font-instrument-serif: var(--font-noto-serif-sc);
  --font-geist: var(--font-inter);
  --font-geist-mono: ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace;
}
```

设计规范以 Fraunces 等字体名命名角色,但 `apps/blog/app/layout.tsx` 实际加载的是 Inter + Playfair + Noto Serif SC。**桥接层让规范名能随实际加载字体走**,未来切换到真正 Fraunces/Instrument Serif/Geist 只需改这四行。

### 5.4 ThemeToggle 不在 ui 包

`ThemeToggle.tsx` 与 `useTheme.tsx` 一同位于 `packages/hooks/src/`,而不是 `packages/ui/`。**理由**:它强依赖 `useTheme` Context 提供的 `toggleThemeWithAnimation` 等命令式 API,把它放在 ui 会让 ui 反向依赖 hooks。

### 5.5 themeConstants 单独拆出

`packages/hooks/src/themeConstants.ts` 显式不带 `'use client'`(`themeConstants.ts:7-11`):暗 / 亮首帧背景色 + FOUC guard 内联样式 + themeInitScript 必须能被 Next.js Server Component(RSC)消费成字符串字面量;若放在 `'use client'` 文件中,跨 RSC 边界会被序列化为 client ref,server 侧拿到的不再是字符串。

### 5.6 Spring vs CSS transition 的二元

- **CSS transition** 给纯属性变化(背景、边框、阴影):用 `--ease-out`(`cubic-bezier(0.16, 1, 0.3, 1)`)+ `--dur-instant/quick/flow/ambient` 四档时长。
- **Framer Motion spring** 给元素位移(scale、x、y):`spring.soft / precise / bouncy`,见 `packages/ui/src/motion.ts:40-47`。

不要互相替代 —— 物理 spring 跑非物理属性会出现"软糖式"违和。

---

## 6. 已知问题

### 6.1 Button.tsx / Card.tsx 仍未迁到 Codex(优先级最高)

`packages/ui/src/Button.tsx:16-22` 写的还是:
```tsx
const variants = {
  primary: 'bg-black text-white hover:bg-black/90 ... dark:bg-white dark:text-black ...',
  secondary: 'bg-[var(--bg-card)] text-[var(--text-primary)] ...',
  ghost: 'text-[var(--text-secondary)] hover:bg-primary/10',
  ...
};
```
违反硬规则 5("不写 `dark:` 变体")与硬规则 1(用了 `--text-primary` legacy 别名)。`05-components.md` 已规划新 API(增加 `aurora` variant、改用 `spring.precise`),**但代码层尚未实施**。

`packages/ui/src/Card.tsx:9-22` 同样未升级 —— 没有 `variant` prop(`leaf | raised | overlay | luminous`),实现仍是 `bg-[var(--bg-card)] backdrop-blur-sm ...`,即 02-surfaces 明确禁止的"裸 backdrop-blur + 裸 bg"组合。

详见 [04-package-ui.md](./04-package-ui.md) §3 与 [08-legacy-and-migration.md](./08-legacy-and-migration.md)。

### 6.2 Toast / ConfirmModal 用了 Tailwind 直接颜色

- `packages/ui/src/components/Toast.tsx:19-24` 用了 `bg-green-500/20`、`bg-yellow-500/20`,违规则 1(应该用 `--signal-success` / `--signal-warn`)。
- `packages/ui/src/components/ConfirmModal.tsx:39-52` 用了 `bg-red-500/20 text-red-400` 等,理由同上。
- `packages/ui/src/components/Badge.tsx:13-18` 同样直接用 Tailwind 色。

### 6.3 Tag 用 inline style 配色

`packages/ui/src/components/Tag.tsx:21-25` 走 `style={{ backgroundColor: ${color}20, color: color || '#8b5cf6' }}` —— 默认值 `#8b5cf6` 是硬编码 hex,违规则 1。

### 6.4 ThemeToggle 还在用 legacy `--text-secondary`

`packages/hooks/src/ThemeToggle.tsx:143, 160` 用 `text-[var(--text-secondary)]`(legacy),应迁到 `var(--ink-secondary)`。

### 6.5 重复的 utils 入口

`packages/utils/src/format.ts` 与 `packages/utils/src/format/index.ts`、`helpers.ts` 与 `helpers/index.ts` 并存。前者(单文件)有简单实现,后者(目录)有完整拆分。索引文件(`packages/utils/src/index.ts`)只 `export * from './format'`、`./helpers` —— Node 解析会优先选 `format.ts`(单文件),**`format/`目录里 `duration.ts` / `number.ts` / `string.ts` 实际未被导出**。详见 [06-package-types-and-utils.md](./06-package-types-and-utils.md) §6。

### 6.6 `@aetherblog/utils` 不在根 tsconfig.references

根 `tsconfig.json:13-19` 只声明了 `apps/admin / apps/blog / packages/{editor, types, ui}` —— `packages/hooks` 与 `packages/utils` 缺失。tsc project mode 不会自动追踪它们的变化,IDE 跳转仍然能工作(`exports."."` 直接指向 `./src/index.ts` 源码),但 `pnpm -r build`(若加上 `--build`)会漏。

### 6.7 codemod 基线 449 warning + 2173 info

距 `2026-07-17 sunset` 91 天的基线(2026-04-17 测得):**0 error**(红线 ≥ 0)/ **449 warning** / **2173 info**。绝大多数是 `bg-white/[5|10|20]`(189 处)与 admin 长尾 modal 内的 `text-[var(--color-primary)]`、`var(--text-*)`。详见 [08-legacy-and-migration.md](./08-legacy-and-migration.md)。

### 6.8 `anchor-positioning` 已撤回

`02-surfaces.md` 描述 marginalia 用 CSS `anchor-name` / `position-anchor`,但 `packages/ui/src/styles/typography.css:128-141` 注释说明:Chrome 125+ / Safari 26+ 在某些视口下 `right: calc(anchor(left) + 13rem)` 解析为 0,触发 fallback 把 marginalia 推到文章内。**已移除** `anchor-positioning`,回退到 `hidden xl:block absolute -left-52 top-0`。

---

## 7. 扩展点

### 7.1 加新颜色

1. 改 `packages/ui/src/styles/tokens.css` —— 在 `:root,:root.light` 与 `:root.dark` 同时写值。
2. 同步 `.claude/design-system/01-tokens.md` 的对照表与对比度记录。
3. 若是信号色,加入 `--signal-*` 命名空间;若是光源,加入 `--aurora-*`。
4. 不要在 JSX 内 inline hex —— 全部走 `--ink-* / --bg-* / --aurora-* / --signal-*` 之一。

### 7.2 加新 surface

**默认禁止**。规范要求**只有四层** —— 决策树见 `02-surfaces.md`,任何新加 surface 都意味着层级失败。若确有需求,先在设计系统 PR 修改 `02-surfaces.md` 与 `04-package-ui.md`,再写 css。

### 7.3 加新动效曲线

**默认禁止**。一条主曲线 `cubic-bezier(0.16, 1, 0.3, 1)` Expo Out。若要新加,**必须**在 PR 中说明业务理由,加入 `--ease-*` token,并在 `packages/ui/src/motion.ts` 的 `ease` 中正式 export(不在组件内 inline bezier)。

### 7.4 加新 UI 组件

按 `.agent/rules/ui_rules.md`:**跨 app 复用 → 必须放 `packages/ui`**。流程:

1. 阅读 `.claude/design-system/05-components.md` 看是否已有同类模式
2. 在 `packages/ui/src/components/<Name>.tsx` 实现
3. 走 `surface-*` + token + motion 预设(不写 inline hex / bezier / `dark:`)
4. 在 `packages/ui/src/index.ts` 加 `export * from './components/<Name>';`
5. 同步 `.agent/rules/ui_rules.md` 与 `.claude/docs/dependencies-and-stack.md` §5

### 7.5 加新 Hook

新 Hook 放 `packages/hooks/src/<useName>.ts`,顶部 `'use client'`(若内部用 useState/useEffect),index.ts 加 `export * from './useName'`。同步 `.agent/rules/code-structure.md`。

### 7.6 加新 type

按业务域分配:API 契约入 `packages/types/src/api/`、领域模型入 `models/`、AI 域入 `ai/`,各自的子 `index.ts` 加 `export *`。

### 7.7 加新供应商或 AI 模型(非本模块,但有索引价值)

`docs/AI_MODULE_PLAN_V2.md`(见 `CLAUDE.md` §6 强制同步表)。本模块只承载 `@aetherblog/types` 的 `ai/` 子目录。

---

## 8. 与其他模块的衔接

| 关心模块 | 与本模块的接触 |
|:---|:---|
| 05 · 前端 Blog | 通过 `apps/blog/app/globals.css` 第 7-9 行 @import 三件套;通过 `next/font` 提供 `--font-fraunces / --font-inter / --font-noto-serif-sc / --font-geist-mono` 给 tokens.css 桥接层使用 |
| 06 · 前端 Admin | 通过 `apps/admin/src/index.css` 第 2-4 行 @import 三件套;`apps/admin/src/components` 大量消费 `@aetherblog/ui` Primitive 与 `@aetherblog/hooks` |
| 04 · AI 服务 | `@aetherblog/types/ai` 提供 SSE 流式响应类型(StreamingChunk / TokenUsage),admin 的 AiWritingWorkspace 用 ink-bleed 类(`typography.css:191-215`)渲染流 |
| 02 · 内容服务 | `@aetherblog/types/models` 中的 `Post / Comment / Tag / Category` 与后端 `apps/server-go/internal/models` 一一对应,前端通过 `@aetherblog/types` 维持类型契约 |

红线:**任何 UI / 类型变更**必须同步本目录与对应模块的文档。详见 `CLAUDE.md` §6.1 强制同步触发器表。
