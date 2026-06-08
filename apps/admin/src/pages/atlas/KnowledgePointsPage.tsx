import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Library, Plus, RefreshCw, Search } from 'lucide-react';
import { Select } from '@aetherblog/ui';
import type {
  AtlasKnowledgePoint,
  AtlasKnowledgePointStatus,
  AtlasKnowledgePointType,
  AtlasProvenance,
} from '@aetherblog/types';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { atlasService } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { kpStatusLabel, kpTypeLabel, provenanceLabel } from './atlasLabels';

type TypeFilter = AtlasKnowledgePointType | 'all';
type StatusFilter = AtlasKnowledgePointStatus | 'all';
type ProvenanceFilter = AtlasProvenance | 'all';
type EvidenceFilter = 'all' | 'with' | 'without';
type AtlasScopeFilter = 'all' | 'mine';

const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'claim', label: '主张' },
  { value: 'concept', label: '概念' },
  { value: 'question', label: '问题' },
  { value: 'definition', label: '定义' },
  { value: 'method', label: '方法' },
  { value: 'example', label: '示例' },
  { value: 'person', label: '人物' },
  { value: 'source', label: '来源' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'seed', label: '萌芽' },
  { value: 'growing', label: '成长' },
  { value: 'evergreen', label: '常青' },
  { value: 'archived', label: '归档' },
];

const SCOPE_OPTIONS = [
  { value: 'all', label: '全部可访问' },
  { value: 'mine', label: '仅我的' },
];

const PROVENANCE_OPTIONS = [
  { value: 'all', label: '全部来源' },
  { value: 'user', label: '手动' },
  { value: 'ai_suggested', label: 'AI 生成' },
  { value: 'imported', label: '导入' },
];

const EVIDENCE_OPTIONS = [
  { value: 'all', label: '全部证据' },
  { value: 'with', label: '有证据' },
  { value: 'without', label: '缺证据' },
];

export default function KnowledgePointsPage() {
  const [searchParams] = useSearchParams();
  const urlKeyword = searchParams.get('keyword') ?? '';
  const [items, setItems] = useState<AtlasKnowledgePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState(urlKeyword);
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [provenance, setProvenance] = useState<ProvenanceFilter>('all');
  const [evidence, setEvidence] = useState<EvidenceFilter>('all');
  const [scope, setScope] = useState<AtlasScopeFilter>('all');

  useEffect(() => {
    setKeyword(urlKeyword);
  }, [urlKeyword]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await atlasService.listKnowledgePoints({
        keyword: keyword.trim() || undefined,
        type: type === 'all' ? undefined : type,
        status: status === 'all' ? undefined : status,
        provenance: provenance === 'all' ? undefined : provenance,
        evidence: evidence === 'all' ? undefined : evidence,
        scope,
        limit: 500,
      });
      setItems(res.data ?? []);
      setError(null);
    } catch (err) {
      setError(extractApiErrorMessage(err, '加载知识点失败'));
    } finally {
      setLoading(false);
    }
  }, [evidence, keyword, provenance, scope, status, type]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summary = useMemo(() => {
    const active = items.filter((item) => !item.archived && item.status !== 'archived').length;
    const ai = items.filter((item) => item.provenance === 'ai_suggested').length;
    return { active, ai };
  }, [items]);

  const hasFilter =
    keyword.trim() !== '' ||
    type !== 'all' ||
    status !== 'all' ||
    provenance !== 'all' ||
    evidence !== 'all';

  return (
    <div className="space-y-4">
      <AdminModuleHeader
        title="知识点"
        description={`${items.length} 条结果 · ${summary.active} 活跃 · ${summary.ai} 由 AI 生成`}
        icon={Library}
        showCurrentLabel={false}
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs hover:bg-[var(--bg-substrate)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </button>
        }
      />

      <section className="grid gap-3 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_150px_150px_150px_150px_150px]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索标题或正文"
            className="h-10 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-substrate)] pl-9 pr-3 text-sm text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
          />
        </label>
        <Select
          value={scope}
          onValueChange={(next) => setScope(next as AtlasScopeFilter)}
          options={SCOPE_OPTIONS}
          size="md"
          ariaLabel="Atlas 数据范围"
        />
        <Select
          value={type}
          onValueChange={(next) => setType(next as TypeFilter)}
          options={TYPE_OPTIONS}
          size="md"
          ariaLabel="知识点类型过滤"
        />
        <Select
          value={status}
          onValueChange={(next) => setStatus(next as StatusFilter)}
          options={STATUS_OPTIONS}
          size="md"
          ariaLabel="知识点状态过滤"
        />
        <Select
          value={provenance}
          onValueChange={(next) => setProvenance(next as ProvenanceFilter)}
          options={PROVENANCE_OPTIONS}
          size="md"
          ariaLabel="知识点来源过滤"
        />
        <Select
          value={evidence}
          onValueChange={(next) => setEvidence(next as EvidenceFilter)}
          options={EVIDENCE_OPTIONS}
          size="md"
          ariaLabel="知识点 evidence 过滤"
        />
      </section>

      {error ? (
        <section className="rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] p-4 text-sm text-[var(--ink-primary)]">
          {error}
        </section>
      ) : loading ? (
        <KPSkeleton />
      ) : items.length === 0 ? (
        hasFilter ? (
          <section className="rounded-xl border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-leaf)] p-10 text-center text-sm text-[var(--ink-secondary)]">
            没有匹配的知识点，换个筛选条件试试。
          </section>
        ) : (
          <section className="rounded-2xl border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_14%,transparent)] bg-[var(--bg-leaf)] p-8 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--ink-primary)]">
              <BookOpen className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold text-[var(--ink-primary)]">还没有知识点</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--ink-secondary)]">
              知识点来自读物里的高亮。先添加一篇读物，在阅读器里选中关键句即可提炼为知识点。
            </p>
            <Link
              to="/atlas/readings"
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_32%,transparent)] px-4 text-sm font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_42%,transparent)]"
            >
              <Plus className="h-4 w-4" />
              添加读物
            </Link>
          </section>
        )
      ) : (
        <ul className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)]">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/atlas/kp/${item.id}`}
                className="group grid gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-substrate)] md:grid-cols-[minmax(0,1fr)_220px_24px] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--ink-primary)] group-hover:underline">
                    {item.title}
                  </p>
                  {item.bodyMarkdown && (
                    <p className="mt-1 line-clamp-1 text-xs text-[var(--ink-secondary)]">{item.bodyMarkdown}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--ink-muted)]">
                  <Chip>{kpTypeLabel(item.type)}</Chip>
                  <Chip>{kpStatusLabel(item.status)}</Chip>
                  <Chip className={cn(item.provenance === 'ai_suggested' && 'text-[var(--signal-warn)]')}>
                    {provenanceLabel(item.provenance)}
                  </Chip>
                  <span className="font-mono">可信度 {item.confidence?.toFixed(2) ?? '0.00'}</span>
                </div>
                <ArrowRight className="hidden h-4 w-4 text-[var(--ink-muted)] md:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KPSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-20 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
      ))}
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-2 py-0.5 font-mono uppercase tracking-[0.12em]', className)}>
      {children}
    </span>
  );
}
