import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Square,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import {
  useReindexStream,
  type ReindexChunkProgressEvent,
  type ReindexCounters,
  type ReindexHeartbeat,
  type ReindexProgressEvent,
} from '@/hooks/useReindexStream';
import { useActivateProfile } from '@/hooks/useSearchProfiles';
import type { SearchProfile } from '@/services/searchProfileService';

type Step = 'confirm' | 'reindexing' | 'activating' | 'done' | 'failed';

interface ProfileActivationFlowProps {
  /** 待激活的目标 profile（shadow 或 deprecated 都可切换为 active）。 */
  profile: SearchProfile;
  /** 当前 active profile（用于在 confirm 步骤展示 source → target）。 */
  activeProfile: SearchProfile | null;
  onClose: () => void;
}

type PreviousActiveProfile = Pick<SearchProfile, 'code' | 'name'>;

/**
 * Profile 激活四步向导：
 *
 *   confirm → reindexing → activating → done
 *                       ↓
 *                    failed (允许 retry)
 *
 * 蓝绿切换严格遵循 ai-service 的 strict-blocking 模式：必须等 reindex 全篇成功
 * （或允许带少量 failed 的部分覆盖）才能调 activate；activate 一旦成功即原子
 * 翻转 active_profile_code 指针。
 */
export function ProfileActivationFlow({
  profile,
  activeProfile,
  onClose,
}: ProfileActivationFlowProps) {
  const [step, setStep] = useState<Step>('confirm');
  const [previousActiveSnapshot, setPreviousActiveSnapshot] = useState<PreviousActiveProfile | null>(
    activeProfile ? { code: activeProfile.code, name: activeProfile.name } : null
  );
  const stream = useReindexStream();
  const activateMut = useActivateProfile();

  const reset = () => {
    stream.reset();
    activateMut.reset();
    setPreviousActiveSnapshot(
      activeProfile ? { code: activeProfile.code, name: activeProfile.name } : null
    );
    setStep('confirm');
  };

  // 关闭 Modal 时若仍在跑就 abort（避免离屏状态机漂移）
  // 故意只在挂载/卸载时跑：stream 引用每次渲染都变，写进 deps 会反复重订阅。
  const abortRef = stream.abort;
  useEffect(() => {
    return () => {
      abortRef();
    };
  }, [abortRef]);

  // reindex 完成 → 自动进 activating
  useEffect(() => {
    if (step !== 'reindexing') return;
    if (stream.isRunning) return;
    if (stream.error) {
      setStep('failed');
      return;
    }
    if (stream.result) {
      // failed > 0 时不自动激活，让用户先看完失败明细再决定
      if (stream.result.failed > 0) {
        setStep('failed');
        return;
      }
      setStep('activating');
      activateMut.mutate(profile.code, {
        onSuccess: (res) => {
          const previousCode = res.data.previousActive;
          if (previousCode && previousCode !== previousActiveSnapshot?.code) {
            setPreviousActiveSnapshot({
              code: previousCode,
              name: previousCode,
            });
          }
          setStep('done');
        },
        onError: () => setStep('failed'),
      });
    }
  }, [
    step,
    stream.isRunning,
    stream.error,
    stream.result,
    activateMut,
    profile.code,
    previousActiveSnapshot?.code,
  ]);

  const startReindex = () => {
    setPreviousActiveSnapshot(
      activeProfile ? { code: activeProfile.code, name: activeProfile.name } : null
    );
    setStep('reindexing');
    stream.start(profile.code);
  };

  const onModalClose = () => {
    if (stream.isRunning) {
      stream.abort();
    }
    onClose();
  };

  return (
    <Modal isOpen onClose={onModalClose} title="激活 Search Profile" size="lg">
      <div className="space-y-5">
        <StepperHeader step={step} />

        {step === 'confirm' && (
          <ConfirmStep
            profile={profile}
            activeProfile={activeProfile}
            onCancel={onClose}
            onStart={startReindex}
          />
        )}

        {step === 'reindexing' && (
          <ReindexingStep
            total={stream.total}
            counters={stream.counters}
            recent={stream.recent}
            heartbeat={stream.heartbeat}
            chunkProgressItems={stream.chunkProgressItems}
            running={stream.isRunning}
            onAbort={() => {
              stream.abort();
              toast.info('已中止 reindex；profile 保持 shadow，可再次重试');
              onClose();
            }}
          />
        )}

        {step === 'activating' && (
          <div className="flex items-center justify-center gap-3 py-10 text-sm text-[var(--text-secondary)]">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--aurora-1)]" />
            正在原子翻转 active 指针…
          </div>
        )}

        {step === 'done' && (
          <DoneStep profile={profile} previousActive={previousActiveSnapshot} onClose={onClose} />
        )}

        {step === 'failed' && (
          <FailedStep
            stream={stream}
            activateError={activateMut.error as Error | undefined}
            onRetry={reset}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

// =============== 步进器头部 ===============

function StepperHeader({ step }: { step: Step }) {
  const steps: Array<{ key: Step | 'failed'; label: string }> = [
    { key: 'confirm', label: '确认' },
    { key: 'reindexing', label: '全量 reindex' },
    { key: 'activating', label: '翻转指针' },
    { key: 'done', label: '完成' },
  ];
  const stepOrder: Record<Step, number> = {
    confirm: 0,
    reindexing: 1,
    activating: 2,
    done: 3,
    failed: 1,
  };
  const cur = stepOrder[step];

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const reached = i <= cur;
        const isFailed = step === 'failed' && i === stepOrder[step];
        return (
          <div key={s.key} className="flex items-center gap-2 flex-1 min-w-0">
            <div
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono',
                isFailed
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : reached
                    ? 'bg-[var(--aurora-1)] text-white'
                    : 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
              )}
            >
              {isFailed ? <XCircle className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                'text-xs font-mono uppercase tracking-[0.18em] truncate',
                reached ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-px',
                  reached ? 'bg-[var(--aurora-1)]/30' : 'bg-[var(--border-subtle)]'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============== 确认步骤 ===============

function ConfirmStep({
  profile,
  activeProfile,
  onCancel,
  onStart,
}: {
  profile: SearchProfile;
  activeProfile: SearchProfile | null;
  onCancel: () => void;
  onStart: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-[var(--text-secondary)]">
          即将切换搜索流量到新 profile，影响范围如下：
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)]">
          <div className="space-y-1">
            <p className="text-[0.65rem] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">
              当前 active
            </p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {activeProfile?.name ?? '(无)'}
            </p>
            <p className="text-xs font-mono text-[var(--text-muted)]">
              {activeProfile?.code ?? '—'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[0.65rem] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">
              将要切换至
            </p>
            <p className="text-sm font-medium text-[var(--aurora-1)]">{profile.name}</p>
            <p className="text-xs font-mono text-[var(--text-muted)]">{profile.code}</p>
          </div>
        </div>
      </div>
      <ul className="text-xs text-[var(--text-muted)] space-y-1.5 list-disc list-inside">
        <li>将运行全量 reindex（按 PUBLISHED 文章数估算耗时）</li>
        <li>失败篇数为 0 时自动激活并翻转指针</li>
        <li>有任意失败时停在"失败"步骤，可重试或取消（profile 保持 shadow）</li>
        <li>旧 active profile 自动 deprecate，对应向量行保留 30 天供回滚</li>
      </ul>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'px-4 py-2 rounded-lg text-sm',
            'bg-[var(--bg-input)] border border-[var(--border-subtle)]',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            'transition-colors'
          )}
        >
          取消
        </button>
        <button
          type="button"
          onClick={onStart}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm',
            'bg-[var(--aurora-1)] text-white',
            'hover:bg-[color-mix(in_oklch,var(--aurora-1)_85%,white)]',
            'transition-colors shadow-lg shadow-[var(--aurora-1)]/20'
          )}
        >
          开始 reindex <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// =============== Reindexing Step (SSE 进度) ===============

