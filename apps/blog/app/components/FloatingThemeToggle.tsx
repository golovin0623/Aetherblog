'use client';

import { Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@aetherblog/hooks';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * 移动端重页面列表：这些页面包含大量高成本环境光/毛玻璃效果。
 * 在移动端 GPU 算力有限时，clip-path 圆形扩散动画会与这些 blur filter 叠加，
 * 导致 GPU/主线程压力骤增、动画卡顿。
 * 对这些页面降级为 fade 过渡，以保证流畅性；PC 端不受影响（按钮本身 md:hidden）。
 */
const MOBILE_HEAVY_PAGES = ['/', '/timeline', '/friends', '/posts'];

/**
 * 全局移动端悬浮主题切换按钮
 * 位于屏幕右下角，视觉极弱，专职用于触发主题切换。
 * - 轻量页面（文章详情等）：使用 clip-path 圆形扩散动画
 * - 重量页面（首页/时间轴/友链/文章列表）：降级为 fade 过渡，避免移动端卡顿
 * 此按钮本身为 md:hidden，修改只影响移动端。
 */
export default function FloatingThemeToggle() {
  const { isDark, toggleThemeWithAnimation, toggleThemeWithFade } = useTheme();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // 判断当前路由是否属于移动端重页面
  const isHeavyPage = MOBILE_HEAVY_PAGES.includes(pathname);

  return (
    <button
      type="button"
      onClick={(e) => {
        // 防止和底部导航或滚动冲突
        e.preventDefault();
        if (isHeavyPage) {
          // 移动端重页面：降级为 fade 过渡，避免 clip-path 动画与大量 blur/glow 叠加卡顿
          toggleThemeWithFade();
        } else {
          const x = e.clientX;
          const y = e.clientY;
          toggleThemeWithAnimation(x, y);
        }
      }}
      className="md:hidden fixed right-6 bottom-8 z-[60] w-[44px] h-[44px] rounded-full 
        bg-[var(--bg-primary)]/70 dark:bg-white/[0.06]
        border border-[var(--border-default)]/60 dark:border-white/[0.08]
        shadow-[0_2px_12px_rgba(0,0,0,0.06)] 
        dark:shadow-[0_2px_12px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.04)]
        backdrop-blur-2xl
        transition-all duration-300 hover:scale-110 hover:bg-[var(--bg-card)] hover:border-[var(--border-hover)]/30 active:scale-95 
        flex items-center justify-center group 
        focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none overflow-hidden"
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
            <Moon className="w-5 h-5 text-[var(--text-secondary)]" />
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
            <Sun className="w-5 h-5 text-[var(--text-secondary)]" />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
