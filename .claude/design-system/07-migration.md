# 07 · Migration Guide · 从旧令牌迁移到新令牌

> 新旧令牌**并存**。旧代码不会立刻坏掉 —— 但应该按模块逐步迁移。本文档提供逐项映射表与批量迁移策略。

---

## 迁移原则

1. **一次一个模块**,不要跨模块大规模 find-replace
2. 每完成一个模块做视觉回归(开 dev、翻页、截图对比)
3. **保留旧令牌直到所有调用点迁移完毕**,再删除旧令牌
4. 先迁移 primitive(`packages/ui`),再迁移业务组件

---

## 令牌映射表

### 颜色

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

### 玻璃

| 旧 | 新 |
|:---|:---|
| `.glass` | `.surface-leaf` |
| `.glass-high` | `.surface-raised` |
| `.glass-premium` | `.surface-overlay` |
| `bg-white/5 backdrop-blur-2xl border border-white/10 rounded-2xl` | `<Card variant="leaf">` |
| `bg-black/40 backdrop-blur-sm` | `.surface-leaf`(若在流)或 `.surface-raised`(若浮起) |

### 字号

| 旧 | 新 |
|:---|:---|
| `text-xs`(12px) | `text-caption` |
| `text-sm`(14px) | `text-body`(但若为辅助信息用 `text-caption`) |
| `text-base`(16px) | `text-body` |
| `text-lg`(18px) | `text-reading`(文章)或 `text-lede` |
| `text-xl`(20px) | `text-lede` |
| `text-2xl`(24px) | `text-h4` |
| `text-3xl`(30px) | `text-h3` |
| `text-4xl`(36px) | `text-h2`(40px,接近) |
| `text-5xl`(48px) | `text-h1`(56px,接近) |
| `text-7xl`(72px) | `text-display` |
| `text-[46px]` 等内联 | 归入最近阶梯或新增 token(需讨论) |

### 字体

| 旧 | 新(Tailwind 类) |
|:---|:---|
| `font-sans`(= Inter) | `font-sans`(= Geist,自动升级) |
| `font-serif`(= Playfair) | `font-display`(Fraunces)或 `font-editorial`(Instrument Serif) |
| 内联 `style={{ fontFamily: 'Inter' }}` | `font-sans` |
| `font-mono`(= JetBrains Mono) | `font-mono`(= Geist Mono,自动升级) |

**注:** `font-sans` 和 `font-mono` 的 Tailwind 类**键名不变**,只是底层 CSS 变量换了,所以代码无需改。

### 动效

| 旧 | 新 |
|:---|:---|
| `transition-all duration-300` | `transition-all duration-quick ease-aether` |
| `ease-out` / `ease-in-out`(Tailwind) | `ease-aether` |
| `duration-200` | `duration-quick`(260ms,接近) |
| `duration-500` | `duration-flow` |
| `duration-700` | `duration-flow`(注意慢 180ms) |
| 内联 `cubic-bezier(0.22, 1, 0.36, 1)`(SearchPanel 在用) | `ease-aether`(略有差别,但更一致) |
| `whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}` + transition 缺省 | 引 `spring.precise` |

### 圆角

| 旧 | 新 |
|:---|:---|
| `rounded-lg` | `rounded-lg`(映射到 `--radius-lg` = 16px) |
| `rounded-xl` | `rounded-xl`(`--radius-xl` = 24px) |
| `rounded-2xl` | `rounded-xl`(合并) |
| `rounded-[46px]` | `rounded-bleed` |
| 其他任意值 | 归入标准或讨论新增 |

---

## 迁移顺序(推荐)

### Stage 1 · Primitives(packages/ui)

1. `Button.tsx`:引 `spring.precise`,添 `aurora` variant
2. `Card.tsx`:加 `variant` prop,内部用 `.surface-*`
3. `Modal.tsx` / `ConfirmModal.tsx`:`surface-overlay`
4. `Toast.tsx`、`Tooltip.tsx`、`Dropdown.tsx`:`surface-raised`

### Stage 2 · 入口布局

5. `apps/blog/app/layout.tsx`:`<body>` 加极光光源 + 新字体变量
6. `apps/admin/src/main.tsx` + `AdminLayout.tsx`:同上

### Stage 3 · 博客高曝光页

