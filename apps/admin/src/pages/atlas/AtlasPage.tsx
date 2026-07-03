// Atlas 概览 —— 知识图集工作台的落地页（Tab：概览）。
//
// 参考：docs/pm/atlas-redesign.md §4 P0-5/P0-6
// 设计目标：第一次回答「这是什么、从哪开始」。顶部是「读 → 标 → 联 → 问」引导条，
// 然后才是健康度指标与最近内容。文案全部去术语化，不再裸露 Carrier/KP/provenance。

import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Database,
  GitBranch,
  Highlighter,
  Library,
  Link2,
  MessageSquareText,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { Select } from '@aetherblog/ui';

import type { AtlasGraphHealth, AtlasHealthResponse, AtlasKnowledgePoint } from '@aetherblog/types';

import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { atlasService, type AtlasSuggestion } from '@/services/atlasService';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { AddReadingDialog } from './AddReadingDialog';
import { kpStatusLabel, kpTypeLabel, provenanceLabel } from './atlasLabels';

type AtlasScopeFilter = 'all' | 'mine';

type DashboardState =
  | { kind: 'loading' }
  | {
      kind: 'ok';
      health: AtlasHealthResponse;
      kps: AtlasKnowledgePoint[];
      suggestions: AtlasSuggestion[];
      graphHealth: AtlasGraphHealth;
    }
  | { kind: 'error'; message: string };

const ONBOARDING_DISMISS_KEY = 'atlas.onboarding.dismissed.v1';

const STEPS = [
  { icon: BookOpen, title: '读', desc: '添加网页、PDF、笔记或一段文本作为读物' },
  { icon: Highlighter, title: '标', desc: '在阅读器里选中关键句，提炼成知识点' },
  { icon: Link2, title: '联', desc: '把知识点连成有类型的关系，长成图谱' },
  { icon: MessageSquareText, title: '问', desc: '让灵境基于你的知识网作答与写作' },
];

