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

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CloudUpload, X, RotateCcw, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageSyncService, SyncFailedJob } from '@/services/storageSyncService';
import { storageProviderService } from '@/services/storageProviderService';
import { Button, Select } from '@aetherblog/ui';
import { toast } from 'sonner';

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const err = error as {
    message?: string;
    msg?: string;
    errorMessage?: string;
    response?: { data?: { message?: string; msg?: string; errorMessage?: string } };
  };
  return (
    err.response?.data?.message ||
    err.response?.data?.msg ||
    err.response?.data?.errorMessage ||
    err.message ||
    err.msg ||
    err.errorMessage ||
    fallback
  );
}

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
      const enq = (resp?.data as { enqueued?: number } | undefined)?.enqueued ?? 0;
      if (enq === 0) {
        toast.info('无未同步文件,所有文件已与目标 provider 一致');
      } else {
        toast.success(`已入队 ${enq} 个文件,worker 正在处理`);
      }
      queryClient.invalidateQueries({ queryKey: ['storage-sync-status'] });
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, '启动备份失败'));
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
    },
  });

  useEffect(() => {
    if (!open) {
      setShowFailed(false);
    }
  }, [open]);

  if (!open) return null;

  const counts = normalizeSyncCounts(status?.counts);
  const activeJobs = counts.pending + counts.running;
  const hasActiveJobs = activeJobs > 0;
  const workerRunning = status?.running ?? false;
  const total = counts.pending + counts.running + counts.succeeded + counts.failed;
  const progress = total > 0 ? Math.round(((counts.succeeded + counts.failed) / total) * 100) : 0;

  const content = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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
            className="relative w-full max-w-2xl"
          >
            <div className="surface-overlay rounded-2xl">
              <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                    <CloudUpload className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">备份同步</h2>
                    <p className="text-xs text-[var(--text-muted)]">把所有未与目标 provider 同步的文件加入备份队列</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* 自动后台备份提示 */}
                {autoEnabled !== undefined && (
                  <div
                    className={`px-3 py-2 rounded-lg text-xs ${
                      autoEnabled
                        ? 'bg-status-success/10 text-status-success border border-status-success/30'
                        : 'bg-[var(--bg-secondary)]/40 text-[var(--text-muted)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    {autoEnabled
                      ? '自动后台备份已启用 — worker 会按周期处理 PENDING 队列'
                      : '当前仅响应手动触发,要打开自动后台备份请去 设置 → 存储管理 → 自动后台备份'}
                  </div>
                )}

                {/* 目标 provider 选择 */}
                <div>
                  <label htmlFor="sync-target-provider" className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">备份目标 (target provider)</label>
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
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    未指定时使用"存储管理"里的备份同步目标;也可在这里临时覆盖本次任务。
                  </p>
                </div>

                {/* 状态摘要 */}
                <div className="rounded-xl bg-[var(--bg-secondary)]/40 border border-[var(--border-subtle)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[var(--text-primary)]">同步进度</p>
                    {hasActiveJobs ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-primary">
                        <Loader2 className="w-3 h-3 animate-spin" /> 队列处理中
                      </span>
                    ) : workerRunning ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-status-success" /> Worker 待命
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">队列空闲</span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-3 mb-3">
                    <Stat label="待处理" value={counts.pending} tint="text-amber-400" />
                    <Stat label="进行中" value={counts.running} tint="text-blue-400" />
                    <Stat label="已成功" value={counts.succeeded} tint="text-green-400" />
                    <Stat label="失败" value={counts.failed} tint="text-red-400" />
                  </div>
                  {/* 进度条 */}
                  {total > 0 && (
                    <>
                      <div className="h-2 bg-[var(--bg-input)] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-primary to-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-1.5">{progress}% — 共 {total} 个 job</p>
                    </>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2">
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
                    className="w-full text-left px-3 py-2 rounded-lg bg-status-danger/8 border border-status-danger/25 text-sm text-[var(--text-primary)] hover:bg-status-danger/15 transition-colors flex items-center gap-2"
                  >
                    <AlertCircle className="w-4 h-4 text-status-danger" />
                    {showFailed ? '隐藏' : '查看'}失败列表 ({counts.failed})
                  </button>
                )}

                {showFailed && failedJobs.length > 0 && (
                  <div className="rounded-xl border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] max-h-64 overflow-y-auto">
                    {failedJobs.map((job) => (
                      <div key={job.id} className="flex items-start gap-3 p-3">
                        <AlertCircle className="w-4 h-4 text-status-danger shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--text-primary)]">媒体 #{job.mediaId} → provider {job.targetProviderId}</p>
                          {job.lastError && (
                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5 break-all line-clamp-2 font-mono">
                              {job.lastError}
                            </p>
                          )}
                          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                            尝试 {job.attempt} 次 · {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '-'}
                          </p>
                        </div>
                        <button
                          onClick={() => retryMutation.mutate([job.id])}
                          disabled={retryMutation.isPending}
                          className="p-1.5 rounded-md text-[var(--text-secondary)] hover:text-primary hover:bg-primary/10 transition-colors"
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
      <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
    </div>
  );
}

export default SyncDialog;
