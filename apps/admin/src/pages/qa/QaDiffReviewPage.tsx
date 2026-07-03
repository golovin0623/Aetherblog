/**
 * QA 差异审查页面 — 显示补丁合并差异与字符/字段/结构差异
 * 支持冲突显示、批准+发布操作
 * 参考：docs/features/qa-document-workflow.md §5、§7
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, CheckSquare, Send, AlertTriangle, Loader2,
  AlertCircle, ArrowRight, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { transition } from '@aetherblog/ui';
import { Skeleton } from '@aetherblog/ui';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { qaDocumentService } from '@/services/qaDocumentService';
import type { QaDiff, DiffChange, CharDiffEntry, QaDocument } from '@/types/qaDocument';
import { logger } from '@/lib/logger';

/** 内联字符级差异渲染器，重用 DiffView 颜色语义 */
function CharDiff({ tokens }: { tokens: CharDiffEntry[] }) {
  return (
    <span>
      {tokens.map((tok, i) => (
        <span
          key={i}
          className={cn(
            tok.op === '+' && 'bg-[color-mix(in_oklch,var(--signal-success)_15%,transparent)] text-[var(--signal-success)]',
            tok.op === '-' && 'bg-[color-mix(in_oklch,var(--signal-danger)_15%,transparent)] text-[var(--signal-danger)] line-through',
          )}
        >
          {tok.t}
        </span>
      ))}
    </span>
  );
}

