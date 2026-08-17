// 知识工作台 —— 聚合入口:知识脉搏(资产总览) + 统一检索(跨域召回) +
// 任务台(目标 → 方案 → 交接灵境) + 来源托盘(本次任务的可信来源)。
//
// 纯逻辑分层:
//   · 状态机 / 方案生成      → knowledgeWorkspaceModel.ts
//   · 统一检索归一 / 泳道降级 → unifiedRetrievalModel.ts
//   · 交接契约               → services/knowledgeWorkspaceHandoff.ts
// 本文件只做编排与呈现;动效一律取 @aetherblog/ui 的 motion 预设。

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Library,
  PencilLine,
  Pin,
  Quote,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Waypoints,
  Workflow,
  WandSparkles,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton, spring, stagger, transition, variants } from '@aetherblog/ui';
import type { AtlasCarrier, AtlasGraphHealth } from '@aetherblog/types';
import type { KnowledgeBase } from '@/services/knowledgeBaseService';
import { atlasService } from '@/services/atlasService';
import { knowledgeBaseService } from '@/services/knowledgeBaseService';
import { noteService } from '@/services/noteService';
import {
  MAX_ATLAS_CARRIER_REFS,
  MAX_ATLAS_KP_REFS,
  MAX_KNOWLEDGE_BASE_REFS,
  storeKnowledgeWorkspaceHandoff,
  type KnowledgeContextRef,
  type KnowledgeContextSelection,
  type KnowledgeWorkspaceIntent,
} from '@/services/knowledgeWorkspaceHandoff';
import { useAuthStore } from '@/stores';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { INTELLIGENCE_ROUTES } from '@/navigation/intelligenceNavigation';
import {
  canUseKnowledgeBase,
  getKnowledgeBaseReadiness,
} from '@/pages/knowledge/knowledgeBaseReadiness';
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
import { isKnowledgeBaseQueryable } from './unifiedRetrievalModel';
import { KnowledgePulse } from './KnowledgePulse';
import { UnifiedRetrievalPanel } from './UnifiedRetrievalPanel';

// 既有契约:模型测试与兄弟页面从本页导入该判定。
export { isKnowledgeBaseQueryable } from './unifiedRetrievalModel';

interface WorkspaceSources {
  noteTotal: number;
  knowledgeBases: KnowledgeBase[];
  carriers: AtlasCarrier[];
  graphHealth: AtlasGraphHealth | null;
}

const EMPTY_SOURCES: WorkspaceSources = {
  noteTotal: 0,
  knowledgeBases: [],
  carriers: [],
  graphHealth: null,
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
  { label: string; detail: string }
> = {
  empty: { label: '还没有可用资料', detail: '添加资料后才能基于内容求证。' },
  processing: { label: '资料正在准备', detail: '已就绪的内容可以先使用，其余内容完成后自动加入。' },
  attention: { label: '有资料需要处理', detail: '失败或异常的资料不会被悄悄用于结果。' },
  ready: { label: '已有来源可以使用', detail: '当前已有完成准备的来源，可用于引用和求证。' },
};

const REF_LIMITS: Record<KnowledgeContextRef['kind'], number> = {
  'knowledge-base': MAX_KNOWLEDGE_BASE_REFS,
  'atlas-kp': MAX_ATLAS_KP_REFS,
  'atlas-carrier': MAX_ATLAS_CARRIER_REFS,
};

const REF_LIMIT_MESSAGES: Record<KnowledgeContextRef['kind'], string> = {
  'knowledge-base': `最多可同时使用 ${MAX_KNOWLEDGE_BASE_REFS} 个知识库。`,
  'atlas-kp': `最多可同时使用 ${MAX_ATLAS_KP_REFS} 个知识点。`,
  'atlas-carrier': `最多可同时使用 ${MAX_ATLAS_CARRIER_REFS} 个 Atlas 读物。`,
};

function sourceRefKey(ref: KnowledgeContextRef): string {
  return `${ref.kind}:${ref.id}`;
}

function modeToIntent(mode: WorkspaceMode): KnowledgeWorkspaceIntent {
  if (mode === 'ask') return 'ask';
  if (mode === 'organize') return 'summarize';
  return 'verify';
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
  progress,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  meta: string;
  status?: 'ready' | 'processing' | 'attention' | 'empty' | 'view-only';
  /** 0..1 的索引进度;仅准备中的知识库渲染。 */
  progress?: number;
  onToggle: () => void;
}) {
  const statusTitle =
    status === 'ready'
      ? '可用'
      : status === 'processing'
        ? '准备中'
        : status === 'attention'
          ? '需要处理'
          : status === 'view-only'
            ? '仅可查看'
            : '暂无可用内容';

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
        {progress !== undefined && (
          <span className="intelligence-pulse-bar" aria-hidden="true">
            <span
              className="intelligence-pulse-bar-fill"
              style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }}
            />
          </span>
        )}
      </span>
      {status && (
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            status === 'ready' && 'bg-[var(--signal-success)]',
            status === 'processing' && 'bg-[var(--aurora-1)]',
            status === 'attention' && 'bg-[var(--signal-warn)]',
            (status === 'empty' || status === 'view-only') && 'bg-[var(--ink-muted)]'
          )}
          title={statusTitle}
        />
      )}
    </button>
  );
}

