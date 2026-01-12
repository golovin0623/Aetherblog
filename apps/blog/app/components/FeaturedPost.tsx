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

  return (
    <div 
        className="relative group rounded-3xl bg-white/5 border border-white/10 overflow-hidden backdrop-blur-xl transition-all hover:border-white/20 min-h-[33vh] max-h-[66vh] lg:min-h-0 lg:max-h-none lg:h-full flex flex-col duration-300"
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
    > 
        {/* 聚光灯效果层 */}
        <div 
          className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
          style={{
            background: `radial-gradient(1000px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(99, 102, 241, 0.08), transparent 40%)`,
            opacity: isHovering ? 1 : 0,
          }}
        />

        {/* 顶部高亮线条 */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent z-10" />

        <div className="grid lg:grid-cols-3 h-full max-h-full overflow-hidden relative z-20">
            {/* Left Content Section (1/3 width on desktop, 100% on mobile) */}
            <div className="lg:col-span-1 p-6 md:p-8 flex flex-col h-full border-b lg:border-b-0 lg:border-r border-white/5 overflow-hidden">
                <div className="flex flex-col items-start min-h-0 flex-1 overflow-hidden">
                     {/* Meta Info: Category, Date */}
                    <div className="flex items-center gap-3 text-[10px] font-medium text-primary mb-4">
                        {post.category && (
                            <Link href={`/categories/${post.category.slug}`} className="flex items-center gap-1 bg-primary/10 px-2 py-0.5 rounded-full hover:bg-primary/20 transition-colors">
                                <Folder className="w-3 h-3" />
                                <span>{post.category.name}</span>
                            </Link>
                        )}
                        <div className="flex items-center gap-1 text-gray-400 font-mono">
                            <Calendar className="w-3 h-3" />
                            <span>{post.publishedAt}</span>
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className="text-2xl md:text-3xl font-bold text-white mb-4 leading-tight group-hover:text-primary transition-colors cursor-pointer line-clamp-3">
                        <Link href={`/posts/${post.slug}`}>
                            {post.title}
                        </Link>
                    </h1>
                    
                    {/* Tags */}
                    {post.tags && post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                            {post.tags.slice(0, 5).map(tag => (
                                <span key={tag.slug} className="text-[10px] font-mono text-gray-500 bg-white/5 px-2 py-0.5 rounded border border-white/5 hover:border-primary/30 transition-colors">
                                    #{tag.name}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Summary - Mobile: flex-1 fills remaining space, scrollable; Desktop: fixed max-h */}
                    <div 
                      className="text-gray-400 text-sm leading-relaxed mb-4 flex-1 lg:flex-initial lg:max-h-[160px] overflow-y-auto"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
                      }}
                    >
                        <MiniMarkdownPreview content={displaySummary} maxLength={800} />
                    </div>
                </div>

                {/* Read More Button */}
                <Link 
                    href={`/posts/${post.slug}`}
                    className="inline-flex items-center gap-2 text-white font-medium hover:gap-3 transition-all group/btn w-fit px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-primary hover:border-primary text-xs shrink-0"
                >
                    <span>阅读全文</span>
                    <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                </Link>
            </div>

            {/* Right Preview Section (2/3 width) - Rendered Markdown */}
            <div className="hidden lg:block lg:col-span-2 bg-black/20 overflow-hidden relative">
                <div className="p-8 h-full overflow-hidden mask-image-b">
                    {post.contentPreview ? (
                         <div className="opacity-70 group-hover:opacity-100 transition-opacity duration-500 text-sm">
                            <MiniMarkdownPreview content={post.contentPreview} maxLength={2000} />
                         </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                            <span className="animate-pulse">Loading preview...</span>
                        </div>
                    )}
                </div>

                 {/* Fade Out Overlay - Stronger gradient for better masking */}
                 <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0a0f] to-transparent pointer-events-none" />
            </div>
        </div>
    </div>
  );
};

export default FeaturedPost;
