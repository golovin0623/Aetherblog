'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, Eye, LockKeyhole, RefreshCw } from 'lucide-react';
import { formatDate } from '@aetherblog/utils';
import MarkdownRenderer from '@/app/components/MarkdownRenderer';
import TableOfContents from '@/app/components/TableOfContents';
import { useAgentAuth } from '../../lib/agentAuth';

interface TagInfo {
  name: string;
}

interface SharedPostDetail {
  id: number;
  title: string;
  slug: string;
  content?: string | null;
  summary?: string;
  categoryName?: string;
  tags?: Array<TagInfo | string>;
  viewCount?: number;
  publishedAt?: string;
  createdAt?: string;
}

interface ApiEnvelope<T> {
  code?: number;
  data?: T;
  message?: string;
}

export default function SharedPostClient({ id }: { id: string }) {
  const router = useRouter();
  const { state } = useAgentAuth();
  const [post, setPost] = useState<SharedPostDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === 'guest') {
      router.replace(`/agent/login?next=${encodeURIComponent(`/agent/shared/${id}`)}`);
    }
  }, [id, router, state.status]);

  useEffect(() => {
    if (state.status !== 'authed') return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/v1/collaboration/posts/${id}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiEnvelope<SharedPostDetail>;
        if (json.code !== undefined && json.code !== 200) throw new Error(json.message || '加载失败');
        setPost(json.data ?? null);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '加载失败');
        setPost(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, state.status]);

  const tagNames = useMemo(() => {
    return (post?.tags ?? [])
      .map((tag) => (typeof tag === 'string' ? tag : tag.name))
      .filter(Boolean);
  }, [post?.tags]);

  const content = post?.content ?? '';
  const dateText = formatSharedDate(post?.publishedAt || post?.createdAt);
  const readingMinutes = Math.max(1, Math.ceil(content.length / 500));

  if (state.status !== 'authed' || loading) {
    return (
      <main className="min-h-screen bg-[var(--bg-substrate)] px-4 pt-28 text-[var(--ink-primary)]">
        <div className="mx-auto max-w-4xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6">
          <div className="flex items-center gap-3 text-[var(--ink-secondary)]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {state.status === 'guest' ? '正在跳转登录' : '正在读取共享文章'}
          </div>
        </div>
      </main>
    );
  }

  if (error || !post) {
    return (
      <main className="min-h-screen bg-[var(--bg-substrate)] px-4 pt-28 text-[var(--ink-primary)]">
        <div className="mx-auto max-w-4xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-8 text-center">
          <h1 className="text-2xl font-semibold">无法读取共享文章</h1>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">{error || '文章不存在或未授权'}</p>
          <Link
            href="/agent/shared"
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] px-4 text-sm font-semibold"
          >
            <ArrowLeft className="h-4 w-4" />
            返回共享内容
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--bg-substrate)] px-4 pb-16 pt-24 text-[var(--ink-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <article className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-sm sm:p-8">
          <Link
            href="/agent/shared"
            className="mb-7 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)]"
          >
            <ArrowLeft className="h-4 w-4" />
            共享内容
          </Link>

          <div className="mb-4 inline-flex h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 text-xs font-semibold text-[var(--ink-secondary)]">
            <LockKeyhole className="h-3.5 w-3.5" />
            登录态共享文章
          </div>

          <h1 className="font-display text-3xl font-semibold leading-tight text-[var(--ink-primary)] sm:text-5xl">
            {post.title}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-[var(--ink-muted)]">
            <span className="tnum inline-flex items-center gap-1.5 font-mono">
              <CalendarDays className="h-4 w-4" />
              {dateText}
            </span>
            <span className="tnum font-mono">{readingMinutes} min</span>
            <span className="tnum inline-flex items-center gap-1.5 font-mono">
              <Eye className="h-4 w-4" />
              {post.viewCount ?? 0}
            </span>
            {post.categoryName && <span>{post.categoryName}</span>}
          </div>

          {post.summary && (
            <p className="mt-6 border-l-2 border-[var(--border-subtle)] pl-4 text-base leading-8 text-[var(--ink-secondary)]">
              {post.summary}
            </p>
          )}

          {tagNames.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {tagNames.map((tag) => (
                <span key={tag} className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--ink-muted)]">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-8">
            <MarkdownRenderer content={content} />
          </div>
        </article>

        <aside className="hidden xl:block">
          <div className="sticky top-28 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
            <TableOfContents content={content} variant="sidebar" />
          </div>
        </aside>
      </div>
    </main>
  );
}

function formatSharedDate(value?: string): string {
  if (!value) return '未记录日期';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录日期';
  return formatDate(date, 'yyyy-MM-dd');
}
