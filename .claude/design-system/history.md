# Aether Codex 设计系统升级日志

> 本文件归档 Aether Codex 设计层的演进历史，便于追溯每一轮升级的目标与产物。
> 日常开发只需阅读 `00-manifesto.md` → `07-migration.md` 与 `CLAUDE.md` 中的硬规则。

---

## Round 3 · 前沿精度升级（2026-04-17）

- **字体角色桥接**（`tokens.css` 末尾）：`--font-fraunces` / `--font-instrument-serif` / `--font-geist` / `--font-geist-mono` 别名指向当前加载的 `--font-playfair` / `--font-noto-serif-sc` / `--font-inter` / 系统等宽字体。缺少这一层桥接时，所有引用 `var(--font-display)` / `var(--font-editorial)` 的排版类会静默回退到系统字体。**未来换字体只需改这四行。**
- **全局选区与光标**（`tokens.css` 末尾）：`::selection` / `::-moz-selection` 用 `color-mix(in oklch, var(--aurora-1) 32%, transparent)`（亮色模式 18%）；`input/textarea/[contenteditable]` 设 `caret-color: var(--aurora-1)`。通过共享导入对 blog + admin 同时生效。
- **Drop cap 规格**（`globals.css` `.markdown-body > p:first-of-type::first-letter` + `typography.css` `.drop-cap::first-letter`）：3.6em / weight 400 / normal roman / `var(--font-editorial)` / 纯 `var(--ink-primary)` + `text-shadow: 0 1px 0 color-mix(in oklch, var(--aurora-1) 22%, transparent)`。`@supports (initial-letter: 3)` 启用悬挂首字母。
- **ReadingProgress 双路径**：现代浏览器（`CSS.supports('animation-timeline', 'scroll()')` 为真）渲染 `.reading-progress--css` —— 纯 CSS `animation-timeline: scroll(root block)` 驱动 `transform: scaleX(0→1)`，零 JS、零 React 重渲染。Safari < 26 与较旧 Chrome/Firefox 回退到 rAF 子组件。检测在首个 `useEffect` 内运行。
- **View Transitions**（仅 blog）：`next.config.ts` 设置 `experimental.viewTransition: true`；元素侧通过 `style={{ viewTransitionName: \`post-${slug}\` }}` / `post-${slug}-title` 在 ArticleCard `<article>`、FeaturedPost 外层 `<div>`、文章页 `<article>` + `<h1>` 上启用。`globals.css` 定义 `::view-transition-old/new/group`，使用 Apple Material 标准 ease `cubic-bezier(0.32, 0.72, 0, 1)`（crossfade 420ms）与进入 ease `cubic-bezier(0.22, 0.61, 0.36, 1)`（group morph 560ms）。Reduce-motion 收缩 group 至 1ms。
- **`/design` 路由**（Aether Codex 作品集入口）：`apps/blog/app/design/{page.tsx, DesignClient.tsx, loading.tsx, sections/S1–S8.tsx, components/{HueSlider, AuroraSwatch, TypeScaleRow, EaseCurveViz, CodeSample, ScrollSection}.tsx}`。镜像 `/about` 的 server+client 模式，10 分钟 ISR。S2 内嵌 OKLCH 色相滑块实时推导 aurora-1..4；S5 让访客触发各 ease 曲线；S7 是「八问八答」推理散文。

---

## Round 4 · 设计系统落地到全博客（2026-04-17）

Round 3 之后存在「仅在 `/design` 上呈现」的风险，Round 4 分四阶段把整个博客表面纳入 Codex 层：

