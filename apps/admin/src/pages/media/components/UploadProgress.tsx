/**
 * @file UploadProgress.tsx
 * @description 上传进度组件 - 可折叠悬浮通知 (长时间上传友好)
 * @ref §3.2.4 - 媒体管理模块
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, Loader2, AlertCircle, ChevronUp, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadingFile {
  file: File;
  progress: number;
  id: string;
  error?: string;
  status: 'uploading' | 'processing' | 'success' | 'error';
}

interface UploadProgressProps {
  files: UploadingFile[];
  onCancel: (id: string) => void;
}

/**
 * 上传进度组件 - 右下角可折叠悬浮通知
 */
export function UploadProgress({ files, onCancel }: UploadProgressProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [hasNewFiles, setHasNewFiles] = useState(false);

  // 计算进度 - 使用 status 字段
  const completedCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;
  const processingCount = files.filter(f => f.status === 'processing').length;
  const uploadingCount = files.filter(f => f.status === 'uploading').length;
  const activeCount = uploadingCount + processingCount;
  const overallProgress = files.length > 0 
    ? Math.round(files.reduce((sum, f) => sum + f.progress, 0) / files.length)
    : 0;

  // 新文件添加时自动展开
  useEffect(() => {
    if (files.length > 0) {
      setIsExpanded(true);
      setHasNewFiles(true);
    }
  }, [files.length]);

  // 5秒后自动折叠（除非有错误）
  useEffect(() => {
    if (hasNewFiles && errorCount === 0) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
        setHasNewFiles(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [hasNewFiles, errorCount]);

  // 全部完成后3秒清理（可选：由父组件处理）
  useEffect(() => {
    if (files.length > 0 && activeCount === 0 && errorCount === 0) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [files.length, activeCount, errorCount]);

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
          "bg-zinc-900/95 backdrop-blur-xl border border-white/10",
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
            stroke={errorCount > 0 ? '#ef4444' : uploadingCount > 0 ? '#8b5cf6' : '#22c55e'}
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: overallProgress / 100 }}
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
          ) : errorCount > 0 ? (
            <AlertCircle className="w-5 h-5 text-red-400" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-green-400" />
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
        "bg-zinc-900/95 backdrop-blur-xl border border-white/10"
      )}>
        {/* 头部概览 */}
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {activeCount > 0 ? (
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              ) : errorCount > 0 ? (
                <AlertCircle className="w-5 h-5 text-red-400" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              )}
              <div>
                <p className="text-sm font-medium text-white">
                  {processingCount > 0 
                    ? `正在处理 ${processingCount} 个文件...`
                    : uploadingCount > 0 
                      ? `正在上传 ${uploadingCount} 个文件...` 
                      : errorCount > 0 
                        ? `${errorCount} 个文件上传失败`
                        : '上传完成'}
                </p>
                {activeCount > 0 && (
                  <p className="text-xs text-white/50">{overallProgress}% 完成</p>
                )}
              </div>
            </div>
            
            {/* 折叠按钮 */}
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
              title="最小化"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
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
                      hasError ? "text-red-400" : isComplete ? "text-green-400" : isProcessing ? "text-yellow-400" : "text-white/70"
                    )}>
                      {item.file.name}
                    </p>
                    {hasError && (
                      <p className="text-[10px] text-red-400/70">{item.error}</p>
                    )}
                    {isProcessing && (
                      <p className="text-[10px] text-yellow-400/70">正在处理...</p>
                    )}
                  </div>
                  
                  {!isComplete && !hasError && !isProcessing && (
                    <span className="text-[10px] text-white/40 tabular-nums">{item.progress}%</span>
                  )}
                  
                  {isProcessing && (
                    <Loader2 className="w-3.5 h-3.5 text-yellow-400 shrink-0 animate-spin" />
                  )}
                  
                  {isComplete && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  )}
                  
                  {hasError && (
                    <button
                      onClick={() => onCancel(item.id)}
                      className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white"
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
