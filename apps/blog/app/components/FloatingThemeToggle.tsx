'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@aetherblog/hooks';
import { useEffect, useState } from 'react';

/**
 * 全局移动端悬浮主题切换按钮
 * 位于屏幕中心靠左边缘或者底部，视觉极弱 (opacity-20)，
 * 专职用于触发非常丝滑的硬件加速 clip-path 扩散动画。
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
      className="md:hidden fixed right-6 bottom-8 z-40 w-[44px] h-[44px] rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-lg backdrop-blur-xl transition-all duration-300 hover:scale-110 active:scale-95 flex items-center justify-center text-primary group focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
    >
      {isDark ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
    </button>
  );
}
