/**
 * @file PostNavigation.tsx
 * @description 文章底部上一篇/下一篇导航组件
 * @ref §8.1 - 博客前台模块
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
      className="mt-12 mb-4 grid gap-4"
      style={{
        gridTemplateColumns: prevPost && nextPost ? '1fr 1fr' : '1fr',
      }}
    >
      {prevPost && (
        <Link
          href={`/posts/${prevPost.slug}`}
          className="group relative flex items-start gap-3 p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/60 backdrop-blur-sm transition-all duration-300 hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-md)] hover:bg-[var(--bg-card)]"
        >
          <ChevronLeft className="w-5 h-5 mt-0.5 flex-shrink-0 text-[var(--text-muted)] group-hover:text-primary transition-colors duration-300 group-hover:-translate-x-0.5 transform" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
              上一篇
            </span>
            <p className="mt-1 text-sm font-medium text-[var(--text-primary)] line-clamp-2 group-hover:text-primary transition-colors duration-300">
              {prevPost.title}
            </p>
          </div>
        </Link>
      )}
      {nextPost && (
        <Link
          href={`/posts/${nextPost.slug}`}
          className={`group relative flex items-start gap-3 p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/60 backdrop-blur-sm transition-all duration-300 hover:border-[var(--border-hover)] hover:shadow-[var(--shadow-md)] hover:bg-[var(--bg-card)] ${!prevPost ? 'ml-auto' : ''}`}
          style={{ textAlign: 'right' }}
        >
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
              下一篇
            </span>
            <p className="mt-1 text-sm font-medium text-[var(--text-primary)] line-clamp-2 group-hover:text-primary transition-colors duration-300">
              {nextPost.title}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 mt-0.5 flex-shrink-0 text-[var(--text-muted)] group-hover:text-primary transition-colors duration-300 group-hover:translate-x-0.5 transform" />
        </Link>
      )}
    </nav>
  );
}
