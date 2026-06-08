import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, BrainCircuit, FileText, Highlighter, RefreshCw, Search } from 'lucide-react';
import { Select } from '@aetherblog/ui';
import type { AtlasAnnotation, AtlasCarrier, AtlasSearchKnowledgePoint, AtlasSearchResponse } from '@aetherblog/types';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { atlasService } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { carrierReaderHref } from './carrierReaderHref';
import { anchorStateLabel, kpStatusLabel, kpTypeLabel, provenanceLabel } from './atlasLabels';

type AtlasScopeFilter = 'all' | 'mine';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; data: AtlasSearchResponse }
  | { kind: 'error'; message: string };

const SCOPE_OPTIONS = [
  { value: 'all', label: '全部可访问' },
  { value: 'mine', label: '仅我的' },
];

export default function AtlasSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const urlScope = searchParams.get('scope') === 'mine' ? 'mine' : 'all';
  const urlSemantic = searchParams.get('semantic') !== '0';
  const [query, setQuery] = useState(urlQuery);
  const [scope, setScope] = useState<AtlasScopeFilter>(urlScope);
  const [semantic, setSemantic] = useState(urlSemantic);
  const [state, setState] = useState<SearchState>(urlQuery ? { kind: 'loading' } : { kind: 'idle' });

  const runSearch = useCallback(async (nextQuery: string, nextScope: AtlasScopeFilter, nextSemantic: boolean) => {
    const q = nextQuery.trim();
    if (!q) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const res = await atlasService.search({ q, scope: nextScope, limit: 10, semantic: nextSemantic });
      setState({ kind: 'ok', data: res.data });
    } catch (err) {
      setState({ kind: 'error', message: extractApiErrorMessage(err, 'Atlas 搜索失败') });
    }
  }, []);

  useEffect(() => {
    setQuery(urlQuery);
    setScope(urlScope);
    setSemantic(urlSemantic);
    if (urlQuery.trim()) {
      void runSearch(urlQuery, urlScope, urlSemantic);
    } else {
      setState({ kind: 'idle' });
    }
  }, [runSearch, urlQuery, urlScope, urlSemantic]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = query.trim();
    setSearchParams(q ? { q, scope, ...(semantic ? {} : { semantic: '0' }) } : {});
  };

  const counts = useMemo(() => {
    if (state.kind !== 'ok') return { kp: 0, annotation: 0, carrier: 0, total: 0 };
    return {
      kp: state.data.knowledgePoints.length,
      annotation: state.data.annotations.length,
      carrier: state.data.carriers.length,
      total: state.data.total,
    };
  }, [state]);

  // 用搜索结果里的 carrier 反查，让「标注」结果也能跳进对应阅读器——
  // 原本 annotation 结果是纯文本死路（无任何链接）。
  const carrierById = useMemo(() => {
    if (state.kind !== 'ok') return new Map<number, AtlasCarrier>();
    // 后端空切片可能序列化为 null，取数前兜底成空数组，避免 .map 抛 TypeError。
    return new Map((state.data.carriers ?? []).map((carrier) => [carrier.id, carrier] as const));
  }, [state]);

  return (
    <div className="space-y-4">
      <AdminModuleHeader
        title="搜索"
        description={`跨知识点 / 标注 / 读物检索 · ${counts.total} 条结果`}
        icon={Search}
        showCurrentLabel={false}
        actions={
          <button
            type="button"
            onClick={() => void runSearch(query, scope, semantic)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </button>
        }
      />

      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-3 md:grid-cols-[minmax(220px,1fr)_160px_180px_104px]"
      >
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、正文、标注或来源"
            className="h-10 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-substrate)] pl-9 pr-3 text-sm text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
          />
        </label>
        <Select
          value={scope}
          onValueChange={(next) => setScope(next as AtlasScopeFilter)}
          options={SCOPE_OPTIONS}
          size="md"
          ariaLabel="Atlas 搜索范围"
        />
        <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-substrate)] px-3 text-sm text-[var(--ink-primary)]">
          <input
            type="checkbox"
            checked={semantic}
            onChange={(event) => setSemantic(event.target.checked)}
            className="h-4 w-4 rounded border-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)] accent-[var(--aurora-1)]"
            aria-label="启用 Atlas 语义重排"
          />
          <BrainCircuit className="h-4 w-4 text-[var(--ink-muted)]" />
          <span className="truncate">语义重排</span>
        </label>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] px-3 text-sm font-medium text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_36%,transparent)]"
        >
          <Search className="h-4 w-4" />
          搜索
        </button>
      </form>

      {state.kind === 'idle' ? (
        <section className="rounded-lg border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-leaf)] p-10 text-center text-sm text-[var(--ink-secondary)]">
          输入关键词后开始检索。
        </section>
      ) : state.kind === 'loading' ? (
        <SearchSkeleton />
      ) : state.kind === 'error' ? (
        <section className="rounded-lg border border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] p-4 text-sm text-[var(--ink-primary)]">
          {state.message}
        </section>
      ) : (
        <div className="space-y-3">
          {state.data.semanticEnabled && !state.data.semanticAvailable ? (
            <section className="rounded-lg border border-[color-mix(in_oklch,var(--signal-warn)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_8%,transparent)] px-4 py-3 text-xs text-[var(--ink-primary)]">
              语义重排暂不可用，当前展示关键词结果。
            </section>
          ) : null}
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ResultPanel title="知识点" count={counts.kp} icon={BookOpen}>
              {state.data.knowledgePoints.length === 0 ? (
                <EmptyResult />
              ) : (
                <ul className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
                  {state.data.knowledgePoints.map((item) => (
                    <KnowledgePointResult key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </ResultPanel>

            <div className="space-y-4">
              <ResultPanel title="标注" count={counts.annotation} icon={Highlighter}>
                {state.data.annotations.length === 0 ? (
                  <EmptyResult />
                ) : (
                  <ul className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
                    {state.data.annotations.map((item) => (
                      <AnnotationResult key={item.id} item={item} carrier={carrierById.get(item.carrierId) ?? null} />
                    ))}
                  </ul>
                )}
              </ResultPanel>

              <ResultPanel title="读物" count={counts.carrier} icon={FileText}>
                {state.data.carriers.length === 0 ? (
                  <EmptyResult />
                ) : (
                  <ul className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
                    {state.data.carriers.map((item) => (
                      <CarrierResult key={item.id} item={item} />
                    ))}
                  </ul>
                )}
              </ResultPanel>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function KnowledgePointResult({ item }: { item: AtlasSearchKnowledgePoint }) {
  const score = typeof item.searchScore === 'number' ? Math.round(item.searchScore * 100) : null;
  return (
    <li>
      <Link
        to={`/atlas/kp/${item.id}`}
        className="group grid gap-2 px-4 py-3 transition-colors hover:bg-[var(--bg-substrate)] md:grid-cols-[minmax(0,1fr)_24px]"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--ink-primary)] group-hover:underline">
            {item.title}
          </span>
          {item.bodyMarkdown ? (
            <span className="mt-1 block line-clamp-2 text-xs text-[var(--ink-secondary)]">{item.bodyMarkdown}</span>
          ) : null}
          <span className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--ink-muted)]">
            <Chip>{kpTypeLabel(item.type)}</Chip>
            <Chip>{kpStatusLabel(item.status)}</Chip>
            <Chip className={cn(item.provenance === 'ai_suggested' && 'text-[var(--signal-warn)]')}>
              {provenanceLabel(item.provenance)}
            </Chip>
            {item.searchSource ? <Chip className="text-[var(--aurora-1)]">{searchSourceLabel(item.searchSource)}</Chip> : null}
            {score !== null ? <Chip>{score}%</Chip> : null}
          </span>
        </span>
        <ArrowRight className="hidden h-4 w-4 text-[var(--ink-muted)] md:block" />
      </Link>
    </li>
  );
}

function searchSourceLabel(source: string) {
  if (source === 'keyword_semantic') return 'keyword+semantic';
  if (source === 'semantic') return 'semantic';
  return 'keyword';
}

function AnnotationResult({ item, carrier }: { item: AtlasAnnotation; carrier: AtlasCarrier | null }) {
  const href = carrier ? carrierReaderHref(carrier) : null;
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm text-[var(--ink-primary)]">{item.bodyText || '(无正文标注)'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--ink-muted)]">
          <Chip>{anchorStateLabel(item.anchorState)}</Chip>
          <span className="min-w-0 truncate">{carrier?.title || `读物 #${item.carrierId}`}</span>
        </div>
      </div>
      {href ? (
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
      ) : (
        <span className="font-mono text-[10px] text-[var(--ink-muted)]">#{item.id}</span>
      )}
    </div>
  );
  return (
    <li>
      {href ? (
        <Link to={href} className="block px-4 py-3 transition-colors hover:bg-[var(--bg-substrate)]">
          {inner}
        </Link>
      ) : (
        <div className="px-4 py-3">{inner}</div>
      )}
    </li>
  );
}

function CarrierResult({ item }: { item: AtlasCarrier }) {
  const readerHref = carrierReaderHref(item);
  const content = (
    <>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[var(--ink-primary)]">{item.title || item.sourceUri}</span>
        <span className="mt-1 block truncate text-xs text-[var(--ink-secondary)]">{item.sourceUri}</span>
        <span className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--ink-muted)]">
          <Chip>{item.type}</Chip>
          <Chip>{item.status}</Chip>
        </span>
      </span>
      {readerHref ? <ArrowRight className="hidden h-4 w-4 text-[var(--ink-muted)] md:block" /> : null}
    </>
  );
  return (
    <li>
      {readerHref ? (
        <Link
          to={readerHref}
          className="group grid gap-2 px-4 py-3 transition-colors hover:bg-[var(--bg-substrate)] md:grid-cols-[minmax(0,1fr)_24px]"
        >
          {content}
        </Link>
      ) : (
        <div className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_24px]">{content}</div>
      )}
    </li>
  );
}

function ResultPanel({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count: number;
  icon: typeof Search;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]">
      <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-primary)]">
          <Icon className="h-4 w-4 text-[var(--ink-muted)]" />
          {title}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          {count} 条
        </span>
      </div>
      {children}
    </section>
  );
}

function EmptyResult() {
  return <div className="px-4 py-6 text-sm text-[var(--ink-secondary)]">没有匹配结果。</div>;
}

function SearchSkeleton() {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {Array.from({ length: 2 }, (_, index) => (
        <Skeleton key={index} className="h-72 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
      ))}
    </section>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-2 py-0.5 font-mono uppercase tracking-[0.12em]', className)}>
      {children}
    </span>
  );
}
