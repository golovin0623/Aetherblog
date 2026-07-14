import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Library,
  PencilLine,
  Quote,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  WandSparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@aetherblog/ui';
import type { AtlasCarrier } from '@aetherblog/types';
import type { KnowledgeBase } from '@/services/knowledgeBaseService';
import { atlasService } from '@/services/atlasService';
import { knowledgeBaseService } from '@/services/knowledgeBaseService';
import { noteService } from '@/services/noteService';
import {
  MAX_ATLAS_CARRIER_REFS,
  MAX_KNOWLEDGE_BASE_REFS,
  storeKnowledgeWorkspaceHandoff,
  type KnowledgeContextRef,
  type KnowledgeContextSelection,
  type KnowledgeWorkspaceIntent,
} from '@/services/knowledgeWorkspaceHandoff';
import { useAuthStore } from '@/stores';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { getKnowledgeBaseReadiness } from '@/pages/knowledge/knowledgeBaseReadiness';
import {
  IntelligenceHeader,
  IntelligencePanel,
  IntelligenceSegmented,
  IntelligenceShell,
  IntelligenceStatusStrip,
} from '@/components/intelligence/IntelligenceShell';
import {
  buildWorkspacePlan,
  getKnowledgeReadiness,
  getWorkspacePrimaryAction,
  reduceWorkspaceState,
  type KnowledgeReadiness,
  type WorkspaceMode,
  type WorkspaceState,
} from './knowledgeWorkspaceModel';

interface WorkspaceSources {
  noteTotal: number;
  knowledgeBases: KnowledgeBase[];
  carriers: AtlasCarrier[];
}

const EMPTY_SOURCES: WorkspaceSources = {
  noteTotal: 0,
  knowledgeBases: [],
  carriers: [],
};

const COLLAPSED_SOURCE_COUNT = 5;
const CARRIER_LOAD_LIMIT = 24;

const INITIAL_STATE: WorkspaceState = {
  phase: 'compose',
  mode: 'automate',
  goal: '',
};

const MODE_OPTIONS: Array<{ value: WorkspaceMode; label: string }> = [
  { value: 'ask', label: '提问求证' },
  { value: 'organize', label: '整理内容' },
  { value: 'automate', label: '一次检查' },
];

const SOURCE_MODE_OPTIONS: Array<{ value: KnowledgeContextSelection['mode']; label: string }> = [
  { value: 'auto', label: '自动选择' },
  { value: 'selected', label: '指定来源' },
  { value: 'none', label: '不用来源' },
];

const STARTER_GOALS: Record<WorkspaceMode, string[]> = {
  ask: [
    '现有资料中，对这个主题有哪些一致结论和分歧？',
    '根据可信来源回答这个问题，并标出每条关键结论的出处。',
  ],
  organize: [
    '把本次指定的资料按主题整理成一份结构清晰的提纲，冲突内容先标记。',
    '从已就绪来源提炼核心观点、证据和仍待补充的问题。',
  ],
  automate: [
    '检查最近一周的新文章是否与已有知识冲突，先给我确认，再生成摘要草稿。',
    '检查这批资料中的重复与过期内容，确认后生成一次整理草稿。',
  ],
};

const READINESS_COPY: Record<
  KnowledgeReadiness,
  { label: string; detail: string; tone: 'neutral' | 'accent' | 'success' | 'warning' }
> = {
  empty: { label: '还没有可用资料', detail: '添加资料后才能基于内容求证。', tone: 'neutral' },
  processing: { label: '资料正在准备', detail: '已就绪的内容可以先使用，其余内容完成后自动加入。', tone: 'accent' },
  attention: { label: '有资料需要处理', detail: '失败或异常的资料不会被悄悄用于结果。', tone: 'warning' },
  ready: { label: '已有来源可以使用', detail: '当前已有完成准备的来源，可用于引用和求证。', tone: 'success' },
};

function sourceRefKey(ref: KnowledgeContextRef): string {
  return `${ref.kind}:${ref.id}`;
}

