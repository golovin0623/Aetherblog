# 03 · Motion System

> AetherBlog 全站只说一种"动效方言"。本文档拆解 motion 体系的两条路径(CSS / Framer Motion)、`packages/ui/src/motion.ts` 的全部导出、`[data-interactive]` aurora hover stripe 的几何方案。

---

## 范围

- `packages/ui/src/motion.ts` —— Framer Motion 预设(ease / duration / spring / transition / variants / stagger / cssMotion)
- `packages/ui/src/styles/tokens.css:65-71` —— CSS 动效 token(`--ease-* / --dur-*`)
- `packages/ui/src/styles/tokens.css:240-294` —— `@keyframes aurora-drift / breath / breath-soft / ink-bleed / ink-blink / shimmer-sweep` + `.aurora-layer` + `.ink-cursor`
- `packages/ui/src/styles/surfaces.css:143-191` —— `[data-interactive]` aurora hover stripe
- `packages/ui/src/styles/typography.css:217-258` —— `.aurora-text` + `@property --aurora-angle` 角度补间
- 设计规范源:`.claude/design-system/04-motion.md`

---

## 1. 核心约束

源:`.claude/design-system/04-motion.md:7-13`、`00-manifesto.md:80-89`("一条曲线")

| 约束 | 值 | 来源 |
|:---|:---|:---|
| **一条主曲线** | `cubic-bezier(0.16, 1, 0.3, 1)` · Expo Out | `tokens.css:65` `--ease-out` |
| **三档时长 + 一档环境** | 120 / 260 / 520 / 1800 ms | `tokens.css:68-71` `--dur-*` |
| **一种弹簧** | Framer Motion spring 预设(soft / precise / bouncy) | `motion.ts:40-47` |

**禁忌**(`04-motion.md:276-285`):
1. 自写 `cubic-bezier(...)`(除非正式加入 tokens)
2. 使用 Tailwind 默认 `ease-in-out` / `ease-out`(不是 Expo Out)
3. `transition: all 0.3s`
4. hover 过渡 > 260ms
5. 列表 stagger 间隔 > 40ms(慢)
6. 单次页面过渡同时动 position + size + color 三个属性
7. `setTimeout` 做动画(用 CSS 或 Framer Motion)

---

## 2. 时长选择

源:`tokens.css:68-71`、`04-motion.md:18-23`

| Token | 时长 | 何时用 |
|:---|---:|:---|
| `--dur-instant` | 120ms | 按钮按下、checkbox 切换、focus-ring 出现 |
| `--dur-quick` | 260ms | hover 状态、dropdown 开合、tab 切换 |
| `--dur-flow` | 520ms | Modal 出入、页面过渡、命令面板 |
| `--dur-ambient` | 1800ms | 呼吸、极光漂移、scroll 驱动氛围 |

CSS 用法:`transition: <prop> var(--dur-quick) var(--ease-out);`
JSX 用法:`<motion.div transition={transition.quick}>`(从 `@aetherblog/ui` 导)

---

## 3. `packages/ui/src/motion.ts` 导出全景

源:`packages/ui/src/motion.ts`(133 行,纯导出文件)

### 3.1 ease(`motion.ts:18-25`)

```ts
export const ease = {
  /** 主曲线:Expo Out。UI 默认选它。 */
  out:   [0.16, 1, 0.3, 1] as const,
  /** 入场反向:快速离场 */
  in:    [0.7, 0, 0.84, 0] as const,
  /** 过渡双向:对称 */
  inOut: [0.87, 0, 0.13, 1] as const,
} as const;
```

CSS `--ease-out` ↔ Framer `ease.out` 一一对应,数值完全一致。

### 3.2 duration(`motion.ts:30-35`)

```ts
export const duration = {
  instant: 0.12,   // 秒(Framer 单位)
  quick:   0.26,
  flow:    0.52,
  ambient: 1.8,
} as const;
```

### 3.3 spring(`motion.ts:40-47`)