function ReindexingStep({
  total,
  counters,
  recent,
  heartbeat,
  chunkProgressItems,
  running,
  onAbort,
}: {
  total: number;
  counters: ReindexCounters;
  recent: ReindexProgressEvent[];
  heartbeat: ReindexHeartbeat | null;
  chunkProgressItems: ReindexChunkProgressEvent[];
  running: boolean;
  onAbort: () => void;
}) {
  const { done, failed, ok, totalElapsedMs } = counters;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const avgMs = useMemo(() => {
    if (ok === 0) return 0;
    return Math.round(totalElapsedMs / ok);
  }, [ok, totalElapsedMs]);

  // recent 来自 hook 内部环形缓冲（最多 16 条），UI 只展示最新 5 条倒序
  const display = recent.slice(-5).reverse();
  const activeChunkProgress = chunkProgressItems.slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Activity
            className={cn(
              'w-4 h-4',
              running ? 'text-[var(--aurora-1)] animate-pulse' : 'text-[var(--text-muted)]'
            )}
          />
          <span>
            {running ? 'reindex 进行中' : '已完成'} —— 已处理 {done} / {total}
            {failed > 0 && (
              <span className="text-red-400 ml-1.5">({failed} 失败)</span>
            )}
            {running && heartbeat && (
              <span className="ml-1.5 text-[var(--text-muted)]">
                · 连接保持中
                {typeof heartbeat.inFlight === 'number' && heartbeat.inFlight > 0
                  ? ` · ${heartbeat.inFlight} 篇处理中`
                  : ''}
              </span>
            )}
          </span>
        </div>
        {running && (
          <button
            type="button"
            onClick={onAbort}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-red-300 hover:text-red-200 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            <Square className="w-3 h-3" /> 中止
          </button>
        )}
      </div>

      <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--aurora-1)] to-[var(--aurora-3)] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-[var(--text-muted)] tabular-nums">
        <span>{percent}%</span>
        <span>平均 {avgMs}ms / 篇</span>
      </div>

      {running && activeChunkProgress.length > 0 && (
        <div className="space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2.5 py-2">
          {activeChunkProgress.map((item) => {
            const chunkPercent = item.totalChunks > 0
              ? Math.min(100, Math.round((item.doneChunks / item.totalChunks) * 100))
              : 0;
            const label = item.totalChunks > 0
              ? `chunk ${item.doneChunks} / ${item.totalChunks}`
              : '正在读取 / 拆分';

            return (
              <div key={item.postId} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
                  <span className="min-w-0 truncate">
                    post #{item.postId} · {label}
                    {item.status === 'resumed' ? ' · 已复用' : ''}
                  </span>
                  <span className="font-mono tabular-nums text-[var(--text-muted)]">{chunkPercent}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--aurora-1)] transition-all"
                    style={{ width: `${chunkPercent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {display.length === 0 && running && (
          <p className="text-xs text-[var(--text-muted)] text-center py-3">
            {heartbeat ? '当前文章仍在处理，等待完成事件…' : '等待第一条进度事件…'}
          </p>
        )}
        {display.map((p) => (
          <div
            key={`${p.postId}-${p.index}`}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs',
              p.status === 'ok'
                ? 'bg-[color-mix(in_oklch,var(--signal-success)_5%,transparent)]'
                : 'bg-red-500/5'
            )}
          >
            <span className="font-mono w-10 text-[var(--text-muted)] shrink-0">
              #{p.index}
            </span>
            {p.status === 'ok' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--signal-success)] shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            )}
            <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">
              post #{p.postId}
              {p.status === 'ok' ? ` · ${p.chunks} chunks` : ` · ${p.error || 'failed'}`}
            </span>
            <span className="font-mono text-[var(--text-muted)] shrink-0 tabular-nums">
              {p.elapsedMs}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============== 完成步骤 ===============

function DoneStep({
  profile,
  previousActive,
  onClose,
}: {
  profile: SearchProfile;
  previousActive: PreviousActiveProfile | null;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 py-6">
        <CheckCircle2 className="w-12 h-12 text-[var(--signal-success)]" />
        <div className="text-center">
          <p className="text-base font-medium text-[var(--text-primary)]">
            激活完成
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            搜索流量已切换到 <span className="font-mono">{profile.code}</span>
            {previousActive && (
              <>
                {'，旧 profile '}
                <span className="font-mono">{previousActive.code}</span>
                {' 已 deprecated'}
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'px-4 py-2 rounded-lg text-sm',
            'bg-[var(--aurora-1)] text-white',
            'hover:bg-[color-mix(in_oklch,var(--aurora-1)_85%,white)]',
            'transition-colors'
          )}
        >
          完成
        </button>
      </div>
    </div>
  );
}

// =============== 失败步骤 ===============

function FailedStep({
  stream,
  activateError,
  onRetry,
  onClose,
}: {
  stream: ReturnType<typeof useReindexStream>;
  activateError: Error | undefined;
  onRetry: () => void;
  onClose: () => void;
}) {
  // Hook 现在只保留最多 16 条 recent，不存全量历史。failed 总数从 counters
  // 读取（精确值）；明细只能展示 recent 里恰好命中的失败条目（最多 5 条预览，
  // 完整列表用户可在 ai-service 日志里看）。
  const failedEvents = stream.recent.filter((p) => p.status === 'failed');
  const failedTotal = stream.counters.failed;
  const message = stream.error || activateError?.message || (
    failedTotal > 0
      ? `${failedTotal} 篇文章 reindex 失败，未自动激活`
      : '激活失败'
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <div className="text-sm text-red-300 min-w-0">
          <p className="font-medium">{message}</p>
          {failedEvents.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto text-xs text-red-300/80">
              {failedEvents.slice(0, 5).map((e) => (
                <li key={`${e.postId}-${e.index}`} className="truncate">
                  post #{e.postId}: {e.error || 'unknown error'}
                </li>
              ))}
              {failedTotal > failedEvents.length && (
                <li className="text-red-300/60">
                  …还有 {failedTotal - failedEvents.length} 篇（详情见 ai-service 日志）
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Profile 仍处于 shadow 状态。可在排除问题后重试，或在搜索配置主面板调用
        <span className="font-mono"> /retry-failed?profileCode= </span>
        补齐失败篇数。
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'px-4 py-2 rounded-lg text-sm',
            'bg-[var(--bg-input)] border border-[var(--border-subtle)]',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            'transition-colors'
          )}
        >
          关闭
        </button>
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            'px-4 py-2 rounded-lg text-sm',
            'bg-[var(--aurora-1)] text-white',
            'hover:bg-[color-mix(in_oklch,var(--aurora-1)_85%,white)]',
            'transition-colors'
          )}
        >
          重试
        </button>
      </div>
    </div>
  );
}