function modeToIntent(mode: WorkspaceMode): KnowledgeWorkspaceIntent {
  if (mode === 'ask') return 'ask';
  if (mode === 'organize') return 'summarize';
  return 'verify';
}

function isKnowledgeBaseQueryable(kb: KnowledgeBase): boolean {
  return (
    getKnowledgeBaseReadiness({
      kind: kb.kind,
      fileCount: kb.fileCount,
      vectorizedCount: kb.vectorizedCount,
      failedCount: kb.failedCount,
      chunkCount: kb.chunkCount,
      hasActiveProfile: Boolean(kb.activeProfileId || kb.activeProfile),
    }) === 'ready'
  );
}

function ReadinessDot({ readiness }: { readiness: KnowledgeReadiness }) {
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        readiness === 'ready' && 'bg-[var(--signal-success)]',
        readiness === 'processing' && 'bg-[var(--aurora-1)]',
        readiness === 'attention' && 'bg-[var(--signal-warn)]',
        readiness === 'empty' && 'bg-[var(--ink-muted)]'
      )}
      aria-hidden="true"
    />
  );
}

function SourceRow({
  checked,
  disabled,
  label,
  meta,
  status,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  meta: string;
  status?: 'ready' | 'processing' | 'attention' | 'empty';
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        'group flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
        checked
          ? 'border-[var(--intelligence-border-strong)] bg-[color-mix(in_oklch,var(--aurora-1)_9%,transparent)]'
          : 'border-transparent bg-transparent hover:border-[var(--intelligence-border)] hover:bg-[var(--intelligence-control)]',
        disabled && 'cursor-not-allowed opacity-45'
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
          checked
            ? 'border-[var(--aurora-1)] bg-[var(--aurora-1)] text-[var(--bg-void)]'
            : 'border-[var(--intelligence-border)] text-transparent'
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[var(--ink-primary)]">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--ink-muted)]">{meta}</span>
      </span>
      {status && (
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            status === 'ready' && 'bg-[var(--signal-success)]',
            status === 'processing' && 'bg-[var(--aurora-1)]',
            status === 'attention' && 'bg-[var(--signal-warn)]',
            status === 'empty' && 'bg-[var(--ink-muted)]'
          )}
          title={status === 'ready' ? '可用' : status === 'processing' ? '准备中' : status === 'attention' ? '需要处理' : '暂无可用内容'}
        />
      )}
    </button>
  );
}

function WorkspaceSkeleton() {
  return (
    <IntelligenceShell>
      <div className="rounded-[1.25rem] border border-[var(--intelligence-border)] bg-[var(--intelligence-panel)] p-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-4 h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-[32rem] max-w-full" />
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton variant="rectangular" className="h-[520px] w-full rounded-[1.25rem]" />
        <Skeleton variant="rectangular" className="h-[420px] w-full rounded-[1.25rem]" />
      </div>
    </IntelligenceShell>
  );
}