```ts
export const spring = {
  /** 温和弹簧:卡片入场、Modal 出入 */
  soft:    { type: 'spring', stiffness: 180, damping: 24 } as const,
  /** 精确弹簧:按钮按压、Toggle 切换 */
  precise: { type: 'spring', stiffness: 320, damping: 30 } as const,
  /** 活泼弹簧:Toast、FAB */
  bouncy:  { type: 'spring', stiffness: 400, damping: 18 } as const,
} as const;
```

**选用规则**:
- **soft** —— 较大元素(卡片、Modal)的入场,带轻微回弹但不夸张
- **precise** —— 小元素的按压反馈,几乎无回弹但有弹性曲线
- **bouncy** —— 强调用户操作触发了什么(Toast 弹出、FAB 召唤),allow overshoot

### 3.4 transition(`motion.ts:52-69`)

```ts
export const transition = {
  instant: { duration: duration.instant, ease: ease.out },
  quick:   { duration: duration.quick,   ease: ease.out },
  flow:    { duration: duration.flow,    ease: ease.out },
  /** 容器 appear:子元素 stagger */
  appear: {
    duration: duration.flow,
    ease: ease.out,
    staggerChildren: 0.04,
  },
  /** 容器 disappear:子元素反向 stagger */
  disappear: {
    duration: duration.quick,
    ease: ease.out,
    staggerChildren: 0.02,
    staggerDirection: -1,
  },
} as const;
```

`transition.appear / disappear` 用作有 children 的 motion 容器(列表、卡片网格等),自动 stagger。

### 3.5 variants(`motion.ts:74-105`)

```ts
export const variants = {
  /** 下方淡入 —— 文字、卡片、通用入场 */
  fadeUp: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit:    { opacity: 0, y: 8 },
  },
  /** 居中缩放 —— Modal / 弹层 */
  scaleIn: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit:    { opacity: 0, scale: 0.98 },
  },
  /** 右侧滑入 —— Sidebar / Drawer */
  slideRight: {
    initial: { opacity: 0, x: -12 },
    animate: { opacity: 1, x: 0 },
    exit:    { opacity: 0, x: -6 },
  },
  /** 顶部落下 —— Toast / Dropdown */
  dropDown: {
    initial: { opacity: 0, y: -8, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit:    { opacity: 0, y: -4, scale: 0.99 },
  },
  /** 仅淡 —— 最轻量 */
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit:    { opacity: 0 },
  },
} as const;
```

**用对的 variant**:
- 内容入场 → `fadeUp`(几乎所有"内容"都该用这个)
- 弹层 → `scaleIn`
- 抽屉 → `slideRight`
- 通知 → `dropDown`
- 路由切换 → `fade`(避免位移大动画与 ViewTransitions 打架)

### 3.6 stagger 辅助(`motion.ts:115-119`)

```ts
export const stagger = (delayMs: number = 40, childEach: number = duration.quick) => ({
  staggerChildren: delayMs / 1000,
  duration: childEach,
  ease: ease.out,
});
```

用法:`<motion.ul transition={stagger(30)}>`(每子元素延迟 30ms)。**不要超过 40ms**(`04-motion.md:281`)。

### 3.7 cssMotion(`motion.ts:124-132`)

```ts
export const cssMotion = {
  easeOut: 'var(--ease-out)',
  easeIn: 'var(--ease-in)',
  easeInOut: 'var(--ease-in-out)',
  durInstant: 'var(--dur-instant)',
  durQuick: 'var(--dur-quick)',
  durFlow: 'var(--dur-flow)',
  durAmbient: 'var(--dur-ambient)',
} as const;
```

供"非 Framer 场景"(如 React `style={{ transition }}`、动态 css 字符串)使用,与 tokens.css 对齐。

### 3.8 index.ts re-export

源:`packages/ui/src/index.ts:25-27`
```ts
// 动效预设 —— ease / duration / spring / transition / variants / stagger / cssMotion
// 消费方示例:import { spring, transition, variants } from '@aetherblog/ui'
export * from './motion';
```

**不要**写 `import { ... } from '@aetherblog/ui/motion'` —— 走根 barrel。

