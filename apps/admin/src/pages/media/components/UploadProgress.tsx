/**
 * @文件UploadProgress.tsx
 * @description 上传进度组件 - 可折叠悬浮通知 (长时间上传友好)
 * @ref §3.2.4 - 媒体管理模块
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, Loader2, AlertCircle, ChevronUp, Upload, RefreshCw, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadingFile {
  file: File;
  progress: number;
  id: string;
  error?: string;
  status: 'queued' | 'uploading' | 'processing' | 'success' | 'error' | 'aborted';
  attempt?: number;
}

interface UploadProgressProps {
  files: UploadingFile[];
  /** 取消单文件:活动中=abort, 终态=移除 */
  onCancel: (id: string) => void;
  /** 重试 error/aborted 状态的文件 */
  onRetry?: (id: string) => void;
  /** 一键取消所有进行中 */
  onCancelAll?: () => void;
  /** 清除所有非进行中的项目 */
  onClearCompleted?: () => void;
}

/**
 * 上传进度组件 - 右下角可折叠悬浮通知
 */
export function UploadProgress({ files, onCancel, onRetry, onCancelAll, onClearCompleted }: UploadProgressProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [hasNewFiles, setHasNewFiles] = useState(false);

  // 计算进度 - 使用 status 字段

  const errorCount = files.filter(f => f.status === 'error').length;
  const abortedCount = files.filter(f => f.status === 'aborted').length;
  const processingCount = files.filter(f => f.status === 'processing').length;
  const uploadingCount = files.filter(f => f.status === 'uploading' || f.status === 'queued').length;
  const activeCount = uploadingCount + processingCount;
  const completedCount = files.filter(f => f.status === 'success' || f.status === 'error' || f.status === 'aborted').length;
  const hasFailed = errorCount + abortedCount > 0;
  const activeProgress = files
    .filter(f => f.status === 'uploading' || f.status === 'processing' || f.status === 'queued')
    .map(f => f.progress);
  const overallProgress = activeProgress.length > 0
    ? Math.round(activeProgress.reduce((sum, p) => sum + p, 0) / activeProgress.length)
    : 100;

  // 新文件添加时自动展开
  useEffect(() => {
    if (files.length > 0) {
      setIsExpanded(true);
      setHasNewFiles(true);
    }
  }, [files.length]);

  // 5秒后自动折叠（除非有错误/中止）
  useEffect(() => {
    if (hasNewFiles && !hasFailed) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
        setHasNewFiles(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [hasNewFiles, hasFailed]);

  // 全部完成后3秒清理（可选：由父组件处理）
  useEffect(() => {
    if (files.length > 0 && activeCount === 0 && !hasFailed) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [files.length, activeCount, hasFailed]);

  if (files.length === 0) return null;

  // 折叠状态 - 只显示一个小圆形指示器
  if (!isExpanded) {
    return (
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        onClick={() => setIsExpanded(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl",
          "flex items-center justify-center cursor-pointer",
          "bg-[var(--bg-popover)]/95 backdrop-blur-xl border border-white/10",
          "hover:scale-110 transition-transform"
        )}
      >
        {/* 进度环 */}
        <svg className="absolute inset-0 w-full h-full -rotate-90">
          <circle
            cx="28"
            cy="28"
            r="24"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="3"
          />
          <motion.circle
            cx="28"
            cy="28"
            r="24"
            fill="none"
            stroke={hasFailed ? '#ef4444' : uploadingCount > 0 ? '#8b5cf6' : '#22c55e'}
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: activeCount > 0 ? overallProgress / 100 : 1 }}
            transition={{ duration: 0.3 }}
            style={{
              strokeDasharray: '150.79644737231007',
              strokeDashoffset: 0,
            }}
          />
        </svg>

        {/* 中心图标 */}
        <div className="relative z-10">
          {activeCount > 0 ? (
            <Upload className="w-5 h-5 text-primary" />
          ) : hasFailed ? (
            <AlertCircle className="w-5 h-5 text-status-danger" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-status-success" />
          )}
        </div>
        
        {/* 文件数量徽章 */}
        {files.length > 1 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
            {files.length}
          </span>
        )}
      </motion.button>
    );
  }

  // 展开状态 - 完整通知面板
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-6 right-6 z-50 w-80"
    >
      <div className={cn(
        "rounded-2xl overflow-hidden shadow-2xl",
        "bg-[var(--bg-popover)]/95 backdrop-blur-xl border border-white/10"
      )}>
        {/* 头部概览 */}
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              {activeCount > 0 ? (
                <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              ) : hasFailed ? (
                <AlertCircle className="w-5 h-5 text-status-danger shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-status-success shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {processingCount > 0
                    ? `正在处理 ${processingCount} 个文件…`
                    : uploadingCount > 0
                      ? `正在上传 ${uploadingCount} 个文件…`
                      : hasFailed
                        ? `${errorCount + abortedCount} 个文件未完成`
                        : '上传完成'}
                </p>
                <p className="text-xs text-white/50">
                  {activeCount > 0 ? `${overallProgress}% 完成` : `共 ${files.length} 个 · ${completedCount} 个已结束`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {activeCount > 0 && onCancelAll && (
                <button
                  onClick={onCancelAll}
                  title="取消全部进行中"
                  aria-label="取消全部进行中"
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-status-danger transition-colors"
                >
                  <Ban className="w-4 h-4" />
                </button>
              )}
              {activeCount === 0 && completedCount > 0 && onClearCompleted && (
                <button
                  onClick={onClearCompleted}
                  title="清除已结束"
                  aria-label="清除已结束"
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setIsExpanded(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                title="最小化"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 整体进度条 */}
          {activeCount > 0 && (
            <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${overallProgress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
        </div>

        {/* 文件列表（最多显示3个） */}
        <AnimatePresence>
          {files.slice(0, 3).map((item) => {
            const isComplete = item.status === 'success';
            const isProcessing = item.status === 'processing';
            const hasError = item.status === 'error';
            const isAborted = item.status === 'aborted';
            const isQueued = item.status === 'queued';
            const isUploading = item.status === 'uploading';
            const canCancel = isUploading || isProcessing || isQueued;
            const canRetry = (hasError || isAborted) && !!onRetry;
            const isRetrying = (item.attempt ?? 1) > 1 && (isUploading || isQueued);

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="px-4 py-2 border-b border-white/5 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-xs truncate",
                      hasError && "text-status-danger",
                      isAborted && "text-white/50",
                      isComplete && "text-status-success",
                      isProcessing && "text-status-warning",
                      (isUploading || isQueued) && "text-white/70"
                    )}>
                      {item.file.name}
                    </p>
                    {hasError && (
                      <p className="text-[10px] text-status-danger/70 truncate">{item.error}</p>
                    )}
                    {isAborted && (
                      <p className="text-[10px] text-white/40">已取消</p>
                    )}
                    {isProcessing && (
                      <p className="text-[10px] text-status-warning/70">服务器处理中…</p>
                    )}
                    {isRetrying && (
                      <p className="text-[10px] text-primary/80">第 {item.attempt} 次尝试…</p>
                    )}
                    {isQueued && !isRetrying && (
                      <p className="text-[10px] text-white/40">排队中…</p>
                    )}
                  </div>

                  {(isUploading || isQueued) && !isRetrying && (
                    <span className="text-[10px] text-white/40 tabular-nums shrink-0">{item.progress}%</span>
                  )}

                  {isProcessing && (
                    <Loader2 className="w-3.5 h-3.5 text-status-warning shrink-0 animate-spin" />
                  )}

                  {isComplete && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-status-success shrink-0" />
                  )}

                  {canRetry && (
                    <button
                      onClick={() => onRetry?.(item.id)}
                      title="重试上传"
                      aria-label="重试上传"
                      className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-primary"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}

                  {(canCancel || hasError || isAborted || isComplete) && (
                    <button
                      onClick={() => onCancel(item.id)}
                      title={canCancel ? '取消上传' : '从列表移除'}
                      aria-label={canCancel ? '取消上传' : '从列表移除'}
                      className={cn(
                        'p-1 rounded transition-colors',
                        canCancel
                          ? 'text-white/50 hover:text-status-danger hover:bg-status-danger/10'
                          : 'text-white/40 hover:text-white hover:bg-white/10'
                      )}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* 更多文件提示 */}
        {files.length > 3 && (
          <div className="px-4 py-2 text-center border-t border-white/5">
            <p className="text-[10px] text-white/30">还有 {files.length - 3} 个文件...</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
