/**
 * QA 文档详细信息页面 — 管道/作业时间表 + 操作
 * 参考：docs/features/qa-document-workflow.md §1、§7
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Bot, GitMerge, CheckSquare, Send,
  Eye, Loader2, AlertCircle, CheckCircle2, Clock, ChevronRight,
  FileText, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@aetherblog/ui';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { qaDocumentService } from '@/services/qaDocumentService';
import type { QaDocument, QaJob, QaPatch, QaDiff, QaDocumentStatus } from '@/types/qaDocument';
import { SPLIT_GRANULARITY_LABELS } from '@/types/qaDocument';
import { logger } from '@/lib/logger';

const JOB_STATUS_ICON: Record<string, React.ElementType> = {
  PENDING: Clock,
  RUNNING: Loader2,
  DONE: CheckCircle2,
  FAILED: AlertCircle,
};

const JOB_STATUS_COLOR: Record<string, string> = {
  PENDING: 'text-[var(--ink-muted)]',
  RUNNING: 'text-[var(--aurora-3)]',
  DONE: 'text-[var(--signal-success)]',
  FAILED: 'text-[var(--signal-danger)]',
};

const PIPELINE_ACTIVE_STATUSES: QaDocumentStatus[] = [
  'PREPROCESSING', 'SEGMENTED', 'OCR_DONE', 'STRUCTURED', 'AGENT_RUNNING',
];

const POLL_INTERVAL_MS = 4000;

export default function QaDocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<QaDocument | null>(null);
  const [jobs, setJobs] = useState<QaJob[]>([]);
  const [patches, setPatches] = useState<QaPatch[]>([]);
  const [diffs, setDiffs] = useState<QaDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | 'reprocess' | 'agentFix' | 'approve' | 'publish'>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const [docRes, jobRes, patchRes, diffRes] = await Promise.all([
        qaDocumentService.getById(id),
        qaDocumentService.getJobs(id),
        qaDocumentService.getPatches(id),
        qaDocumentService.getDiffs(id),
      ]);
      if (docRes.code === 200 && docRes.data) {
        setDoc(docRes.data);
      }
      if (jobRes.code === 200 && jobRes.data) setJobs(jobRes.data);
      if (patchRes.code === 200 && patchRes.data) setPatches(patchRes.data);
      // 始终加载持久的差异，以便重新打开/刷新 DIFF_READY/APPROVED 文档
      // 保留指向 /qa/:id/diff/:diffId 的链接（不仅仅是同一会话合并）。
      if (diffRes.code === 200 && diffRes.data) setDiffs(diffRes.data);
    } catch (err) {
      logger.error('Detail fetch error:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  const isPipelineActive = doc && PIPELINE_ACTIVE_STATUSES.includes(doc.status);
  useEffect(() => {
    if (!isPipelineActive) return;
    const timer = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isPipelineActive, fetchAll]);

  const runAction = async (action: 'reprocess' | 'agentFix' | 'approve' | 'publish') => {
    if (!id || !doc) return;
    setActionLoading(action);
    try {
      if (action === 'reprocess') {
        await qaDocumentService.reprocess(id);
      } else if (action === 'agentFix') {
        await qaDocumentService.triggerAgentFix(id);
      } else if (action === 'approve') {
        // 批准最新版本（数字 versionId — 请参阅服务）
        await qaDocumentService.approve(id, doc.currentVersion);
      } else if (action === 'publish') {
        await qaDocumentService.publish(id);
      }
      await fetchAll();
    } catch (err) {
      logger.error(`Action ${action} failed:`, err);
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  };

  const handleMergePatch = async (patchId: string) => {
    if (!id) return;
    setActionLoading(`merge-${patchId}`);
    try {
      const res = await qaDocumentService.mergePatch(id, patchId);
      if (res.data) setDiffs((prev) => [...prev, res.data]);
      await fetchAll();
    } catch (err) {
      logger.error('Merge failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="p-6 text-center text-[var(--signal-danger)]">
        <AlertCircle className="mx-auto mb-2 h-8 w-8" />
        {error || '文档未找到'}
        <button
          type="button"
          onClick={() => navigate('/qa')}
          className="mt-4 block mx-auto text-sm text-[var(--aurora-1)]"
        >
          返回列表
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/qa')}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-3 text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        <h1 className="font-display text-xl text-[var(--ink-primary)] flex-1 truncate">{doc.title}</h1>
        <button
          type="button"
          onClick={fetchAll}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
          title="刷新"
        >
          <RefreshCw className={cn('h-4 w-4', isPipelineActive && 'animate-spin')} />
        </button>
      </div>

      {/* Document info card */}
      <div className="surface-leaf rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: '状态', value: doc.status },
            { label: '粒度', value: SPLIT_GRANULARITY_LABELS[doc.splitGranularity] },
            { label: '当前版本', value: `v${doc.currentVersion}` },
            { label: '更新时间', value: new Date(doc.updatedAt).toLocaleString('zh-CN') },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="mb-0.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</p>
              <p className="text-sm font-medium text-[var(--ink-primary)]">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {['REVIEW_READY', 'ANNOTATED'].includes(doc.status) && (
          <button
            type="button"
            onClick={() => navigate(`/qa/${id}/proofread`)}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--aurora-1)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Eye className="h-4 w-4" />
            进入校对
          </button>
        )}
        {['REVIEW_READY', 'ANNOTATED'].includes(doc.status) && (
          <button
            type="button"
            onClick={() => setConfirmAction('agentFix')}
            disabled={actionLoading === 'agentFix'}
            className="inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--aurora-4)_30%,transparent)] bg-[color-mix(in_oklch,var(--aurora-4)_8%,transparent)] px-4 py-2 text-sm font-medium text-[var(--aurora-4)] hover:opacity-90 disabled:opacity-50"
          >
            {actionLoading === 'agentFix' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            触发 AI 修复
          </button>
        )}
        {doc.status === 'DIFF_READY' && (
          <button
            type="button"
            onClick={() => setConfirmAction('approve')}
            disabled={actionLoading === 'approve'}
            className="inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--signal-success)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_8%,transparent)] px-4 py-2 text-sm font-medium text-[var(--signal-success)] hover:opacity-90 disabled:opacity-50"
          >
            {actionLoading === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckSquare className="h-4 w-4" />}
            审批通过
          </button>
        )}
        {doc.status === 'APPROVED' && (
          <button
            type="button"
            onClick={() => setConfirmAction('publish')}
            disabled={actionLoading === 'publish'}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--signal-success)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {actionLoading === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            发布入题库
          </button>
        )}
        {doc.status === 'FAILED' && (
          <button
            type="button"
            onClick={() => setConfirmAction('reprocess')}
            disabled={actionLoading === 'reprocess'}
            className="inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] px-4 py-2 text-sm font-medium text-[var(--signal-danger)] hover:opacity-90 disabled:opacity-50"
          >
            {actionLoading === 'reprocess' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            重新处理
          </button>
        )}
      </div>

      {/* Jobs timeline */}
      <div className="surface-leaf rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ink-primary)]">
          <Activity className="h-4 w-4 text-[var(--aurora-1)]" />
          流水线任务
        </h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">暂无流水线任务</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => {
              const Icon = JOB_STATUS_ICON[job.status] ?? Clock;
              return (
                <div
                  key={job.id}
                  className="flex items-start gap-3 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] p-3"
                >
                  <Icon
                    className={cn(
                      'mt-0.5 h-4 w-4 flex-shrink-0',
                      JOB_STATUS_COLOR[job.status] ?? 'text-[var(--ink-muted)]',
                      job.status === 'RUNNING' && 'animate-spin'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium text-[var(--ink-primary)]">{job.stage}</span>
                      <span className="text-[10px] text-[var(--ink-muted)]">
                        第 {job.attempt} 次
                        {job.finishedAt && ` · ${new Date(job.finishedAt).toLocaleTimeString('zh-CN')}`}
                      </span>
                    </div>
                    {job.error && (
                      <p className="mt-1 text-xs text-[var(--signal-danger)]">{job.error}</p>
                    )}
                    {job.log && (
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-muted)]">{job.log}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Patches */}
      {patches.length > 0 && (
        <div className="surface-leaf rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ink-primary)]">
            <GitMerge className="h-4 w-4 text-[var(--aurora-4)]" />
            AI 修复补丁
          </h2>
          <div className="space-y-2">
            {patches.map((patch) => (
              <div
                key={patch.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--ink-primary)]">{patch.summary}</p>
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                    {patch.operations.length} 个操作 · {patch.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {patch.status === 'PROPOSED' && (
                    <button
                      type="button"
                      onClick={() => handleMergePatch(patch.id)}
                      disabled={actionLoading === `merge-${patch.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--aurora-4)_30%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--aurora-4)] hover:bg-[color-mix(in_oklch,var(--aurora-4)_8%,transparent)] disabled:opacity-50"
                    >
                      {actionLoading === `merge-${patch.id}`
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <GitMerge className="h-3 w-3" />}
                      合并
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diffs */}
      {diffs.length > 0 && (
        <div className="surface-leaf rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-[var(--ink-primary)]">版本差异</h2>
          <div className="space-y-2">
            {diffs.map((diff) => (
              <div
                key={diff.id}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] p-3 hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]"
                onClick={() => navigate(`/qa/${id}/diff/${diff.id}`)}
              >
                <div>
                  <p className="text-sm font-medium text-[var(--ink-primary)]">
                    v{diff.fromVersion} → v{diff.toVersion}
                    {diff.hasConflict && (
                      <span className="ml-2 rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] px-2 py-0.5 text-xs text-[var(--signal-warn)]">
                        有冲突
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">{diff.changes.length} 处变更 · {diff.level}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--ink-muted)]" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        isOpen={confirmAction === 'agentFix'}
        title="触发 AI 自动修复？"
        message="Agent 将分析标注与 OCR 结果，产出 Patch Proposal。触发后状态变为 AGENT_RUNNING，请稍候。"
        confirmText="确认触发"
        variant="warning"
        onConfirm={() => runAction('agentFix')}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        isOpen={confirmAction === 'approve'}
        title="审批通过当前候选版本？"
        message="审批后状态变为 APPROVED，可以发布到正式题库。"
        confirmText="确认审批"
        variant="warning"
        onConfirm={() => runAction('approve')}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        isOpen={confirmAction === 'publish'}
        title="发布到正式题库？"
        message="发布后将写入 qa_questions，状态变为 PUBLISHED（不可撤销）。"
        confirmText="确认发布"
        variant="danger"
        onConfirm={() => runAction('publish')}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        isOpen={confirmAction === 'reprocess'}
        title="重新处理这份文档？"
        message="将从当前阶段重新进入流水线，覆盖已有 OCR / 结构化结果。"
        confirmText="确认重处理"
        variant="warning"
        onConfirm={() => runAction('reprocess')}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
