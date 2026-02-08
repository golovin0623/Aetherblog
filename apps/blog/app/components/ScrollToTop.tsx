'use client';
import { useEffect, useState, useRef } from 'react';
import { ArrowUp } from 'lucide-react';

export const ScrollToTop = () => {
  const [isVisible, setIsVisible] = useState(false);
  const circleRef = useRef<SVGCircleElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const updateScroll = () => {
      const scrollY = window.scrollY;
      const shouldBeVisible = scrollY > 300;

      // Update visibility state only if changed to minimize re-render checks
      setIsVisible(prev => {
        if (prev !== shouldBeVisible) return shouldBeVisible;
        return prev;
      });

      // Update progress ring directly via DOM
      if (circleRef.current) {
        const height = document.documentElement.scrollHeight - window.innerHeight;
        // Avoid division by zero and clamp value between 0 and 1
        const progress = height > 0 ? Math.min(1, Math.max(0, scrollY / height)) : 0;
        const offset = 113 - progress * 113;
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
    // Initial check
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
      onClick={scrollToTop}
      className={`fixed bottom-8 right-8 z-50 p-2 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-lg transition-all duration-300 group hover:scale-110 active:scale-95 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
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
            strokeDasharray="113"
            strokeDashoffset="113"
            strokeLinecap="round"
            className="transition-all duration-75 ease-out"
          />
        </svg>
        <ArrowUp className="w-5 h-5 text-[var(--text-primary)] group-hover:text-[var(--color-primary)] transition-colors duration-300" />
      </div>
    </button>
  );
};
