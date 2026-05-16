'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, FileText, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { formatDate } from '@aetherblog/utils';
import { useAgentAuth } from '../lib/agentAuth';

interface PostListItem {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  categoryName?: string;
  tagNames?: string[];
  viewCount?: number;
  publishedAt?: string;
  createdAt?: string;
}

interface PageResult<T> {
  list: T[];
  total: number;
  pageNum: number;
  pageSize: number;
  pages: number;
}

interface ApiEnvelope<T> {
  code?: number;
  data?: T;
  message?: string;
}

const PAGE_SIZE = 30;

export default function SharedContentClient() {
  const router = useRouter();
  const { state } = useAgentAuth();
  const [items, setItems] = useState<PostListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === 'guest') {
      router.replace('/agent/login?next=/agent/shared');
    }
  }, [router, state.status]);

  useEffect(() => {
    if (state.status !== 'authed') return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/v1/collaboration/posts?pageNum=${pageNum}&pageSize=${PAGE_SIZE}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiEnvelope<PageResult<PostListItem>>;
        if (json.code !== undefined && json.code !== 200) throw new Error(json.message || '加载失败');
        const data = json.data;
        setItems(Array.isArray(data?.list) ? data.list : []);
        setTotal(typeof data?.total === 'number' ? data.total : 0);
        setTotalPages(Math.max(1, typeof data?.pages === 'number' ? data.pages : 1));
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '加载失败');
        setItems([]);
        setTotal(0);
        setTotalPages(1);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pageNum, state.status]);

  useEffect(() => {
    if (pageNum > totalPages) setPageNum(totalPages);
  }, [pageNum, totalPages]);

  const userLabel = useMemo(() => {
    if (state.status !== 'authed') return '正在确认身份';
    return state.user.nickname || state.user.username;
  }, [state]);

  const rangeStart = total === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(pageNum * PAGE_SIZE, total);

  if (state.status !== 'authed') {
    return (
      <main className="min-h-screen bg-[var(--bg-substrate)] px-4 pt-28 text-[var(--ink-primary)]">
        <div className="mx-auto max-w-5xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6">
          <div className="flex items-center gap-3 text-[var(--ink-secondary)]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {state.status === 'guest' ? '正在跳转登录' : '正在确认身份'}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--bg-substrate)] px-4 pb-16 pt-24 text-[var(--ink-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="mb-3 inline-flex h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 text-xs font-semibold text-[var(--ink-secondary)]">
                <LockKeyhole className="h-3.5 w-3.5" />
                Shared Workspace
              </div>
              <h1 className="font-display text-3xl font-semibold leading-tight text-[var(--ink-primary)] sm:text-4xl">
                共享内容
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-secondary)]">
                {userLabel} 可读取的团队、角色和直接授权文章。这里展示的是登录态授权内容，不进入公开文章列表。
              </p>
            </div>
            <div className="grid min-w-[13rem] grid-cols-2 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-leaf)]">
              <div className="border-r border-[var(--border-subtle)] p-4">
                <div className="text-xs text-[var(--ink-muted)]">授权文章</div>
                <div className="tnum mt-1 font-mono text-2xl font-semibold">{total}</div>
              </div>
              <div className="p-4">
                <div className="text-xs text-[var(--ink-muted)]">当前身份</div>
                <div className="mt-1 truncate text-sm font-semibold">{state.user.role}</div>
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-lg border border-status-danger-border bg-status-danger-light p-4 text-sm text-status-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]" />
            ))}
          </div>
        ) : items.length > 0 ? (
          <>
            <section className="grid gap-3 md:grid-cols-2">
              {items.map((post) => (
                <SharedPostCard key={post.id} post={post} />
              ))}
            </section>
            <SharedPagination
              pageNum={pageNum}
              totalPages={totalPages}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              total={total}
              onPrev={() => setPageNum((page) => Math.max(1, page - 1))}
              onNext={() => setPageNum((page) => Math.min(totalPages, page + 1))}
            />
          </>
        ) : (
          <section className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-card)] p-10 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-[var(--ink-muted)]" />
            <h2 className="mt-4 text-lg font-semibold">暂无可访问的共享文章</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
              管理员为你的账号、所属团队或角色创建文章共享授权后，会出现在这里。
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function SharedPostCard({ post }: { post: PostListItem }) {
  const dateText = formatSharedDate(post.publishedAt || post.createdAt);

  return (
    <article className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-sm transition-colors hover:border-[var(--aurora-1)]/40">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-leaf)] text-[var(--ink-primary)]">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
            <span className="tnum inline-flex items-center gap-1 font-mono">
              <CalendarDays className="h-3.5 w-3.5" />
              {dateText}
            </span>
            {post.categoryName && <span>{post.categoryName}</span>}
          </div>
          <h2 className="mt-2 line-clamp-2 text-lg font-semibold leading-snug text-[var(--ink-primary)]">
            {post.title}
          </h2>
          {post.summary && (
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--ink-secondary)]">
              {post.summary}
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {(post.tagNames ?? []).slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-full border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--ink-muted)]">
              #{tag}
            </span>
          ))}
        </div>
        <Link
          href={`/agent/shared/${post.id}`}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--ink-primary)] bg-[var(--ink-primary)] px-4 text-sm font-semibold text-[var(--bg-void)] transition-transform group-hover:translate-x-0.5"
        >
          阅读
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

function SharedPagination({
  pageNum,
  totalPages,
  rangeStart,
  rangeEnd,
  total,
  onPrev,
  onNext,
}: {
  pageNum: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total <= PAGE_SIZE && totalPages <= 1) return null;
  return (
    <nav className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="tnum text-xs font-semibold text-[var(--ink-muted)]">
        显示 <span className="text-[var(--ink-secondary)]">{rangeStart}-{rangeEnd}</span>
        <span className="mx-2 text-[var(--ink-subtle)]">/</span>
        共 <span className="text-[var(--ink-secondary)]">{total}</span> 篇
        <span className="mx-2 text-[var(--ink-subtle)]">·</span>
        第 <span className="text-[var(--ink-secondary)]">{pageNum}</span> / {totalPages} 页
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPrev}
          disabled={pageNum <= 1}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-45"
          aria-label="上一页"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="tnum min-w-8 px-2 text-center text-sm font-semibold text-[var(--ink-secondary)]">
          {pageNum}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={pageNum >= totalPages}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-45"
          aria-label="下一页"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

function formatSharedDate(value?: string): string {
  if (!value) return '未记录日期';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录日期';
  return formatDate(date, 'yyyy-MM-dd');
}
