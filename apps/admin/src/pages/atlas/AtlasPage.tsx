import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Compass,
  Database,
  GitBranch,
  Highlighter,
  Library,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Select } from '@aetherblog/ui';

import type { AtlasHealthResponse, AtlasKnowledgePoint, AtlasTypedRelation } from '@aetherblog/types';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { atlasService, type AtlasSuggestion } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';

type AtlasScopeFilter = 'all' | 'mine';

type DashboardState =
  | { kind: 'loading' }
  | {
      kind: 'ok';
      health: AtlasHealthResponse;
      kps: AtlasKnowledgePoint[];
      suggestions: AtlasSuggestion[];
      relations: AtlasTypedRelation[];
    }
  | { kind: 'error'; message: string };

const QUICK_LINKS = [
  {
    title: '知识点',
    description: '搜索、筛选和进入 KP 详情',
    href: '/atlas/kps',
    icon: Library,
  },
  {
    title: '图谱',
    description: '按类型过滤并检查节点关系',
    href: '/atlas/graph',
    icon: GitBranch,
  },
  {
    title: 'AI 建议',
    description: '处理待确认的 KP / relation 候选',
    href: '/atlas/suggestions',
    icon: Sparkles,
  },
  {
    title: '阅读器',
    description: '从智能笔记进入 Reader 并创建标注',
    href: '/notes',
    icon: Highlighter,
  },
];

const SCOPE_OPTIONS = [
  { value: 'all', label: '全部可访问' },
  { value: 'mine', label: '仅我的' },
];

