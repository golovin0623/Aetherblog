/**
 * AetherBlog · Motion Preset
 * -----------------------------------------------------------
 * 规范:.claude/design-system/04-motion.md
 *
 * 使用:
 *   import { spring, transition, variants, duration, ease } from '@aetherblog/ui';
 *
 *   <motion.div variants={variants.fadeUp} initial="initial" animate="animate" transition={transition.flow} />
 *   <motion.button whileTap={{ scale: 0.97 }} transition={spring.precise} />
 *
 * 禁止:在组件内直接写 cubic-bezier / spring.stiffness 数值。
 */

/* -----------------------------------------------------------
 * 缓动曲线 —— 与 CSS 的 --ease-* 令牌一一对应
 * ----------------------------------------------------------- */
export const ease = {
  /** 主曲线:Expo Out。UI 默认选它。 */
  out: [0.16, 1, 0.3, 1] as const,
  /** 入场反向:快速离场 */
  in: [0.7, 0, 0.84, 0] as const,
  /** 过渡双向:对称 */
  inOut: [0.87, 0, 0.13, 1] as const,
} as const;

/* -----------------------------------------------------------
 * 时长 —— 与 CSS 的 --dur-* 令牌一一对应(单位秒,Framer)
 * ----------------------------------------------------------- */
export const duration = {
  instant: 0.12,
  quick:   0.26,
  flow:    0.52,
  ambient: 1.8,
} as const;

/* -----------------------------------------------------------
 * 弹簧预设 —— 弹簧物理参数
 * ----------------------------------------------------------- */
export const spring = {
  /** 温和弹簧:卡片入场、Modal 出入 */
  soft: { type: 'spring', stiffness: 180, damping: 24 } as const,
  /** 精确弹簧:按钮按压、Toggle 切换 */
  precise: { type: 'spring', stiffness: 320, damping: 30 } as const,
  /** 活泼弹簧:Toast、FAB */
  bouncy: { type: 'spring', stiffness: 400, damping: 18 } as const,
} as const;

/* -----------------------------------------------------------
 * 过渡预设 —— 常用的 transition 配置
 * ----------------------------------------------------------- */
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

/* -----------------------------------------------------------
 * 通用 Variants —— Framer Motion variants 预设
 * ----------------------------------------------------------- */
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

/* -----------------------------------------------------------
 * 辅助函数
 * ----------------------------------------------------------- */

/**
 * stagger —— 生成子元素逐个入场的 transition
 * @example transition={stagger(30)}
 */
export const stagger = (delayMs: number = 40, childEach: number = duration.quick) => ({
  staggerChildren: delayMs / 1000,
  duration: childEach,
  ease: ease.out,
});

/**
 * CSS var 值(供非 Framer 场景使用,与 tokens 对齐)
 */
export const cssMotion = {
  easeOut: 'var(--ease-out)',
  easeIn: 'var(--ease-in)',
  easeInOut: 'var(--ease-in-out)',
  durInstant: 'var(--dur-instant)',
  durQuick: 'var(--dur-quick)',
  durFlow: 'var(--dur-flow)',
  durAmbient: 'var(--dur-ambient)',
} as const;

/* -----------------------------------------------------------
 * 音乐域动效 —— 播放器浮岛 / 沉浸台专属物理参数
 * -----------------------------------------------------------
 * 这些数值经过浮岛手势多轮实机调优(见 scripts/verify-music-player-motion.mjs
 * 的 Playwright 门禁),从 MusicPlayerProvider 收编至此,禁止在组件内
 * 重新散落裸数值。语义:
 *   orbSnap  —— 下滑收起后,壳体回吸成灵动音乐元的收势
 *   rebound  —— 手势未达阈值时,卡片弹回原位
 *   reanchor —— 沉浸台拖拽未达阈值的回锚
 *   sheet    —— 移动端沉浸台共享布局形变(layoutId 过渡)
 *   glide    —— 音乐域内容出入的柔和曲线(pane 切换、封面轮换)
 *   fling    —— 沉浸台下滑离场的顺势加速曲线
 */
export const musicMotion = {
  ease: {
    glide: [0.22, 1, 0.36, 1] as const,
    fling: [0.32, 0.72, 0, 1] as const,
  },
  spring: {
    orbSnap:  { type: 'spring', stiffness: 460, damping: 40, mass: 0.68 } as const,
    rebound:  { type: 'spring', stiffness: 440, damping: 38, mass: 0.72 } as const,
    reanchor: { type: 'spring', stiffness: 420, damping: 40, mass: 0.8 } as const,
    sheet:    { type: 'spring', stiffness: 360, damping: 36, mass: 0.82 } as const,
  },
  duration: {
    /** prefers-reduced-motion 下的极短淡入淡出 */
    reduced: 0.08,
    /** 沉浸台 pane(播放/歌词/队列)切换 */
    pane: 0.16,
    /** 背景遮罩淡入 */
    veil: 0.18,
    /** 对话框整体淡入 */
    dialog: 0.2,
    /** 沉浸台缩放入场 */
    zoom: 0.22,
    /** 封面横向轮换 */
    swap: 0.24,
  },
} as const;