---

## 4. 使用范式

### 4.1 Modal 出入(`04-motion.md:84-99`)

```tsx
import { motion } from 'framer-motion';
import { variants, transition } from '@aetherblog/ui';

<motion.div
  variants={variants.scaleIn}
  initial="initial"
  animate="animate"
  exit="exit"
  transition={transition.flow}
  className="surface-overlay"
>
  {children}
</motion.div>
```

### 4.2 按钮按压(`04-motion.md:101-113`)

```tsx
import { spring } from '@aetherblog/ui';

<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.97 }}
  transition={spring.precise}
>
  {children}
</motion.button>
```

**当前 `Button.tsx:43-44` 用的是 `whileTap={{ scale: 0.98 }}` 且没传 transition,这是已知偏差** —— 见 [04-package-ui.md](./04-package-ui.md) Button 已知问题。

### 4.3 列表 stagger(`04-motion.md:115-129`)

```tsx
<motion.ul
  variants={{ animate: { transition: { staggerChildren: 0.04 } } }}
  initial="initial"
  animate="animate"
>
  {items.map(item => (
    <motion.li key={item.id} variants={variants.fadeUp}>
      ...
    </motion.li>
  ))}
</motion.ul>
```

或更简洁地:`<motion.ul transition={transition.appear}>` —— `transition.appear.staggerChildren` 已经是 0.04。

---

## 5. 纯 CSS 动效

### 5.1 Tailwind 映射(规范侧 `04-motion.md:139-151`)

```ts
// tailwind.config.ts
extend: {
  transitionTimingFunction: {
    aether: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
  transitionDuration: {
    instant: '120ms',
    quick: '260ms',
    flow: '520ms',
    ambient: '1800ms',
  },
}
```

使用:
```html
<div class="transition-all duration-quick ease-aether hover:scale-[1.02]">
```

**禁止** `duration-300 ease-in-out`(Tailwind 默认值,不是 Expo Out)。

### 5.2 关键帧定义在 tokens.css

源:`packages/ui/src/styles/tokens.css:240-294`

```css
@keyframes aurora-drift {
  0%, 100% { transform: translate(0, 0) rotate(0); }
  33%      { transform: translate(2%, -1%) rotate(2deg); }
  66%      { transform: translate(-1%, 2%) rotate(-1deg); }
}

/* 老的对称呼吸,Fraunces SOFT 轴 */
@keyframes breath {
  0%, 100% { font-variation-settings: "opsz" 144, "SOFT" 30, "WONK" 1; }
  50%      { font-variation-settings: "opsz" 144, "SOFT" 80, "WONK" 1; }
}

/* Round 4 新的非对称呼吸 —— 4.8s 周期,对任何字体都生效 */
@keyframes breath-soft {
  0%   { opacity: 0.92; letter-spacing: -0.02em;  filter: brightness(0.98); }
  40%  { opacity: 1;    letter-spacing: -0.015em; filter: brightness(1.04); }   /* 吸气 40% */
  100% { opacity: 0.92; letter-spacing: -0.02em;  filter: brightness(0.98); }   /* 呼气 60% */
}

@keyframes ink-bleed {
  from { opacity: 0; transform: translateY(2px); filter: blur(1.5px); }
  to   { opacity: 1; transform: translateY(0);   filter: blur(0); }
}

@keyframes ink-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.2; }
}

@keyframes shimmer-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

### 5.3 复用类

源:`tokens.css:228-237` + `:296-306`

```css
.aurora-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--aurora-field);
  z-index: 0;
}
.aurora-layer[data-animated="true"] {
  animation: aurora-drift 40s var(--ease-in-out) infinite;
}