function WorkspaceSkeleton() {
  return (
    <IntelligenceShell>
      <div className="px-1 py-2 sm:px-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-4 h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-[32rem] max-w-full" />
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} variant="rectangular" className="h-[104px] w-full rounded-[0.95rem]" />
        ))}
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Skeleton variant="rectangular" className="h-[180px] w-full rounded-[1.25rem]" />
          <Skeleton variant="rectangular" className="h-[420px] w-full rounded-[1.25rem]" />
        </div>
        <div className="min-w-0 space-y-4">
          <Skeleton variant="rectangular" className="h-[200px] w-full rounded-[1.25rem]" />
          <Skeleton variant="rectangular" className="h-[260px] w-full rounded-[1.25rem]" />
        </div>
      </div>
    </IntelligenceShell>
  );
}

const REF_KIND_ICONS: Record<KnowledgeContextRef['kind'], typeof Library> = {
  'knowledge-base': Library,
  'atlas-kp': Waypoints,
  'atlas-carrier': BookOpen,
};

export default function KnowledgeWorkspacePage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion() ?? false;
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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const taskPanelRef = useRef<HTMLDivElement>(null);

  const loadSources = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const [notesResult, knowledgeBasesResult, carriersResult, graphHealthResult] =
      await Promise.allSettled([
        noteService.getList({ pageNum: 1, pageSize: 1, view: 'recent' }),
        knowledgeBaseService.list(),
        atlasService.listCarriers({ scope: 'mine', limit: CARRIER_LOAD_LIMIT }),
        atlasService.getGraphHealth({ scope: 'mine' }),
      ]);

    const next: WorkspaceSources = {
      noteTotal: notesResult.status === 'fulfilled' ? notesResult.value.data?.total ?? 0 : 0,
      knowledgeBases:
        knowledgeBasesResult.status === 'fulfilled' ? knowledgeBasesResult.value.data ?? [] : [],
      carriers: carriersResult.status === 'fulfilled' ? carriersResult.value.data ?? [] : [],
      graphHealth:
        graphHealthResult.status === 'fulfilled' ? graphHealthResult.value.data ?? null : null,
    };
    setSources(next);
    const selectableKeys = new Set(
      next.knowledgeBases
        .filter(isKnowledgeBaseQueryable)
        .map((knowledgeBase) =>
          sourceRefKey({ kind: 'knowledge-base', id: knowledgeBase.id, label: knowledgeBase.name }),
        ),
    );
    // 知识点引用无法在本页廉价校验存在性,刷新时保留;知识库引用按可用性过滤。
    setSelectedRefs((current) =>
      current.filter(
        (ref) => ref.kind !== 'knowledge-base' || selectableKeys.has(sourceRefKey(ref)),
      ),
    );

    // 图谱统计是增强信息:失败只影响脉搏块占位,不计入来源连接错误。
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
      sources.knowledgeBases.map((knowledgeBase) => {
        const readiness = getKnowledgeBaseReadiness({
          kind: knowledgeBase.kind,
          fileCount: knowledgeBase.fileCount,
          vectorizedCount: knowledgeBase.vectorizedCount,
          failedCount: knowledgeBase.failedCount,
          chunkCount: knowledgeBase.chunkCount,
          hasActiveProfile: Boolean(
            knowledgeBase.activeProfileId || knowledgeBase.activeProfile,
          ),
        });
        const hasUsePermission = canUseKnowledgeBase(knowledgeBase.effectivePermission);
        return {
          knowledgeBase,
          readiness,
          hasUsePermission,
          queryable: hasUsePermission && readiness === 'ready',
        };
      }),
    [sources.knowledgeBases]
  );

  const queryableStates = useMemo(
    () => knowledgeBaseStates.filter((item) => item.queryable),
    [knowledgeBaseStates],
  );

  const queryableKnowledgeFileCount = useMemo(
    () => queryableStates.reduce((sum, item) => sum + item.knowledgeBase.vectorizedCount, 0),
    [queryableStates],
  );

  const searchableChunkCount = useMemo(
    () => queryableStates.reduce((sum, item) => sum + item.knowledgeBase.chunkCount, 0),
    [queryableStates],
  );

  const preparedKnowledgeBaseStates = knowledgeBaseStates.filter(
    (item) => item.hasUsePermission && item.readiness !== 'empty',
  );
  const readiness = getKnowledgeReadiness({
    fileCount: preparedKnowledgeBaseStates.length,
    vectorizedCount: preparedKnowledgeBaseStates.filter((item) => item.queryable).length,
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

  const pinnedKeys = useMemo(
    () => new Set(selectedRefs.map(sourceRefKey)),
    [selectedRefs],
  );

  const invalidatePlanForSourceEdit = () => {
    if (state.phase === 'review') {
      dispatch({ type: 'return-to-compose' });
    }
  };

  const togglePinnedRef = (ref: KnowledgeContextRef) => {
    const key = sourceRefKey(ref);
    const alreadySelected = selectedRefs.some((item) => sourceRefKey(item) === key);
    if (!alreadySelected) {
      const sameKindCount = selectedRefs.filter((item) => item.kind === ref.kind).length;
      if (sameKindCount >= REF_LIMITS[ref.kind]) {
        setHandoffError(REF_LIMIT_MESSAGES[ref.kind]);
        return;
      }
    }
    // 从统一检索固定来源即视为进入「指定来源」模式。
    if (sourceMode !== 'selected') setSourceMode('selected');
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

  const seedGoalFromAtom = (seed: string) => {
    dispatch({ type: 'change-mode', mode: 'ask' });
    dispatch({ type: 'change-goal', goal: seed });
    window.setTimeout(() => {
      taskPanelRef.current?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      const composer = composerRef.current;
      if (composer) {
        composer.focus();
        composer.setSelectionRange(composer.value.length, composer.value.length);
      }
    }, 60);
  };

  const generatePlan = () => {
    if (sourceMode === 'selected' && selectedRefs.length === 0) {
      setShowSources(true);
      setHandoffError('请至少选择一个来源，或改用“自动选择”。');
      return;
    }
    setHandoffError(null);
    // 来源清单是编辑面。进入方案审阅后收起,让方案与确认动作保持同屏;
    // 摘要仍然可见,随时可以重新展开。
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
    navigate(INTELLIGENCE_ROUTES.aetherhub);
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

  const sectionVariants = reducedMotion ? variants.fade : variants.fadeUp;

  return (
    <IntelligenceShell>
      <motion.div
        className="flex min-w-0 flex-col gap-4"
        initial="initial"
        animate="animate"
        variants={{ initial: {}, animate: { transition: reducedMotion ? undefined : stagger(55) } }}
      >
        <motion.div variants={sectionVariants} transition={transition.quick}>
          <IntelligenceHeader
            title="和你的知识一起工作"
            description="先看清资产状态，再检索并固定可信来源，最后把目标交给灵境执行。"
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
        </motion.div>

        {loadError && (
          <motion.div variants={sectionVariants} transition={transition.quick}>
            <IntelligenceStatusStrip tone="warning" icon={AlertTriangle}>
              <p className="text-sm font-semibold text-[var(--ink-primary)]">来源连接不完整</p>
              <p className="mt-0.5 text-xs leading-5">{loadError}</p>
            </IntelligenceStatusStrip>
          </motion.div>
        )}

        <KnowledgePulse
          searchableChunks={searchableChunkCount}
          queryableBaseCount={queryableStates.length}
          readyFiles={totals.ready}
          totalFiles={totals.files}
          failedFiles={totals.failed}
          noteTotal={sources.noteTotal}
          readableCarriers={carrierTotals.readable}
          carrierTotal={carrierTotals.total}
          graph={
            sources.graphHealth
              ? {
                  activeKpCount: sources.graphHealth.activeKpCount,
                  relationCount: sources.graphHealth.relationCount,
                  orphanKpCount: sources.graphHealth.orphanKpCount,
                }
              : null
          }
        />

        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0 space-y-4">
            <motion.div variants={sectionVariants} transition={transition.quick}>
              <UnifiedRetrievalPanel
                knowledgeBases={sources.knowledgeBases}
                pinnedKeys={pinnedKeys}
                onTogglePin={togglePinnedRef}
                onAskAbout={seedGoalFromAtom}
              />
            </motion.div>

            <motion.div variants={sectionVariants} transition={transition.quick} ref={taskPanelRef}>
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

                <AnimatePresence initial={false}>
                  {showSources && (
                    <motion.div
                      key="source-inventory"
                      initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
                      transition={transition.quick}
                      className="overflow-hidden border-b border-[var(--intelligence-border)] bg-[var(--intelligence-control)]"
                    >
                      <div className="px-4 py-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <div className="mb-2 flex items-center justify-between gap-3 px-1">
                              <span className="min-w-0">
                                <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-muted)]">知识库</span>
                                <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">
                                  已加载 {sources.knowledgeBases.length} 个 · 显示 {showAllKnowledgeBases ? sources.knowledgeBases.length : Math.min(COLLAPSED_SOURCE_COUNT, sources.knowledgeBases.length)} 个
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => navigate(INTELLIGENCE_ROUTES.knowledge)}
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
                                  ? knowledgeBaseStates
                                  : knowledgeBaseStates.slice(0, COLLAPSED_SOURCE_COUNT)
                                ).map(({ knowledgeBase: kb, readiness: itemReadiness, hasUsePermission, queryable }) => {
                                  const ref: KnowledgeContextRef = { kind: 'knowledge-base', id: kb.id, label: kb.name };
                                  const sourceMeta = !hasUsePermission
                                    ? '仅可查看 · 需要“可使用”权限才能指定'
                                    : queryable
                                      ? `${kb.chunkCount} 个片段可以检索`
                                      : `${kb.vectorizedCount}/${kb.fileCount} 份资料已处理 · 暂不可提问`;
                                  const sourceStatus = queryable
                                    ? 'ready'
                                    : hasUsePermission
                                      ? itemReadiness
                                      : 'view-only';
                                  const progress =
                                    hasUsePermission && itemReadiness === 'processing' && kb.fileCount > 0
                                      ? kb.vectorizedCount / kb.fileCount
                                      : undefined;
                                  return (
                                    <SourceRow
                                      key={sourceRefKey(ref)}
                                      checked={pinnedKeys.has(sourceRefKey(ref))}
                                      disabled={sourceMode !== 'selected' || !queryable}
                                      label={kb.name}
                                      meta={sourceMeta}
                                      status={sourceStatus}
                                      progress={progress}
                                      onToggle={() => togglePinnedRef(ref)}
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
                                <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Atlas 读物 · 仅查看</span>
                                <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">
                                  本次已加载 {sources.carriers.length} 个 · 显示 {showAllCarriers ? sources.carriers.length : Math.min(COLLAPSED_SOURCE_COUNT, sources.carriers.length)} 个
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => navigate(`${INTELLIGENCE_ROUTES.atlas}/readings`)}
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
                                      checked={pinnedKeys.has(sourceRefKey(ref))}
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
                                      onToggle={() => togglePinnedRef(ref)}
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
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="p-4 sm:p-5">
                  <AnimatePresence mode="wait" initial={false}>
                    {state.phase === 'compose' ? (
                      <motion.div
                        key="compose"
                        variants={sectionVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        transition={transition.quick}
                      >
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
                            ref={composerRef}
                            value={state.goal}
                            onChange={(event) => dispatch({ type: 'change-goal', goal: event.target.value })}
                            placeholder={STARTER_GOALS[state.mode][0]}
                            rows={5}
                            maxLength={4000}
                            className="block min-h-[132px] w-full resize-y bg-transparent px-4 py-3 text-[14px] leading-6 text-[var(--ink-primary)] outline-none placeholder:text-[var(--ink-muted)]"
                          />
                          <div className="flex items-center justify-between gap-3 border-t border-[var(--intelligence-border)] px-3 py-2">
                            <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">{state.goal.length}/4000</span>
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
                      </motion.div>
                    ) : (
                      state.plan && (
                        <motion.div
                          key="review"
                          variants={sectionVariants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          transition={transition.quick}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-[var(--ink-primary)]">先确认系统理解是否正确</p>
                              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">确认后会把同一目标和来源带入灵境；不会修改或发布内容。</p>
                            </div>
                            <span className="rounded-full border border-[var(--intelligence-border)] px-2.5 py-1 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                              {state.plan.steps.length} STEPS
                            </span>
                          </div>

                          <div className="mt-5 rounded-2xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-3 sm:p-4">
                            <p className="text-[13px] font-semibold leading-6 text-[var(--ink-primary)]">{state.plan.goal}</p>
                          </div>

                          <motion.ol
                            className="relative mt-5 space-y-1"
                            initial="initial"
                            animate="animate"
                            variants={{
                              initial: {},
                              animate: { transition: reducedMotion ? undefined : stagger(70) },
                            }}
                          >
                            {state.plan.steps.map((step, index) => (
                              <motion.li
                                key={step.id}
                                className="relative flex gap-3 rounded-xl px-2 py-3"
                                variants={sectionVariants}
                                transition={transition.quick}
                              >
                                {index < state.plan!.steps.length - 1 && (
                                  <motion.span
                                    className="absolute left-[19px] top-9 h-[calc(100%-1rem)] w-px bg-[var(--intelligence-border)]"
                                    aria-hidden="true"
                                    style={{ transformOrigin: 'top center' }}
                                    variants={
                                      reducedMotion
                                        ? variants.fade
                                        : { initial: { scaleY: 0 }, animate: { scaleY: 1 } }
                                    }
                                    transition={transition.flow}
                                  />
                                )}
                                <span
                                  className={cn(
                                    'relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-[var(--intelligence-panel-strong)]',
                                    index === 0
                                      ? 'border-[var(--aurora-1)] text-[var(--aurora-1)]'
                                      : 'border-[var(--intelligence-border)] text-[var(--ink-muted)]'
                                  )}
                                >
                                  <span className="font-mono text-[10px] tabular-nums">{index + 1}</span>
                                </span>
                                <div className="min-w-0">
                                  <p className="text-[13px] font-semibold text-[var(--ink-primary)]">{step.title}</p>
                                  <p className="mt-1 text-xs leading-5 text-[var(--ink-secondary)]">{step.description}</p>
                                </div>
                              </motion.li>
                            ))}
                          </motion.ol>

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
                        </motion.div>
                      )
                    )}
                  </AnimatePresence>

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
                    <motion.button
                      type="button"
                      className="intelligence-action-button-primary min-h-9 px-4"
                      disabled={primaryAction.disabled || refreshing}
                      onClick={handlePrimaryAction}
                      whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                      transition={spring.precise}
                    >
                      {state.phase === 'compose' && <Sparkles className="h-4 w-4" />}
                      {state.phase === 'review' && <ArrowRight className="h-4 w-4" />}
                      {primaryAction.label}
                    </motion.button>
                  </div>
                </div>
              </IntelligencePanel>
            </motion.div>
          </main>

          <motion.aside
            className="min-w-0 space-y-4 xl:sticky xl:top-4"
            variants={sectionVariants}
            transition={transition.quick}
          >
            <IntelligencePanel
              title="本次来源"
              description={selectedSummary}
              icon={Pin}
              bodyClassName="space-y-3"
            >
              {sourceMode === 'selected' ? (
                <>
                  {selectedRefs.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-[var(--intelligence-border)] px-3 py-4 text-center text-xs leading-5 text-[var(--ink-muted)]">
                      在统一检索的结果里「固定为来源」，或从来源清单勾选。
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5" aria-label="已固定的来源">
                      <AnimatePresence initial={false}>
                        {selectedRefs.map((ref) => {
                          const RefIcon = REF_KIND_ICONS[ref.kind];
                          return (
                            <motion.li
                              key={sourceRefKey(ref)}
                              layout={reducedMotion ? false : 'position'}
                              variants={reducedMotion ? variants.fade : variants.scaleIn}
                              initial="initial"
                              animate="animate"
                              exit="exit"
                              transition={spring.soft}
                              className="intelligence-tray-chip"
                            >
                              <RefIcon className="h-3 w-3 shrink-0 text-[var(--aurora-1)]" aria-hidden="true" />
                              <span className="max-w-[9.5rem] truncate">{ref.label}</span>
                              <button
                                type="button"
                                className="intelligence-tray-chip-remove"
                                onClick={() => togglePinnedRef(ref)}
                                aria-label={`移除来源 ${ref.label}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </ul>
                  )}
                  <p className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                    知识库 {selectedRefs.filter((ref) => ref.kind === 'knowledge-base').length}/{MAX_KNOWLEDGE_BASE_REFS}
                    {' · '}
                    知识点 {selectedRefs.filter((ref) => ref.kind === 'atlas-kp').length}/{MAX_ATLAS_KP_REFS}
                  </p>
                </>
              ) : (
                <p className="text-xs leading-5 text-[var(--ink-muted)]">
                  {sourceMode === 'auto'
                    ? '执行时自动检索你有权使用的知识库与知识点；也可以从检索结果把关键来源固定进来。'
                    : '本次不检索任何私有内容，只依据你的目标说明完成任务。'}
                </p>
              )}
            </IntelligencePanel>

            <IntelligencePanel
              title="来源就绪度"
              description="可检索来源与仍待整理的内容分开显示。"
              icon={Search}
              bodyClassName="space-y-3"
              actions={
                <button
                  type="button"
                  onClick={() => navigate(INTELLIGENCE_ROUTES.knowledge)}
                  className="text-[11px] font-semibold text-[var(--aurora-1)] hover:underline"
                >
                  管理
                </button>
              }
            >
              <div className="flex items-start gap-3 rounded-xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-3">
                <ReadinessDot readiness={readiness} />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--ink-primary)]">{readinessCopy.label}</p>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--ink-muted)]">{readinessCopy.detail}</p>
                </div>
              </div>

              {knowledgeBaseStates.length > 0 && (
                <ul className="divide-y divide-[var(--intelligence-border)]" aria-label="知识库就绪状态">
                  {knowledgeBaseStates.slice(0, 5).map(({ knowledgeBase: kb, readiness: itemReadiness, queryable }) => (
                    <li key={kb.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                      <ReadinessDot readiness={queryable ? 'ready' : itemReadiness} />
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink-secondary)]">{kb.name}</span>
                      <span className="font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                        {queryable ? `${kb.chunkCount} 片段` : `${kb.vectorizedCount}/${kb.fileCount}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowSources(true);
                  taskPanelRef.current?.scrollIntoView({
                    behavior: reducedMotion ? 'auto' : 'smooth',
                    block: 'start',
                  });
                }}
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
                  onClick={() => navigate(INTELLIGENCE_ROUTES.agentWorkflows)}
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
                  onClick={() => navigate(INTELLIGENCE_ROUTES.aiTools)}
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
                  onClick={() => navigate(INTELLIGENCE_ROUTES.qa)}
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
                  onClick={() => navigate(INTELLIGENCE_ROUTES.atlas)}
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
          </motion.aside>
        </div>
      </motion.div>
    </IntelligenceShell>
  );
}
