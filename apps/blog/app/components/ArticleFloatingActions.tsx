/**
 * @file ArticleFloatingActions.tsx
 * @description 文章详情页移动端悬浮操作按钮组 - 目录快捷入口 + 回顶部
 * @ref §8.1 - 博客前台模块
 */

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { List, ArrowUp } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { extractHeadingsFromMarkdown } from '../lib/headingId';

const STROKE_CIRCUMFERENCE = 113;

interface TocItem {
  id: string;
  text: string;
  level: number;
  line: number;
}

interface ArticleFloatingActionsProps {
  /** Markdown 内容，供 TOC 使用 */
  content: string;
}

export default function ArticleFloatingActions({ content }: ArticleFloatingActionsProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeId, setActiveId] = useState('');
  const circleRef = useRef<SVGCircleElement>(null);
  const rafRef = useRef<number | null>(null);
  const visibleHeadingsRef = useRef<Set<string>>(new Set());

  const headings = useMemo<TocItem[]>(
    () => extractHeadingsFromMarkdown(content),
    [content]
  );
  const minLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1;

  useEffect(() => {
    setMounted(true);
  }, []);

  // 检测是否移动端
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };
    handleChange(mql);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  // 滚动监听：控制可见性 + 更新进度环
  useEffect(() => {
    if (!isMobile) return;

    const updateScroll = () => {
      const scrollY = window.scrollY;
      setIsVisible(scrollY > 400);

      if (circleRef.current) {
        const height = document.documentElement.scrollHeight - window.innerHeight;
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
    updateScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isMobile]);

  // 标题可见性监听
  useEffect(() => {
    if (!isMobile || headings.length === 0) return;

    const callback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleHeadingsRef.current.add(entry.target.id);
        } else {
          visibleHeadingsRef.current.delete(entry.target.id);
        }
      });
      const firstVisible = headings.find((h) => visibleHeadingsRef.current.has(h.id));
      if (firstVisible) setActiveId(firstVisible.id);
    };

    const observer = new IntersectionObserver(callback, {
      rootMargin: '-100px 0px -70% 0px',
      threshold: [0, 1],
    });

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
      visibleHeadingsRef.current.clear();
    };
  }, [isMobile, headings]);

  // 禁止背景滚动
  useEffect(() => {
    if (!isTocOpen || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isTocOpen, isMobile]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top: y, behavior: 'smooth' });
      setActiveId(id);
      setIsTocOpen(false);
    }
  }, []);

  if (!isMobile) return null;

  return (
    <>
      {/* FAB 按钮组 */}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
            className="fixed bottom-8 right-6 z-50 flex flex-col items-center gap-3"
          >
            {/* 目录按钮 */}
            <button
              onClick={() => setIsTocOpen(true)}
              className="p-2.5 rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-lg backdrop-blur-xl transition-all duration-300 hover:scale-110 active:scale-95"
              aria-label="打开目录"
            >
              <List className="w-5 h-5 text-primary" />
            </button>

            {/* 回顶部按钮 */}
            <button
              onClick={scrollToTop}
              className="p-2 rounded-full bg-[var(--bg-card)]/80 border border-[var(--border-subtle)] shadow-lg backdrop-blur-xl transition-all duration-300 group hover:scale-110 active:scale-95"
              aria-label="返回顶部"
            >
              <div className="relative flex items-center justify-center w-8 h-8">
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
                <ArrowUp className="w-4 h-4 text-[var(--text-primary)] group-hover:text-[var(--color-primary)] transition-colors duration-300" />
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOC Drawer */}
      {mounted && createPortal(
        <AnimatePresence>
          {isTocOpen && (
            <div className="fixed inset-0 z-[100]">
              {/* 背景遮罩 */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsTocOpen(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />

              {/* Bottom Sheet 面板 */}
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                className="absolute bottom-0 left-0 right-0 max-h-[66vh] bg-[var(--bg-primary)] border-t border-[var(--border-subtle)] rounded-t-3xl shadow-2xl p-6 overflow-hidden flex flex-col"
              >
                {/* Drag Handle */}
                <div className="flex justify-center mb-4">
                  <div className="w-10 h-1 rounded-full bg-[var(--text-muted)]/30" />
                </div>

                {/* 标题 */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 rounded-lg bg-primary/10">
                    <List className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-bold text-[var(--text-primary)]">文章目录</span>
                </div>

                {/* 目录列表 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                  {headings.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-card)]/50 px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                      暂无目录项
                    </div>
                  ) : (
                    <div className="relative pl-1 space-y-0.5">
                      <div className="absolute left-0 top-0 bottom-0 w-[1.5px] bg-[var(--border-subtle)]/50 rounded-full" />
                      {headings.map((heading) => {
                        const isActive = activeId === heading.id;
                        return (
                          <button
                            key={heading.id}
                            onClick={() => scrollToHeading(heading.id)}
                            className={`group relative block w-full text-left py-2.5 px-4 rounded-lg text-sm transition-all duration-200 ${
                              isActive
                                ? 'text-primary bg-primary/5 font-medium'
                                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                            }`}
                            style={{
                              paddingLeft: `${(heading.level - minLevel) * 12 + 16}px`,
                            }}
                          >
                            {isActive && (
                              <motion.div
                                layoutId="mobile-toc-indicator"
                                className="absolute left-0 top-2 bottom-2 w-[2px] bg-primary rounded-full"
                              />
                            )}
                            <span className="line-clamp-2">{heading.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 返回顶部 */}
                <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]/50">
                  <button
                    onClick={() => {
                      setIsTocOpen(false);
                      scrollToTop();
                    }}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:text-primary hover:bg-primary/5 transition-all duration-300 border border-transparent hover:border-primary/20"
                  >
                    <ArrowUp className="h-4 w-4" />
                    <span>返回顶部</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