.ink-cursor {
  display: inline-block;
  width: 0.4em;
  height: 1em;
  vertical-align: text-bottom;
  background: var(--aurora-1);
  animation: ink-blink 800ms var(--ease-in-out) infinite;
  box-shadow: 0 0 4px var(--aurora-1);
  margin-left: 0.1em;
}
```

`.ink-cursor` —— 命令面板光标 + AI 流式末尾光标,共用同一个类。

---

## 6. 签名动画

### 6.1 极光漂移(全站背景)

`tokens.css:240-244` + `:228-237` + 任一页面在 hero 区添加 `<div class="aurora-layer" data-animated="true">`。`6.aurora-drift 40s var(--ease-in-out) infinite` —— 40 秒一个完整环游,不影响阅读。

### 6.2 Fraunces 呼吸(Hero 标题)

Round 4 升级到 `breath-soft 4.8s cubic-bezier(0.5, 0, 0.25, 1)`(`history.md` Phase 1):
- 4.8s 周期(人类静息呼吸下限 + 审美余裕)
- 吸气 40% 时间(快),呼气 60%(慢) —— 模拟生理节奏
- 只做极细微的亮度 + 字距变化,**不改字形,不撼动布局**

### 6.3 Ink Bleed(AI 流式)

`tokens.css:273-284` 的 `@keyframes ink-bleed` + `typography.css:198-201`:

```css
.ai-stream .delta {
  display: inline;
  animation: ink-bleed 220ms var(--ease-out) both;
  will-change: opacity, transform, filter;
}
```

每个 chunk(句或词)被包成 `<span class="delta">`,生成 220ms 渐显 + 上浮 + 模糊→清晰,模拟"墨水渗入纸张"。

`04-motion.md:447` 禁忌:"❌ 每个字符都单独动画(性能差,按句/按块分片)"。

### 6.4 阅读进度极光条

详见 [02-surfaces-and-typography.md](./02-surfaces-and-typography.md) §21 双路径实现。

### 6.5 Aurora Sweep(`surfaces.css:193-217`)

hover 时从左到右扫过一道极光:

```css
.aurora-sweep::before {
  position: absolute; inset: 0;
  background: linear-gradient(110deg,
    transparent 40%,
    color-mix(in oklch, var(--aurora-1) 20%, transparent) 50%,
    transparent 60%);
  transform: translateX(-100%);
  transition: transform var(--dur-flow) var(--ease-out);
}
.aurora-sweep:hover::before {
  transform: translateX(100%);
}
```

适合:CTA 按钮、签名卡片的次级 hover 反馈、Hero CTA。

---

## 7. `[data-interactive]` Aurora Hover Stripe

源:`packages/ui/src/styles/surfaces.css:143-191`

### 7.1 用法

```html
<a class="surface-leaf" data-interactive>...</a>
<button class="surface-raised" data-interactive>...</button>
```

**任何带 surface-leaf 或 surface-raised 类的元素加上 `data-interactive` 属性,自动获得**:
- hover 时 border-color 变成 `color-mix(in oklch, var(--aurora-1) 30%, transparent)`
- 左边缘出现 2px aurora 光带,沿圆角包裹
- 仅在真实 hover 设备(`(hover: hover) and (pointer: fine)`)生效,移动端触屏不触发

### 7.2 几何方案(Round 4 重写,`surfaces.css:148-154`)

老方案有 bug —— `width: 2px` + `border-*-left-radius: inherit` 会被 radius 钳到 1px,光带变成扁柱形竖在卡片圆弧之外。

新方案:
- `inset: 0` 占满整个卡片
- `border-radius: inherit` 与卡片同形
- `clip-path: inset(0 calc(100% - 2px) 0 0)` 只露出最左 2px

光带左上 / 左下天然沿着卡片圆角弧线收束,不再有视觉错位。

### 7.3 渐变停靠点(Round 4)

```css
background: linear-gradient(to bottom,
  transparent 0%,
  var(--aurora-1) 18%,
  var(--aurora-1) 82%,
  transparent 100%);
