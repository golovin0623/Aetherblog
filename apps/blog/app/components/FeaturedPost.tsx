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
        ? post.contentPreview.slice(0, 80).replace(/[#*`]/g, '') + '...' 
        : '暂无摘要';

  return (
    <div className="relative group rounded-3xl bg-white/5 border border-white/10 overflow-hidden backdrop-blur-xl transition-all hover:border-white/20 h-full"> 
        <div className="grid lg:grid-cols-3 h-full">
            {/* Left Content Section (1/3 width) */}
            <div className="lg:col-span-1 p-6 flex flex-col justify-between relative z-10 h-full border-r border-white/5">
                <div className="flex-1 flex flex-col items-start min-h-0">
                     {/* Meta Info: Category, Date */}
                    <div className="flex items-center gap-3 text-[10px] font-medium text-primary mb-3">
                        {post.category && (
                            <Link href={`/categories/${post.category.slug}`} className="flex items-center gap-1 bg-primary/10 px-2 py-0.5 rounded-full hover:bg-primary/20 transition-colors">
                                <Folder className="w-3 h-3" />
                                <span>{post.category.name}</span>
                            </Link>
                        )}
                        <div className="flex items-center gap-1 text-gray-400">
                            <Calendar className="w-3 h-3" />
                            <span>{post.publishedAt}</span>
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className="text-xl md:text-2xl font-bold text-white mb-3 leading-tight group-hover:text-primary transition-colors cursor-pointer line-clamp-2">
                        <Link href={`/posts/${post.slug}`}>
                            {post.title}
                        </Link>
                    </h1>
                    
                    {/* Tags */}
                    {post.tags && post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            {post.tags.slice(0, 3).map(tag => (
                                <span key={tag.slug} className="text-[10px] font-mono text-gray-500 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 hover:border-primary/30 transition-colors">
                                    #{tag.name}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Summary */}
                    <p className="text-gray-400 text-xs md:text-sm leading-relaxed mb-4 line-clamp-3">
                        {displaySummary}
                    </p>
                </div>

                {/* Read More Button */}
                <Link 
                    href={`/posts/${post.slug}`}
                    className="inline-flex items-center gap-2 text-white font-medium hover:gap-3 transition-all group/btn w-fit px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-primary hover:border-primary text-xs"
                >
                    <span>阅读全文</span>
                    <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                </Link>

                 {/* Background Decoration */}
                 <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>

            {/* Right Preview Section (2/3 width) - Rendered Markdown */}
            <div className="hidden lg:block lg:col-span-2 bg-[#0a0a0a] overflow-hidden relative">
                <div className="p-6 h-full overflow-hidden">
                    {post.contentPreview ? (
                         <div className="opacity-80 group-hover:opacity-100 transition-opacity duration-500">
                            <MiniMarkdownPreview content={post.contentPreview} maxLength={1500} />
                         </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                            <span className="animate-pulse">Loading preview...</span>
                        </div>
                    )}
                </div>

                 {/* Fade Out Overlay */}
                 <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0d0d0d] to-transparent pointer-events-none" />
            </div>
        </div>
    </div>
  );
};

export default FeaturedPost;
