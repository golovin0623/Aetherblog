'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, Folder, ArrowRight, Lock } from 'lucide-react';
import MiniMarkdownPreview from './MiniMarkdownPreview';
import { useSpotlightEffect } from '../hooks/useSpotlightEffect';

interface FeaturedPostProps {
  post: {
    title: string;
    slug: string;
    summary?: string;
    coverImage?: string;
    publishedAt: string;
    category?: { name: string; slug: string };
    tags?: { name: string; slug: string }[];
    contentPreview?: string; // 可选的原始内容用于预览
    passwordRequired?: boolean; // 新增：是否需要密码
  };
}

const FeaturedPostBase: React.FC<FeaturedPostProps> = ({ post }) => {
  const router = useRouter();
  const { spotlightRef, isHovering, handleMouseEnter, handleMouseLeave, handleMouseMove }
    = useSpotlightEffect({ radius: 1000 });

  // 使用 useMemo 记忆化摘要计算，防止聚光灯效果导致的频繁重渲染重复执行
  const displaySummary = useMemo(() => {
    return post.passwordRequired
      ? '这是一篇加密文章，请输入密码后查看。'
      : post.summary
        ? post.summary
        : post.contentPreview
            ? post.contentPreview.slice(0, 500) + '...'
            : '暂无摘要';
  }, [post.passwordRequired, post.summary, post.contentPreview]);

  const handleCardClick = (e: React.MouseEvent) => {
    // 点击交互元素时阻止导航
    if (e.target instanceof Element && e.target.closest('a, button')) {
      return;
    }
    router.push(`/posts/${post.slug}`);
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
        className="surface-raised relative group overflow-hidden transition-all min-h-[33vh] max-h-[66vh] lg:min-h-0 lg:max-h-none lg:h-full flex flex-col duration-300 hover:shadow-[0_20px_50px_rgba(0,0,0,0.15)] cursor-pointer"
        data-interactive
        style={{ viewTransitionName: `post-${post.slug}` } as React.CSSProperties}
        onClick={handleCardClick}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
    >
        {/* 顶部装饰条 - 品牌色渐变 */}
        <div className="absolute top-0 left-0 right-0 h-[var(--decoration-bar-height)] bg-[var(--decoration-gradient)] z-30" />

        {/* 聚光灯效果层 */}
        <div
          ref={spotlightRef}
          className="absolute inset-0 pointer-events-none transition-opacity duration-300 z-0"
          style={{
            // 背景通过 ref 管理
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
            {/* 左侧内容区域 (桌面端 1/3 宽度，移动端 100%) */}
            <div className="lg:col-span-1 p-6 md:p-8 flex flex-col h-full border-b lg:border-b-0 lg:border-r border-[var(--border-subtle)] overflow-hidden min-w-0">
                <div className="flex flex-col items-start min-h-0 flex-1 overflow-hidden min-w-0 w-full">
                     {/* 元信息：分类、日期 */}
                    <div className="flex items-center gap-3 text-[10px] font-medium text-primary mb-3">
                        {post.category && (
                            <Link href={`/categories/${post.category.slug}`} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-primary to-accent text-white shadow-sm hover:shadow-md transition-all">
                                <Folder className="w-3 h-3" />
                                <span>{post.category.name}</span>
                            </Link>
                        )}
                        <div className="flex items-center gap-1 text-[var(--text-muted)] font-mono">
                            <Calendar className="w-3 h-3" />
                            <span>{post.publishedAt}</span>
                        </div>
                        {post.passwordRequired && (
                            <div
                                className="flex items-center gap-1.5 px-2 py-1 rounded ml-auto"
                                style={{
                                    border: '1px solid color-mix(in oklch, var(--signal-warn) 30%, transparent)',
                                    background: 'color-mix(in oklch, var(--signal-warn) 10%, transparent)',
                                    color: 'var(--signal-warn)',
                                }}
                            >
                                <Lock className="w-3 h-3" />
                                <span className="text-[10px] font-semibold tracking-wider">已加密</span>
                            </div>
                        )}
                    </div>

                    {/* 标题 */}
                    <h1
                        className={`font-display ${titleSizeClass} font-semibold text-[var(--ink-primary,var(--text-primary))] mb-3 leading-[1.1] tracking-tight group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-accent group-hover:bg-clip-text group-hover:text-transparent transition-all cursor-pointer`}
                        style={{
                          viewTransitionName: `post-${post.slug}-title`,
                          textWrap: 'balance' as unknown as 'inherit',
                        } as React.CSSProperties}
                    >
                        <Link href={`/posts/${post.slug}`}>
                            {post.title}
                        </Link>
                    </h1>
                    
                    {/* 标签 (新样式) */}
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

                    {/* 摘要 - 自适应高度带渐变遮罩 */}
                    <div 
                      className="text-[var(--text-secondary)] text-sm leading-relaxed mb-4 flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full min-w-0"
                      style={{
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                        // 加密文章不需要底部渐变遮罩，因为它不会很长
                        maskImage: post.passwordRequired ? 'none' : 'linear-gradient(to bottom, black 80%, transparent 100%)',
                        WebkitMaskImage: post.passwordRequired ? 'none' : 'linear-gradient(to bottom, black 80%, transparent 100%)'
                      }}
                    >
                        {post.passwordRequired ? (
                            <div
                                className="p-3 rounded-r-md text-xs flex items-start gap-2 h-full mt-2"
                                style={{
                                    background: 'color-mix(in oklch, var(--signal-warn) 5%, transparent)',
                                    borderLeft: '2px solid color-mix(in oklch, var(--signal-warn) 50%, transparent)',
                                    color: 'color-mix(in oklch, var(--signal-warn) 80%, var(--text-secondary))',
                                }}
                            >
                                <div className="mt-0.5">
                                    此文章内容已使用密码加密。阅读全文和查看摘要需要提供访问凭证。
                                </div>
                            </div>
                        ) : (
                            <MiniMarkdownPreview content={displaySummary} maxLength={800} />
                        )}
                    </div>
                </div>

                {/* 阅读更多按钮 */}
                <Link
                    href={`/posts/${post.slug}`}
                    aria-label={`阅读全文: ${post.title}`}
                    className="inline-flex items-center gap-2 text-white font-medium hover:gap-3 transition-all group/btn w-fit px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-accent shadow-[var(--shadow-primary)] hover:shadow-[var(--shadow-primary-lg)] text-xs shrink-0"
                >
                    <span>阅读全文</span>
                    <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-1 transition-transform" />
                </Link>
            </div>

             {/* 右侧预览区域 (2/3 宽度) - 渲染的 Markdown 或 加密状态 */}
            <div className="hidden lg:block lg:col-span-2 bg-[var(--preview-bg)] overflow-hidden relative">
                {post.passwordRequired ? (
                    // 加密状态的右侧大区域 UI
                    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                        {/* 装饰性背景：斜纹或网点 */}
                        <div 
                            className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] z-0" 
                            style={{ 
                                backgroundImage: 'repeating-linear-gradient(45deg, var(--text-primary) 0, var(--text-primary) 1px, transparent 0, transparent 50%)',
                                backgroundSize: '20px 20px'
                            }} 
                        />
                        {/* 居中悬浮卡片 */}
                        <div className="relative z-10 flex flex-col items-center justify-center p-10 bg-[var(--bg-card)]/40 backdrop-blur-xl rounded-3xl border border-[var(--border-subtle)]/60 shadow-[0_8px_32px_rgba(0,0,0,0.08)] max-w-sm text-center">
                            <div
                                className="w-16 h-16 mb-6 rounded-full flex items-center justify-center"
                                style={{
                                    background: 'linear-gradient(to top right, color-mix(in oklch, var(--signal-warn) 20%, transparent), color-mix(in oklch, var(--signal-warn) 10%, transparent))',
                                    border: '1px solid color-mix(in oklch, var(--signal-warn) 30%, transparent)',
                                    boxShadow: 'inset 0 0 20px color-mix(in oklch, var(--signal-warn) 20%, transparent)',
                                }}
                            >
                                <Lock
                                    className="w-7 h-7"
                                    style={{
                                        color: 'var(--signal-warn)',
                                        filter: 'drop-shadow(0 0 8px color-mix(in oklch, var(--signal-warn) 80%, transparent))',
                                    }}
                                />
                            </div>
                            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2 tracking-wide">访问受限</h3>
                            <p className="text-sm text-[var(--text-secondary)] mb-6 leading-relaxed">
                                这是一篇加密文章<br/>预览和正文内容已被隐藏
                            </p>
                            <div className="px-5 py-2 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-default)] text-xs text-[var(--text-muted)] flex items-center gap-2">
                                <span
                                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                                    style={{ background: 'var(--signal-warn)' }}
                                ></span>
                                安全锁定中
                            </div>
                        </div>
                    </div>
                ) : (
                    // 正常预览区域
                    <div className="p-8 h-full overflow-hidden">
                        {post.contentPreview ? (
                            <div
                                className="h-full text-sm antialiased"
                                style={{
                                    maskImage: 'linear-gradient(to bottom, black 0%, black 85%, transparent 100%)',
                                    WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 85%, transparent 100%)'
                                }}
                            >
                                <MiniMarkdownPreview content={post.contentPreview} maxLength={2000} />
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
                                <span className="animate-pulse">Loading preview...</span>
                            </div>
                        )}
                    </div>
                )}

                 {/* 微妙的淡出覆盖层 - 较浅的渐变 */}
                 <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[var(--bg-card)] via-[var(--bg-card)]/50 to-transparent pointer-events-none" />
            </div>
        </div>
    </div>
  );
};

export const FeaturedPost = React.memo(FeaturedPostBase);
export default FeaturedPost;