```

顶 / 底淡出 —— 中段 18%-82% aurora 实色,顶 0-18% 与底 82-100% 渐淡。这样的纵向极光在卡片顶部 / 底部不会戛然而止,边缘"软化"。

### 7.4 移动端 hover 残留对策

`@media (hover: hover) and (pointer: fine)` 限定:**只有真鼠标设备** hover 才触发。iOS Safari 的 sticky :hover 会让光带残留(用户在 A 卡 hover 后跳到 B 卡,A 卡光带不会消失),这就是限定的根因。

---

## 8. View Transitions(blog 端,`history.md` Round 3)

`apps/blog/next.config.ts` 设 `experimental.viewTransition: true`,在 ArticleCard / FeaturedPost / 文章页 h1 上用:

```tsx
<article style={{ viewTransitionName: `post-${slug}` }}>
<h1 style={{ viewTransitionName: `post-${slug}-title` }}>
```

`globals.css` 定义 `::view-transition-old/new/group`:
- crossfade 420ms · `cubic-bezier(0.32, 0.72, 0, 1)`(Apple Material 标准)
- group morph 560ms · `cubic-bezier(0.22, 0.61, 0.36, 1)`(进入 ease)
- reduce-motion 收缩 group 至 1ms

Chrome 111+ / Safari 18+ 原生 morph,不支持回退普通导航。

---

## 9. 主题切换动画(useTheme)

源:`packages/hooks/src/useTheme.tsx:91-214`

`performCircularTransition(x, y, isDarkToLight, callback)` —— 圆形遮罩主题切换:
- 从点击位置 `(x, y)` 计算最大半径(到屏幕四角)
- `document.startViewTransition(callback)` —— 切类的副作用包在 VT 内
- `transition.ready` 后用 `documentElement.animate({ clipPath: [from, to] }, animOpts)` 驱动 root 层 + mobile-menu-drawer 层
- Safari 特别优化:`will-change: clip-path` + 300ms ease-out + 暂停其他动画(`animation-play-state: paused !important`)
- 不支持 VT API 的浏览器或 reduce-motion 直接调 callback

详见 [05-package-hooks.md](./05-package-hooks.md) §4。

---

## 10. 减动效模式

源:`tokens.css:309-320`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .ink-cursor { animation: none; opacity: 0.6; }
  .aurora-layer { animation: none !important; }
}
```

**例外**(`04-motion.md:271-272`):**状态反馈(聚焦环、按钮反馈)保留 instant(120ms)** —— 因为它们是可用性所需的即时反馈,不是"动画"。

---

## 11. 关键代码引用

| 文件 | 行号 | 内容 |
|:---|---:|:---|
| `packages/ui/src/motion.ts` | 18-25 | `ease` 三档 |
| `packages/ui/src/motion.ts` | 30-35 | `duration` 四档 |
| `packages/ui/src/motion.ts` | 40-47 | `spring` 三档(soft / precise / bouncy) |
| `packages/ui/src/motion.ts` | 52-69 | `transition` 五档(instant / quick / flow / appear / disappear) |
| `packages/ui/src/motion.ts` | 74-105 | `variants` 五档(fadeUp / scaleIn / slideRight / dropDown / fade) |
| `packages/ui/src/motion.ts` | 115-119 | `stagger(delayMs, childEach)` 辅助 |
| `packages/ui/src/motion.ts` | 124-132 | `cssMotion` —— var() 字符串映射 |
| `packages/ui/src/index.ts` | 27 | `export * from './motion'` |
| `packages/ui/src/styles/tokens.css` | 65-71 | CSS `--ease-* / --dur-*` |
| `packages/ui/src/styles/tokens.css` | 240-294 | 6 个全局 `@keyframes` |
| `packages/ui/src/styles/tokens.css` | 228-237 | `.aurora-layer` |
| `packages/ui/src/styles/tokens.css` | 296-306 | `.ink-cursor` |
| `packages/ui/src/styles/tokens.css` | 309-320 | `prefers-reduced-motion` 全局禁用 |
| `packages/ui/src/styles/surfaces.css` | 143-191 | `[data-interactive]` aurora hover stripe |
| `packages/ui/src/styles/surfaces.css` | 193-217 | `.aurora-sweep` |
| `packages/ui/src/styles/typography.css` | 217-258 | `.aurora-text` + `@property --aurora-angle` |
| `packages/ui/src/styles/typography.css` | 273-318 | `.reading-progress` 双路径 |
| `packages/hooks/src/useTheme.tsx` | 91-214 | 主题切换 clip-path 圆形动画 |

