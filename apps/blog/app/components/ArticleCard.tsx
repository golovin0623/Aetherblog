'use client';

import React from 'react';
import Link from 'next/link';
import { Calendar, Clock, Eye, Tag, Folder } from 'lucide-react';

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

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"
      style={{ animationDelay: `${index * 100}ms` }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 聚光灯效果层 */}
      <div 
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(99, 102, 241, 0.1), transparent 40%)`,
          opacity: isHovering ? 1 : 0,
        }}
      />

      {/* 顶部高亮线条 */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent z-10" />

      {/* 封面图片 */}
      {coverImage && (
        <Link href={`/posts/${slug}`} className="block aspect-video w-full overflow-hidden relative z-20 shrink-0">
          <img
            src={coverImage}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </Link>
      )}

      {/* 置顶标记 */}
      {isPinned && (
        <div className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full bg-primary/90 text-white text-[10px] font-medium backdrop-blur-sm z-30 shadow-lg shadow-primary/20">
          置顶
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 flex flex-col p-5 relative z-20 min-h-0">
        <div className="mb-auto">
          {/* 分类 & 日期 */}
          <div className="flex items-center justify-between mb-3 text-xs">
             {category ? (
                <Link
                  href={`/categories/${category.slug}`}
                  className="flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors"
                >
                  <Folder className="h-3 w-3" />
                  {category.name}
                </Link>
             ) : (
                <span className="w-1" />
             )}
             
             <span className="flex items-center gap-1 text-gray-500 font-mono">
                <Calendar className="h-3 w-3" />
                {publishedAt}
             </span>
          </div>

          {/* 标题 */}
          <h2 className="mb-3">
            <Link
              href={`/posts/${slug}`}
              className="text-lg font-bold text-white hover:text-primary transition-colors line-clamp-2 leading-snug"
              title={title}
            >
              {title}
            </Link>
          </h2>

          {/* 摘要 - 限制行数 */}
          {summary && (
            <p className="text-gray-400 text-sm leading-relaxed line-clamp-2 md:line-clamp-3 mb-4 overflow-hidden text-ellipsis">
              {summary}
            </p>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-3">
            {/* 标签 */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 h-[26px] overflow-hidden">
                {tags.slice(0, 3).map((tag) => (
                  <Link
                    key={tag.slug}
                    href={`/tags/${tag.slug}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-500 border border-white/5 hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all font-mono"
                  >
                    #{tag.name}
                  </Link>
                ))}
              </div>
            )}
    
            {/* 底部元信息 */}
            <div className="flex items-center justify-between text-xs text-gray-600">
               <div className="flex items-center gap-3">
                  {readingTime && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {readingTime}m
                    </span>
                  )}
               </div>
               
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
  );
};

export default ArticleCard;
