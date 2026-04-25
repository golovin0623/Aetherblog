'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useSpotlightEffect } from '../hooks/useSpotlightEffect';

interface ArticleCardProps {
  title: string;
  slug: string;
  summary?: string;
  category?: { name: string; slug: string };
  tags?: { name: string; slug: string }[];
  publishedAt: string;
  readingTime?: number;
  viewCount?: number;
  isPinned?: boolean;
  index?: number;
  passwordRequired?: boolean;
}

const ArticleCardBase: React.FC<ArticleCardProps> = ({
  title,
  slug,
  summary,
  category,
  tags = [],
  publishedAt,
  readingTime,
  viewCount,
  isPinned = false,
  index = 0,
  passwordRequired = false,
}) => {
  const { spotlightRef, isHovering, handleMouseEnter, handleMouseLeave, handleMouseMove }
    = useSpotlightEffect({ radius: 600 });

  const maxVisibleTags = 3;
  const visibleTags = tags.slice(0, maxVisibleTags);
  const remainingTagCount = tags.length - maxVisibleTags;

  const displaySummary = useMemo(() => {
    if (!summary) return null;
    const processed = summary
      .replace(/:::\s*(info|note|warning|danger|tip)\s*(\{[^}]*\})?/g, '')
      .replace(/^:::\s*$/gm, '')
      .replace(/<!--\s*more\s*-->/g, '')
      .replace(/[#*`>\[\]!|_~]/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return processed.slice(0, 140) + (processed.length > 140 ? '…' : '');
  }, [summary]);

  return (
    <Link
      href={`/posts/${slug}`}
      className="group block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 rounded-2xl"
      style={{ animationDelay: `${index * 80}ms` } as React.CSSProperties}
    >
      <article
        className="surface-raised relative flex flex-col h-full min-h-[320px] cursor-pointer overflow-hidden p-8 transition-transform duration-[var(--dur-flow,520ms)] ease-[var(--ease-out,cubic-bezier(0.16,1,0.3,1))] hover:-translate-y-[3px]"
        data-interactive
        style={{ viewTransitionName: `post-${slug}` } as React.CSSProperties}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* 聚光灯层(光标跟随径向高光) */}
        <div
          ref={spotlightRef}
          className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] transition-opacity duration-300"
          style={{ opacity: isHovering ? 'var(--spotlight-opacity)' : 0 }}
        />

        {/* 顶栏:分类(aurora 签名)· 日期(mono tnum,极静) */}
        <header className="relative z-10 mb-6 flex items-baseline justify-between gap-3">
          {category ? (
            <span
              className="font-mono text-[11px] uppercase tracking-[0.22em] truncate"
              style={{ color: 'color-mix(in oklch, var(--aurora-1) 90%, transparent)' }}
            >
              {category.name}
            </span>
          ) : (
            <span aria-hidden />
          )}
          <time
            className="font-mono text-[10px] tnum tabular-nums whitespace-nowrap"
            style={{ color: 'var(--ink-muted)' }}
          >
            {publishedAt}
          </time>
        </header>

        {/* 标题 —— Fraunces display,balance,2 行截断 */}
        <h2 className="relative z-10 mb-5">
          <span
            className="font-display font-semibold transition-colors duration-[var(--dur-quick,260ms)]"
            style={{
              color: 'var(--ink-primary)',
              fontSize: 'clamp(1.5rem, 1.4rem + 0.5vw, 1.875rem)',
              lineHeight: '1.2',
              letterSpacing: '-0.01em',
              textWrap: 'balance' as unknown as 'inherit',
              viewTransitionName: `post-${slug}-title`,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            } as React.CSSProperties}
            title={title}
          >
            {title}
          </span>
        </h2>

        {/* 摘要 / 加密锁 —— Instrument Serif italic,3 行截断 */}
        <div className="relative z-10 mb-6 flex-1">
          {passwordRequired ? (
            <div
              className="inline-flex items-center gap-2 rounded-md px-3 py-1.5"
              style={{
                color: 'var(--signal-warn)',
                background: 'color-mix(in oklch, var(--signal-warn) 8%, transparent)',
                border: '1px solid color-mix(in oklch, var(--signal-warn) 22%, transparent)',
              }}
            >
              <Lock className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em]">Encrypted</span>
            </div>
          ) : displaySummary ? (
            <p
              className="font-editorial italic text-[15px] leading-[1.65]"
              style={{
                color: 'rgb(from var(--ink-secondary) r g b / 0.9)',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              } as React.CSSProperties}
            >
              {displaySummary}
            </p>
          ) : null}
        </div>

        {/* 底栏 —— hairline 分隔 + tags / reading */}
        <footer
          className="relative z-10 mt-auto flex items-center justify-between gap-3 pt-5"
          style={{
            borderTop: '1px solid rgb(from var(--ink-primary) r g b / 0.1)',
          }}
        >
          {/* 左:tags(mono,字号 11) */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
            {visibleTags.length > 0 ? (
              <>
                {visibleTags.map((tag) => (
                  <span
                    key={tag.slug}
                    className="font-mono text-[11px] whitespace-nowrap"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    #{tag.name}
                  </span>
                ))}
                {remainingTagCount > 0 && (
                  <span
                    className="font-mono text-[11px] tnum tabular-nums"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    +{remainingTagCount}
                  </span>
                )}
              </>
            ) : (
              <span aria-hidden />
            )}
          </div>

          {/* 右:reading time(常驻)· views 仅 hover 时浮现 */}
          <div className="flex shrink-0 items-center gap-3 font-mono text-[10px] tnum tabular-nums uppercase tracking-[0.18em] whitespace-nowrap">
            {readingTime ? (
              <span style={{ color: 'var(--ink-muted)' }}>{readingTime} min</span>
            ) : null}
            {viewCount !== undefined && viewCount > 0 && (
              <span
                className="opacity-0 transition-opacity duration-[var(--dur-quick,260ms)] group-hover:opacity-100 group-focus:opacity-100"
                style={{ color: 'color-mix(in oklch, var(--aurora-1) 75%, transparent)' }}
              >
                {viewCount} ·  views
              </span>
            )}
          </div>
        </footer>

        {/* 置顶标记 —— 右上角小印章,aurora 配色 */}
        {isPinned && (
          <div
            className="absolute right-4 top-4 z-20 rounded-sm px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.24em]"
            style={{
              color: 'var(--aurora-1)',
              background: 'color-mix(in oklch, var(--aurora-1) 14%, transparent)',
              boxShadow: '0 0 0 1px color-mix(in oklch, var(--aurora-1) 22%, transparent)',
            }}
          >
            Pinned
          </div>
        )}
      </article>
    </Link>
  );
};

export const ArticleCard = React.memo(ArticleCardBase);
export default ArticleCard;