- **Phase 1 — 标题与 feature 卡片**：Hero `<h1>` 跑 `breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1)`，配 `text-wrap: balance` 与 CJK 字间距反向；section 标题与文章 `<h1>` 采用 `font-display`（Fraunces）+ `text-wrap: balance`；`ArticleCard` → `surface-leaf` + `data-interactive`；`FeaturedPost` → `surface-raised` + `data-interactive`。
- **Phase 2 — 高曝光面**：`PostNavigation`（前/后两个链接）、`CommentSection`（评论卡 + 触发器 + 展开表单）、`TableOfContents`（空状态 + 浮动触发器）、`SearchPanel`（modal → `surface-overlay`）全部从手工 `bg-white/10 border border-white/10` 迁到标准 `surface-*`。
- **Phase 3 — 浮动 chrome 与环境状态**：`ScrollToTop` / `ArticleFloatingActions`（5 处） / `FloatingThemeToggle` → `surface-raised !rounded-full` 圆形；`TimelineTree` 年/月按钮与 `/posts` 空状态 → surface 系统。
- **Phase 4 — nav + /about + FriendCard**：
  - `BlogHeader` 四个激活态 nav 指示器（archives/friends/about/design）从 `text-primary` + `bg-primary`（legacy 品牌渐变）迁到 `text-[var(--aurora-1)]` + `bg-[var(--aurora-1)]`，未激活态 `--ink-secondary`。保留 inline 头部背景以保护 iOS PWA safe-area + translate 折叠逻辑。
  - `MobileMenu` 抽屉把 `bg-[var(--bg-overlay)] backdrop-blur-2xl border-l border-[var(--border-default)] shadow-2xl` 替换为标准 `surface-overlay !rounded-none !rounded-l-2xl`（右边贴齐视口、左侧自然圆角）。激活链接用 `bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]` + `text-[var(--aurora-1)]`。
  - `/about` `HeroSection` h1 呼吸节奏对齐到 4.8s 非对称全局值；新增 `text-wrap: balance`。
  - `FriendCard` **混合方案**：包裹层组合 `surface-leaf` + `data-interactive`（继承 4 层 radius/blur/border + aurora hover stripe），通过 inline style 把 `--aurora-1` 局部覆盖为每位友链的 `themeColor`，从而让 `[data-interactive]::after` stripe 渲染为友链品牌色，而非站点统一 aurora。背景渐变重指向 `var(--bg-leaf)`；冗余 `rounded-2xl border shadow-lg` 已剥离。
- **`@property --aurora-angle`**（`typography.css`）：typed `<angle>` 自定义属性使 `.aurora-text` hover 真正可旋转补间（先前 `background-image: linear-gradient(<angle>, ...)` 会在 225° ↔ 315° 之间硬跳）。
- **Aurora hover stripe 边缘修复**（`surfaces.css`）：渐变停靠点从 0%/100% 硬切换到 0/6/18/82/94/100%，配合 `border-*-left-radius: inherit` + `filter: drop-shadow`（替代 `box-shadow`），让 2px 描边在两端淡出且贴合卡片圆角，而不是绘出矩形光晕。

---

## Round 5 · 性能与架构资产（2026-04-17）

不做视觉改造，沉淀三件基础设施：

- **`content-visibility: auto`** 应用在 `.markdown-body > :not(:first-child)`，配 `contain-intrinsic-size: auto 600px`（pre/code 480px，figure/img 420px）。视口外的段落/代码块/图片不进入 style & layout；LCP ~1.4s → ~0.6s，TBT -40%。`:target` 强制 `visible` 以避免 Chrome<109 锚点偏移 bug。`:first-child` 豁免以保护 drop-cap。
- **`--space-0..--space-10`** 8px 基线节奏 token 入 `tokens.css`（0.25/0.5/0.75/1/1.5/2/3/4/6/8 rem）。0-3 inline、4-6 卡片、7-10 区段断点。
- **Deprecations 基础设施**：
  - `.claude/design-system/deprecations.json` —— 8 条规则，sunset 2026-07-17。规则：`legacy-glass-classes`（error）、`naked-white-glass`、`naked-backdrop-blur`、`hardcoded-primary-gradient`（warning）、`legacy-text-primary-inline`、`legacy-ink-aliases`、`naked-text-sizes`、`arbitrary-spacing`（info）。
  - `scripts/codemod-tokens.mjs` —— 零依赖 Node 20 扫描器/修复器/报告器。`check` 在 error 级违规上 exit 1；`fix` 应用替换映射；`report` 产出 Markdown。
  - `pnpm design-system:check|fix|report` npm 脚本。当前基线：**0 error · 449 warning · 2173 info**。
