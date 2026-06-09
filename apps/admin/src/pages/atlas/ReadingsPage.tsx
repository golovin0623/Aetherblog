// Atlas 读物列表 —— 知识图集闭环的「读」入口（修复激活漏斗最致命断点）。
//
// ref: docs/pm/atlas-redesign.md §4 P0-2
// 在此之前 Reader 没有任何 Atlas 内入口，用户只能从笔记/媒体/写作模块反向摸进去。
// 本页让「已有读物」可见、可继续，并提供零依赖的「添加读物」冷启动。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  FileText,
  Film,
  Globe,
  Headphones,
  Image as ImageIcon,
  Newspaper,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Select } from '@aetherblog/ui';
import type { AtlasCarrier } from '@aetherblog/types';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { atlasService } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { carrierReaderHref } from './carrierReaderHref';
import { AddReadingDialog } from './AddReadingDialog';

type ScopeFilter = 'all' | 'mine';

const SCOPE_OPTIONS = [
  { value: 'all', label: '全部可访问' },
  { value: 'mine', label: '仅我的' },
];

const TYPE_META: Record<string, { icon: typeof FileText; label: string }> = {
  markdown: { icon: FileText, label: '笔记 / 文本' },
  web: { icon: Globe, label: '网页' },
  pdf: { icon: FileText, label: 'PDF' },
  blog_post: { icon: Newspaper, label: '文章' },
  video: { icon: Film, label: '视频转录' },
  audio: { icon: Headphones, label: '音频转录' },
  image: { icon: ImageIcon, label: '图片' },
  epub: { icon: BookOpen, label: 'EPUB' },
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { icon: FileText, label: type };
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReadingsPage() {
  const [items, setItems] = useState<AtlasCarrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [addOpen, setAddOpen] = useState(false);
  // 请求序列号：快速切换 scope 时只让最新一次请求写状态，避免先发后到的竞态。
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const res = await atlasService.listCarriers({ scope, limit: 100 });
      if (seq !== requestSeq.current) return;
      setItems(res.data ?? []);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(extractApiErrorMessage(err, '加载读物失败'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-36">
          <Select
            value={scope}
            onValueChange={(next) => setScope(next as ScopeFilter)}
            options={SCOPE_OPTIONS}
            size="sm"
            ariaLabel="读物范围"
          />
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </button>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] px-3 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]"
        >
          <Plus className="h-3.5 w-3.5" />
          添加读物
        </button>
      </div>
    ),
    [refresh, scope]
  );

  return (
    <div className="space-y-4">
      <AdminModuleHeader
        title="读物"
        description="知识图集的起点 · 读到的内容先成为读物，再在阅读器里高亮、提炼知识点"
        icon={BookOpen}
        currentLabel={`${items.length} 篇`}
        actions={headerActions}
      />

      {error ? (
        <section className="rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] p-4 text-sm text-[var(--ink-primary)]">
          {error}
        </section>
      ) : loading ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
          ))}
        </section>
      ) : items.length === 0 ? (
        <EmptyReadings onAdd={() => setAddOpen(true)} />
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((carrier) => (
            <ReadingCard key={carrier.id} carrier={carrier} />
          ))}
        </section>
      )}

      <AddReadingDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => void refresh()} />
    </div>
  );
}

function ReadingCard({ carrier }: { carrier: AtlasCarrier }) {
  const meta = typeMeta(carrier.type);
  const Icon = meta.icon;
  const href = carrierReaderHref(carrier);
  const title = carrier.title || carrier.sourceUri;

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-primary)]">
          <Icon className="h-3 w-3" />
          {meta.label}
        </span>
        {href ? (
          <ArrowRight className="h-4 w-4 text-[var(--ink-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ink-primary)]" />
        ) : (
          <span className="font-mono text-[10px] text-[var(--ink-muted)]">{carrier.status}</span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold text-[var(--ink-primary)] group-hover:underline">{title}</p>
      <p className="mt-1 truncate text-xs text-[var(--ink-secondary)]">{carrier.sourceUri}</p>
      <p className="mt-2 font-mono text-[10px] text-[var(--ink-muted)]">{formatTime(carrier.updatedAt)}</p>
    </>
  );

  const cardClass =
    'group block min-h-[112px] rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-3 transition-colors';

  return href ? (
    <Link to={href} className={cn(cardClass, 'hover:border-[color-mix(in_oklch,var(--aurora-1)_34%,transparent)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_6%,var(--bg-leaf))]')}>
      {inner}
    </Link>
  ) : (
    <div className={cardClass}>{inner}</div>
  );
}

function EmptyReadings({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_14%,transparent)] bg-[var(--bg-leaf)] p-8 text-center">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--ink-primary)]">
        <BookOpen className="h-5 w-5" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-[var(--ink-primary)]">从第一篇读物开始</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--ink-secondary)]">
        读物是整张知识图谱的起点。贴一个网页链接或一段文本，进入阅读器后选中关键句即可提炼为知识点，再连成你的知识网。
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] px-4 text-sm font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)]"
        >
          <Plus className="h-4 w-4" />
          添加读物
        </button>
        <Link
          to="/notes"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] px-4 text-sm text-[var(--ink-secondary)] hover:bg-[var(--bg-substrate)] hover:text-[var(--ink-primary)]"
        >
          <FileText className="h-4 w-4" />
          从智能笔记选择
        </Link>
      </div>
    </section>
  );
}
