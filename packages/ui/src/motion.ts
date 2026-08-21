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
 *   glide    —— 音乐域内容出入的柔和曲线(pane 切换、封面轮换)
 *   fling    —— 沉浸台下滑离场的顺势加速曲线
 *
 * 移动端浮岛编排(2026-08 三态动效重制)追加的语义:
 *   emphasis   —— 三态几何形变主曲线。主曲线 ease.out 是 Expo:前 30% 就走完
 *                 ~85% 位移,用在「盒子长大」上会读成「先弹一下再爬」;emphasis
 *                 把加速段拉长,让容器像被推开而不是被弹开。
 *   recede     —— 内容退场:短促加速离场,绝不与几何抢戏。
 *   islandEnter—— 浮岛从锚角浮现(ζ≈0.76,允许一丝过冲,像实体落位)
 *   sheetZoom  —— 沉浸台自浮岛原位放大 / 收回(ζ≈1.0,整屏面不许回弹)
 */
export const musicMotion = {
  ease: {
    glide: [0.22, 1, 0.36, 1] as const,
    fling: [0.32, 0.72, 0, 1] as const,
    emphasis: [0.32, 0.9, 0.24, 1] as const,
    recede: [0.62, 0, 0.86, 0.24] as const,
  },
  spring: {
    orbSnap:  { type: 'spring', stiffness: 460, damping: 40, mass: 0.68 } as const,
    rebound:  { type: 'spring', stiffness: 440, damping: 38, mass: 0.72 } as const,
    reanchor: { type: 'spring', stiffness: 420, damping: 40, mass: 0.8 } as const,
    islandEnter: { type: 'spring', stiffness: 380, damping: 28, mass: 0.9 } as const,
    sheetZoom:   { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 } as const,
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
    /** 封面横向轮换 */
    swap: 0.24,
    /** 浮岛浮现时透明度追随形变的窗口 */
    islandEnter: 0.34,
    /** 浮岛收起:比浮现短,收敛回锚点不留尾巴 */
    islandExit: 0.22,
    /** 移动端三态几何形变(与 CSS --music-morph-dur 对齐) */
    morph: 0.44,
    /** 形变期间内容跟随入场(与 CSS --music-content-dur 对齐) */
    contentIn: 0.28,
    /** 浮岛交接给沉浸台时的短促淡出(仅 Framer 侧消费,CSS 无对应令牌) */
    contentOut: 0.12,
    /**
     * 内容让几何先走 ~30% 行程后再入场(与 CSS --music-content-delay 对齐)。
     * 这是 Apple 容器形变的核心语法:几何先动、内容后到,反向则内容先走、
     * 几何后收。没有这层错峰,内容会在半成型的空盒子里闪现。
     */
    contentDelay: 0.13,
  },
  /**
   * 浮岛显隐的锚点缩放 —— **仅触屏视口消费**。浮岛的 transform-origin 恒为
   * left bottom(它就贴在屏幕左下角),所以「缩放」等价于「从锚角长出来 /
   * 缩回锚角」,不需要额外位移,也就不会和拖拽占用的 y 打架。
   *
   * 指针端浮岛沿用既有的 opacity-only 入场(transition.quick):AGENTS.md
   * §移动端 UI 开发约定要求「修改移动端样式时不得影响桌面端」,而这一档缩放
   * 是为 52px 的灵动音乐元调的,套在指针端那条横幅上本就偏重。
   *
   *   enterScale   —— 浮现起手(52px 的元,缩得狠才读得出「浮现」)
   *   exitScale    —— 收起落点
   *   handoffScale —— 交接给沉浸台时反向微放:像被展开的整屏吸走,而非原地消失
   */
  island: {
    enterScale: 0.62,
    exitScale: 0.7,
    handoffScale: 1.05,
    /** 沉浸台自浮岛原位放大的起手比例(见 MusicPlayerProvider 的 sheetOrigin) */
    sheetZoomFrom: 0.82,
  },
} as const;
