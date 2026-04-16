'use client';
import React, { useEffect, useState, useRef } from 'react';
import { ArrowUp } from 'lucide-react';

const STROKE_CIRCUMFERENCE = 113;

const ScrollToTopBase = () => {
  const [isVisible, setIsVisible] = useState(false);
  const circleRef = useRef<SVGCircleElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const updateScroll = () => {
      const scrollY = window.scrollY;
      const shouldBeVisible = scrollY > 300;

      // 仅在状态改变时更新可见性，以减少重渲染检查次数
      // React 会自动跳过相同 state 的更新，因此直接使用 setter 即可
      setIsVisible(shouldBeVisible);

      // 直接通过 DOM 更新进度环
      if (circleRef.current) {
        const height = document.documentElement.scrollHeight - window.innerHeight;
        // 避免除以零，并将值钳制在 0 到 1 之间
        const progress = height > 0 ? Math.min(1, Math.max(0, scrollY / height)) : 0;
        const offset = STROKE_CIRCUMFERENCE * (1 - progress);
        circleRef.current.style.strokeDashoffset = `${offset}`;
      }

      rafRef.current = null;
    };

    const onScroll = () => {
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(updateScroll);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    // 初始检查
    updateScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <button
      type="button"
      onClick={scrollToTop}
      className={`surface-raised !rounded-full fixed bottom-8 right-8 z-50 p-2 transition-all duration-300 group hover:scale-110 active:scale-95 hidden md:block focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
        isVisible ? 'md:opacity-100 md:translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
      }`}
      aria-label="返回顶部"
      tabIndex={isVisible ? 0 : -1}
    >
      <div className="relative flex items-center justify-center w-10 h-10">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border-subtle)" strokeWidth="2" />
          <circle
            ref={circleRef}
            cx="22"
            cy="22"
            r="18"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2"
            strokeDasharray={STROKE_CIRCUMFERENCE}
            strokeDashoffset={STROKE_CIRCUMFERENCE}
            strokeLinecap="round"
            className="transition-all duration-75 ease-out"
          />
        </svg>
        <ArrowUp className="w-5 h-5 text-[var(--text-primary)] group-hover:text-[var(--color-primary)] transition-colors duration-300" />
      </div>
    </button>
  );
};

// ⚡ Bolt: 添加 React.memo() 以避免父组件（如 ClientLayout）重渲染时 ScrollToTop 组件
// 不必要的重渲染，因为该组件不接收任何 props。
export const ScrollToTop = React.memo(ScrollToTopBase);
