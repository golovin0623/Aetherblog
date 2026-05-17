/**
 * @file SyncDialog.tsx
 * @description "备份同步"对话框 - Phase 4 同步备份的前端入口
 * @ref 对象存储 rollout - Phase 4
 *
 * 触发流程:
 *   1. 用户点"备份同步"按钮 → 打开此对话框
 *   2. 选择目标 provider (默认使用存储管理中配置的备份目标)
 *   3. 点"立即备份" → POST /sync/start → 显示进度条 (轮询 /status)
 *   4. running=false 后展示完成统计 + 失败列表 + 单条重试入口
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CloudUpload, X, RotateCcw, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageSyncService, SyncFailedJob } from '@/services/storageSyncService';
import { storageProviderService } from '@/services/storageProviderService';
import { Button, Select } from '@aetherblog/ui';
import { toast } from 'sonner';
import { extractApiErrorMessage } from '@/lib/utils';

interface SyncDialogProps {
  open: boolean;
  onClose: () => void;
}

interface SyncCountsView {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeSyncCounts(raw: unknown): SyncCountsView {
  const counts = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    pending: asCount(counts.pending ?? counts.Pending),
    running: asCount(counts.running ?? counts.Running),
    succeeded: asCount(counts.succeeded ?? counts.Succeeded),
    failed: asCount(counts.failed ?? counts.Failed),
  };
}

function hasActiveSyncJobs(raw: unknown): boolean {
  const counts = normalizeSyncCounts(raw);
  return counts.pending + counts.running > 0;
}

export function SyncDialog({ open, onClose }: SyncDialogProps) {
  const queryClient = useQueryClient();
  const [targetProviderId, setTargetProviderId] = useState<number | undefined>(undefined);
  const [showFailed, setShowFailed] = useState(false);
  const lastSettledSignatureRef = useRef<string | null>(null);

  // 获取所有 provider 用于下拉
  const { data: providersResp } = useQuery({
    queryKey: ['storage-providers'],
    queryFn: () => storageProviderService.getAll(),
    enabled: open,
  });
  const providers = (providersResp?.data || []).filter((p) => p.isEnabled);

  // 状态轮询 — 仅在 dialog 打开时,worker running 时 2s 一次,否则 10s 一次保留摘要
  const { data: statusResp } = useQuery({
    queryKey: ['storage-sync-status'],
    queryFn: () => storageSyncService.getStatus(),
    enabled: open,
    refetchInterval: (query) => {
      const data = query.state.data?.data;
      return hasActiveSyncJobs(data?.counts) ? 2000 : 10000;
    },
  });
  const status = statusResp?.data;

  // 自动后台备份开关状态(用于在 dialog 顶部展示提示)
  const { data: autoEnabledResp } = useQuery({
    queryKey: ['storage-sync-auto-enabled'],
    queryFn: () => storageSyncService.getAutoEnabled(),
    enabled: open,
  });
  const autoEnabled = autoEnabledResp?.data?.autoEnabled;

  // 失败列表
  const { data: failedResp } = useQuery({
    queryKey: ['storage-sync-failed'],
    queryFn: () => storageSyncService.listFailed(50),
    enabled: open && showFailed,
  });
  const failedJobs: SyncFailedJob[] = (failedResp?.data as SyncFailedJob[] | undefined) || [];

  // 启动备份
  const startMutation = useMutation({
    mutationFn: () => storageSyncService.start(targetProviderId),
    onSuccess: (resp) => {
      lastSettledSignatureRef.current = null;
      const enq = (resp?.data as { enqueued?: number } | undefined)?.enqueued ?? 0;
      if (enq === 0) {
        toast.info('无未同步文件,所有文件已与目标 provider 一致');
      } else {
        toast.success(`已入队 ${enq} 个文件,worker 正在处理`);
      }
      queryClient.invalidateQueries({ queryKey: ['storage-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'detail'] });
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, '启动备份失败'));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => storageSyncService.cancel(),
    onSuccess: () => {
      toast.success('已通知 worker 停止 (当前批次跑完后退出)');
      queryClient.invalidateQueries({ queryKey: ['storage-sync-status'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (jobIds: number[]) => storageSyncService.retry(jobIds),
    onSuccess: () => {
      toast.success('重试任务已入队');
      queryClient.invalidateQueries({ queryKey: ['storage-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['storage-sync-failed'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'detail'] });
    },
  });

  useEffect(() => {
    if (!open) {
      setShowFailed(false);
      lastSettledSignatureRef.current = null;
    }
  }, [open]);

  const counts = normalizeSyncCounts(status?.counts);
  const activeJobs = counts.pending + counts.running;
  const hasActiveJobs = activeJobs > 0;
  const workerRunning = status?.running ?? false;
  const total = counts.pending + counts.running + counts.succeeded + counts.failed;
  const progress = total > 0 ? Math.round(((counts.succeeded + counts.failed) / total) * 100) : 0;

  useEffect(() => {
    if (!open || hasActiveJobs || total === 0 || counts.succeeded + counts.failed === 0) return;
    const signature = `${counts.succeeded}:${counts.failed}`;
    if (lastSettledSignatureRef.current === signature) return;
    lastSettledSignatureRef.current = signature;
    queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
    queryClient.invalidateQueries({ queryKey: ['media', 'detail'] });
  }, [open, hasActiveJobs, total, counts.succeeded, counts.failed, queryClient]);

  if (!open) return null;

  const content = (
    <AnimatePresence>
      {open && (
        <div className="media-library-page fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            className="relative w-full sm:max-w-2xl"
          >
            <div className="media-neutral-surface surface-overlay flex max-h-[82vh] flex-col overflow-hidden rounded-t-2xl sm:max-h-[88vh] sm:rounded-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]">
                    <CloudUpload className="h-5 w-5 text-[var(--aurora-1)]" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[var(--ink-primary)]">备份同步</h2>
                    <p className="text-xs text-[var(--ink-muted)]">把所有未与目标 provider 同步的文件加入备份队列</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-2 text-[var(--ink-muted)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]"
                  aria-label="关闭备份同步"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
                {/* 自动后台备份提示 */}
                {autoEnabled !== undefined && (
                  <div
                    className={`rounded-lg px-3 py-2 text-xs ${
                      autoEnabled
                        ? 'bg-status-success/10 text-status-success border border-status-success/30'
                        : 'border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-muted)]'
                    }`}
                  >
                    {autoEnabled
                      ? '自动后台备份已启用 — worker 会按周期处理 PENDING 队列'
                      : '当前仅响应手动触发,要打开自动后台备份请去 设置 → 存储管理 → 自动后台备份'}
                  </div>
                )}

                {/* 目标 provider 选择 */}
                <div>
                  <label htmlFor="sync-target-provider" className="mb-1.5 block text-sm font-medium text-[var(--ink-primary)]">备份目标 (target provider)</label>
                  <Select
                    id="sync-target-provider"
                    ariaLabel="备份目标 provider"
                    value={targetProviderId !== undefined ? String(targetProviderId) : ''}
                    onValueChange={(next) => setTargetProviderId(next ? Number(next) : undefined)}
                    options={[
                      { value: '', label: '使用存储管理中的备份目标' },
                      ...providers.map((p) => ({
                        value: String(p.id),
                        label: `${p.name} (${p.providerType})${p.isDefault ? ' — 主存储' : ''}`,
                        description: p.providerType,
                      })),
                    ]}
                  />
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    未指定时使用"存储管理"里的备份同步目标;也可在这里临时覆盖本次任务。
                  </p>
                </div>

                {/* 状态摘要 */}
                <div className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[var(--ink-primary)]">同步进度</p>
                    {hasActiveJobs ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--aurora-1)]">
                        <Loader2 className="w-3 h-3 animate-spin" /> 队列处理中
                      </span>
                    ) : workerRunning ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-status-success" /> Worker 待命
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--ink-muted)]">队列空闲</span>
                    )}
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="待处理" value={counts.pending} tint="text-amber-400" />
                    <Stat label="进行中" value={counts.running} tint="text-blue-400" />
                    <Stat label="已成功" value={counts.succeeded} tint="text-green-400" />
                    <Stat label="失败" value={counts.failed} tint="text-red-400" />
                  </div>
                  {/* 进度条 */}
                  {total > 0 && (
                    <>
                      <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                        <motion.div
                          className="h-full bg-gradient-to-r from-[var(--aurora-1)] to-[var(--signal-success)]"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-[var(--ink-muted)]">{progress}% — 共 {total} 个 job</p>
                    </>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending}
                    className="flex-1 gap-1.5"
                  >
                    {startMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                    {startMutation.isPending ? '处理中...' : '立即备份未关联文件'}
                  </Button>
                  {workerRunning && (
                    <Button
                      variant="secondary"
                      onClick={() => cancelMutation.mutate()}
                      disabled={cancelMutation.isPending}
                    >
                      {hasActiveJobs ? '暂停 worker' : '停止 worker'}
                    </Button>
                  )}
                </div>

                {/* 失败抽屉 */}
                {counts.failed > 0 && (
                  <button
                    onClick={() => setShowFailed((v) => !v)}
                    className="flex w-full items-center gap-2 rounded-lg border border-status-danger/25 bg-status-danger/8 px-3 py-2 text-left text-sm text-[var(--ink-primary)] transition-colors hover:bg-status-danger/15"
                  >
                    <AlertCircle className="w-4 h-4 text-status-danger" />
                    {showFailed ? '隐藏' : '查看'}失败列表 ({counts.failed})
                  </button>
                )}

                {showFailed && failedJobs.length > 0 && (
                  <div className="max-h-64 divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] overflow-y-auto rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                    {failedJobs.map((job) => (
                      <div key={job.id} className="flex items-start gap-3 p-3">
                        <AlertCircle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--ink-primary)]">媒体 #{job.mediaId} → provider {job.targetProviderId}</p>
                          {job.lastError && (
                            <p className="mt-0.5 line-clamp-2 break-all font-mono text-[10px] text-[var(--ink-muted)]">
                              {job.lastError}
                            </p>
                          )}
                          <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                            尝试 {job.attempt} 次 · {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '-'}
                          </p>
                        </div>
                        <button
                          onClick={() => retryMutation.mutate([job.id])}
                          disabled={retryMutation.isPending}
                          className="rounded-md p-1.5 text-[var(--ink-secondary)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] hover:text-[var(--aurora-1)]"
                          title="重试该任务"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 完成提示 */}
                {!hasActiveJobs && counts.succeeded > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-status-success/10 border border-status-success/30 text-sm text-status-success">
                    <CheckCircle2 className="w-4 h-4" />
                    本轮备份已完成 — 共 {counts.succeeded} 个文件成功
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

function Stat({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="text-center">
      <p className={`text-xl font-semibold ${tint}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-[var(--ink-muted)]">{label}</p>
    </div>
  );
}

export default SyncDialog;
