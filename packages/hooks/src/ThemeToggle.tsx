/**
 * @file ThemeToggle.tsx
 * @description 主题切换按钮组件 - 太阳/月亮图标切换
 * @author AI Assistant
 * @created 2026-01-16
 */

'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, Theme } from './useTheme';

export interface ThemeToggleProps {
  /** 按钮尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 是否显示系统选项 */
  showSystem?: boolean;
  /** 自定义类名 */
  className?: string;
}

const sizeMap = {
  sm: { button: 'w-8 h-8', icon: 'w-4 h-4' },
  md: { button: 'w-10 h-10', icon: 'w-5 h-5' },
  lg: { button: 'w-12 h-12', icon: 'w-6 h-6' },
};

/**
 * 主题切换按钮组件
 * 
 * @example
 * ```tsx
 * // 简单使用
 * <ThemeToggle />
 * 
 * // 带系统选项的下拉
 * <ThemeToggle showSystem />
 * 
 * // 自定义尺寸
 * <ThemeToggle size="lg" />
 * ```
 */
export function ThemeToggle({ 
  size = 'md', 
  showSystem = false,
  className = '' 
}: ThemeToggleProps) {
  const { theme, resolvedTheme, isDark, setTheme, toggleTheme } = useTheme();
  const [isOpen, setIsOpen] = React.useState(false);
  const { button: buttonSize, icon: iconSize } = sizeMap[size];
  
  // 简单模式：点击切换
  if (!showSystem) {
    return (
      <motion.button
        onClick={toggleTheme}
        whileHover={{ scale: 1.1, rotate: 15 }}
        whileTap={{ scale: 0.9 }}
        className={`
          relative flex items-center justify-center rounded-full
          bg-transparent hover:bg-[var(--bg-card)]
          border border-transparent hover:border-[var(--border-default)]
          transition-colors duration-300 ease-out
          ${buttonSize} ${className}
        `}
        title={isDark ? '切换到亮色主题' : '切换到暗色主题'}
        aria-label="Toggle theme"
      >
        <AnimatePresence mode="wait">
          {isDark ? (
            <motion.div
              key="moon"
              initial={{ rotate: -180, opacity: 0, scale: 0.3 }}
              animate={{
                rotate: 0,
                opacity: 1,
                scale: 1,
              }}
              exit={{ rotate: 180, opacity: 0, scale: 0.3 }}
              transition={{
                duration: 0.4,
                ease: [0.34, 1.56, 0.64, 1]
              }}
            >
              <Moon className={`${iconSize} text-[var(--text-secondary)]`} />
            </motion.div>
          ) : (
            <motion.div
              key="sun"
              initial={{ rotate: 180, opacity: 0, scale: 0.3 }}
              animate={{
                rotate: 0,
                opacity: 1,
                scale: 1,
              }}
              exit={{ rotate: -180, opacity: 0, scale: 0.3 }}
              transition={{
                duration: 0.4,
                ease: [0.34, 1.56, 0.64, 1]
              }}
            >
              <Sun className={`${iconSize} text-[var(--text-secondary)]`} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    );
  }
  
  // 带系统选项的下拉菜单
  const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'light', icon: <Sun className={iconSize} />, label: '亮色' },
    { value: 'dark', icon: <Moon className={iconSize} />, label: '暗色' },
    { value: 'system', icon: <Monitor className={iconSize} />, label: '系统' },
  ];
  
  const currentIcon = theme === 'system' 
    ? <Monitor className={iconSize} />
    : theme === 'dark' 
      ? <Moon className={iconSize} /> 
      : <Sun className={iconSize} />;
  
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          relative flex items-center justify-center rounded-full
          bg-transparent hover:bg-[var(--bg-card)]
          border border-transparent hover:border-[var(--border-default)]
          transition-all duration-300 ease-out
          ${buttonSize}
        `}
        title="选择主题"
        aria-label="Select theme"
      >
        <motion.div
          initial={false}
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          {currentIcon}
        </motion.div>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <>
            {/* 背景遮罩 */}
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />
            
            {/* 下拉菜单 */}
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="
                absolute right-0 top-full mt-2 z-50
                min-w-[120px] p-1.5 rounded-xl
                bg-[var(--bg-secondary)] backdrop-blur-xl
                border border-[var(--border-default)]
                shadow-lg
              "
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setTheme(option.value);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors
                    ${theme === option.value 
                      ? 'bg-[var(--color-primary)] bg-opacity-20 text-[var(--color-primary)]' 
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]'
                    }
                  `}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ThemeToggle;
