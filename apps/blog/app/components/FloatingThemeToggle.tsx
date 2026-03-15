'use client';

import { Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@aetherblog/hooks';
import { useEffect, useState } from 'react';

/**
 * 全局移动端悬浮主题切换按钮
 * 位于屏幕中心靠左边缘或者底部，视觉极弱 (opacity-20)，
 * 专职用于触发非常丝滑的硬件加速 clip-path 扩散动画。
 * 图标在切换时带有旋转+缩放动画，提升视觉美感。
 */
export default function FloatingThemeToggle() {
  const { isDark, toggleThemeWithAnimation } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // 防止和底部导航或滚动冲突
        e.preventDefault();
        const x = e.clientX;
        const y = e.clientY;
        toggleThemeWithAnimation(x, y);
      }}
      className="md:hidden fixed right-6 bottom-8 z-[60] w-[44px] h-[44px] rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-lg backdrop-blur-xl transition-all duration-300 hover:scale-110 active:scale-95 flex items-center justify-center text-primary group focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none overflow-hidden"
      aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.span
            key="moon"
            initial={{ rotate: -90, scale: 0, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center justify-center"
          >
            <Moon className="w-5 h-5 text-primary" />
          </motion.span>
        ) : (
          <motion.span
            key="sun"
            initial={{ rotate: 90, scale: 0, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: -90, scale: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center justify-center"
          >
            <Sun className="w-5 h-5 text-primary" />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
