'use client';

/**
 * @file useTheme.ts
 * @description 主题切换 Hook - 支持亮/暗主题切换、持久化存储、系统偏好检测
 * @author AI Assistant
 * @created 2026-01-16
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

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

export interface UseThemeReturn {
  /** 当前主题设置 (light | dark | system) */
  theme: Theme;
  /** 实际解析后的主题 (light | dark) */
  resolvedTheme: ResolvedTheme;
  /** 是否为暗色主题 */
  isDark: boolean;
  /** 设置主题 */
  setTheme: (theme: Theme) => void;
  /** 切换亮/暗主题 */
  toggleTheme: () => void;
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

  // 初始化用户主题设置 (在挂载后执行，避免 hydration error)
  useEffect(() => {
    const stored = getStoredTheme();
    if (stored !== 'system') {
      setThemeState(stored);
    }
  }, []);
  
  // 解析实际主题
  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    // 如果未挂载，返回 'light' 或默认值以匹配服务端 (SRR usually defaults to light in CSS if no class)
    // 但我们的 themeInitScript 可能已经设置了 dark class。
    // 为了避免 react hydration 报错，React 渲染的内容必须匹配。
    // 如果 content 依赖于 isDark (例如图标)，我们应该在 mounted 前不渲染或者渲染占位符，
    // 或者接受 hydration mismatch 然后用 suppressHydrationWarning。
    // 这里我们选择 consistent rendering ('system' -> 'light') then update.
    if (!mounted) return 'light'; // Server default
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
  
  // 切换主题
  const toggleTheme = useCallback(() => {
    const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  }, [resolvedTheme, setTheme]);
  
  // 为避免UI闪烁或错误图标，未挂载时可以返回一个安全状态
  // 但为了 API 兼容性，我们返回计算值
  
  return {
    theme,
    resolvedTheme,
    isDark,
    setTheme,
    toggleTheme,
  };
}

/**
 * 主题初始化脚本 (用于避免 FOUC)
 * 
 * 在 <head> 中内联此脚本，在 CSS 加载前应用主题类名
 * 
 * @example
 * ```tsx
 * // Next.js layout.tsx
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
