'use client';

import React from 'react';
import Link from 'next/link';
import { Calendar, Clock, Eye, Tag, Folder } from 'lucide-react';
import MiniMarkdownPreview from './MiniMarkdownPreview';

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
    <Link href={`/posts/${slug}`} className="block">
      <article
        className="group relative flex flex-col overflow-hidden rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1 h-full cursor-pointer"
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
        <div className="flex-1 flex flex-col p-5 relative z-20 min-h-0">
          <div className="mb-auto">
            {/* 分类 & 日期 */}
            <div className="flex items-center justify-between mb-3 text-xs">
               {category ? (
                  <span className="flex items-center gap-1.5 text-primary">
                    <Folder className="h-3 w-3" />
                    {category.name}
                  </span>
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
              <span
                className="text-lg font-bold text-white group-hover:text-primary transition-colors line-clamp-2 leading-snug"
                title={title}
              >
                {title}
              </span>
            </h2>

            {/* 摘要 - 使用 MiniMarkdownPreview 渲染并限制行数 */}
            {summary && (
              <div className="text-gray-400 text-sm leading-relaxed line-clamp-2 md:line-clamp-3 mb-4 overflow-hidden">
                <MiniMarkdownPreview content={summary} maxLength={150} />
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-3">
              {/* 标签 */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 h-[26px] overflow-hidden">
                  {tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag.slug}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-white/5 text-gray-500 border border-white/5 font-mono"
                    >
                      #{tag.name}
                    </span>
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
    </Link>
  );
};

export default ArticleCard;