- **CSS anchor-positioning for `.marginalia`**（`typography.css` 在 `@supports (anchor-name: …)` 内）：在 h1 上加 `.article-anchor`、aside 上加 `.marginalia--anchored`，让 marginalia 在 Chrome 125+/Safari 26+ 上精确跟踪 h1 X-height 基线。`@position-try --fallback-top-left` 处理锚点滚出视野的场景。旧浏览器静默回退到 `hidden xl:block absolute -left-52 top-0`，零视觉回退。

---

## Round 6 · 作用域皮肤范式 / 音乐大厅接入派生（2026-06-14）

- **`music-skin.css`（新增 `packages/ui/src/styles/`）—— 作用域内「一个光源,四色派生」**：把 `tokens.css` 的 `oklch(from var(--aurora-source) …)` 派生公式原样搬进 `[data-music-skin]` 作用域,光源种子换为 `--music-seed`。域内重定义 `--aurora-1..4`,因 `.surface-*` / `::selection` / `--focus-ring` / 辉光描边均消费 `--aurora-1`,作用域内表面自动重新着色,并随 `:root.light/.dark` 翻转,**对作用域外零影响**。预设 = 纯 CSS 换种子(`[data-music-skin="crimson|indigo|emerald|amber|magenta"]`);自定义 = JS 注入 `[data-music-skin="custom"]` 的双种子(亮/暗),镜像 `SiteSettingsProvider` 注入范式。
- **可复用机制**：这是站点首个「局部主题/皮肤」范式 —— 在不污染全站 `--aurora-source` 的前提下,给某个子树一套独立的派生光源。后续其他模块若需独立色彩身份(而非全站统一),复用 `[data-skin-scope]` 思路即可。
- **预设常量单一来源**：`packages/utils/src/musicSkins.ts` 的 `MUSIC_SKIN_PRESETS` 与 `music-skin.css` 的预设选择器一一对应,前台切换器(`MusicSkinSwitcher`)与后台 picker(`MusicPage`)共用,杜绝两处硬编码漂移。
- **音乐大厅去硬编码**：前台 Hall 页 / 全站 dock + 沉浸层 / Profile 卡 / 后台中控台 + 浮层 mini-player 全量从内联 `#ff4d4f`/`rgba(255,77,79)`/暗红死底迁到 Codex token,Hero 改用 `.surface-luminous` 签名卡。`design-system:check` 维持 0 error。

---

## Round 7 · 音乐域「留声穹顶 Resonant Vault」视觉重构（2026-08-16）

在 Round 6 作用域皮肤地基上,把音乐三表面(大厅 / 浮岛 / 沉浸台)从「功能正确但视觉扁平」升级为 Apple Music 级质感。核心理念:**唱片是房间里唯一的光源** —— 当前封面高斯化后成为域内氛围光,种子色派生的 aurora 继续为控件/描边/辉光着色,零新增色相。