export default function AtlasPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<DashboardState>({ kind: 'loading' });
  const [scope, setScope] = useState<AtlasScopeFilter>('all');
  const [kpSearch, setKpSearch] = useState('');

  const handleKPSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = kpSearch.trim();
    navigate(query ? `/atlas/kps?keyword=${encodeURIComponent(query)}` : '/atlas/kps');
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [healthRes, kpRes, suggestionRes, graphRes] = await Promise.all([
          atlasService.health(),
          atlasService.listKnowledgePoints({ limit: 100, scope }),
          atlasService.listSuggestions({ status: 'pending', limit: 100, scope }),
          atlasService.getGraph(500, { scope }),
        ]);
        if (cancelled) return;
        setState({
          kind: 'ok',
          health: healthRes.data,
          kps: kpRes.data ?? [],
          suggestions: suggestionRes.data ?? [],
          relations: graphRes.data?.edges ?? [],
        });
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'error', message: extractApiErrorMessage(err, 'Atlas 工作台加载失败') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const summary = useMemo(() => {
    if (state.kind !== 'ok') return null;
    const activeKps = state.kps.filter((k) => !k.archived && k.status !== 'archived');
    const relationDensity = activeKps.length > 0 ? state.relations.length / activeKps.length : 0;
    const related = new Set<number>();
    state.relations.forEach((r) => {
      related.add(r.fromKpId);
      related.add(r.toKpId);
    });
    const orphanCount = activeKps.filter((k) => !related.has(k.id)).length;
    const aiKps = activeKps.filter((k) => k.provenance === 'ai_suggested').length;
    return {
      activeKps,
      relationDensity,
      orphanCount,
      aiKps,
    };
  }, [state]);

  return (
    <div className="space-y-6">
      <AdminModuleHeader
        title="Aether Atlas"
        description="可溯源知识图集工作台 · Carrier / Annotation / KnowledgePoint / Typed Relation"
        icon={Compass}
        currentLabel="Dashboard"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-36">
              <Select
                value={scope}
                onValueChange={(next) => setScope(next as AtlasScopeFilter)}
                options={SCOPE_OPTIONS}
                size="sm"
                ariaLabel="Atlas 数据范围"
              />
            </div>
            <Link
              to="/atlas/kps"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] px-3 text-xs font-medium text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_36%,transparent)]"
            >
              <Library className="h-3.5 w-3.5" />
              管理知识点
            </Link>
          </div>
        }
      />

      {state.kind === 'loading' ? (
        <DashboardSkeleton />
      ) : state.kind === 'error' ? (
        <section className="rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] p-4 text-sm text-[var(--ink-primary)]">
          {state.message}
        </section>
      ) : (
        <>
          <form
            onSubmit={handleKPSearch}
            className="grid gap-2 rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-3 md:grid-cols-[minmax(220px,1fr)_96px]"
          >
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="search"
                value={kpSearch}
                onChange={(event) => setKpSearch(event.target.value)}
                placeholder="搜索 KP 标题或正文"
                className="h-10 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-substrate)] pl-9 pr-3 text-sm text-[var(--ink-primary)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]"
              />
            </label>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] px-3 text-sm font-medium text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_36%,transparent)]"
            >
              <Search className="h-4 w-4" />
              搜索
            </button>
          </form>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile icon={Database} label="Active KP" value={String(summary?.activeKps.length ?? 0)} />
            <MetricTile icon={GitBranch} label="Relations" value={String(state.relations.length)} />
            <MetricTile
              icon={ShieldCheck}
              label="Relation density"
              value={(summary?.relationDensity ?? 0).toFixed(2)}
              tone={(summary?.relationDensity ?? 0) >= 0.6 ? 'good' : 'warn'}
            />
            <MetricTile
              icon={Sparkles}
              label="Pending suggestions"
              value={String(state.suggestions.length)}
              tone={state.suggestions.length > 0 ? 'warn' : 'neutral'}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <section className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--ink-primary)]">工作区入口</h2>
                    <p className="text-xs text-[var(--ink-secondary)]">从真实子流程进入，不再保留旧版占位操作。</p>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    module={state.health.module} · phase={state.health.phase}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {QUICK_LINKS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        className="group flex min-h-[92px] items-start gap-3 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-substrate)] p-3 transition-colors hover:border-[color-mix(in_oklch,var(--aurora-1)_34%,transparent)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,var(--bg-substrate))]"
                      >
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--ink-primary)]">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-[var(--ink-primary)]">{item.title}</span>
                          <span className="mt-1 block text-xs leading-relaxed text-[var(--ink-secondary)]">{item.description}</span>
                        </span>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--ink-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ink-primary)]" />
                      </Link>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-[var(--ink-primary)]">最近知识点</h2>
                  <Link to="/atlas/kps" className="text-xs text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]">
                    查看全部
                  </Link>
                </div>
                {state.kps.length === 0 ? (
                  <EmptyLine icon={BookOpen} text="还没有知识点。先从智能笔记进入阅读器创建标注，再提炼 KP。" />
                ) : (
                  <ul className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
                    {state.kps.slice(0, 6).map((kp) => (
                      <li key={kp.id} className="py-2.5">
                        <Link to={`/atlas/kp/${kp.id}`} className="group flex items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--ink-primary)] group-hover:underline">
                              {kp.title}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--ink-muted)]">
                              <Chip>{kp.type}</Chip>
                              <Chip>{kp.status}</Chip>
                              <Chip>{kp.provenance}</Chip>
                            </span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className="space-y-4">
              <section className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
                <h2 className="text-sm font-semibold text-[var(--ink-primary)]">图谱健康</h2>
                <dl className="mt-3 space-y-3 text-xs">
                  <HealthRow label="孤立 KP" value={summary?.orphanCount ?? 0} warn={(summary?.orphanCount ?? 0) > 0} />
                  <HealthRow label="AI 生成 KP" value={summary?.aiKps ?? 0} />
                  <HealthRow label="待处理建议" value={state.suggestions.length} warn={state.suggestions.length > 0} />
                </dl>
              </section>

              <section className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-[var(--ink-primary)]">待处理建议</h2>
                  <Link to="/atlas/suggestions" className="text-xs text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]">
                    处理
                  </Link>
                </div>
                {state.suggestions.length === 0 ? (
                  <EmptyLine icon={Sparkles} text="当前没有 pending 建议。" />
                ) : (
                  <ul className="space-y-2">
                    {state.suggestions.slice(0, 4).map((item) => (
                      <li key={item.id} className="rounded-lg bg-[var(--bg-substrate)] p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <Chip>{item.kind}</Chip>
                          <span className="font-mono text-[10px] text-[var(--ink-muted)]">#{item.id}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[var(--ink-primary)]">
                          {item.kind === 'kp'
                            ? item.proposedTitle ?? '(无标题建议)'
                            : `KP #${item.fromKpId} -> KP #${item.toKpId}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </section>
        </>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        ))}
      </section>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-72 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
        <Skeleton className="h-72 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" />
      </section>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof Database;
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  return (
    <article className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</span>
        <Icon className="h-4 w-4 text-[var(--ink-muted)]" />
      </div>
      <p
        className={cn(
          'mt-3 font-mono text-3xl text-[var(--ink-primary)]',
          tone === 'good' && 'text-[var(--signal-success)]',
          tone === 'warn' && 'text-[var(--signal-warn)]'
        )}
      >
        {value}
      </p>
    </article>
  );
}

function HealthRow({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--ink-secondary)]">{label}</dt>
      <dd className={cn('font-mono text-[var(--ink-primary)]', warn && 'text-[var(--signal-warn)]')}>{value}</dd>
    </div>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: typeof BookOpen; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] p-4 text-center text-xs text-[var(--ink-secondary)]">
      <Icon className="mx-auto mb-2 h-4 w-4 text-[var(--ink-muted)]" />
      {text}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-2 py-0.5 font-mono uppercase tracking-[0.12em]">
      {children}
    </span>
  );
}
