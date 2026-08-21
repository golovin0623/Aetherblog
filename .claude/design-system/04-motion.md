# 04 · Motion · 动效语言

> 一个产品的动效如果各部件**各说各话**,就会显得廉价。AetherBlog 的动效必须说同一种方言。

---

## 核心约束

- **一条主曲线:** `cubic-bezier(0.16, 1, 0.3, 1)` · Expo Out · `--ease-out`
- **三档时长:** `120ms` / `260ms` / `520ms`
- **一档环境:** `1800ms` · 用于极光漂移、呼吸等非交互的氛围动画
- **一种弹簧:** 当需要弹性反馈(按钮按压、弹窗出入)时用 Framer Motion 的 spring,预设化

---

## 时长选择

| Token | 时长 | 何时用 |
|:---|---:|:---|
| `--dur-instant` | 120ms | 按钮按下、checkbox 切换、focus-ring 出现 |
| `--dur-quick` | 260ms | hover 状态、dropdown 开合、tab 切换 |
| `--dur-flow` | 520ms | Modal 出入、页面过渡、命令面板 |
| `--dur-ambient` | 1800ms | 呼吸、极光、scroll 驱动 |

---

## Framer Motion 预设(`packages/ui/src/motion.ts`)

```ts
// 导出给所有 React 动画使用,禁止在组件内自写 bezier
export const ease = {
  out:   [0.16, 1, 0.3, 1],
  in:    [0.7, 0, 0.84, 0],
  inOut: [0.87, 0, 0.13, 1],
} as const;

export const duration = {
  instant: 0.12,
  quick:   0.26,
  flow:    0.52,
  ambient: 1.8,
} as const;

export const spring = {
  soft:    { type: 'spring', stiffness: 180, damping: 24 } as const,
  precise: { type: 'spring', stiffness: 320, damping: 30 } as const,
  bouncy:  { type: 'spring', stiffness: 400, damping: 18 } as const,
};

export const transition = {
  quick: { duration: duration.quick, ease: ease.out },
  flow:  { duration: duration.flow,  ease: ease.out },
  appear: {
    duration: duration.flow,
    ease: ease.out,
    staggerChildren: 0.04,
  },
} as const;

// 常用 variants
export const variants = {
  fadeUp: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit:    { opacity: 0, y: 8 },
  },
  scaleIn: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit:    { opacity: 0, scale: 0.98 },
  },
  slideRight: {
    initial: { opacity: 0, x: -12 },
    animate: { opacity: 1, x: 0 },
    exit:    { opacity: 0, x: -6 },
  },
} as const;
```

---

## 使用示例

### Modal 出入

```tsx
import { variants, transition } from '@aetherblog/ui/motion';

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

### 按钮按压

```tsx
import { spring } from '@aetherblog/ui/motion';

<motion.button
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.97 }}
  transition={spring.precise}
>
  {children}
</motion.button>
```

### 列表 stagger

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

---

## 纯 CSS 动效

能用 CSS 做的**不用** JS。

### Tailwind 映射(`tailwind.config.ts`)

```ts
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

**禁止** `duration-300 ease-in-out`。

---

## 签名动画

### 1 · 极光漂移(Ambient Drift)

全站极光光源缓慢位移,让背景"活着"。

```css
@keyframes aurora-drift {
  0%   { transform: translate(0, 0)     rotate(0deg); }
  33%  { transform: translate(2%, -1%)  rotate(2deg); }
  66%  { transform: translate(-1%, 2%)  rotate(-1deg); }
  100% { transform: translate(0, 0)     rotate(0deg); }
}

body::before {
  content: '';
  position: fixed; inset: -10%;
  background: var(--aurora-field);
  pointer-events: none;
  z-index: -1;
  animation: aurora-drift 40s var(--ease-in-out) infinite;
}
```

### 2 · 呼吸(Breath)· Fraunces SOFT

