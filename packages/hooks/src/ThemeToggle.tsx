/**
 * @文件ThemeToggle.tsx
 * @description 主题切换按钮组件 - 太阳/月亮图标切换，带圆形扩散动画
 * @作者人工智能助手
 * @创建于2026-01-16
 */

'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, Theme } from './useTheme';

/**
 * ThemeToggle 文案 —— 通过 props 注入以便 i18n。
 * 默认中文与项目主体语言保持一致;
 * 在多语种场景下消费者可全部或部分覆盖。
 */
export interface ThemeToggleLabels {
  /** 简单模式下按钮 title / aria-label 模板 (动态拼接当前 isDark 状态) */
  toLight: string;
  toDark: string;
  /** 下拉触发器 title */
  selectTitle: string;
  /** 下拉触发器 aria-label 前缀 ("当前主题：X{selectAction}") */
  currentPrefix: string;
  selectAction: string;
  /** 下拉菜单 aria-label */
  menuLabel: string;
  /** 选项文案 */
  optionLight: string;
  optionDark: string;
  optionSystem: string;
}

const DEFAULT_LABELS: ThemeToggleLabels = {
  toLight: '切换到亮色主题',
  toDark: '切换到暗色主题',
  selectTitle: '选择主题',
  currentPrefix: '当前主题：',
  selectAction: '。点击选择主题',
  menuLabel: '主题选项',
  optionLight: '亮色',
  optionDark: '暗色',
  optionSystem: '系统',
};

export interface ThemeToggleProps {
  /** 按钮尺寸 */
  size?: 'sm' | 'md' | 'lg';
  /** 是否显示系统选项 */
  showSystem?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 自定义文案 (i18n) ——
   * 局部覆盖默认中文文案; 仅传入需要替换的字段即可。 */
  labels?: Partial<ThemeToggleLabels>;
}

const sizeMap = {
  sm: { button: 'w-8 h-8', icon: 'w-4 h-4' },
  md: { button: 'w-10 h-10', icon: 'w-5 h-5' },
  lg: { button: 'w-12 h-12', icon: 'w-6 h-6' },
};

/**
 * 主题切换按钮组件
 * 
 * @例子
 * ````tsx
 * // 简单使用
 * <主题切换/>
 * 
 * // 带系统选项的下拉
 * <主题切换显示系统/>
 * 
 * // 自定义尺寸
 * <主题切换大小=“lg”/>
 * ```
 */
export function ThemeToggle({
  size = 'md',
  showSystem = false,
  className = '',
  labels: labelsProp,
}: ThemeToggleProps) {
  const { theme, isDark, setTheme, toggleThemeWithAnimation } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const { button: buttonSize, icon: iconSize } = sizeMap[size];
  const labels: ThemeToggleLabels = { ...DEFAULT_LABELS, ...labelsProp };
  const toggleLabel = isDark ? labels.toLight : labels.toDark;

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // 处理主题切换（带圆形动画）
  const handleToggle = (e: React.MouseEvent) => {
    const x = e.clientX;
    const y = e.clientY;
    toggleThemeWithAnimation(x, y);
  };

  if (!mounted) {
    return <div className={`relative flex items-center justify-center rounded-full bg-transparent ${buttonSize} ${className}`} />;
  }

  // 简单模式：点击切换
  if (!showSystem) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        data-theme-toggle
        className={`
          relative flex items-center justify-center rounded-full
          bg-transparent hover:bg-[var(--bg-card)]
          border border-transparent hover:border-[var(--border-default)]
          transition-[background-color,border-color,color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]
          ${buttonSize} ${className}
        `}
        title={toggleLabel}
        aria-label={toggleLabel}
      >
        <span className={`relative block ${iconSize}`} aria-hidden="true">
          <AnimatePresence mode="wait" initial={false}>
            {isDark ? (
              <motion.span
                key="moon"
                initial={{ rotate: -35, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 35, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <Moon className={`${iconSize} text-[var(--text-secondary)]`} />
              </motion.span>
            ) : (
              <motion.span
                key="sun"
                initial={{ rotate: 35, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -35, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <Sun className={`${iconSize} text-[var(--text-secondary)]`} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </button>
    );
  }

  // 带系统选项的下拉菜单
  const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'light', icon: <Sun className={iconSize} />, label: labels.optionLight },
    { value: 'dark', icon: <Moon className={iconSize} />, label: labels.optionDark },
    { value: 'system', icon: <Monitor className={iconSize} />, label: labels.optionSystem },
  ];

  // 触发器 aria-label 包含当前主题, 屏幕阅读器无需展开菜单即可知晓状态。
  // 标点完全由 labels (currentPrefix / selectAction) 控制, 便于多语言定制。
  const currentOptionLabel = options.find((o) => o.value === theme)?.label ?? '';
  const triggerAriaLabel = `${labels.currentPrefix}${currentOptionLabel}${labels.selectAction}`;

  const currentIcon = theme === 'system'
    ? <Monitor className={iconSize} />
    : theme === 'dark'
      ? <Moon className={iconSize} />
      : <Sun className={iconSize} />;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-theme-toggle
        className={`
          relative flex items-center justify-center rounded-full
          bg-transparent hover:bg-[var(--bg-card)]
          border border-transparent hover:border-[var(--border-default)]
          transition-[background-color,border-color,color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]
          ${buttonSize}
        `}
        title={labels.selectTitle}
        aria-label={triggerAriaLabel}
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
              role="menu"
              aria-label={labels.menuLabel}
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
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setTheme(option.value);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]
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
