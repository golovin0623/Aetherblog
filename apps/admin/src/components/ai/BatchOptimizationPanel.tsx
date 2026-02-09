/**
 * 批量优化面板
 *
 * 功能：
 * 1. 收集所有待优化的批注
 * 2. 预览批量应用效果
 * 3. 一键应用所有优化
 * 4. 显示优化进度
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Annotation, BatchOptimizationTask } from '@/types/writing-workflow';

interface BatchOptimizationPanelProps {
  annotations: Annotation[];
  onApplyAll: (annotationIds: string[]) => Promise<void>;
  onClose: () => void;
}

export function BatchOptimizationPanel({
  annotations,
  onApplyAll,
  onClose,
}: BatchOptimizationPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(annotations.map(a => a.id))
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === annotations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(annotations.map(a => a.id)));
    }
  };

  const handleApply = async () => {
    if (selectedIds.size === 0) return;

    setIsProcessing(true);
    setError(null);
    setProgress(0);

    try {
      const ids = Array.from(selectedIds);

      // 模拟进度更新
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 300);

      await onApplyAll(ids);

      clearInterval(progressInterval);
      setProgress(100);

      // 延迟后关闭
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量优化失败');
      setProgress(0);
    } finally {
      setIsProcessing(false);
    }
  };

  const stats = {
    total: annotations.length,
    selected: selectedIds.size,
    grammar: annotations.filter(a => a.type === 'grammar').length,
    style: annotations.filter(a => a.type === 'style').length,
    suggestion: annotations.filter(a => a.type === 'suggestion').length,
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl max-h-[80vh] bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                批量优化
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 统计信息 */}
          <div className="flex items-center gap-4 mt-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">已选择:</span>
              <span className="font-medium text-primary">
                {stats.selected} / {stats.total}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
              <span>语法: {stats.grammar}</span>
              <span>风格: {stats.style}</span>
              <span>建议: {stats.suggestion}</span>
            </div>
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 全选/取消全选 */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)]/50 border border-[var(--border-subtle)]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size === annotations.length}
                onChange={toggleAll}
                className="w-4 h-4 rounded border-[var(--border-subtle)] text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium text-[var(--text-primary)]">
                全选 / 取消全选
              </span>
            </label>
          </div>

          {/* 批注列表 */}
          <div className="space-y-2">
            {annotations.map(annotation => (
              <label
                key={annotation.id}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                  selectedIds.has(annotation.id)
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-[var(--bg-secondary)]/50 border-[var(--border-subtle)] hover:border-[var(--border-default)]'
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(annotation.id)}
                  onChange={() => toggleSelection(annotation.id)}
                  className="mt-0.5 w-4 h-4 rounded border-[var(--border-subtle)] text-primary focus:ring-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500">
                      {annotation.type}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      位置: {annotation.range.from}-{annotation.range.to}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-primary)] mb-1">
                    {annotation.message}
                  </p>
                  {annotation.suggestion && (
                    <div className="flex items-start gap-2 text-xs">
                      <ChevronRight className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                      <span className="text-[var(--text-muted)]">
                        {annotation.suggestion}
                      </span>
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 space-y-3">
          {/* 进度条 */}
          <AnimatePresence>
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>正在应用优化...</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-primary to-purple-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 按钮 */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleApply}
              disabled={selectedIds.size === 0 || isProcessing}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all',
                'bg-primary text-white hover:bg-primary/90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  应用 {selectedIds.size} 项优化
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