7. `page.tsx`(首页)→ Hero 极光日晷
8. `components/ArticleCard.tsx` → `.surface-leaf[data-interactive]`,象牙色,`--signal-warn`
9. `components/BlogHeader.tsx` → `.surface-raised` + 极光分隔
10. `components/SearchPanel.tsx` → 命令路由 + 墨水光标
11. `globals.css` `.markdown-body` → 编辑级排印升级
12. `posts/(article)/[slug]/page.tsx` → 加 marginalia + 阅读进度

### Stage 4 · Admin

13. `Sidebar.tsx`、`AdminLayout.tsx`:`.surface-raised`,专注模式
14. `DataTable.tsx`:极光 hover 线,tnum
15. `StatsCard.tsx`、`DashboardPage.tsx`:Fraunces 数字
16. 新建 `CommandPalette.tsx`(全局 ⌘K)
17. 新建 `FocusModeContext.tsx`(⌘.)
18. `AiWritingWorkspacePage.tsx`:ink-bleed 流式

### Stage 5 · 零散页面

逐页迁移:categories、tags、settings、analytics 等。每迁移一页视觉回归一次。

---

## 批量 find-replace 模式(慎用)

以下正则仅作为**初筛**,每条必须人肉复核:

```bash
# 检测所有裸字号(需改为语义)
rg -n 'className=.*text-(5xl|6xl|7xl)' apps/blog apps/admin packages

# 检测裸 amber 警告色
rg -n 'border-amber|bg-amber|text-amber' apps packages

# 检测三玻璃旧用法
rg -n '\b(glass|glass-high|glass-premium)\b' apps

# 检测裸 backdrop-blur
rg -n 'backdrop-blur-' apps packages | rg -v 'surface-'

# 检测裸白色文字
rg -n 'text-white\b' apps packages
```

---

## 视觉回归清单(每次迁移后过一遍)

- [ ] 启动 `./start.sh`
- [ ] 博客首页 http://localhost:3000 渲染无异常
- [ ] 文章详情页 http://localhost:3000/posts/xxx 渲染无异常
- [ ] Admin http://localhost:5173 登录流程正常
- [ ] 主题切换(亮/暗)仍然工作
- [ ] FontProvider(后台"字体设置")仍然工作
- [ ] 控制台无 `undefined CSS variable` 警告
- [ ] Tailwind 未意外 purge 关键类(建 `safelist`)
- [ ] 移动端(devtools 375px)关键页面可用
- [ ] Lighthouse 性能分不低于基线 85

---

## 已知不迁移项

以下内容**保留现状**,不进本次升级:

- Markdown 渲染器 Shiki 配置(代码高亮颜色)
- mermaid / katex 的内建样式
- 时间线页的 TimelineTree 特殊布局(已足够独特)
- PageTransition 的 View Transitions 切换机制

---

## 何时允许破坏旧令牌

当:
1. 所有 `packages/ui` primitive 完成迁移
2. 博客前台 8 个高曝光页面完成迁移
3. Admin 核心 5 页(Dashboard、Posts、AI Tools、Settings、Analytics)完成迁移
4. CLAUDE.md 设计系统章节同步更新
5. 至少一次正式验证通过

此时可 PR 删除旧令牌(`.glass`、`--color-primary` 等),并升级 CHANGELOG 到 v2.0。

**在此之前绝不删除旧令牌。**

---

## Round 3 · 前沿精度升级进度 (2026-04-17)

本轮基于第三轮深度评审,一次性交付五件顶尖级改造:

- [x] **Item 0 · 字体变量桥接** —— `--font-fraunces` / `--font-instrument-serif` / `--font-geist` / `--font-geist-mono` 别名到当前加载的 Playfair/Noto Serif SC/Inter/系统 mono。修复设计系统字体角色变量从未定义的根因。位置:`packages/ui/src/styles/tokens.css` 尾部。
- [x] **Item 1 · Drop Cap 精度重构** —— Butterick + Frere-Jones 工艺:3.6em / roman / weight 400 / 纯墨色 + 极细金色 text-shadow / `initial-letter: 3 drop 2` / 中文走 editorial + 取消描金。双处同步:`apps/blog/app/globals.css` 与 `packages/ui/src/styles/typography.css`。
- [x] **Item 2 · ReadingProgress scroll-timeline** —— `animation-timeline: scroll()` 纯 CSS 120fps;`CSS.supports` 检测失败时退到 rAF 子组件。零 React re-render。
- [x] **Item 3 · ::selection + caret-color** —— `color-mix(in oklch, var(--aurora-1) 32%, transparent)` 全站统一(亮主题 18%);所有 input/textarea/contenteditable 的 `caret-color: var(--aurora-1)`。blog + admin 双端覆盖。
- [x] **Item 4 · View Transitions** —— `experimental.viewTransition: true` + 三端对称 `viewTransitionName` + Apple Material standard ease。Chrome 111+/Safari 18+ 原生 morph,不支持浏览器回退普通导航。
- [x] **Item 5 · /design 路由** —— 设计系统作品集入口:8 节 + 14 新建文件 + OKLCH hue slider + ease 曲线可视化 + 五个签名时刻 live demo + 八问八答推理长文。