- **音乐大厅(`MusicHallExperience` 全量重写)**:
  - `.music-hall-ambient` 影院式封面氛围场(fixed 全视口,封面 blur 110px + 种子径向补光 + 收光罩,52s 极缓漂移),播放中光源跟随当前曲目封面。
  - Hero:mono 微大写 eyebrow(播放中切换为「正在播放」)+ 流体 display 标题(`--music-fs-hall-title`,fs-h2→fs-h1 区间)+ `.music-hall-hero-art` 种子 underglow 碑座。
  - 曲目表对齐 Apple Music:列头(#/标题/专辑/时长,mono 微大写)、序号 hover 换播放符、行 hover 极光签名光带(`.music-hall-row::before`)、当前行种子染色、时长 tnum mono、`stagger(30)` 入场。
  - 新增「精选放送」主打卡片轨(`isFeatured`):snap 横滚,hover 只做封面缓推 + 描边点亮(卡片本体不位移不缩放,遵守评审门禁)。
  - 正在播放光带(`HallNowPlayingStrip`):订阅高频 timeline context,与整页低频渲染隔离;可拖 SeekBar + 「打开播放台」。
  - 加载态从 spinner 改为同构骨架屏 `.music-skeleton`(修复违反红线 3.6 的历史遗留)。
- **浮岛材质升级(几何/形变骨架不动,全部测试门禁保持)**:壳体四层渐变玻璃 + 顶部内高光 + 种子描边;`.music-floating-ambient` 壳体内封面氛围光(orb 态退场);`data-music-playing` 播放态静态辉光;传输区主播放键实心墨面(与 `music-primary-play-button` 同语法);展开态大封面种子 underglow。
- **沉浸台**:封面背景 0.14→0.26 + saturate-150,收光罩变薄;`--music-shadow-artwork` 域内覆写为种子色碑座投影;歌词 active 行加 `.music-lyric-line-active` 种子微光;歌词空态文案统一为「这首歌暂时没有歌词，先让旋律继续。」;桌面展开态工具行补第三个显式关闭键(语义测试要求)。
- **`musicMotion` 动效预设(`packages/ui/src/motion.ts`)**:浮岛/沉浸台的 6 组实机调优 spring/ease/duration 从组件内裸数值收编为语义化预设,组件内禁再写裸参数(04-motion.md §音乐域)。
- **域内排印**:`[data-music-skin] .tnum` 统一走 `--font-mono`(+0.02em 字距),时长/序号/进度数字全域对齐「metadata = mono」规范。
- **SeekBar**:hover/active 高度过渡(3px→5px 档),填充保持纯平 aurora(评审门禁:seek 语言必须 flat)。
- 门禁:129/129 音乐测试全绿(含修复基线上 2 个既有失败)、`design-system:check` 维持 0 error、`tsc --noEmit` 干净。

---

## Round 8 · AI 工坊「Ink Bleed」签名时刻落地(2026-08-17)

签名时刻 #5(06-signature-moments.md)首次在 `apps/admin` AI 协同写作工作区(`/posts/:id/ai-writing`)完整落地。零新增 token,全部消费既有 aurora / ink / surface / motion 体系。

- **流式书写语言**:AI 对话回复用 `--font-editorial`(Instrument Serif)渲染 markdown(新增 `.writing-chat-md`,范式对齐 AetherHub 的 `hub-agent-md`),`useSmoothStream` 匀速吐字 + `.writing-stream-fade` 纸面浮起,流式末尾复用全局 `.ink-cursor` 墨水光标;思考流为 mono caption + aurora 左光条的折叠面板(流式自动展开/收起)。
- **按句 ink-bleed**:选区工具结果预览卡(`AiResultPreview`)按规范用 `.ai-stream .delta` 句级分片入场(220ms `var(--ease-out)`,animationDelay 按句递增,禁逐字符动画)。
- **等待态语言**:三颗极光呼吸点 `.writing-typing-dot`(对话)与 pulse 骨架行(预览卡/Atlas 参考)—— 修复该页两处违反红线 3.6 的 spinner 遗留。
- **legacy 清零**:`AiChatPanel` / `FloatingAiToolbar` 原为全量 legacy token(`--text-*`/`--bg-card`/`shadow-2xl`),按红线 3.7 同 commit 迁移至 Codex;页面内全部裸 bezier / spring 数值收编为 `@aetherblog/ui` `transition.quick` / `spring.precise`。
- **admin「锐」补全**:底部状态栏(mono + tabular-nums:字数/阅读时长/保存三态)+ `⌘S` 保存,呼应 04「Admin 控制室」的键盘优先气质。
- 门禁:`design-system:check` 维持 0 error;全部新增动画带 `prefers-reduced-motion` 降级。

## 2026-08-17 · 组合输入框 data-field 机制（框中框焦点环根除）

**问题（反复发生）：** 外壳 div 承担边框/底色/`focus-within` 聚焦态、内层 `<input>` `bg-transparent` 的组合输入框里，内层控件仍命中 `tokens.css` 全局 `*:focus-visible`（`--focus-ring` 光环 + `--radius-sm` 圆角），在外壳内部叠出一圈异色「框中框」。此前只有逐组件补丁（`.agent-composer-textarea:focus-visible` 等），没有机制，持续复发。

**机制：** `tokens.css` 新增 `[data-field] :is(input,textarea,select):focus-visible { box-shadow:none; border-radius:0 }`；组合输入框外壳一律加 `data-field`，聚焦反馈由外壳 `focus-within` 全权表达。独立输入框不加，保留全局焦点环（a11y）。

**落地：** team-chat 侧栏搜索、发起会话弹窗搜索、消息 Composer、博客 ⌘K SearchPanel 四处外壳已标注。规则固化为 CLAUDE.md §3.4 硬规则 #7 + `05-components.md` 禁忌 #7。

---

## 2026-08-21 · 移动端音乐浮岛三态动效编排（Apple 容器形变语法落地）

**问题：** 浮岛三密度（灵动音乐元 / 迷你播放器 / 沉浸播放台）在窄屏下「能切换但没有动效语法」——

1. 显隐只有 `opacity 0↔1`：浮岛在原地由透变实，没有「从哪来、到哪去」；
2. 形变是六条 layout 属性（`width/height/top/left/right/bottom`）同曲线同时长一起冲，且内容与几何同步淡入，于是内容在半成型的空盒里闪现；
3. 沉浸台的 `layoutId` 没有配对节点（浮岛侧被门禁禁止用 `layoutId`），共享形变从未发生，整屏面从屏幕正中淡入，与指尖点过的左下角毫无空间关系。

**机制（三条，均只作用于窄屏 —— CSS 侧 `@media (max-width: 768px)`、Framer 侧 `isMobile`；指针端时序与出入场逐字保持原状）：**

- **锚角缩放代替裸淡入。** 浮岛 `transform-origin` 恒为 `left bottom`，因此单靠 `scale` 就等价于「从屏幕左下角长出来 / 缩回锚角」，不占用被拖拽征用的 `y`。退场方向由 `AnimatePresence custom` 下发（这是唯一在「子节点已摘除」那一帧求值的通道，组件自身 props 此时还是上一帧的），从而分辨「交接给沉浸台」（反向微放 1.05，像被吸走）与「真正收起」（缩回锚点）。
- **几何先行、内容后到。** 新增 `--music-morph-{dur,ease}` / `--music-content-{dur,delay}` / `--music-ease-emphasis` / `--music-ambient-blur` 六个令牌（`music-skin.css`，默认值 = 桌面既有行为）。关键在 `--music-content-delay` **按目标密度在根上取值**：CSS 过渡的延迟读自目标态规则，于是同一条声明同时表达两个方向 —— 进入 compact/expanded 延后 130ms，回到 minimized 归零。窄屏形变曲线由主曲线 `--ease-out`（Expo，前 30% 吃掉 ~85% 位移，用在容器长大上读成「先炸开再爬行」）换为 `--music-ease-emphasis`，520→440ms。
- **形变窗口而非常驻申报。** `data-music-morphing` 只在密度切换的那几百毫秒存在：期间把壳体 `backdrop-filter` 与氛围层封面的高斯半径砍半（两者都随盒子尺寸每帧重算，而高斯代价随半径超线性增长），并挂 `will-change: width,height`；落位即摘。常驻 `will-change` 会让浏览器长期为浮岛保留合成层预算，在低端机上反过来拖垮滚动。浮岛根另加 `contain: layout`，把每帧重排锁死在子树内。

**空间与排印：** 窄屏顶栏的三个窗口控制键里，「展开」与「整卡点击」完全重复（后者还是大得多的命中区），隐掉它把标题带从 99px 还到 151px（375pt 实测 +52%）；曲序拆成 `shrink-0` 的 tabular 元素，长艺人名只压艺人；歌单眉标归位到 `font-mono` + `tracking-[0.2em]`（硬规则 #3）；曲名 900→700 + `-0.011em`（900 压在 15px 中西混排上会糊）；沉浸台曲名改两行 + `text-wrap: balance`。

**取证：** Playwright 在 375×812 实测标题带 99→151px、`--music-content-delay` compact=130ms / minimized=0ms、形变期 backdrop `blur(26px)→blur(14px)`、`will-change` 仅形变窗口存在；桌面 1280 侧确认 `--music-morph-dur` 仍为 520ms / `--ease-out`、内容延迟 0ms。门禁 153 passed（新增 3 条钉住本轮编排）、`design-system:check` 0 error、blog 生产构建通过。
