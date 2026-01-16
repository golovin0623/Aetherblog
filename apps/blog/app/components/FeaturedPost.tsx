'use client';

import React from 'react';
import Link from 'next/link';
import { Calendar, Folder, ArrowRight } from 'lucide-react';
import MiniMarkdownPreview from './MiniMarkdownPreview';

interface FeaturedPostProps {
  post: {
    title: string;
    slug: string;
    summary?: string;
    coverImage?: string;
    publishedAt: string;
    category?: { name: string; slug: string };
    tags?: { name: string; slug: string }[];
    contentPreview?: string; // Optional raw content for preview
  };
}

export const FeaturedPost: React.FC<FeaturedPostProps> = ({ post }) => {
  // Logic to generate summary from content if summary is missing
  const displaySummary = post.summary 
    ? post.summary 
    : post.contentPreview 
        ? post.contentPreview.slice(0, 500) + '...' 
        : '暂无摘要';

  // 鼠标位置状态
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

  // 根据标题长度动态调整字号
  const titleLength = post.title.length;
  
  const titleSizeClass = titleLength > 40
    ? 'text-base md:text-lg'
    : titleLength > 25
      ? 'text-lg md:text-xl'
      : titleLength > 15
        ? 'text-xl md:text-2xl'
        : 'text-2xl md:text-3xl';

  return (
    <div
        className="relative group rounded-3xl bg-[var(--bg-card)] border border-[var(--border-default)] overflow-hidden backdrop-blur-xl transition-all hover:border-[var(--border-hover)] min-h-[33vh] max-h-[66vh] lg:min-h-0 lg:max-h-none lg:h-full flex flex-col duration-300 shadow-[var(--shadow-md)] hover:shadow-[var(--shadow-primary-lg)]"
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
            background: `radial-gradient(1000px circle at ${mousePosition.x}px ${mousePosition.y}px, var(--spotlight-color), transparent 40%)`,
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

        <div className="grid lg:grid-cols-3 h-full max-h-full overflow-hidden relative z-20">
            {/* Left Content Section (1/3 width on desktop, 100% on mobile) */}
            <div className="lg:col-span-1 p-6 md:p-8 flex flex-col h-full border-b lg:border-b-0 lg:border-r border-[var(--border-subtle)] overflow-hidden">
                <div className="flex flex-col items-start min-h-0 flex-1 overflow-hidden">
                     {/* Meta Info: Category, Date */}
                    <div className="flex items-center gap-3 text-[10px] font-medium text-primary mb-3">
                        {post.category && (
                            <Link href={`/categories/${post.category.slug}`} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-primary to-purple-500 text-white shadow-sm hover:shadow-md transition-all">
                                <Folder className="w-3 h-3" />
                                <span>{post.category.name}</span>
                            </Link>
                        )}
                        <div className="flex items-center gap-1 text-[var(--text-muted)] font-mono">
                            <Calendar className="w-3 h-3" />
                            <span>{post.publishedAt}</span>
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className={`${titleSizeClass} font-bold text-[var(--text-primary)] mb-3 leading-tight group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-purple-500 group-hover:bg-clip-text group-hover:text-transparent transition-all cursor-pointer`}>
                        <Link href={`/posts/${post.slug}`}>
                            {post.title}
                        </Link>
                    </h1>
                    
                    {/* Tags (New Style) */}
                    {post.tags && post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {post.tags.slice(0, 2).map(tag => (
                                <span key={tag.slug} className="text-xs font-medium text-primary bg-primary/10 border border-primary/20 px-2.5 py-0.5 rounded-full hover:bg-primary/20 hover:border-primary/30 transition-all duration-300 backdrop-blur-sm">
                                    #{tag.name}
                                </span>
                            ))}
                            {post.tags.length > 2 && (
                                <span className="text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-subtle)] px-2 py-0.5 rounded-full cursor-default backdrop-blur-sm">
                                    +{post.tags.length - 2}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Summary - Adaptive height with fade mask */}
                    <div 
                      className="text-[var(--text-secondary)] text-sm leading-relaxed mb-4 flex-1 min-h-0 overflow-y-auto"
                      style={{
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                        maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
                        WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)'
                      }}
                    >
                        <MiniMarkdownPreview content={displaySummary} maxLength={800} />
                    </div>
                </div>

                {/* Read More Button */}
                <Link
                    href={`/posts/${post.slug}`}
                    className="inline-flex items-center gap-2 text-white font-medium hover:gap-3 transition-all group/btn w-fit px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-purple-500 shadow-[var(--shadow-primary)] hover:shadow-[var(--shadow-primary-lg)] text-xs shrink-0"
                >
                    <span>阅读全文</span>
                    <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                </Link>
            </div>

             {/* Right Preview Section (2/3 width) - Rendered Markdown */}
            <div className="hidden lg:block lg:col-span-2 bg-[var(--preview-bg)] overflow-hidden relative">
                <div className="p-8 h-full overflow-hidden mask-image-b">
                    {post.contentPreview ? (
                         <div className="opacity-70 group-hover:opacity-100 transition-opacity duration-500 text-sm">
                            <MiniMarkdownPreview content={post.contentPreview} maxLength={2000} />
                         </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
                            <span className="animate-pulse">Loading preview...</span>
                        </div>
                    )}
                </div>

                 {/* Fade Out Overlay - Stronger gradient for better masking */}
                 <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--bg-primary)] to-transparent pointer-events-none" />
            </div>
        </div>
    </div>
  );
};

export default FeaturedPost;