const QUICK_LINKS = [
  {
    title: '读物',
    description: '添加并管理读物，进入阅读器标注',
    href: '/atlas/readings',
    icon: BookOpen,
  },
  {
    title: '知识点',
    description: '搜索、筛选并进入知识点详情',
    href: '/atlas/kps',
    icon: Library,
  },
  {
    title: '图谱',
    description: '按类型过滤并检查知识点之间的关系',
    href: '/atlas/graph',
    icon: GitBranch,
  },
  {
    title: 'AI 建议',
    description: '处理待确认的知识点 / 关系候选',
    href: '/atlas/suggestions',
    icon: Sparkles,
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
  const [addOpen, setAddOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(ONBOARDING_DISMISS_KEY) !== '1';
  });

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    try {
      window.localStorage.setItem(ONBOARDING_DISMISS_KEY, '1');
    } catch {
      /* 忽略 */
    }
  };

  const handleKPSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = kpSearch.trim();
    navigate(query ? `/atlas/search?q=${encodeURIComponent(query)}` : '/atlas/search');
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [healthRes, kpRes, suggestionRes, graphHealthRes] = await Promise.all([
          atlasService.health(),
          atlasService.listKnowledgePoints({ limit: 100, scope }),
          atlasService.listSuggestions({ status: 'pending', limit: 100, scope }),
          atlasService.getGraphHealth({ scope, hubLimit: 5 }),
        ]);
        if (cancelled) return;
        setState({
          kind: 'ok',
          health: healthRes.data,
          kps: kpRes.data ?? [],
          suggestions: suggestionRes.data ?? [],
          graphHealth: graphHealthRes.data,
        });
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'error', message: extractApiErrorMessage(err, '知识图集工作台加载失败') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  return (
    <div className="space-y-5">
      <AdminModuleHeader
        title="知识图集"
        description="把读到的内容连成一张可追溯、可被 AI 调用的知识网"
        icon={BookOpen}
        showCurrentLabel={false}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-36">
              <Select
                value={scope}
                onValueChange={(next) => setScope(next as AtlasScopeFilter)}
                options={SCOPE_OPTIONS}
                size="sm"
                ariaLabel="数据范围"
              />
            </div>
            <Link
              to="/aetherhub"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] px-3 text-xs font-medium text-[var(--ink-primary)] hover:bg-[var(--bg-substrate)]"
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              问灵境
            </Link>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] px-3 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]"
            >
              <Plus className="h-3.5 w-3.5" />
              添加读物
            </button>
          </div>
        }
      />

      {showOnboarding && (
        <section className="relative overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_6%,var(--bg-leaf))] p-4">
          <button
            type="button"
            onClick={dismissOnboarding}
            aria-label="收起引导"
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--bg-substrate)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--ink-primary)]">把读到的，变成你的知识网</h2>
              <p className="mt-1 text-xs text-[var(--ink-secondary)]">四步闭环：读 → 标 → 联 → 问，从一篇读物开始。</p>
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] px-3 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]"
            >
              <Plus className="h-3.5 w-3.5" />
              立即开始
            </button>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isFirst = index === 0;
              const isAsk = index === STEPS.length - 1;
              const activeCard =
                'h-full w-full rounded-xl border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[var(--bg-leaf)] p-3 text-left transition-colors hover:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]';
              const body = (
                <>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--ink-primary)]">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      0{index + 1}
                    </span>
                    <span className="text-sm font-semibold text-[var(--ink-primary)]">{step.title}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--ink-secondary)]">{step.desc}</p>
                </>
              );
              return (
                <li key={step.title}>
                  {isFirst ? (
                    <button type="button" onClick={() => setAddOpen(true)} className={activeCard}>
                      {body}
                    </button>
                  ) : isAsk ? (
                    <Link to="/aetherhub" className={cn(activeCard, 'block')}>
                      {body}
                    </Link>
                  ) : (
                    <div className="h-full rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-3">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

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
                placeholder="搜索知识点、标注或来源"
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
            <MetricTile icon={Database} label="活跃知识点" value={String(state.graphHealth.activeKpCount)} />
            <MetricTile icon={GitBranch} label="关系" value={String(state.graphHealth.relationCount)} />
            <MetricTile
              icon={ShieldCheck}
              label="平均连接数"
              value={state.graphHealth.relationDensity.toFixed(2)}
              tone={state.graphHealth.relationDensity >= 2 ? 'good' : 'warn'}
            />
            <MetricTile
              icon={Sparkles}
              label="待处理建议"
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
                    <p className="text-xs text-[var(--ink-secondary)]">从读物开始，到图谱与 AI 建议。</p>
                  </div>
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
                  <EmptyLine
                    icon={BookOpen}
                    text="还没有知识点。先添加一篇读物，在阅读器里选中关键句即可提炼。"
                    actionLabel="添加读物"
                    onAction={() => setAddOpen(true)}
                  />
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
                              <Chip>{kpTypeLabel(kp.type)}</Chip>
                              <Chip>{kpStatusLabel(kp.status)}</Chip>
                              <Chip>{provenanceLabel(kp.provenance)}</Chip>
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
                  <HealthRow
                    label="孤立知识点"
                    value={`${state.graphHealth.orphanKpCount} (${formatPercent(state.graphHealth.orphanKpRatio)})`}
                    warn={state.graphHealth.orphanKpCount > 0}
                  />
                  <HealthRow
                    label="知识点证据覆盖"
                    value={formatPercent(state.graphHealth.kpEvidenceCoverage)}
                    warn={state.graphHealth.missingEvidenceKpCount > 0}
                  />
                  <HealthRow
                    label="关系证据覆盖"
                    value={formatPercent(state.graphHealth.relationEvidenceCoverage)}
                    warn={state.graphHealth.missingEvidenceRelationCount > 0}
                  />
                  <HealthRow label="AI 生成知识点" value={state.graphHealth.aiKpCount} />
                  <HealthRow label="待处理建议" value={state.suggestions.length} warn={state.suggestions.length > 0} />
                </dl>
                <div className="mt-4 border-t border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] pt-3">
                  <h3 className="text-xs font-semibold text-[var(--ink-primary)]">枢纽节点</h3>
                  {state.graphHealth.topHubs.length === 0 ? (
                    <p className="mt-2 text-xs text-[var(--ink-secondary)]">暂无枢纽节点</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {state.graphHealth.topHubs.map((hub) => (
                        <li key={hub.kpId} className="text-xs">
                          <Link
                            to={`/atlas/kp/${hub.kpId}`}
                            className="flex items-center justify-between gap-3 rounded-md bg-[var(--bg-substrate)] px-2.5 py-2 hover:bg-[color-mix(in_oklch,var(--aurora-1)_8%,var(--bg-substrate))]"
                          >
                            <span className="min-w-0 truncate text-[var(--ink-primary)]">{hub.title}</span>
                            <span className="shrink-0 font-mono text-[var(--ink-muted)]">
                              {hub.degree} · {hub.inDegree}/{hub.outDegree}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[var(--bg-leaf)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-[var(--ink-primary)]">待处理建议</h2>
                  <Link to="/atlas/suggestions" className="text-xs text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]">
                    处理
                  </Link>
                </div>
                {state.suggestions.length === 0 ? (
                  <EmptyLine icon={Sparkles} text="当前没有待处理的 AI 建议。在阅读器里点「生成建议」即可产出候选。" />
                ) : (
                  <ul className="space-y-2">
                    {state.suggestions.slice(0, 4).map((item) => (
                      <li key={item.id} className="rounded-lg bg-[var(--bg-substrate)] p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <Chip>{item.kind === 'kp' ? '知识点' : '关系'}</Chip>
                          <span className="font-mono text-[10px] text-[var(--ink-muted)]">#{item.id}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[var(--ink-primary)]">
                          {item.kind === 'kp'
                            ? item.proposedTitle ?? '(无标题建议)'
                            : `知识点 #${item.fromKpId} → 知识点 #${item.toKpId}`}
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

      <AddReadingDialog open={addOpen} onClose={() => setAddOpen(false)} />
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
        <span className="text-[11px] font-medium text-[var(--ink-secondary)]">{label}</span>
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

function HealthRow({ label, value, warn = false }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--ink-secondary)]">{label}</dt>
      <dd className={cn('font-mono text-[var(--ink-primary)]', warn && 'text-[var(--signal-warn)]')}>{value}</dd>
    </div>
  );
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

function EmptyLine({
  icon: Icon,
  text,
  actionLabel,
  onAction,
}: {
  icon: typeof BookOpen;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] p-4 text-center text-xs text-[var(--ink-secondary)]">
      <Icon className="mx-auto mb-2 h-4 w-4 text-[var(--ink-muted)]" />
      {text}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] px-3 text-xs font-medium text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_36%,transparent)]"
        >
          <Plus className="h-3.5 w-3.5" />
          {actionLabel}
        </button>
      )}
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
