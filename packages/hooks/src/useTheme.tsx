'use client';

/**
 * @file useTheme.ts
 * @description 主题切换 Hook - 支持亮/暗主题切换、持久化存储、系统偏好检测
 * @author AI Assistant
 * @created 2026-01-16
 */

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';

// 纯数据常量在独立文件(无 'use client'),以便 Server Component 也能消费。
// 本文件不再 re-export 它们 —— 消费者直接从 '@aetherblog/hooks' 导入即可,
// 通过 index.ts 的 barrel 从 themeConstants.ts 拿到非 client-ref 的值。
export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'aetherblog-theme';

/**
 * 获取系统偏好的主题
 */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 从 localStorage 获取已保存的主题
 */
function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage 不可用
  }
  return 'system';
}

/**
 * 应用主题到 DOM
 */
function applyTheme(resolvedTheme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  
  const root = document.documentElement;
  
  if (resolvedTheme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }
  
  // 同时设置 color-scheme 以支持原生滚动条和表单控件
  root.style.colorScheme = resolvedTheme;
}

/**
 * 检测当前浏览器是否为 Safari/WebKit（非 Chrome/非 Android WebView）。
 * 用于性能调优：Safari 的 clip-path 动画走主线程重绘，需要额外优化。
 */
function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

/**
 * 执行圆形遮罩主题切换动画
 * 使用 View Transitions API，从点击位置开始扩散/收缩
 * 
 * 动画逻辑：
 * - 暗→亮: 新视图(亮色)从点击位置扩散出来
 * - 亮→暗: 旧视图(亮色)向点击位置收缩消失，暴露下面的暗色
 * 
 * 多层动画与性能优化：
 * - 侧边栏和遮罩也需要同步做动画，以保留其真正的 backdrop-filter。
 * - 必须保证各层扩张速度(dr/dt)完全一致，以防止多圈重影割裂。
 * 
 * Safari/WebKit 性能优化策略（不降级，满帧光圈）：
 * - 注入 will-change: clip-path 强制 GPU 图层提升
 * - 动画时长缩短至 300ms + ease-out（前快后慢，视觉更快完成）
 * - 动画期间冻结所有其他 CSS 动画，释放 GPU 算力
 * - contain: layout 减少布局重排
 */
async function performCircularTransition(
  x: number,
  y: number,
  isDarkToLight: boolean,
  callback: () => void
): Promise<void> {
  // 检查浏览器是否支持 View Transitions API
  if (
    typeof document === 'undefined' ||
    !document.startViewTransition ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    // 不支持则直接切换
    callback();
    return;
  }

  const isSafari = isSafariBrowser();

  const Math_hypot = Math.hypot;
  const Math_max = Math.max;

  // 1. 计算出全屏幕物理光圈的标准速度 (dr/dt)
  const maxRadius = Math_hypot(
    Math_max(x, window.innerWidth - x),
    Math_max(y, window.innerHeight - y)
  );

  // Safari 使用更短时长 + ease-out 减少主线程重绘帧数
  const totalDuration = isSafari ? 300 : 350;
  const easing = isSafari ? 'ease-out' : 'cubic-bezier(0.4, 0, 0.2, 1)';

  // 注入性能优化样式（动画期间生效，结束后移除）
  const perfStyle = document.createElement('style');
  perfStyle.textContent = `
    ::view-transition-old(root),
    ::view-transition-new(root) {
      will-change: clip-path;
      contain: layout;
    }
    html[data-theme-transition] *,
    html[data-theme-transition] *::before,
    html[data-theme-transition] *::after {
      animation-play-state: paused !important;
    }
  `;
  document.head.appendChild(perfStyle);

  // 设置动画方向（决定 z-index）
  document.documentElement.dataset.themeTransition = isDarkToLight ? 'to-light' : 'to-dark';

  // 安全网：无论动画成功与否，最迟 totalDuration + 200ms 后强制清理
  const cleanupTimer = setTimeout(() => {
    perfStyle.remove();
    delete document.documentElement.dataset.themeTransition;
  }, totalDuration + 200);

  const transition = document.startViewTransition(() => {
    callback();
  });

  try {
    await transition.ready;

    const animOpts = {
      duration: totalDuration,
      easing,
    };

    // 动画辅助函数：对指定 VT 层应用 clip-path 动画
    const animateLayer = (
      vtName: string,
      localX: number,
      localY: number,
      radius: number
    ) => {
      const from = `circle(0px at ${localX}px ${localY}px)`;
      const to = `circle(${radius}px at ${localX}px ${localY}px)`;
      const pseudo = isDarkToLight
        ? `::view-transition-new(${vtName})`
        : `::view-transition-old(${vtName})`;

      try {
        document.documentElement.animate(
          { clipPath: isDarkToLight ? [from, to] : [to, from] },
          {
            ...animOpts,
            pseudoElement: pseudo,
            ...(isDarkToLight ? {} : { fill: 'forwards' as const }),
          }
        );
      } catch {
        // VT 层不存在时忽略
      }
    };

    // 1) root 层 — 覆盖全视口
    animateLayer('root', x, y, maxRadius);

    // 2) mobile-menu-drawer — 局部视口，由于其隔离在新 VT 层，必须计算自身的最大对角线
    const drawerEl = document.querySelector('.mobile-menu-drawer');
    if (drawerEl) {
      const rect = drawerEl.getBoundingClientRect();
      const drawerX = x - rect.left;
      const drawerY = y - rect.top;
      const drawerRadius = Math_hypot(
        Math_max(drawerX, rect.width - drawerX),
        Math_max(drawerY, rect.height - drawerY)
      );
      animateLayer('mobile-menu-drawer', drawerX, drawerY, drawerRadius);
    }

    // 等待动画跑完
    await new Promise((resolve) => setTimeout(resolve, totalDuration));
    await transition.finished;

  } catch {
    // 失败静默
  } finally {
    clearTimeout(cleanupTimer);
    perfStyle.remove();
    delete document.documentElement.dataset.themeTransition;
  }
}

