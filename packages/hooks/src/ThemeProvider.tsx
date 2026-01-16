/**
 * @file ThemeProvider.tsx
 * @description 主题提供者组件 - 为应用提供主题上下文
 * @author AI Assistant
 * @created 2026-01-16
 */

'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useTheme, UseThemeReturn, Theme, ResolvedTheme, themeInitScript } from './useTheme';

// 创建主题上下文
const ThemeContext = createContext<UseThemeReturn | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** 默认主题 */
  defaultTheme?: Theme;
}

/**
 * 主题提供者组件
 * 
 * @example
 * ```tsx
 * // App.tsx 或 layout.tsx
 * import { ThemeProvider } from '@aetherblog/hooks';
 * 
 * export default function App({ children }) {
 *   return (
 *     <ThemeProvider>
 *       {children}
 *     </ThemeProvider>
 *   );
 * }
 * ```
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeValue = useTheme();
  
  return (
    <ThemeContext.Provider value={themeValue}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 获取主题上下文 Hook
 * 
 * @throws 如果在 ThemeProvider 外部使用会抛出错误
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isDark, toggleTheme } = useThemeContext();
 *   return <button onClick={toggleTheme}>{isDark ? '🌙' : '☀️'}</button>;
 * }
 * ```
 */
export function useThemeContext(): UseThemeReturn {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}

// 导出类型 (themeInitScript 已从 useTheme 导出)
export type { Theme, ResolvedTheme, UseThemeReturn };

export default ThemeProvider;