见 [03-typography.md](./03-typography.md#可变字体--签名效果)。

### 3 · Ink Bleed · 墨水渗入

AI 流式输出时,每个新出现的文字用渐显 + 微上浮:

```css
@keyframes ink-bleed {
  from { opacity: 0; transform: translateY(2px); filter: blur(1px); }
  to   { opacity: 1; transform: translateY(0);   filter: blur(0);   }
}

.ai-stream > *:not(.streamed) {
  animation: ink-bleed 200ms var(--ease-out) both;
}
```

Wrap 每个 delta 或每个字符时应用。

### 4 · 阅读进度极光条

顶部 2px 条,颜色随阅读进度(0→100%)在 `--aurora-1 → --aurora-4` 间插值:

```css
.reading-progress {
  position: fixed; top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg,
    var(--aurora-1) 0%,
    var(--aurora-2) calc(var(--reading-progress) * 0.5),
    var(--aurora-4) calc(var(--reading-progress) * 1)
  );
  transform: scaleX(var(--reading-progress));
  transform-origin: left;
  z-index: 100;
  pointer-events: none;
  transition: transform 100ms linear;
}
```

JS 更新 `--reading-progress`(0~1)。

### 5 · 光带 hover(Aurora Sweep)

hover 时从左到右扫过一道极光:

```css
.aurora-sweep {
  position: relative;
  overflow: hidden;
}
.aurora-sweep::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(110deg,
    transparent 40%,
    color-mix(in oklch, var(--aurora-1) 20%, transparent) 50%,
    transparent 60%);
  transform: translateX(-100%);
  transition: transform var(--dur-flow) var(--ease-out);
}
.aurora-sweep:hover::after {
  transform: translateX(100%);
}
```

---

## 音乐域动效(musicMotion)

播放器浮岛(orb / compact / expanded 三态形变)与移动端沉浸台的手势物理经过
Playwright 实机门禁(`scripts/verify-music-player-motion.mjs`)多轮调优,数值与
全站三档时长不同属一个语义域,故单独收编为 `musicMotion` 预设(2026-08-16):

```ts
import { musicMotion } from '@aetherblog/ui';

musicMotion.spring.orbSnap;      // 下滑收起 → 回吸成灵动音乐元
musicMotion.spring.rebound;      // 手势未达阈值 → 卡片弹回
musicMotion.spring.reanchor;     // 沉浸台拖拽回锚
musicMotion.ease.glide;          // 音乐域内容出入(pane 切换、封面轮换)
musicMotion.ease.fling;          // 沉浸台下滑离场
musicMotion.duration.*;          // reduced / pane / veil / dialog / swap

// 移动端浮岛三态编排(2026-08-21)
musicMotion.spring.islandEnter;  // 浮岛自锚角浮现(ζ≈0.76,一丝过冲)
musicMotion.spring.sheetZoom;    // 沉浸台自浮岛原位放大 / 收回(ζ≈1.0,不回弹)
musicMotion.ease.emphasis;       // 三态几何形变主曲线
musicMotion.ease.recede;         // 内容退场:短促加速让位
musicMotion.island.*;            // enterScale / exitScale / handoffScale / sheetZoomFrom
musicMotion.duration.morph;      // 窄屏几何形变 440ms
musicMotion.duration.contentDelay; // 内容让几何先走 130ms
```

配套的 CSS 侧令牌在 `packages/ui/src/styles/music-skin.css`(浮岛的形变靠 CSS
几何过渡,不能从 TS 导入,故两侧各存一份并在注释中互指):

```css
--music-morph-dur / --music-morph-ease   /* 几何形变 */
--music-content-dur                      /* 内容淡入淡出 */
--music-content-delay                    /* 内容让位延迟(按目标密度取值) */
--music-ease-emphasis                    /* = musicMotion.ease.emphasis */
--music-ambient-blur                     /* 氛围层高斯半径,形变期砍半 */
```

**规则:** 音乐播放器组件(`MusicPlayerProvider` / `MusicHallExperience` /
`ProfileMusicPlayer`)内禁止出现裸 spring 参数或裸 bezier —— 新的手势物理先在
此预设登记语义,再消费。全站通用交互仍走 `spring` / `transition` 主预设。

**容器形变的两条语法**(浮岛三态,`@media (max-width: 768px)`):

1. **几何先行、内容后到。** `--music-content-delay` 按**目标密度**在浮岛根上取值 ——
   CSS 过渡的 delay 读自目标态规则,因此同一条声明自动表达两个方向:进入更高密度
   时内容延后入场,回落时延迟归零、内容先撤。不要把延迟写成 `transition-delay`
   单独声明,那会连几何一起延后。
2. **主曲线 `--ease-out` 不适合「盒子长大」。** 它是 Expo,前 30% 就吃掉 ~85% 位移,
   用在按钮变色上干脆利落,用在容器尺寸上读成「先炸开再爬行」。容器形变走
   `--music-ease-emphasis`(加速段更长)。

---

## 无障碍

所有非必要动画在 `prefers-reduced-motion` 下必须禁用:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**但** 状态反馈(聚焦环、按钮反馈)保留 instant(120ms),因为它们是可用性所需的即时反馈,不是"动画"。

---

## 禁忌

1. ❌ 自写 `cubic-bezier(...)`(除非正式加入 tokens)
2. ❌ 使用 `ease-in-out` / `ease-out`(Tailwind 默认,不是 Expo Out)
3. ❌ `transition: all 0.3s`
4. ❌ 为 hover 加超过 260ms 的过渡
5. ❌ 为列表项 stagger 设置超过 40ms 间隔(会感觉慢)
6. ❌ 在单次页面过渡中同时动 position + size + color 三个属性(性能差)
7. ❌ 用 `setTimeout` 做动画(用 CSS 或 Framer Motion)