---

## Round 4 · 设计系统落地到全博客 (2026-04-17)

Round 3 重精度,Round 4 重**覆盖度** —— 由用户"你是做了个花架子么"之问催生,四阶段扫过博客所有用户可触达的页面。

### Phase 1 · 标题体系 + 卡片基座
- [x] Hero h1 呼吸周期 7.2s → 4.8s cubic-bezier(0.5, 0, 0.25, 1) 非对称
- [x] Hero h1 + 首页 section h2 + 文章页 h1 接入 font-display (Fraunces) + text-wrap: balance + CJK 字距反转
- [x] ArticleCard → surface-leaf + data-interactive
- [x] FeaturedPost → surface-raised + data-interactive

### Phase 2 · 高曝光组件
- [x] PostNavigation (prev/next) → surface-leaf + data-interactive + font-editorial
- [x] CommentSection (评论卡/触发器/展开表单) → surface-leaf / surface-raised
- [x] TableOfContents (空态/浮动触发) → surface-leaf / surface-raised
- [x] SearchPanel (模态框) → surface-overlay

### Phase 3 · 浮动交互 + 环境态
- [x] ScrollToTop / FloatingThemeToggle / ArticleFloatingActions(5 处) → surface-raised !rounded-full
- [x] TimelineTree 月/年按钮 → surface-leaf / surface-raised + data-interactive
- [x] /posts 空态 → surface-leaf

### Phase 4 · 导航 + /about + FriendCard
- [x] BlogHeader 4 处 active 指示器(归档/友链/关于/设计)→ aurora-1 / ink-secondary token
- [x] MobileMenu 抽屉 → surface-overlay !rounded-none !rounded-l-2xl + 激活项 aurora-1
- [x] /about HeroSection 呼吸周期对齐 4.8s + text-wrap: balance
- [x] FriendCard 混合:surface-leaf + data-interactive + `--aurora-1` 本地覆写为 themeColor

### 设计系统增强
- [x] `@property --aurora-angle` 实现 `.aurora-text` hover 角度补间
- [x] Aurora hover stripe 边缘软化(0/6/18/82/94/100% + radius inherit + drop-shadow)
- [x] View Transitions 规则 scoped 到命名组,避免与主题切换冲突

### 相关 Bug 修复
- [x] `UpdateAvatarRequest.AvatarURL` 验证器 url → uri 放宽
- [x] `useCopyToClipboard` 三层降级 + 返回类型 void → boolean

---

## 推荐下一轮(Round 5)方向

尚未落地但被评审识别的前沿特性,供 Round 4 计划参考:

- [ ] `@property` 声明 aurora 角度变量,让 `.aurora-text` 在 hover 时真做角度/hue-shift 补间
- [ ] CSS Anchor Positioning —— marginalia 精确锚定到对应段落
- [ ] `content-visibility: auto` —— 长文章首屏性能弹药
- [ ] `text-wrap: balance` 替换 h1/h2 的 pretty
- [ ] `--space-*` 垂直韵律 token(8px baseline 9 级)
- [ ] Spring mass 参数化(`bouncy` mass 降到 0.6)
- [ ] 呼吸周期 4.8s + 非对称关键帧(吸 40% / 呼 60%)
- [ ] 签名预算 —— 每路由 ≤2 签名元素,`data-aurora-budget` 运行时校验
- [ ] `deprecations.json` + codemod + CI gate(为旧 `.glass` / `bg-white/5` / `text-white` 设下线日期)
- [ ] Lighthouse CI 性能门禁(LCP < 1.2s / CLS < 0.02 硬要求)
