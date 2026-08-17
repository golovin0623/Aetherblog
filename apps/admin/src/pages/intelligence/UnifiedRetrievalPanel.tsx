// 统一检索面板 —— 知识工作台的聚合检索入口。
//
// 一句话同时探询三条链路:知识库向量检索 / Atlas 关键词+语义 / 笔记关键词。
// 命中以「知识原子」卡片呈现:出处、内容、相似度、下一步动作(打开原文 /
// 固定为来源 / 就此提问)。任何一条链路失败都转成可见的泳道状态。
//
// 纯逻辑在 unifiedRetrievalModel.ts;本文件只负责编排请求与呈现。

import {
  ArrowUpRight,
  Atom,
  CornerDownLeft,
  MessageSquareQuote,
  Pin,
  Search,
  Telescope,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import { Skeleton, spring, stagger, transition, variants } from '@aetherblog/ui';
import type { KnowledgeBase } from '@/services/knowledgeBaseService';
import { knowledgeBaseService } from '@/services/knowledgeBaseService';
import { atlasService } from '@/services/atlasService';
import { noteService } from '@/services/noteService';
import type { KnowledgeContextRef } from '@/services/knowledgeWorkspaceHandoff';
import {
  validateKnowledgeBaseRetrievalQuery,
  formatKnowledgeBaseRetrievalScore,
} from '@/pages/knowledge/knowledgeBaseRetrievalModel';
import { cn } from '@/lib/utils';
import {
  ATLAS_SEARCH_LIMIT,
  KB_HITS_PER_BASE,
  NOTE_SEARCH_LIMIT,
  buildAskSeed,
  planKbRetrievalTargets,
  resolveAtlasLaneOutcome,
  resolveKbLaneOutcome,
  resolveNotesLaneOutcome,
  type KbLaneSettledResult,
  type KnowledgeAtom,
  type RetrievalLane,
  type RetrievalLaneOutcome,
} from './unifiedRetrievalModel';

const LANE_LABELS: Record<RetrievalLane, string> = {
  kb: '知识库',
  atlas: '知识图集',
  notes: '笔记',
};

const COLLAPSED_ATOMS_PER_LANE = 4;

type PanelPhase = 'idle' | 'loading' | 'done';
type LaneFilter = 'all' | RetrievalLane;

export interface UnifiedRetrievalPanelProps {
  knowledgeBases: KnowledgeBase[];
  /** 已固定来源的 key 集合(`${kind}:${id}`),用于回显 pin 状态。 */
  pinnedKeys: ReadonlySet<string>;
  onTogglePin: (ref: KnowledgeContextRef) => void;
  onAskAbout: (seedGoal: string) => void;
}

function pinKey(ref: KnowledgeContextRef): string {
  return `${ref.kind}:${ref.id}`;
}

function LaneStateDot({ state }: { state: RetrievalLaneOutcome['state'] }) {
  return (
    <span
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        state === 'ready' && 'bg-[var(--signal-success)]',
        state === 'degraded' && 'bg-[var(--signal-warn)]',
        state === 'error' && 'bg-[var(--signal-danger)]',
        state === 'empty' && 'bg-[var(--ink-subtle)]',
      )}
      aria-hidden="true"
    />
  );
}