export default function KnowledgeWorkspacePage() {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.user?.id);
  const [state, dispatch] = useReducer(reduceWorkspaceState, INITIAL_STATE);
  const [sourceMode, setSourceMode] = useState<KnowledgeContextSelection['mode']>('auto');
  const [selectedRefs, setSelectedRefs] = useState<KnowledgeContextRef[]>([]);
  const [sources, setSources] = useState<WorkspaceSources>(EMPTY_SOURCES);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [showAllKnowledgeBases, setShowAllKnowledgeBases] = useState(false);
  const [showAllCarriers, setShowAllCarriers] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const loadSources = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const [notesResult, knowledgeBasesResult, carriersResult] = await Promise.allSettled([
      noteService.getList({ pageNum: 1, pageSize: 1, view: 'recent' }),
      knowledgeBaseService.list(),
      atlasService.listCarriers({ scope: 'mine', limit: CARRIER_LOAD_LIMIT }),
    ]);

    const next: WorkspaceSources = {
      noteTotal: notesResult.status === 'fulfilled' ? notesResult.value.data?.total ?? 0 : 0,
      knowledgeBases:
        knowledgeBasesResult.status === 'fulfilled' ? knowledgeBasesResult.value.data ?? [] : [],
      carriers: carriersResult.status === 'fulfilled' ? carriersResult.value.data ?? [] : [],
    };
    setSources(next);
    const selectableKeys = new Set([
      ...next.knowledgeBases
        .filter(isKnowledgeBaseQueryable)
        .map((knowledgeBase) => sourceRefKey({ kind: 'knowledge-base', id: knowledgeBase.id, label: knowledgeBase.name })),
    ]);
    setSelectedRefs((current) => current.filter((ref) => selectableKeys.has(sourceRefKey(ref))));

    const rejected = [notesResult, knowledgeBasesResult, carriersResult].filter(
      (result) => result.status === 'rejected'
    );
    if (rejected.length === 3) {
      const reason = rejected[0]?.status === 'rejected' ? rejected[0].reason : undefined;
      setLoadError(extractApiErrorMessage(reason, '暂时无法读取知识来源，请稍后重试。'));
    } else if (rejected.length > 0) {
      setLoadError('部分来源暂时不可用；可用来源已正常显示。');
    } else {
      setLoadError(null);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const totals = useMemo(
    () =>
      sources.knowledgeBases.reduce(
        (sum, kb) => ({
          files: sum.files + kb.fileCount,
          ready: sum.ready + kb.vectorizedCount,
          failed: sum.failed + kb.failedCount,
        }),
        { files: 0, ready: 0, failed: 0 }
      ),
    [sources.knowledgeBases]
  );

  const carrierTotals = useMemo(
    () =>
      sources.carriers.reduce(
        (sum, carrier) => ({
          total: sum.total + 1,
          readable: sum.readable + (carrier.status === 'ready' ? 1 : 0),
          failed: sum.failed + (carrier.status === 'failed' ? 1 : 0),
        }),
        { total: 0, readable: 0, failed: 0 }
      ),
    [sources.carriers]
  );

  const knowledgeBaseStates = useMemo(
    () =>
      sources.knowledgeBases.map((knowledgeBase) => ({
        knowledgeBase,
        readiness: getKnowledgeBaseReadiness({
          kind: knowledgeBase.kind,
          fileCount: knowledgeBase.fileCount,
          vectorizedCount: knowledgeBase.vectorizedCount,
          failedCount: knowledgeBase.failedCount,
          chunkCount: knowledgeBase.chunkCount,
          hasActiveProfile: Boolean(
            knowledgeBase.activeProfileId || knowledgeBase.activeProfile,
          ),
        }),
      })),
    [sources.knowledgeBases]
  );

  const queryableKnowledgeFileCount = useMemo(
    () =>
      knowledgeBaseStates.reduce(
        (sum, item) =>
          item.readiness === 'ready' ? sum + item.knowledgeBase.vectorizedCount : sum,
        0,
      ),
    [knowledgeBaseStates],
  );

  const preparedKnowledgeBaseStates = knowledgeBaseStates.filter(
    (item) => item.readiness !== 'empty',
  );
  const readiness = getKnowledgeReadiness({
    fileCount: preparedKnowledgeBaseStates.length,
    vectorizedCount: preparedKnowledgeBaseStates.filter((item) => item.readiness === 'ready').length,
    failedCount: preparedKnowledgeBaseStates.filter((item) => item.readiness === 'attention').length,
    carrierCount: 0,
    readyCarrierCount: 0,
    failedCarrierCount: 0,
  });
  const readinessCopy = READINESS_COPY[readiness];
  const primaryAction = getWorkspacePrimaryAction(state);

  const contextSelection: KnowledgeContextSelection =
    sourceMode === 'selected'
      ? { mode: 'selected', refs: selectedRefs }
      : { mode: sourceMode };

  const selectedSummary = useMemo(() => {
    if (sourceMode === 'auto') return '自动检索有权限的知识库与知识点';
    if (sourceMode === 'none') return '本次只使用你的描述，不检索私有内容';
    if (selectedRefs.length === 0) return '还没有指定来源';
    return `已指定 ${selectedRefs.length} 个来源`;
  }, [selectedRefs.length, sourceMode]);

  const invalidatePlanForSourceEdit = () => {
    if (state.phase === 'review') {
      dispatch({ type: 'return-to-compose' });
    }
  };

  const toggleRef = (ref: KnowledgeContextRef) => {
    const key = sourceRefKey(ref);
    const alreadySelected = selectedRefs.some((item) => sourceRefKey(item) === key);
    if (!alreadySelected) {
      const sameKindCount = selectedRefs.filter((item) => item.kind === ref.kind).length;
      const limit = ref.kind === 'knowledge-base' ? MAX_KNOWLEDGE_BASE_REFS : MAX_ATLAS_CARRIER_REFS;
      if (sameKindCount >= limit) {
        setHandoffError(
          ref.kind === 'knowledge-base'
            ? `最多可同时使用 ${MAX_KNOWLEDGE_BASE_REFS} 个知识库。`
            : `最多可同时使用 ${MAX_ATLAS_CARRIER_REFS} 个 Atlas 读物。`
        );
        return;
      }
    }
    setSelectedRefs((current) =>
      alreadySelected
        ? current.filter((item) => sourceRefKey(item) !== key)
        : [...current, ref]
    );
    invalidatePlanForSourceEdit();
    setHandoffError(null);
  };

  const changeSourceMode = (next: KnowledgeContextSelection['mode']) => {
    if (next === sourceMode) return;
    setSourceMode(next);
    invalidatePlanForSourceEdit();
    setHandoffError(null);
    if (next === 'selected') setShowSources(true);
  };

  const generatePlan = () => {
    if (sourceMode === 'selected' && selectedRefs.length === 0) {
      setShowSources(true);
      setHandoffError('请至少选择一个来源，或改用“自动选择”。');
      return;
    }
    setHandoffError(null);
    // The source inventory is an editing surface. Once the user asks to
    // review the plan, collapse it so the plan and its confirmation action
    // stay together; the summary remains visible and sources can be reopened.
    setShowSources(false);
    dispatch({
      type: 'review-plan',
      plan: buildWorkspacePlan(state.mode, state.goal, {
        mode: sourceMode,
        readyKnowledgeFileCount: queryableKnowledgeFileCount,
        readyAtlasCarrierCount: 0,
        ...(sourceMode === 'selected'
          ? { selectedLabels: selectedRefs.map((ref) => ref.label) }
          : {}),
      }),
    });
  };

  const handoffToExecution = () => {
    if (!userId) {
      setHandoffError('当前登录状态尚未就绪，请刷新后再试。');
      return;
    }
    const result = storeKnowledgeWorkspaceHandoff({
      userId,
      origin: 'knowledge-workspace',
      intent: modeToIntent(state.mode),
      context: contextSelection,
      draftPrompt: state.goal,
    });
    if (!result.ok) {
      setHandoffError(result.error.message);
      return;
    }
    navigate('/aetherhub');
  };

  const handlePrimaryAction = () => {
    if (refreshing) return;
    if (state.phase === 'compose') {
      generatePlan();
      return;
    }
    if (state.phase === 'review') {
      handoffToExecution();
    }
  };

  if (loading) return <WorkspaceSkeleton />;

  return (
    <IntelligenceShell>
      <IntelligenceHeader
        title="和你的内容一起工作"
        description="先说目标，系统会解释如何使用资料、在哪一步停下来，以及结果会保存到哪里。"
        icon={WandSparkles}
        eyebrow="KNOWLEDGE WORKBENCH"
        currentLabel={state.phase === 'compose' ? '新任务' : '待确认方案'}
        activeSummary={selectedSummary}
        className="intelligence-context-header"
        actions={
          <button
            type="button"
            className="intelligence-action-button min-h-9"
            onClick={() => void loadSources(true)}
            disabled={refreshing || state.phase !== 'compose'}
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            {refreshing ? '正在更新' : '更新来源'}
          </button>
        }
      />

      {loadError && (
        <IntelligenceStatusStrip tone="warning" icon={AlertTriangle}>
          <p className="text-sm font-semibold text-[var(--ink-primary)]">来源连接不完整</p>
          <p className="mt-0.5 text-xs leading-5">{loadError}</p>
        </IntelligenceStatusStrip>
      )}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-4">
          <IntelligencePanel className="overflow-visible" bodyClassName="p-0">
            <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--intelligence-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Library className="h-4 w-4 text-[var(--aurora-1)]" />
                  <span className="text-xs font-bold text-[var(--ink-primary)]">本次使用的来源</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-[var(--ink-muted)]">{selectedSummary}</p>
              </div>
              <fieldset className="m-0 flex w-full min-w-0 flex-col items-stretch gap-2 border-0 p-0 sm:w-auto sm:flex-row sm:items-center">
                <IntelligenceSegmented
                  value={sourceMode}
                  options={SOURCE_MODE_OPTIONS}
                  onChange={changeSourceMode}
                  ariaLabel="知识来源模式"
                  className="w-full max-w-full sm:w-auto"
                />
                <button
                  type="button"
                  className="intelligence-action-button min-h-9 shrink-0 self-end px-2.5 text-xs sm:self-auto"
                  onClick={() => setShowSources((current) => !current)}
                  aria-expanded={showSources}
                >
                  {showSources ? '收起来源' : '查看来源'}
                  <ChevronRight className={cn('h-4 w-4 transition-transform', showSources && 'rotate-90')} />
                </button>
              </fieldset>
            </div>

            {showSources && (
              <div className="border-b border-[var(--intelligence-border)] bg-[var(--intelligence-control)] px-4 py-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3 px-1">
                      <span className="min-w-0">
                        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-muted)]">知识库</span>
                        <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">
                          已加载 {sources.knowledgeBases.length} 个 · 显示 {showAllKnowledgeBases ? sources.knowledgeBases.length : Math.min(COLLAPSED_SOURCE_COUNT, sources.knowledgeBases.length)} 个
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate('/intelligence/knowledge')}
                        className="text-[11px] font-semibold text-[var(--aurora-1)] hover:underline"
                      >
                        管理资料
                      </button>
                    </div>
                    <div className="space-y-1">
                      {sources.knowledgeBases.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-[var(--intelligence-border)] px-3 py-5 text-center text-xs text-[var(--ink-muted)]">
                          还没有知识库
                        </p>
                      ) : (
                        (showAllKnowledgeBases
                          ? sources.knowledgeBases
                          : sources.knowledgeBases.slice(0, COLLAPSED_SOURCE_COUNT)
                        ).map((kb) => {
                          const ref: KnowledgeContextRef = { kind: 'knowledge-base', id: kb.id, label: kb.name };
                          const itemReadiness = getKnowledgeBaseReadiness({
                            kind: kb.kind,
                            fileCount: kb.fileCount,
                            vectorizedCount: kb.vectorizedCount,
                            failedCount: kb.failedCount,
                            chunkCount: kb.chunkCount,
                            hasActiveProfile: Boolean(kb.activeProfileId || kb.activeProfile),
                          });
                          const queryable = isKnowledgeBaseQueryable(kb);
                          return (
                            <SourceRow
                              key={sourceRefKey(ref)}
                              checked={selectedRefs.some((item) => sourceRefKey(item) === sourceRefKey(ref))}
                              disabled={sourceMode !== 'selected' || !queryable}
                              label={kb.name}
                              meta={
                                queryable
                                  ? `${kb.chunkCount} 个片段可以检索`
                                  : `${kb.vectorizedCount}/${kb.fileCount} 份资料已处理 · 暂不可提问`
                              }
                              status={queryable ? 'ready' : itemReadiness}
                              onToggle={() => toggleRef(ref)}
                            />
                          );
                        })
                      )}
                    </div>
                    {sources.knowledgeBases.length > COLLAPSED_SOURCE_COUNT && (
                      <button
                        type="button"
                        onClick={() => setShowAllKnowledgeBases((current) => !current)}
                        className="mt-2 min-h-9 w-full rounded-xl text-[11px] font-semibold text-[var(--aurora-1)] transition-colors hover:bg-[var(--intelligence-panel)]"
                      >
                        {showAllKnowledgeBases ? '收起知识库' : `展开全部 ${sources.knowledgeBases.length} 个知识库`}
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3 px-1">
                      <span className="min-w-0">
                        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Atlas 读物 · 仅查看</span>
                        <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">
                          本次已加载 {sources.carriers.length} 个 · 显示 {showAllCarriers ? sources.carriers.length : Math.min(COLLAPSED_SOURCE_COUNT, sources.carriers.length)} 个
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate('/atlas/readings')}
                        className="text-[11px] font-semibold text-[var(--aurora-1)] hover:underline"
                      >
                        查看读物
                      </button>
                    </div>
                    <div className="space-y-1">
                      {sources.carriers.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-[var(--intelligence-border)] px-3 py-5 text-center text-xs text-[var(--ink-muted)]">
                          还没有可选读物
                        </p>
                      ) : (
                        (showAllCarriers
                          ? sources.carriers
                          : sources.carriers.slice(0, COLLAPSED_SOURCE_COUNT)
                        ).map((carrier) => {
                          const ref: KnowledgeContextRef = {
                            kind: 'atlas-carrier',
                            id: carrier.id,
                            label: carrier.title,
                          };
                          return (
                            <SourceRow
                              key={sourceRefKey(ref)}
                              checked={selectedRefs.some((item) => sourceRefKey(item) === sourceRefKey(ref))}
                              disabled
                              label={carrier.title}
                              meta={
                                carrier.status === 'ready'
                                  ? '可阅读，尚未确认为可提问来源'
                                  : carrier.status === 'failed'
                                    ? '读物准备失败，请先处理'
                                    : '读物正在准备'
                              }
                              status={carrier.status === 'failed' ? 'attention' : carrier.status === 'ready' ? 'empty' : 'processing'}
                              onToggle={() => toggleRef(ref)}
                            />
                          );
                        })
                      )}
                    </div>
                    {sources.carriers.length > COLLAPSED_SOURCE_COUNT && (
                      <button
                        type="button"
                        onClick={() => setShowAllCarriers((current) => !current)}
                        className="mt-2 min-h-9 w-full rounded-xl text-[11px] font-semibold text-[var(--aurora-1)] transition-colors hover:bg-[var(--intelligence-panel)]"
                      >
                        {showAllCarriers ? '收起 Atlas 读物' : `展开本次加载的 ${sources.carriers.length} 个读物`}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="p-4 sm:p-5">
              {state.phase === 'compose' && (
                <div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-[var(--ink-primary)]">你想完成什么？</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">用结果和边界来描述，不需要先理解知识库、Atlas 或工作流。</p>
                    </div>
                    <IntelligenceSegmented
                      value={state.mode}
                      options={MODE_OPTIONS}
                      onChange={(mode) => dispatch({ type: 'change-mode', mode })}
                      ariaLabel="任务类型"
                    />
                  </div>

                  <div className="relative mt-4 overflow-hidden rounded-2xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] focus-within:border-[var(--intelligence-border-strong)] focus-within:ring-2 focus-within:ring-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]">
                    <textarea
                      value={state.goal}
                      onChange={(event) => dispatch({ type: 'change-goal', goal: event.target.value })}
                      placeholder={STARTER_GOALS[state.mode][0]}
                      rows={5}
                      maxLength={4000}
                      className="block min-h-[132px] w-full resize-y bg-transparent px-4 py-3 text-[14px] leading-6 text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-muted)]"
                    />
                    <div className="flex items-center justify-between gap-3 border-t border-[var(--intelligence-border)] px-3 py-2">
                      <span className="font-mono text-[10px] text-[var(--ink-muted)]">{state.goal.length}/4000</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        先审阅，后执行
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {STARTER_GOALS[state.mode].map((goal) => (
                      <button
                        key={goal}
                        type="button"
                        onClick={() => dispatch({ type: 'change-goal', goal })}
                        className="min-h-11 rounded-xl border border-[var(--intelligence-border)] bg-transparent px-3 text-left text-[11px] leading-4 text-[var(--ink-secondary)] transition-colors hover:border-[var(--intelligence-border-strong)] hover:bg-[var(--intelligence-control)] hover:text-[var(--ink-primary)] sm:min-h-9"
                      >
                        {goal}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {state.phase === 'review' && state.plan && (
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-[var(--ink-primary)]">先确认系统理解是否正确</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">确认后会把同一目标和来源带入灵境；不会修改或发布内容。</p>
                    </div>
                    <span className="rounded-full border border-[var(--intelligence-border)] px-2.5 py-1 font-mono text-[10px] text-[var(--ink-muted)]">
                      {state.plan.steps.length} STEPS
                    </span>
                  </div>

                  <div className="mt-5 rounded-2xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-3 sm:p-4">
                    <p className="text-[13px] font-semibold leading-6 text-[var(--ink-primary)]">{state.plan.goal}</p>
                  </div>

                  <ol className="relative mt-5 space-y-1">
                    {state.plan.steps.map((step, index) => (
                        <li key={step.id} className="relative flex gap-3 rounded-xl px-2 py-3">
                          {index < state.plan!.steps.length - 1 && (
                            <span className="absolute left-[19px] top-9 h-[calc(100%-1rem)] w-px bg-[var(--intelligence-border)]" aria-hidden="true" />
                          )}
                          <span
                            className={cn(
                              'relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-[var(--intelligence-panel-strong)]',
                              index === 0
                                ? 'border-[var(--aurora-1)] text-[var(--aurora-1)]'
                                : 'border-[var(--intelligence-border)] text-[var(--ink-muted)]'
                            )}
                          >
                            <span className="font-mono text-[10px]">{index + 1}</span>
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-[var(--ink-primary)]">{step.title}</p>
                            <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">{step.description}</p>
                          </div>
                        </li>
                      ))}
                  </ol>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {state.plan.boundaries.map((boundary) => (
                      <span
                        key={boundary}
                        className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--signal-success)_24%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_7%,transparent)] px-2.5 text-[11px] font-semibold text-[var(--ink-secondary)]"
                      >
                        <ShieldCheck className="h-3 w-3 text-[var(--signal-success)]" />
                        {boundary}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {handoffError && (
                <p role="alert" className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--signal-warn)]">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {handoffError}
                </p>
              )}

              <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[var(--intelligence-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  {state.phase !== 'compose' && (
                    <button
                      type="button"
                      className="intelligence-action-button min-h-9"
                      onClick={() => dispatch({ type: 'return-to-compose' })}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      修改目标或来源
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="intelligence-action-button-primary min-h-9 px-4"
                  disabled={primaryAction.disabled || refreshing}
                  onClick={handlePrimaryAction}
                >
                  {state.phase === 'compose' && <Sparkles className="h-4 w-4" />}
                  {state.phase === 'review' && <ArrowRight className="h-4 w-4" />}
                  {primaryAction.label}
                </button>
              </div>
            </div>
          </IntelligencePanel>
        </main>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
          <IntelligencePanel
            title="来源连接概览"
            description="可检索来源与仍待整理的内容分开显示。"
            icon={Search}
            bodyClassName="space-y-4"
          >
            <div className="flex items-start gap-3 rounded-xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-3">
              <ReadinessDot readiness={readiness} />
              <div className="min-w-0">
                <p className="text-xs font-bold text-[var(--ink-primary)]">{readinessCopy.label}</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">{readinessCopy.detail}</p>
              </div>
            </div>

            <dl className="divide-y divide-[var(--intelligence-border)]">
              <div className="flex items-center gap-3 py-3 first:pt-0">
                <Library className="h-4 w-4 text-[var(--aurora-1)]" />
                <dt className="min-w-0 flex-1 text-xs text-[var(--ink-secondary)]">知识库</dt>
                <dd className="font-mono text-xs font-semibold text-[var(--ink-primary)]">{sources.knowledgeBases.length}</dd>
              </div>
              <div className="flex items-center gap-3 py-3">
                <FileText className="h-4 w-4 text-[var(--aurora-1)]" />
                <dt className="min-w-0 flex-1 text-xs text-[var(--ink-secondary)]">可检索资料</dt>
                <dd className="font-mono text-xs font-semibold text-[var(--ink-primary)]">{queryableKnowledgeFileCount}/{totals.files}</dd>
              </div>
              <div className="flex items-center gap-3 py-3">
                <PencilLine className="h-4 w-4 text-[var(--aurora-1)]" />
                <dt className="min-w-0 flex-1 text-xs text-[var(--ink-secondary)]">
                  <span className="block">可继续整理的笔记</span>
                  <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">尚未作为本轮可选来源</span>
                </dt>
                <dd className="font-mono text-xs font-semibold text-[var(--ink-primary)]">{sources.noteTotal}</dd>
              </div>
              <div className="flex items-center gap-3 py-3 last:pb-0">
                <BookOpen className="h-4 w-4 text-[var(--aurora-1)]" />
                <dt className="min-w-0 flex-1 text-xs text-[var(--ink-secondary)]">
                  <span className="block">可阅读 Atlas 读物</span>
                  <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">尚未确认为本轮可提问来源</span>
                </dt>
                <dd className="font-mono text-xs font-semibold text-[var(--ink-primary)]">{carrierTotals.readable}/{sources.carriers.length}</dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={() => setShowSources(true)}
              className="intelligence-action-button min-h-9 w-full"
            >
              调整本次来源
              <ChevronRight className="h-4 w-4" />
            </button>
          </IntelligencePanel>

          {state.phase === 'compose' ? (
            <IntelligencePanel title="按任务进入" description="需要专用工作区时可直接开始。" icon={Route} bodyClassName="p-2">
              <button
                type="button"
                onClick={() => navigate('/agent-workflows')}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--intelligence-control)]"
              >
                <Workflow className="h-4 w-4 text-[var(--ink-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[var(--ink-primary)]">智能编排</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">定期或触发式运行任务</span>
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/ai-tools')}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--intelligence-control)]"
              >
                <PencilLine className="h-4 w-4 text-[var(--ink-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[var(--ink-primary)]">写作助手</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">改写、润色与生成内容</span>
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/qa')}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--intelligence-control)]"
              >
                <Search className="h-4 w-4 text-[var(--ink-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[var(--ink-primary)]">试卷拆题</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">拆分、校对与复核试卷</span>
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/atlas')}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--intelligence-control)]"
              >
                <BookOpen className="h-4 w-4 text-[var(--ink-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[var(--ink-primary)]">Atlas 知识图集</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">阅读、标注与连接知识</span>
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
              </button>
            </IntelligencePanel>
          ) : (
            <IntelligencePanel title="完成后你将获得" icon={Sparkles} bodyClassName="p-2">
              <div className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2">
                <Quote className="h-4 w-4 shrink-0 text-[var(--aurora-1)]" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--ink-primary)]">
                    {sourceMode === 'none' ? '结构化的回答' : '可核对的结论'}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">
                    {sourceMode === 'none'
                      ? '只根据你的目标说明组织内容'
                      : '冲突、缺口与核心判断分开呈现'}
                  </span>
                </span>
              </div>
              <div className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2">
                <BookOpen className="h-4 w-4 shrink-0 text-[var(--aurora-1)]" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--ink-primary)]">
                    {sourceMode === 'none' ? '不检索私有来源' : '来源引用'}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">
                    {sourceMode === 'none' ? '只使用你的目标说明' : '关键结论可返回原始资料'}
                  </span>
                </span>
              </div>
              <div className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2">
                <Clock3 className="h-4 w-4 shrink-0 text-[var(--aurora-1)]" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--ink-primary)]">执行时间线</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">看见每一步和暂停原因</span>
                </span>
              </div>
            </IntelligencePanel>
          )}
        </aside>
      </div>
    </IntelligenceShell>
  );
}
