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
  return (
    <article
      className="group relative overflow-hidden rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* 封面图片 */}
      {coverImage && (
        <Link href={`/posts/${slug}`} className="block aspect-video overflow-hidden">
          <img
            src={coverImage}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </Link>
      )}

      {/* 置顶标记 */}
      {isPinned && (
        <div className="absolute top-4 left-4 px-3 py-1 rounded-full bg-primary/90 text-white text-xs font-medium backdrop-blur-sm">
          置顶
        </div>
      )}

      {/* 内容区域 */}
      <div className="p-6">
        {/* 分类 */}
        {category && (
          <Link
            href={`/categories/${category.slug}`}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors mb-3"
          >
            <Folder className="h-3 w-3" />
            {category.name}
          </Link>
        )}

        {/* 标题 */}
        <h2 className="mb-3">
          <Link
            href={`/posts/${slug}`}
            className="text-xl font-bold text-white hover:text-primary transition-colors line-clamp-2"
          >
            {title}
          </Link>
        </h2>

        {/* 摘要 */}
        {summary && (
          <p className="text-gray-400 text-sm leading-relaxed line-clamp-3 mb-4">
            {summary}
          </p>
        )}

        {/* 标签 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {tags.slice(0, 3).map((tag) => (
              <Link
                key={tag.slug}
                href={`/tags/${tag.slug}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-400 border border-white/5 hover:bg-primary/10 hover:text-primary hover:border-primary/20 transition-all"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag.name}
              </Link>
            ))}
          </div>
        )}

        {/* 元信息 */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {publishedAt}
          </span>
          {readingTime && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {readingTime} 分钟
            </span>
          )}
          {viewCount !== undefined && (
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {viewCount}
            </span>
          )}
        </div>
      </div>

      {/* 悬浮光效 */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-primary/20 via-transparent to-primary/20" />
      </div>
    </article>
  );
};

export default ArticleCard;