function AtomCard({
  atom,
  pinned,
  reducedMotion,
  onOpen,
  onTogglePin,
  onAskAbout,
}: {
  atom: KnowledgeAtom;
  pinned: boolean;
  reducedMotion: boolean;
  onOpen: (href: string) => void;
  onTogglePin: (ref: KnowledgeContextRef) => void;
  onAskAbout: (seed: string) => void;
}) {
  return (
    <motion.article
      layout={reducedMotion ? false : 'position'}
      variants={reducedMotion ? variants.fade : variants.fadeUp}
      transition={transition.quick}
      className={cn('intelligence-atom', pinned && 'intelligence-atom-pinned')}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          {atom.sourceLabel}
        </span>
        {atom.score !== null && (
          <span
            className="flex shrink-0 items-center gap-1.5"
            title={`相似度 ${formatKnowledgeBaseRetrievalScore(atom.score)}`}
          >
            <span className="intelligence-score-bar" aria-hidden="true">
              <span
                className="intelligence-score-bar-fill"
                style={{ transform: `scaleX(${atom.score})` }}
              />
            </span>
            <span className="font-mono text-[10px] font-bold tabular-nums text-[var(--aurora-1)]">
              {formatKnowledgeBaseRetrievalScore(atom.score)}
            </span>
          </span>
        )}
      </div>
      <h3 className="mt-1.5 truncate text-[13px] font-bold leading-5 text-[var(--ink-primary)]">
        {atom.title}
      </h3>
      {atom.snippet && (
        <p className="intelligence-atom-snippet">{atom.snippet}</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {atom.href && (
          <button
            type="button"
            className="intelligence-atom-action"
            onClick={() => onOpen(atom.href!)}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            打开原文
          </button>
        )}
        {atom.pinRef && (
          <motion.button
            type="button"
            aria-pressed={pinned}
            className={cn('intelligence-atom-action', pinned && 'intelligence-atom-action-active')}
            onClick={() => onTogglePin(atom.pinRef!)}
            whileTap={reducedMotion ? undefined : { scale: 0.94 }}
            transition={spring.precise}
          >
            <Pin className="h-3.5 w-3.5" />
            {pinned ? '已固定为来源' : '固定为来源'}
          </motion.button>
        )}
        {(atom.quote || atom.snippet) && (
          <button
            type="button"
            className="intelligence-atom-action"
            onClick={() => onAskAbout(buildAskSeed(atom))}
          >
            <MessageSquareQuote className="h-3.5 w-3.5" />
            就此提问
          </button>
        )}
      </div>
    </motion.article>
  );
}

function LaneSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      {[0, 1].map((index) => (
        <div key={index} className="intelligence-atom">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-4 w-56 max-w-full" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-1 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function UnifiedRetrievalPanel({
  knowledgeBases,
  pinnedKeys,
  onTogglePin,
  onAskAbout,
}: UnifiedRetrievalPanelProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion() ?? false;
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeqRef = useRef(0);

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [phase, setPhase] = useState<PanelPhase>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<RetrievalLaneOutcome[] | null>(null);
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('all');
  const [expandedLanes, setExpandedLanes] = useState<ReadonlySet<RetrievalLane>>(new Set());

  useHotkeys(
    '/',
    () => inputRef.current?.focus(),
    { preventDefault: true },
    [],
  );

  const runSearch = async () => {
    const validation = validateKnowledgeBaseRetrievalQuery(query);
    if (!validation.ok) {
      setValidationError(validation.message);
      inputRef.current?.focus();
      return;
    }
    const plan = planKbRetrievalTargets(knowledgeBases);
    const seq = ++requestSeqRef.current;
    setValidationError(null);
    setPhase('loading');
    setSubmittedQuery(validation.query);
    setLaneFilter('all');
    setExpandedLanes(new Set());

    const kbPromises = plan.targets.map(
      (target): Promise<KbLaneSettledResult> =>
        knowledgeBaseService
          .retrieve(target.id, { query: validation.query, limit: KB_HITS_PER_BASE })
          .then((res): KbLaneSettledResult =>
            res.data ? { target, ok: true, response: res.data } : { target, ok: false },
          )
          .catch((): KbLaneSettledResult => ({ target, ok: false })),
    );
    const atlasPromise = atlasService
      .search({ q: validation.query, limit: ATLAS_SEARCH_LIMIT, semantic: true, scope: 'mine' })
      .then((res) => (res.data ? { ok: true as const, response: res.data } : { ok: false as const }))
      .catch(() => ({ ok: false as const }));
    const notesPromise = noteService
      .getList({ pageNum: 1, pageSize: NOTE_SEARCH_LIMIT, keyword: validation.query })
      .then((res) => ({ ok: true as const, notes: res.data?.list ?? [] }))
      .catch(() => ({ ok: false as const }));

    const [kbResults, atlasResult, notesResult] = await Promise.all([
      Promise.all(kbPromises),
      atlasPromise,
      notesPromise,
    ]);
    if (seq !== requestSeqRef.current) return;

    setOutcomes([
      resolveKbLaneOutcome(kbResults, plan.skippedReadyCount),
      resolveAtlasLaneOutcome(atlasResult),
      resolveNotesLaneOutcome(notesResult),
    ]);
    setPhase('done');
  };

  const totalAtoms = useMemo(
    () => (outcomes ?? []).reduce((sum, outcome) => sum + outcome.atoms.length, 0),
    [outcomes],
  );
  const visibleOutcomes = useMemo(
    () => (outcomes ?? []).filter((outcome) => laneFilter === 'all' || outcome.lane === laneFilter),
    [outcomes, laneFilter],
  );
  const allLanesFailed = outcomes !== null && outcomes.every((outcome) => outcome.state === 'error');

  const toggleLaneExpansion = (lane: RetrievalLane) => {
    setExpandedLanes((current) => {
      const next = new Set(current);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  };

  return (
    <section className="intelligence-panel" aria-label="统一检索">
      <div className="intelligence-panel-header">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="intelligence-panel-icon" aria-hidden="true">
            <Telescope className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="intelligence-panel-title">统一检索</h2>
            <p className="intelligence-panel-description">
              一句话同时检索知识库、知识图集与笔记；命中可直接固定为本次任务的来源。
            </p>
          </div>
        </div>
        <span className="intelligence-kbd" aria-hidden="true">/</span>
      </div>

      <div className="intelligence-panel-body">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
          role="search"
          aria-label="在全部知识中检索"
        >
          <div className="intelligence-search-field">
            <Search className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (validationError) setValidationError(null);
              }}
              placeholder="用一个真实的问题探询你的全部知识…"
              maxLength={500}
              className="min-w-0 flex-1 bg-transparent text-sm leading-6 text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-muted)]"
              aria-label="检索词"
            />
            <button
              type="submit"
              className="intelligence-action-button-primary min-h-9 shrink-0 px-3.5 text-sm"
              disabled={phase === 'loading'}
            >
              {phase === 'loading' ? '检索中' : '检索'}
              <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </form>

        {validationError && (
          <p role="alert" className="mt-2 text-xs font-semibold text-[var(--signal-warn)]">
            {validationError}
          </p>
        )}

        {phase === 'idle' && (
          <p className="mt-3 flex items-center gap-2 text-xs leading-5 text-[var(--ink-muted)]">
            <Atom className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-1)]" aria-hidden="true" />
            检索结果会拆成一条条「知识原子」:每条命中都带出处与相似度，可固定为来源或就此提问。
          </p>
        )}

        {phase === 'loading' && (
          <div className="mt-4 grid gap-4 lg:grid-cols-3" aria-busy="true" aria-label="正在检索">
            <LaneSkeleton />
            <LaneSkeleton />
            <LaneSkeleton />
          </div>
        )}

        {phase === 'done' && outcomes && (
          <div className="mt-4">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p aria-live="polite" className="min-w-0 truncate font-mono text-[11px] tabular-nums text-[var(--ink-muted)]">
                「{submittedQuery}」 · {totalAtoms} 个知识原子
              </p>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="按来源筛选">
                {(
                  [
                    { value: 'all' as const, label: '全部', count: totalAtoms },
                    ...outcomes.map((outcome) => ({
                      value: outcome.lane,
                      label: LANE_LABELS[outcome.lane],
                      count: outcome.atoms.length,
                    })),
                  ]
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    data-active={laneFilter === option.value}
                    onClick={() => setLaneFilter(option.value)}
                    className="intelligence-lane-filter"
                  >
                    {option.label}
                    <span className="font-mono tabular-nums opacity-70">{option.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {allLanesFailed ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[var(--intelligence-border)] px-4 py-8 text-center">
                <p className="text-sm font-bold text-[var(--ink-primary)]">检索链路暂时不可用</p>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                  三条链路本次都未完成，请稍后重试;这不代表你的知识中没有答案。
                </p>
              </div>
            ) : totalAtoms === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[var(--intelligence-border)] px-4 py-8 text-center">
                <p className="text-sm font-bold text-[var(--ink-primary)]">没有找到相关的知识原子</p>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                  换一种问法，补充对象、时间或关键术语;或先到知识库添加资料。
                </p>
              </div>
            ) : (
                <motion.div
                  key={`${submittedQuery}:${laneFilter}`}
                  className="mt-4 space-y-5"
                  initial="initial"
                  animate="animate"
                  variants={{
                    initial: {},
                    animate: { transition: reducedMotion ? undefined : stagger(35) },
                  }}
                >
                  {visibleOutcomes.map((outcome) => {
                    const expanded = expandedLanes.has(outcome.lane);
                    const atoms = expanded
                      ? outcome.atoms
                      : outcome.atoms.slice(0, COLLAPSED_ATOMS_PER_LANE);
                    return (
                      <section key={outcome.lane} aria-label={LANE_LABELS[outcome.lane]}>
                        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 px-0.5">
                          <LaneStateDot state={outcome.state} />
                          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                            {LANE_LABELS[outcome.lane]}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                            {outcome.atoms.length}
                          </span>
                          {outcome.detail && (
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate text-[11px]',
                                outcome.state === 'error'
                                  ? 'text-[var(--signal-danger)]'
                                  : outcome.state === 'degraded'
                                    ? 'text-[var(--signal-warn)]'
                                    : 'text-[var(--ink-muted)]',
                              )}
                              title={outcome.detail}
                            >
                              {outcome.detail}
                            </span>
                          )}
                        </div>
                        {outcome.atoms.length > 0 && (
                          <div className="grid gap-2 lg:grid-cols-2">
                            {atoms.map((atom) => (
                              <AtomCard
                                key={atom.key}
                                atom={atom}
                                pinned={Boolean(atom.pinRef && pinnedKeys.has(pinKey(atom.pinRef)))}
                                reducedMotion={reducedMotion}
                                onOpen={(href) => navigate(href)}
                                onTogglePin={onTogglePin}
                                onAskAbout={onAskAbout}
                              />
                            ))}
                          </div>
                        )}
                        {outcome.atoms.length > COLLAPSED_ATOMS_PER_LANE && (
                          <button
                            type="button"
                            onClick={() => toggleLaneExpansion(outcome.lane)}
                            className="mt-2 min-h-9 w-full rounded-xl text-[11px] font-semibold text-[var(--aurora-1)] transition-colors hover:bg-[var(--intelligence-control)]"
                          >
                            {expanded
                              ? `收起${LANE_LABELS[outcome.lane]}结果`
                              : `展开全部 ${outcome.atoms.length} 条${LANE_LABELS[outcome.lane]}结果`}
                          </button>
                        )}
                      </section>
                    );
                  })}
                </motion.div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
