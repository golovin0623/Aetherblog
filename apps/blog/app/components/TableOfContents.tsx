'use client';

import React, { useState, useEffect, useRef } from 'react';
import { List, ChevronRight } from 'lucide-react';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  content: string;
  className?: string;
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ content, className = '' }) => {
  const [headings, setHeadings] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // 从内容中提取标题
  useEffect(() => {
    const regex = /^(#{1,6})\s+(.+)$/gm;
    const items: TocItem[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const level = match[1].length;
      const text = match[2].replace(/[*_`]/g, ''); // 移除markdown格式
      const id = text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]/g, '');

      items.push({ id, text, level });
    }

    setHeadings(items);
  }, [content]);

  // 监听滚动高亮当前标题
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const callback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveId(entry.target.id);
        }
      });
    };

    observerRef.current = new IntersectionObserver(callback, {
      rootMargin: '-80px 0px -80% 0px',
      threshold: 0,
    });

    headings.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) {
        observerRef.current?.observe(element);
      }
    });

    return () => observerRef.current?.disconnect();
  }, [headings]);

  // 滚动到标题
  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 80;
      const y = element.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  if (headings.length === 0) return null;

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <nav className={`sticky top-24 ${className}`}>
      {/* 标题 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left mb-4 group"
      >
        <div className="p-1.5 rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
          <List className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium text-white">目录</span>
        <ChevronRight
          className={`ml-auto h-4 w-4 text-gray-500 transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {/* 目录列表 */}
      {isExpanded && (
        <div className="relative pl-2 space-y-1">
          {/* 进度条 */}
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white/10 rounded-full">
            <div
              className="absolute left-0 w-full bg-primary rounded-full transition-all duration-300"
              style={{
                top: `${
                  (headings.findIndex((h) => h.id === activeId) / headings.length) * 100
                }%`,
                height: `${100 / headings.length}%`,
              }}
            />
          </div>

          {/* 标题项 */}
          {headings.map((heading) => (
            <button
              key={heading.id}
              onClick={() => scrollToHeading(heading.id)}
              className={`block w-full text-left py-1.5 pl-4 pr-2 rounded-r-md text-sm transition-all ${
                activeId === heading.id
                  ? 'text-primary bg-primary/10 border-l-2 border-primary -ml-0.5'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
              style={{
                paddingLeft: `${(heading.level - minLevel) * 12 + 16}px`,
              }}
            >
              <span className="line-clamp-1">{heading.text}</span>
            </button>
          ))}
        </div>
      )}

      {/* 返回顶部 */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="mt-4 flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg text-sm text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
      >
        <span>↑</span>
        <span>返回顶部</span>
      </button>
    </nav>
  );
};

export default TableOfContents;
