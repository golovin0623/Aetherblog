/**
 * @file PostNavigation.tsx
 * @description 文章底部上一篇/下一篇导航组件
 * @ref §8.1 - 博客前台模块
 *
 * 语义约定（与博客列表一致，按发布时间倒序）：
 *   上一篇 (←) = 较新文章   下一篇 (→) = 较旧文章
 */

import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PostBrief {
  slug: string;
  title: string;
}

interface PostNavigationProps {
  prevPost?: PostBrief | null;
  nextPost?: PostBrief | null;
}

export default function PostNavigation({ prevPost, nextPost }: PostNavigationProps) {
  if (!prevPost && !nextPost) return null;

  return (
    <nav
      aria-label="文章导航"
      className="mt-12 mb-4 flex flex-col sm:grid sm:grid-cols-2 gap-3 sm:gap-4"
    >
      {/* 上一篇（较新） — 左侧 */}
      {prevPost ? (
        <Link
          href={`/posts/${prevPost.slug}`}
          className="group relative flex items-center gap-3 p-4 sm:p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/60 backdrop-blur-sm transition-all duration-300 hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-md)] hover:bg-[var(--bg-card)]"
        >
          <ChevronLeft className="w-5 h-5 flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--color-primary)] transition-all duration-300 group-hover:-translate-x-0.5" />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] sm:text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
              上一篇
            </span>
            <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm font-medium text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors duration-300 leading-relaxed">
              {prevPost.title}
            </p>
          </div>
        </Link>
      ) : (
        /* 占位保证 nextPost 靠右 */
        <div className="hidden sm:block" />
      )}

      {/* 下一篇（较旧） — 右侧 */}
      {nextPost && (
        <Link
          href={`/posts/${nextPost.slug}`}
          className="group relative flex items-center gap-3 p-4 sm:p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/60 backdrop-blur-sm transition-all duration-300 hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-md)] hover:bg-[var(--bg-card)]"
        >
          <div className="min-w-0 flex-1 text-right">
            <span className="text-[10px] sm:text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
              下一篇
            </span>
            <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm font-medium text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors duration-300 leading-relaxed">
              {nextPost.title}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--color-primary)] transition-all duration-300 group-hover:translate-x-0.5" />
        </Link>
      )}
    </nav>
  );
}
