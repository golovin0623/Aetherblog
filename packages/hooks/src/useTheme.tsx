'use client';

/**
 * @file useTheme.ts
 * @description 主题切换 Hook - 支持亮/暗主题切换、持久化存储、系统偏好检测
 * @author AI Assistant
 * @created 2026-01-16
 */

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';

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
 * 执行圆形遮罩主题切换动画
 * 使用 View Transitions API，从点击位置开始扩散/收缩
 * 
 * 动画逻辑：
 * - 暗→亮: 新视图(亮色)从点击位置扩散出来
 * - 亮→暗: 旧视图(亮色)向点击位置收缩消失，暴露下面的暗色
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

  // 计算最大半径（从点击位置到最远角落的距离）
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  // 设置动画方向，用于 CSS z-index 控制
  document.documentElement.dataset.themeTransition = isDarkToLight ? 'to-light' : 'to-dark';

  // 开始 View Transition
  const transition = document.startViewTransition(() => {
    callback();
  });

  try {
    await transition.ready;

    // 根据切换方向选择动画目标和方向
    // 暗→亮: 动画新视图(亮色)从0扩散到全屏，新视图在上层
    // 亮→暗: 动画旧视图(亮色)从全屏收缩到0，旧视图在上层
    
    if (isDarkToLight) {
      // 暗→亮: 新的亮色视图从点击处扩散
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 500,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      );
    } else {
      // 亮→暗: 旧的亮色视图向点击处收缩消失
      document.documentElement.animate(
        {
          clipPath: [
            `circle(${endRadius}px at ${x}px ${y}px)`,
            `circle(0px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 500,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-old(root)',
          fill: 'forwards', // 保持最终状态，防止闪烁
        }
      );
    }

    // 动画完成后清理
    await transition.finished;
  } catch {
    // 动画失败时静默处理
  } finally {
    // 使用 requestAnimationFrame 延迟清理，避免闪烁
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        delete document.documentElement.dataset.themeTransition;
      });
    });
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
  /** 带动画的主题切换（传入点击位置） */
  toggleThemeWithAnimation: (x: number, y: number) => void;
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
  useEffect(() => {
    if (mounted) {
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
      setTheme(newTheme);
    });
  }, [resolvedTheme, setTheme]);
  
  // 带动画的主题切换（传入点击位置）
  const toggleThemeWithAnimation = useCallback((x: number, y: number) => {
    setThemeTransitionOrigin(x, y);
    const newTheme: Theme = resolvedTheme === 'dark' ? 'light' : 'dark';
    const isDarkToLight = resolvedTheme === 'dark';
    
    performCircularTransition(x, y, isDarkToLight, () => {
      setTheme(newTheme);
    });
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
  }), [theme, resolvedTheme, isDark, setTheme, toggleTheme, toggleThemeWithAnimation]);

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

/**
 * 主题初始化脚本 (用于避免 FOUC)
 * 
 * 在 <head> 中内联此脚本，在 CSS 加载前应用主题类名
 * 
 * @example
 * ```tsx
 * // Next.js 布局文件 layout.tsx
 * <head>
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
 * </head>
 * ```
 */
export const themeInitScript = `
(function() {
  try {
    var theme = localStorage.getItem('${THEME_STORAGE_KEY}');
    var isDark = theme === 'dark' || 
      (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.add(isDark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default useTheme;
