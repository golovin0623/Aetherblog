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
      className="md:hidden fixed right-4 bottom-6 z-40 p-2.5 rounded-full bg-black/10 dark:bg-white/10 text-[var(--text-primary)] opacity-30 hover:opacity-100 backdrop-blur-sm border border-[var(--border-subtle)]/30 transition-all duration-300 shadow-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
    >
      {isDark ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
