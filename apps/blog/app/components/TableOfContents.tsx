'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { List, ChevronRight, X, ArrowUp } from 'lucide-react';
import { extractHeadingsFromMarkdown } from '../lib/headingId';
import { motion, AnimatePresence } from 'framer-motion';

interface TocItem {
  id: string;
  text: string;
  level: number;
  line: number;
}

interface TableOfContentsProps {
  content: string;
  className?: string;
  variant?: 'floating' | 'icon' | 'sidebar';
  triggerClassName?: string;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({
  content,
  className = '',
  variant = 'floating',
  triggerClassName = ''
}) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const headings = useMemo<TocItem[]>(() => extractHeadingsFromMarkdown(content), [content]);
  const [activeId, setActiveId] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleHeadingsRef = useRef<Set<string>>(new Set());

  // 监听标题可见性以更新当前活动项
  useEffect(() => {
    if (typeof window === 'undefined' || headings.length === 0) {
      return;
    }

    const callback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleHeadingsRef.current.add(entry.target.id);
        } else {
          visibleHeadingsRef.current.delete(entry.target.id);
        }
      });

      // 找到第一个在可见集合中的标题（利用 headings 的 DOM 顺序）
      // 这样避免了使用 getBoundingClientRect() 导致的重排 (Reflow)
      const firstVisible = headings.find((heading) => visibleHeadingsRef.current.has(heading.id));
      if (firstVisible) {
        setActiveId(firstVisible.id);
      }
    };

    observerRef.current = new IntersectionObserver(callback, {
      rootMargin: '-100px 0px -70% 0px',
      threshold: [0, 1],
    });

    headings.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) {
        observerRef.current?.observe(element);
      }
    });

    return () => {
      observerRef.current?.disconnect();
      visibleHeadingsRef.current.clear();
    };
  }, [headings]);

  // 禁止背景滚动
  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isDrawerOpen]);

  // 监听滚动以更新“正在阅读”状态
  useEffect(() => {
    let rafId: number | null = null;

    const handleScroll = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          setIsReading(window.scrollY > 400);
          rafId = null;
        });
      }
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 100; // 考虑固定头部的偏移
      const y = element.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
      setActiveId(id);
      setIsDrawerOpen(false);
    }
  };

  const minLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1;

  // 渲染目录列表内容
  const renderTocList = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
           <div className="p-1.5 rounded-lg bg-primary/10">
             <List className="h-4 w-4 text-primary" />
           </div>
           <span className="font-bold text-[var(--text-primary)]">
             {variant === 'sidebar' ? '文章目录' : '目录'}
           </span>
        </div>
        {variant !== 'sidebar' && (
           <button
             onClick={() => setIsExpanded(!isExpanded)}
             className="p-1 hover:bg-[var(--bg-card-hover)] rounded-md transition-colors"
           >
             <ChevronRight
               className={`h-4 w-4 text-[var(--text-secondary)] transition-transform duration-300 ${
                 isExpanded ? 'rotate-90' : ''
               }`}
             />
           </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {headings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-card)]/50 px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                暂无目录项
              </div>
            ) : (
              <div className={`relative pl-1 space-y-0.5 ${variant === "sidebar" ? "max-h-[60vh]" : "max-h-[70vh]"} overflow-y-auto custom-scrollbar pr-2`}>
                {/* 进度轨道 */}
                <div className="absolute left-0 top-0 bottom-0 w-[1.5px] bg-[var(--border-subtle)]/50 rounded-full" />

                {headings.map((heading) => {
                  const isActive = activeId === heading.id;
                  return (
                    <button
                      key={heading.id}
                      onClick={() => scrollToHeading(heading.id)}
                      className={`group relative block w-full text-left py-2 px-4 rounded-lg text-sm transition-all duration-200 ${
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
                          layoutId="active-indicator"
                          className="absolute left-0 top-2 bottom-2 w-[2px] bg-primary rounded-full"
                        />
                      )}
                      <span className="line-clamp-1">{heading.text}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-auto pt-4 border-t border-[var(--border-subtle)]/50">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium text-[var(--text-muted)] hover:text-primary hover:bg-primary/5 transition-all duration-300 border border-transparent hover:border-primary/20"
        >
          <ArrowUp className="h-4 w-4" />
          <span>返回顶部</span>
        </button>
      </div>
    </div>
  );

  // Sidebar 变体：直接渲染列表
  if (variant === 'sidebar') {
    return (
      <div className={`w-full ${className}`}>
        {renderTocList()}
      </div>
    );
  }

  // 返回 Trigger 按钮和 Drawer
  return (
    <>
      {/* Trigger 按钮 */}
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setIsDrawerOpen(true)}
          className={`inline-flex items-center justify-center h-7 w-7 rounded-full border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-primary hover:border-primary/40 transition-all ${triggerClassName}`}
          title="文章目录"
          aria-label="文章目录"
        >
          <List size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsDrawerOpen(true)}
          className={`fixed right-6 bottom-8 z-[55] flex items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/80 px-5 py-3 text-sm font-medium text-[var(--text-primary)] backdrop-blur-xl shadow-2xl transition-all duration-500 ${
            isReading ? 'translate-y-2 opacity-40 scale-95 blur-[0.5px]' : 'translate-y-0 opacity-100'
          } hover:opacity-100 hover:scale-105 hover:blur-0 hover:shadow-primary/20 hover:border-primary/30 ${triggerClassName}`}
        >
          <List className="h-4 w-4 text-primary" />
          <span>目录</span>
        </button>
      )}

      {/* Drawer */}
      {mounted && createPortal(
        <AnimatePresence>
        {isDrawerOpen && (
          <div className="fixed inset-0 z-[100]">
            {/* 背景遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />

            {/* 面板内容 */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`absolute right-0 top-0 h-full w-2/3 md:w-[380px] bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] shadow-2xl p-6 overflow-hidden flex flex-col ${className}`}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">文章导航</h3>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-2 rounded-xl hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-hidden">
                {renderTocList()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default TableOfContents;
