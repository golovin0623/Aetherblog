/**
 * @file TrashDialog.tsx
 * @description 回收站对话框组件
 * @ref 媒体库深度优化方案 - 回收站功能
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trash2,
  RotateCcw,
  X,
  AlertTriangle,
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  FileText,
  File,
  Loader2,
  Check,
  RefreshCw,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { mediaService, getMediaUrl } from '@/services/mediaService';
import { toast } from 'sonner';
import { formatFileSize, formatRelativeTime } from '@aetherblog/utils';

interface TrashDialogProps {
  open: boolean;
  onClose: () => void;
}

const getFileIcon = (fileType: string) => {
  switch (fileType) {
    case 'IMAGE':
      return ImageIcon;
    case 'VIDEO':
      return VideoIcon;
    case 'AUDIO':
      return MusicIcon;
    case 'DOCUMENT':
      return FileText;
    default:
      return File;
  }
};

export function TrashDialog({ open, onClose }: TrashDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  // 获取回收站列表
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['media', 'trash', page],
    queryFn: async () => {
      const res = await mediaService.getTrashList({ pageNum: page, pageSize: 20 });
      return res.data;
    },
    enabled: open,
  });

  const trashItems = data?.list || [];
  const totalItems = data?.total || 0;

  // 恢复单个文件
  const restoreMutation = useMutation({
    mutationFn: (id: number) => mediaService.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      toast.success('文件已恢复');
    },
    onError: () => {
      toast.error('恢复失败');
    },
  });

  // 批量恢复
  const batchRestoreMutation = useMutation({
    mutationFn: (ids: number[]) => mediaService.batchRestore(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      setSelectedIds(new Set());
      toast.success('批量恢复成功');
    },
    onError: () => {
      toast.error('批量恢复失败');
    },
  });

  // 彻底删除单个文件
  const permanentDeleteMutation = useMutation({
    mutationFn: (id: number) => mediaService.permanentDelete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      toast.success('文件已彻底删除');
    },
    onError: () => {
      toast.error('删除失败');
    },
  });

  // 批量彻底删除
  const batchPermanentDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => mediaService.batchPermanentDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      setSelectedIds(new Set());
      toast.success('批量删除成功');
    },
    onError: () => {
      toast.error('批量删除失败');
    },
  });

  // 清空回收站
  const emptyTrashMutation = useMutation({
    mutationFn: () => mediaService.emptyTrash(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      setSelectedIds(new Set());
      toast.success('回收站已清空');
    },
    onError: () => {
      toast.error('清空失败');
    },
  });

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === trashItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(trashItems.map((item: any) => item.id)));
    }
  }, [selectedIds.size, trashItems]);

  const handlePermanentDelete = (id: number) => {
    toast.custom((t) => (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl p-4 shadow-2xl w-80">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-red-100 dark:bg-red-500/10 rounded-lg shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">彻底删除？</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              此操作无法撤销，文件将被永久删除。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toast.dismiss(t)}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  permanentDeleteMutation.mutate(id);
                  toast.dismiss(t);
                }}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      </div>
    ), { duration: 5000 });
  };

  const handleEmptyTrash = () => {
    toast.custom((t) => (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl p-4 shadow-2xl w-80">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-red-100 dark:bg-red-500/10 rounded-lg shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">清空回收站？</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              此操作将永久删除回收站中的所有 {totalItems} 个文件，无法撤销。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toast.dismiss(t)}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  emptyTrashMutation.mutate();
                  toast.dismiss(t);
                }}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
              >
                清空回收站
              </button>
            </div>
          </div>
        </div>
      </div>
    ), { duration: 5000 });
  };

  const handleBatchPermanentDelete = () => {
    const count = selectedIds.size;
    const ids = Array.from(selectedIds);
    toast.custom((t) => (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl p-4 shadow-2xl w-80">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-red-100 dark:bg-red-500/10 rounded-lg shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">批量彻底删除？</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              确定要永久删除选中的 {count} 个文件吗？此操作无法撤销。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toast.dismiss(t)}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  batchPermanentDeleteMutation.mutate(ids);
                  toast.dismiss(t);
                }}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      </div>
    ), { duration: 5000 });
  };

  if (!open) return null;

  const content = (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 lg:p-8">
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* 对话框 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="relative w-full max-w-[900px] h-full max-h-[700px] flex flex-col bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-white/10 shadow-2xl overflow-hidden"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 dark:bg-red-500/10 rounded-lg">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">回收站</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {totalItems} 个文件 · 120天后自动清理
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => refetch()}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors text-gray-500 dark:text-gray-400"
                  title="刷新"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors text-gray-500 dark:text-gray-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 工具栏 */}
            {trashItems.length > 0 && (
              <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-white/10 shrink-0 bg-gray-50 dark:bg-white/5">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === trashItems.length && trashItems.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : '全选'}
                    </span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  {selectedIds.size > 0 && (
                    <>
                      <button
                        onClick={() => batchRestoreMutation.mutate(Array.from(selectedIds))}
                        disabled={batchRestoreMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-500/10 hover:bg-green-200 dark:hover:bg-green-500/20 rounded-lg transition-colors"
                      >
                        {batchRestoreMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5" />
                        )}
                        批量恢复
                      </button>
                      <button
                        onClick={handleBatchPermanentDelete}
                        disabled={batchPermanentDeleteMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/10 hover:bg-red-200 dark:hover:bg-red-500/20 rounded-lg transition-colors"
                      >
                        {batchPermanentDeleteMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        批量删除
                      </button>
                    </>
                  )}
                  <button
                    onClick={handleEmptyTrash}
                    disabled={emptyTrashMutation.isPending || totalItems === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                  >
                    {emptyTrashMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    清空回收站
                  </button>
                </div>
              </div>
            )}

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              {isLoading ? (
                <div className="flex items-center justify-center h-full min-h-[200px]">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : trashItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-gray-500 dark:text-gray-400">
                  <Trash2 className="w-16 h-16 mb-4 opacity-30" />
                  <p className="text-base font-medium">回收站是空的</p>
                  <p className="text-sm mt-1 opacity-70">删除的文件将在这里显示</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {trashItems.map((item: any) => {
                    const Icon = getFileIcon(item.fileType);
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'flex items-center gap-4 p-3 rounded-xl border transition-all',
                          isSelected
                            ? 'bg-primary/5 border-primary/30'
                            : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10'
                        )}
                      >
                        {/* 选择框 */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-primary shrink-0"
                        />

                        {/* 缩略图/图标 */}
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-200 dark:bg-white/10 shrink-0 flex items-center justify-center">
                          {item.fileType === 'IMAGE' ? (
                            <img
                              src={getMediaUrl(item.fileUrl)}
                              alt={item.originalName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Icon className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                          )}
                        </div>

                        {/* 文件信息 */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {item.originalName}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {formatFileSize(item.fileSize)} · 删除于 {formatRelativeTime(item.deletedAt || item.createdAt)}
                          </p>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => restoreMutation.mutate(item.id)}
                            disabled={restoreMutation.isPending}
                            className="p-2 hover:bg-green-100 dark:hover:bg-green-500/20 rounded-lg transition-colors text-green-600 dark:text-green-400"
                            title="恢复"
                          >
                            {restoreMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handlePermanentDelete(item.id)}
                            disabled={permanentDeleteMutation.isPending}
                            className="p-2 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-lg transition-colors text-red-500"
                            title="彻底删除"
                          >
                            {permanentDeleteMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 分页 */}
            {data && data.total > 20 && (
              <div className="flex items-center justify-center gap-2 px-6 py-4 border-t border-gray-200 dark:border-white/10 shrink-0">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  上一页
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {page} / {Math.ceil(data.total / 20)}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= Math.ceil(data.total / 20)}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  下一页
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
