'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Calendar, Eye, Folder } from 'lucide-react';

interface ArticleCardProps {
  title: string;
  slug: string;
  summary?: string;
  coverImage?: string;
  category?: { name: string; slug: string };
  tags?: { name: string; slug: string }[];
  publishedAt: string;
  readingTime?: number;
  viewCount?: number;
  isPinned?: boolean;
  index?: number;
}

const ArticleCardBase: React.FC<ArticleCardProps> = ({
  title,
  slug,
  summary,
  coverImage,
  category,
  tags = [],
  publishedAt,
  readingTime,
  viewCount,
  isPinned = false,
  index = 0,
}) => {
  // Use ref for direct DOM manipulation of background position (high freq)
  const spotlightRef = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<number>(0);
  // Use state for opacity (low freq), ensures correct style on re-renders
  const [isHovering, setIsHovering] = React.useState(false);

  // Clean up animation frame on unmount
  React.useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!spotlightRef.current) return;

    // ⚡ Bolt: Extract event properties synchronously before the async requestAnimationFrame callback.
    // This prevents issues with React's synthetic event pooling/nullification and ensures the closure
    // captures the exact values at the time the event fired, avoiding potential runtime TypeErrors.
    // Impact: Avoids unnecessary errors and overhead from accessing pooled event objects during high-frequency mouse movements.
    const { clientX, clientY } = e;
    const target = e.currentTarget;

    // Throttle using requestAnimationFrame to avoid layout thrashing
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = requestAnimationFrame(() => {
      if (!spotlightRef.current) {
        frameRef.current = 0;
        return;
      }
      const rect = target.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      spotlightRef.current.style.background = `radial-gradient(600px circle at ${x}px ${y}px, var(--spotlight-color), transparent 40%)`;
      frameRef.current = 0;
    });
  }, []);

  // 计算显示的标签数量
  const maxVisibleTags = 4;
  const visibleTags = tags.slice(0, maxVisibleTags);
  const remainingTagCount = tags.length - maxVisibleTags;

  return (
    <Link
      href={`/posts/${slug}`}
      className="group block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-2xl"
    >
      <article
        className="relative flex flex-col overflow-hidden rounded-2xl bg-[var(--bg-card)] backdrop-blur-md border border-[var(--border-default)] transition-all duration-300 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-hover)] hover:-translate-y-1 cursor-pointer min-h-[280px] h-full shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-lg)]"
        style={{ animationDelay: `${index * 100}ms` }}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* 顶部装饰条 - 品牌色渐变 */}
        <div className="absolute top-0 left-0 right-0 h-[var(--decoration-bar-height)] bg-[var(--decoration-gradient)] z-30" />

        {/* 聚光灯效果层 */}
        <div
          ref={spotlightRef}
          className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
          style={{
            // Managed by React state to persist correctly across re-renders
            opacity: isHovering ? 'var(--spotlight-opacity)' : 0,
            // Background is managed manually via ref
          }}
        />

        {/* 顶部高亮线条 */}
        <div
          className="absolute top-0 left-0 right-0 h-px z-10"
          style={{
            background: `linear-gradient(to right, transparent, var(--highlight-line), transparent)`
          }}
        />

        {/* 封面图片 */}
        {coverImage && (
          <div className="block aspect-video w-full overflow-hidden relative z-20 shrink-0">
            <Image
              src={coverImage}
              alt={title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </div>
        )}

        {/* 置顶标记 */}
        {isPinned && (
          <div className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full bg-primary/90 text-white text-[10px] font-medium backdrop-blur-sm z-30 shadow-lg shadow-primary/20">
            置顶
          </div>
        )}

        {/* 内容区域 */}
        <div className="flex-1 flex flex-col p-5 relative z-20">
          {/* 分类 & 日期 - 固定高度 */}
          <div className="flex items-center justify-between mb-3 text-xs h-[20px]">
             {category ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-primary to-purple-500 text-white text-[10px] font-medium shadow-sm">
                  <Folder className="h-3 w-3" />
                  {category.name}
                </span>
             ) : (
                <span className="w-1" />
             )}

             <span className="flex items-center gap-1 text-[var(--text-muted)] font-mono">
                <Calendar className="h-3 w-3" />
                {publishedAt}
             </span>
          </div>

          {/* 标题 - 固定高度，悬停时渐变 */}
          <h2 className="mb-1.5 h-[56px]">
            <span
              className="text-lg font-bold text-[var(--text-primary)] group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-purple-500 group-hover:bg-clip-text group-hover:text-transparent group-focus-visible:bg-gradient-to-r group-focus-visible:from-primary group-focus-visible:to-purple-500 group-focus-visible:bg-clip-text group-focus-visible:text-transparent transition-all line-clamp-2 leading-snug"
              title={title}
            >
              {title}
            </span>
          </h2>

          {/* 摘要 - 固定3行高度 */}
          <div className="h-[66px] mb-4 overflow-hidden">
            <p className="text-[var(--text-secondary)] text-sm leading-relaxed line-clamp-3">
              {summary
                ? summary
                    .replace(/[#*`>\\[\\]!|_~]/g, '')
                    .replace(/\\n+/g, ' ')
                    .replace(/\\s+/g, ' ')
                    .trim()
                    .slice(0, 120) + (summary.length > 120 ? '...' : '')
                : title.length > 100
                  ? title.slice(0, 100) + '...'
                  : `${title} - 探索更多精彩内容，点击阅读全文了解详情。`}
            </p>
          </div>

          {/* 底部区域 - 标签和元信息 */}
          <div className="mt-auto pt-3 border-t border-[var(--border-subtle)]">
            {/* 标签 - 固定高度，优化显示 */}
            <div className="flex items-center gap-1.5 h-[24px] mb-2 overflow-hidden">
              {visibleTags.length > 0 ? (
                <>
                  {visibleTags.map((tag) => (
                    <span
                      key={tag.slug}
                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border-subtle)] font-mono whitespace-nowrap"
                    >
                      #{tag.name}
                    </span>
                  ))}
                  {remainingTagCount > 0 && (
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">
                      +{remainingTagCount}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[10px] text-[var(--text-muted)] italic">无标签</span>
              )}
            </div>
    
            {/* 底部元信息 */}
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] h-[20px]">
               <span className="flex items-center gap-1">
                  {readingTime && <span>{readingTime}m 阅读</span>}
               </span>
               
               {viewCount !== undefined && (
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity">
                  <Eye className="h-3 w-3" />
                  {viewCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
};

export const ArticleCard = React.memo(ArticleCardBase);
export default ArticleCard;
