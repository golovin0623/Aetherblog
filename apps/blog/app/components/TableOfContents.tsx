'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { List, ChevronRight, X } from 'lucide-react';
import { extractHeadingsFromMarkdown } from '../lib/headingId';

interface TocItem {
  id: string;
  text: string;
  level: number;
  line: number;
}

interface TableOfContentsProps {
  content: string;
  className?: string;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ content, className = '' }) => {
  const headings = useMemo<TocItem[]>(() => extractHeadingsFromMarkdown(content), [content]);
  const [activeId, setActiveId] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || headings.length === 0) {
      return;
    }

    const callback = (entries: IntersectionObserverEntry[]) => {
      let bestEntry: IntersectionObserverEntry | null = null;

      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
          bestEntry = entry;
        }
      });

      if (bestEntry?.target?.id) {
        setActiveId(bestEntry.target.id);
      }
    };

    observerRef.current = new IntersectionObserver(callback, {
      rootMargin: '-80px 0px -70% 0px',
      threshold: [0, 0.2, 0.5, 0.8],
    });

    headings.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) {
        observerRef.current?.observe(element);
      }
    });

    return () => observerRef.current?.disconnect();
  }, [headings]);

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileOpen]);

  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 88;
      const y = element.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
      setActiveId(id);
      setIsMobileOpen(false);
    }
  };

  if (headings.length === 0) {
    return null;
  }

  const minLevel = Math.min(...headings.map((h) => h.level));

  const tocList = (
    <>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left mb-4 group"
      >
        <div className="p-1.5 rounded-lg bg-[var(--bg-card)] group-hover:bg-[var(--bg-card-hover)] transition-colors border border-[var(--border-subtle)]">
          <List className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-[var(--text-primary)]">目录</span>
        <ChevronRight
          className={`ml-auto h-4 w-4 text-[var(--text-secondary)] transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {isExpanded && (
        <div className="relative pl-2 space-y-1">
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--border-subtle)] rounded-full">
            <div
              className="absolute left-0 w-full bg-primary rounded-full transition-all duration-300"
              style={{
                top: `${
                  Math.max(0, headings.findIndex((h) => h.id === activeId)) / headings.length * 100
                }%`,
                height: `${100 / headings.length}%`,
              }}
            />
          </div>

          {headings.map((heading) => (
            <button
              key={heading.id}
              onClick={() => scrollToHeading(heading.id)}
              className={`block w-full text-left py-1.5 pl-4 pr-2 rounded-r-md text-sm transition-all ${
                activeId === heading.id
                  ? 'text-primary bg-primary/10 border-l-2 border-primary -ml-0.5'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
              }`}
              style={{
                paddingLeft: `${(heading.level - minLevel) * 12 + 16}px`,
              }}
              title={`L${heading.line}`}
            >
              <span className="line-clamp-1">{heading.text}</span>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="mt-4 flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
      >
        <span>↑</span>
        <span>返回顶部</span>
      </button>
    </>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        className="fixed bottom-6 right-5 z-40 md:hidden inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)]/95 px-4 py-2 text-sm text-[var(--text-primary)] shadow-lg backdrop-blur"
      >
        <List className="h-4 w-4 text-primary" />
        目录
      </button>

      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="关闭目录"
            className="absolute inset-0 bg-black/45"
            onClick={() => setIsMobileOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[82vw] max-w-[360px] bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] p-4 overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--text-primary)]">文章目录</span>
              <button
                type="button"
                onClick={() => setIsMobileOpen(false)}
                className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {tocList}
          </div>
        </div>
      )}

      <nav className={`sticky top-24 hidden md:block ${className}`}>{tocList}</nav>
    </>
  );
};

export default TableOfContents;