---

## 12. 引用的子文档与原始规范

- `.claude/design-system/04-motion.md` —— 动效规范权威
- `.claude/design-system/00-manifesto.md` §80-89 —— "一条曲线"原则
- `.claude/design-system/06-signature-moments.md` —— 五个签名时刻的动效呼应
- `.claude/design-system/history.md` —— Round 3 scroll-timeline / Round 4 呼吸 4.8s 非对称 / Round 4 `@property` 落地

---

## 13. 使用方与扩展点

### 13.1 谁消费 motion.ts

- `packages/ui/src/components/Select.tsx:6` —— `import { transition, variants } from '../motion'`
- `packages/ui/src/components/DateRangePicker.tsx:31` —— 同上
- 各 app 大量 `import { spring, transition, variants } from '@aetherblog/ui'`

### 13.2 谁消费 keyframes

- `apps/blog/app/globals.css` 的 `.hero-title` —— `breath` / `breath-soft`
- `apps/blog/app/components/ReadingProgress.tsx` —— `.reading-progress`
- `apps/admin/src/pages/posts/AiWritingWorkspacePage.tsx` —— `.ai-stream / .delta`(`ink-bleed`)
- 任何带 `.aurora-layer[data-animated]` 的容器 —— `aurora-drift`

### 13.3 加新动效曲线

**默认禁止**。一条主曲线已经够用。若有强烈需求:

1. 在 PR 中说明业务理由
2. 加到 `tokens.css` 的 `--ease-*` 命名空间
3. 同步加到 `motion.ts` 的 `ease` 对象
4. 同步 `04-motion.md` 与 `01-tokens.md`

### 13.4 加新 spring 预设

如果三档不够(soft / precise / bouncy),按 stiffness × damping 二维空间设计:
- 大元素(modal、抽屉) → 低 stiffness + 中 damping
- 小元素(开关、按钮) → 高 stiffness + 高 damping
- 反馈强烈(toast、celebration) → 高 stiffness + 低 damping(allow overshoot)

### 13.5 自定义 variant

可以用 `as const` 做 inline variant,但**避免重复 `fadeUp` 等已有形状**。重复出现 → 应该提到 `motion.ts:variants` 中。

---

## 14. 已知限制

1. **`spring` 没有 mass 参数化** —— 全部用默认 mass=1。`04-motion.md` 推荐 Round 6 把 `bouncy.mass` 降到 0.6。
2. **`stagger` 帮助函数未在内部组件大规模使用** —— 大多数组件直接 inline `transition: { staggerChildren: 0.04 }`。
3. **CSS 端 ↔ Framer 端的 ease 数值是手工同步** —— `motion.ts:20` 的 `[0.16, 1, 0.3, 1]` 与 `tokens.css:65` 的 `cubic-bezier(0.16, 1, 0.3, 1)` 没有自动校验。改一个忘改另一个会静默偏差。
4. **`@property --aurora-angle` 仅 Chrome 85+ / Safari 16.4+ / Firefox 128+ 真补间** —— Firefox ESR 115 仍硬跳。
5. **`animation-timeline: scroll()`** —— 仅 Chrome 115+ 真支持,Safari / Firefox 退到 rAF 路径。
6. **`prefers-reduced-motion`** —— 强 `!important` 关停一切 `animation-duration` —— 但 framer-motion 的 spring 不走 CSS animation-duration,所以不会被禁用。需要组件层主动响应 `usePrefersReducedMotion()`(`packages/hooks/src/useMediaQuery.ts:35`)。
7. **`Button.tsx` 还未消费 `motion.ts` 的 `spring.precise`** —— 它走 inline `whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}` 且不传 transition,默认 framer 用 `tween` 而非 spring。这是已知偏差,见 [04-package-ui.md](./04-package-ui.md)。