function DiffChangeRow({ change }: { change: DiffChange }) {
  return (
    <div className="rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--ink-muted)]">
          {change.stableKey}
        </span>
        {change.fieldPath && (
          <>
            <ChevronRight className="h-3 w-3 text-[var(--ink-muted)]" />
            <span className="font-mono text-[10px] text-[var(--ink-muted)]">{change.fieldPath}</span>
          </>
        )}
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium',
            change.kind === 'modified' && 'bg-[color-mix(in_oklch,var(--signal-warn)_10%,transparent)] text-[var(--signal-warn)]',
            change.kind === 'added' && 'bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] text-[var(--signal-success)]',
            change.kind === 'deleted' && 'bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] text-[var(--signal-danger)]',
            change.kind === 'moved' && 'bg-[color-mix(in_oklch,var(--signal-info)_10%,transparent)] text-[var(--signal-info)]',
          )}
        >
          {change.kind}
        </span>
      </div>

      {change.charDiff ? (
        <p className="text-sm leading-relaxed">
          <CharDiff tokens={change.charDiff} />
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {change.before !== undefined && (
            <div className="rounded bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] px-2 py-1">
              <p className="mb-0.5 font-mono text-[10px] text-[var(--signal-danger)]">Before</p>
              <p className="text-[var(--ink-secondary)]">{change.before}</p>
            </div>
          )}
          {change.after !== undefined && (
            <div className="rounded bg-[color-mix(in_oklch,var(--signal-success)_8%,transparent)] px-2 py-1">
              <p className="mb-0.5 font-mono text-[10px] text-[var(--signal-success)]">After</p>
              <p className="text-[var(--ink-secondary)]">{change.after}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function QaDiffReviewPage() {
  const { id, diffId } = useParams<{ id: string; diffId: string }>();
  const navigate = useNavigate();

  const [diff, setDiff] = useState<QaDiff | null>(null);
  const [doc, setDoc] = useState<QaDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'publish' | null>(null);

  const fetchData = useCallback(async () => {
    if (!id || !diffId) return;
    try {
      setError(null);
      const [docRes, diffRes] = await Promise.all([
        qaDocumentService.getById(id),
        qaDocumentService.getDiff(id, diffId),
      ]);
      if (docRes.data) setDoc(docRes.data);
      if (diffRes.data) setDiff(diffRes.data);
    } catch (err) {
      logger.error('Diff review fetch error:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id, diffId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const runAction = async (action: 'approve' | 'publish') => {
    if (!id || !doc) return;
    setActionLoading(action);
    try {
      if (action === 'approve') {
        await qaDocumentService.approve(id, doc.currentVersion);
      } else {
        await qaDocumentService.publish(id);
      }
      await fetchData();
    } catch (err) {
      logger.error(`Action ${action} failed:`, err);
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !diff) {
    return (
      <div className="p-6 text-center text-[var(--signal-danger)]">
        <AlertCircle className="mx-auto mb-2 h-8 w-8" />
        {error || 'Diff 未找到'}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`/qa/${id}`)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-3 text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          详情
        </button>
        <h1 className="flex-1 font-display text-xl text-[var(--ink-primary)]">
          版本差异审核
        </h1>
      </div>

      {/* Diff summary card */}
      <div className="surface-leaf rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex-1 rounded-lg border border-[color-mix(in_oklch,var(--signal-danger)_20%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_5%,transparent)] px-4 py-3">
            <p className="text-xs font-mono text-[var(--signal-danger)]">原版本</p>
            <p className="mt-0.5 text-sm font-medium text-[var(--ink-primary)]">v{diff.fromVersion}</p>
          </div>
          <ArrowRight className="h-5 w-5 flex-shrink-0 text-[var(--ink-muted)]" />
          <div className="flex-1 rounded-lg border border-[color-mix(in_oklch,var(--signal-success)_20%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_5%,transparent)] px-4 py-3">
            <p className="text-xs font-mono text-[var(--signal-success)]">新版本</p>
            <p className="mt-0.5 text-sm font-medium text-[var(--ink-primary)]">v{diff.toVersion}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-6 rounded-lg bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] px-4 py-2 text-xs">
          <span className="text-[var(--ink-muted)]">粒度: <strong className="text-[var(--ink-primary)]">{diff.level}</strong></span>
          <span className="text-[var(--ink-muted)]">变更: <strong className="text-[var(--ink-primary)]">{diff.changes.length}</strong></span>
          <span className="text-[var(--ink-muted)]">冲突: <strong className={diff.hasConflict ? 'text-[var(--signal-warn)]' : 'text-[var(--ink-primary)]'}>{diff.conflicts.length}</strong></span>
        </div>
      </div>

      {/* Conflicts */}
      {diff.hasConflict && diff.conflicts.length > 0 && (
        <div className="rounded-xl border border-[color-mix(in_oklch,var(--signal-warn)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_5%,transparent)] p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--signal-warn)]">
            <AlertTriangle className="h-4 w-4" />
            {diff.conflicts.length} 个冲突需要人工处理
          </h3>
          <div className="space-y-2">
            {diff.conflicts.map((c, i) => (
              <div
                key={i}
                className="rounded-lg border border-[color-mix(in_oklch,var(--signal-warn)_20%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_8%,transparent)] px-3 py-2"
              >
                <span className="font-mono text-xs text-[var(--signal-warn)]">{c.stableKey}</span>
                <p className="mt-0.5 text-xs text-[var(--ink-secondary)]">{c.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Changes */}
      <div className="surface-leaf rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[var(--ink-primary)]">
          变更详情（{diff.changes.length} 处）
        </h2>
        {diff.changes.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">无变更记录</p>
        ) : (
          <div className="space-y-2">
            {diff.changes.map((change, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...transition.quick, delay: i * 0.02 }}
              >
                <DiffChangeRow change={change} />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex justify-end gap-2 pt-2">
        {doc?.status === 'DIFF_READY' && (
          <button
            type="button"
            onClick={() => setConfirmAction('approve')}
            disabled={!!actionLoading || diff.hasConflict}
            className="inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--signal-success)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-success)_8%,transparent)] px-4 py-2.5 text-sm font-medium text-[var(--signal-success)] hover:opacity-90 disabled:opacity-50"
            title={diff.hasConflict ? '有冲突时无法审批' : ''}
          >
            {actionLoading === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckSquare className="h-4 w-4" />}
            审批通过
          </button>
        )}
        {doc?.status === 'APPROVED' && (
          <button
            type="button"
            onClick={() => setConfirmAction('publish')}
            disabled={!!actionLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--signal-success)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {actionLoading === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            发布入题库
          </button>
        )}
      </div>

      {/* Confirm dialogs */}
      <ConfirmDialog
        isOpen={confirmAction === 'approve'}
        title="审批通过此版本？"
        message={`将 v${diff.toVersion} 标记为已审批候选版本，之后可以发布到题库。`}
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
    </div>
  );
}