// 存储最后一次点击位置（用于主题切换动画）
let lastClickPosition = { x: 0, y: 0 };

/**
 * 更新点击位置（供 ThemeToggle 组件调用）
 */
export function setThemeTransitionOrigin(x: number, y: number): void {
  lastClickPosition = { x, y };
}

/**
 * 获取当前点击位置
 */
export function getThemeTransitionOrigin(): { x: number; y: number } {
  return lastClickPosition;
}

export interface UseThemeReturn {
  /** 当前主题设置 (light | dark | system) */
  theme: Theme;
  /** 实际解析后的主题 (light | dark) */
  resolvedTheme: ResolvedTheme;
  /** 是否为暗色主题 */
  isDark: boolean;
  /** 设置主题 */
  setTheme: (theme: Theme) => void;
  /** 切换亮/暗主题（支持圆形动画，需先调用 setThemeTransitionOrigin） */
  toggleTheme: () => void;
  /** 带扩散光圈动画的主题切换（传入点击位置） */
  toggleThemeWithAnimation: (x: number, y: number) => void;
  /** 只带原生的淡入淡出 (Crossfade) 瞬切，用于规避卡顿 */
  toggleThemeWithFade: () => void;
}

// 创建 Context
const ThemeContext = createContext<UseThemeReturn | undefined>(undefined);

