'use client';

import React from 'react';
import Link from 'next/link';
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

export const ArticleCard: React.FC<ArticleCardProps> = ({
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
  // 鼠标位置状态 (用于光束跟随效果)
  const [mousePosition, setMousePosition] = React.useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = React.useState(false);

  // 监听鼠标移动，更新光束位置
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // 计算显示的标签数量
  const maxVisibleTags = 4;
  const visibleTags = tags.slice(0, maxVisibleTags);
  const remainingTagCount = tags.length - maxVisibleTags;

  return (
    <Link href={`/posts/${slug}`} className="block h-full">
      <article
        className="group relative flex flex-col overflow-hidden rounded-2xl bg-[var(--bg-card)] backdrop-blur-md border border-[var(--border-default)] transition-all duration-300 hover:bg-[var(--bg-card-hover)] hover:border-[var(--border-hover)] hover:-translate-y-1 cursor-pointer min-h-[280px] h-full shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-primary)]"
        style={{ animationDelay: `${index * 100}ms` }}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* 顶部装饰条 - 品牌色渐变 */}
        <div className="absolute top-0 left-0 right-0 h-[var(--decoration-bar-height)] bg-[var(--decoration-gradient)] z-30" />

        {/* 聚光灯效果层 */}
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, var(--spotlight-color), transparent 40%)`,
            opacity: isHovering ? 'var(--spotlight-opacity)' : 0,
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
            <img
              src={coverImage}
              alt={title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
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
              className="text-lg font-bold text-[var(--text-primary)] group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-purple-500 group-hover:bg-clip-text group-hover:text-transparent transition-all line-clamp-2 leading-snug"
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
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

export default ArticleCard;

