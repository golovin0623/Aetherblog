'use client';

import { Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@aetherblog/hooks';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * 全局移动端悬浮主题切换按钮
 * 位于屏幕右下角，视觉极弱，专职用于触发主题切换。
 * 所有页面统一使用 clip-path 圆形扩散动画。主题切换期间的性能兜底
 * 在 globals.css/useTheme 中完成：隐藏环境光、关闭高成本 blur、禁用路由
 * morph 的具名 View Transition 层，避免移动端看到卡片压住光圈。
 * 此按钮本身为 md:hidden，修改只影响移动端。
 */
export default function FloatingThemeToggle() {
  const { isDark, toggleThemeWithAnimation } = useTheme();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // Agent 工作台自带主题入口，不让全局浮层占用 fixed bottom-right 位置
  // 与 composer / FAB 相互遮挡。
  if (pathname.startsWith('/agent/workspace')) return null;

  return (
    <button
      type="button"
      data-theme-toggle
      onClick={(e) => {
        // 防止和底部导航或滚动冲突
        e.preventDefault();
        const x = e.clientX;
        const y = e.clientY;
        toggleThemeWithAnimation(x, y);
      }}
      className="surface-raised !rounded-full md:hidden fixed right-6 bottom-8 z-[60] w-[44px] h-[44px]
        theme-toggle-vt
        transition-[background-color,border-color,color,box-shadow,opacity] duration-200
        flex items-center justify-center group
        focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] focus-visible:outline-none overflow-hidden"
      aria-label={isDark ? '切换到亮色主题' : '切换到暗色主题'}
      title={isDark ? '切换到亮色主题' : '切换到暗色主题'}
    >
      <span className="relative block h-5 w-5" aria-hidden="true">
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
              <Moon className="w-5 h-5 text-[var(--text-secondary)]" />
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
              <Sun className="w-5 h-5 text-[var(--text-secondary)]" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}