/**
 * 主题 Provider 组件
 * 
 * 功能特性:
 * - 支持亮色/暗色/跟随系统三种主题模式
 * - 自动持久化到 localStorage
 * - 支持 View Transitions API 的圆形动画切换
 * - **跨标签页同步**: 在 Blog 修改主题后，Admin 后台会自动同步，反之亦然
 *
 * @example
 * ```tsx
 * // app/layout.tsx (示例)
 * import { ThemeProvider } from '@aetherblog/hooks';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <ThemeProvider>
 *           {children}
 *         </ThemeProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 1. 初始化状态为 'system' 以确保服务端和客户端初次渲染一致
  const [theme, setThemeState] = useState<Theme>('system');
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>('light'); // 默认假设 light，避免 mismatch
  const [mounted, setMounted] = useState(false);
  
  // 监听系统主题变化
  useEffect(() => {
    setMounted(true);
    
    // 初始化系统主题
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
      
      const handleChange = (e: MediaQueryListEvent) => {
        setSystemTheme(e.matches ? 'dark' : 'light');
      };
      
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);

  // 监听跨标签页的主题变化（实现 Blog ↔ Admin 主题同步）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      // 只处理主题相关的变化
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        const newTheme = e.newValue as Theme;
        if (newTheme === 'light' || newTheme === 'dark' || newTheme === 'system') {
          setThemeState(newTheme);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // 初始化用户主题设置 (在挂载后执行，避免 hydration error)
  useEffect(() => {
    const stored = getStoredTheme();
    if (stored !== 'system') {
      setThemeState(stored);
    }
  }, []);
  
  // 解析实际主题
  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    // 如果未挂载，返回 'light' 或默认值以匹配服务端 (SSR 通常在没有类名时默认为 light 样式)
    // 但我们的 themeInitScript 可能已经设置了 dark class。
    // 为了避免 React 水合 (hydration) 报错，React 渲染的内容必须匹配。
    // 如果内容依赖于 isDark (例如图标)，我们应该在挂载前不渲染或者渲染占位符，
    // 或者接受水合不匹配 (hydration mismatch) 然后使用 suppressHydrationWarning。
    // 这里我们选择一致性渲染 ('system' -> 'light') 然后更新。
    if (!mounted) return 'light'; // 服务端默认值
    return theme === 'system' ? systemTheme : theme;
  }, [theme, systemTheme, mounted]);
  
  const isDark = resolvedTheme === 'dark';
  
  // 应用主题到 DOM (Color Scheme & Class)
  // 注意：themeInitScript 已经处理了初始化，这里主要是响应后续变化
  // 当 data-force-dark 存在时（后台强制暗黑模式），跳过应用以避免覆盖
  useEffect(() => {
    if (mounted) {
      if (typeof document !== 'undefined' && document.documentElement.dataset.forceDark === 'true') {
        return; // 强制暗黑模式下不覆盖
      }
      applyTheme(resolvedTheme);
    }
  }, [resolvedTheme, mounted]);
  
  // 设置主题并持久化
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // localStorage 不可用
    }
  }, []);
  
  // 切换主题（使用存储的点击位置触发动画）
  const toggleTheme = useCallback(() => {
    const { x, y } = getThemeTransitionOrigin();
    const newTheme: Theme = resolvedTheme === 'dark' ? 'light' : 'dark';
    const isDarkToLight = resolvedTheme === 'dark';

    performCircularTransition(x, y, isDarkToLight, () => {
      // 同步更新 DOM 类名，确保 View Transitions API 捕获的"新"快照是正确的主题
      applyTheme(newTheme as ResolvedTheme);
      setTheme(newTheme);
    });
  }, [resolvedTheme, setTheme]);

  // 带动画的主题切换（传入点击位置）
  const toggleThemeWithAnimation = useCallback((x: number, y: number) => {
    setThemeTransitionOrigin(x, y);
    const newTheme: Theme = resolvedTheme === 'dark' ? 'light' : 'dark';
    const isDarkToLight = resolvedTheme === 'dark';

    performCircularTransition(x, y, isDarkToLight, () => {
      applyTheme(newTheme as ResolvedTheme);
      setTheme(newTheme);
    });
  }, [resolvedTheme, setTheme]);

  // 只带原生的淡入淡出 (Crossfade) 瞬切，无 clip-path 特效
  const toggleThemeWithFade = useCallback(() => {
    const newTheme: Theme = resolvedTheme === 'dark' ? 'light' : 'dark';

    // 如果支持 View Transitions API，则使用简单的默认过渡（交叉淡入淡出）
    if (typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => {
        applyTheme(newTheme as ResolvedTheme);
        setTheme(newTheme);
      });
    } else {
      setTheme(newTheme);
    }
  }, [resolvedTheme, setTheme]);
  
  // 为避免UI闪烁或错误图标，未挂载时可以返回一个安全状态
  // 但为了 API 兼容性，我们返回计算值

  const value = useMemo<UseThemeReturn>(() => ({
    theme,
    resolvedTheme,
    isDark,
    setTheme,
    toggleTheme,
    toggleThemeWithAnimation,
    toggleThemeWithFade,
  }), [theme, resolvedTheme, isDark, setTheme, toggleTheme, toggleThemeWithAnimation, toggleThemeWithFade]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 主题切换 Hook
 *
 * @example
 * ```tsx
 * const { theme, resolvedTheme, isDark, setTheme, toggleTheme } = useTheme();
 *
 * // 切换主题
 * <button onClick={toggleTheme}>
 *   {isDark ? '🌙' : '☀️'}
 * </button>
 *
 * // 设置特定主题
 * <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
 *   <option value="light">亮色</option>
 *   <option value="dark">暗色</option>
 *   <option value="system">跟随系统</option>
 * </select>
 * ```
 */
export function useTheme(): UseThemeReturn {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}

// themeInitScript / themeFoucGuardStyle / THEME_LIGHT_BG / THEME_DARK_BG
// 均已迁移到 ./themeConstants,从 @aetherblog/hooks 的 barrel 消费。

export default useTheme;
