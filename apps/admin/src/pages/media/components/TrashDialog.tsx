/**
 * @文件TrashDialog.tsx
 * @description 回收站对话框组件
 * @ref 媒体库深度优化方案 - 回收站功能
 */

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trash2,
  RotateCcw,
  X,
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
import { ConfirmModal } from '@aetherblog/ui';
import { toast } from 'sonner';
import { formatFileSize, formatRelativeTime } from '@aetherblog/utils';
import { DeleteMediaConfirmModal } from '@/components/media/DeleteMediaConfirmModal';
import { AdminPagination } from '@/components/common/AdminPagination';

interface TrashDialogProps {
  open: boolean;
  onClose: () => void;
}

type TrashConfirm =
  | { kind: 'permanent-delete'; id: number }
  | { kind: 'empty-trash' }
  | { kind: 'batch-permanent-delete'; ids: number[] };

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
  const [pendingConfirm, setPendingConfirm] = useState<TrashConfirm | null>(null);
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

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setPendingConfirm(null);
      return;
    }

    setPage(1);
    queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
    queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
  }, [open, queryClient]);

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

  // 彻底删除单个文件 — Phase 3: 接受 deleteCloud 选项
  const permanentDeleteMutation = useMutation({
    mutationFn: ({ id, deleteCloud }: { id: number; deleteCloud: boolean }) =>
      mediaService.permanentDelete(id, { deleteCloud }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      toast.success('文件已彻底删除');
    },
    onError: () => {
      toast.error('删除失败');
    },
  });

  // 批量彻底删除 — Phase 3: 接受 deleteCloud 选项;部分失败时提示 failedIds
  const batchPermanentDeleteMutation = useMutation({
    mutationFn: ({ ids, deleteCloud }: { ids: number[]; deleteCloud: boolean }) =>
      mediaService.batchPermanentDelete(ids, { deleteCloud }),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['media', 'trash'] });
      queryClient.invalidateQueries({ queryKey: ['media', 'trash', 'count'] });
      setSelectedIds(new Set());
      const failedIds = (resp?.data as { failedIds?: number[] } | undefined)?.failedIds;
      if (failedIds && failedIds.length > 0) {
        toast.warning(`已清 catalog,但 ${failedIds.length} 个文件后端删除失败 (id: ${failedIds.join(', ')}),建议手动检查云端`);
      } else {
        toast.success('批量删除成功');
      }
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
    setPendingConfirm({ kind: 'permanent-delete', id });
  };

  const handleEmptyTrash = () => {
    setPendingConfirm({ kind: 'empty-trash' });
  };

  const handleBatchPermanentDelete = () => {
    setPendingConfirm({ kind: 'batch-permanent-delete', ids: Array.from(selectedIds) });
  };

  const confirmCopy = (() => {
    if (!pendingConfirm) return { title: '', message: '', confirmText: '确认' };
    if (pendingConfirm.kind === 'permanent-delete') {
      return { title: '彻底删除？', message: '此操作无法撤销，文件将被永久删除。', confirmText: '确认删除' };
    }
    if (pendingConfirm.kind === 'empty-trash') {
      return {
        title: '清空回收站？',
        message: `此操作将永久删除回收站中的所有 ${totalItems} 个文件，无法撤销。`,
        confirmText: '清空回收站',
      };
    }
    return {
      title: '批量彻底删除？',
      message: `确定要永久删除选中的 ${pendingConfirm.ids.length} 个文件吗？此操作无法撤销。`,
      confirmText: '确认删除',
    };
  })();

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
            className="surface-overlay relative w-full max-w-[900px] h-full max-h-[700px] flex flex-col !rounded-2xl overflow-hidden"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] dark:border-white/10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-status-danger-light dark:bg-status-danger-light rounded-lg">
                  <Trash2 className="w-5 h-5 text-status-danger" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)] dark:text-white">回收站</h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    {totalItems} 个文件 · 120天后自动清理
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => refetch()}
                  className="p-2 hover:bg-[var(--bg-secondary)] dark:hover:bg-white/10 rounded-lg transition-colors text-[var(--text-muted)]"
                  title="刷新"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-[var(--bg-secondary)] dark:hover:bg-white/10 rounded-lg transition-colors text-[var(--text-muted)]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 工具栏 */}
            {trashItems.length > 0 && (
              <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-default)] dark:border-white/10 shrink-0 bg-[var(--bg-secondary)] dark:bg-white/5">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === trashItems.length && trashItems.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 rounded border-[var(--border-default)] text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-tertiary)]">
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
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-status-success bg-status-success-light dark:bg-status-success-light hover:bg-status-success/20 dark:hover:bg-status-success/20 rounded-lg transition-colors"
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
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-status-danger bg-status-danger-light dark:bg-status-danger-light hover:bg-status-danger/20 dark:hover:bg-status-danger/20 rounded-lg transition-colors"
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
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-status-danger hover:bg-status-danger disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
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
                <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-[var(--text-muted)]">
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
                            : 'surface-leaf hover:bg-[var(--bg-card-hover)]'
                        )}
                      >
                        {/* 选择框 */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          className="w-4 h-4 rounded border-[var(--border-default)] text-primary focus:ring-primary shrink-0"
                        />

                        {/* 缩略图/图标 —— 默认底层显示 file-type icon；图片加载成功时覆盖；失败回退 icon */}
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--bg-tertiary)] dark:bg-white/10 shrink-0 flex items-center justify-center relative">
                          <Icon className="w-6 h-6 text-[var(--text-muted)]" />
                          {item.fileType === 'IMAGE' && (
                            <img
                              src={getMediaUrl(item)}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                        </div>

                        {/* 文件信息 */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)] dark:text-white truncate">
                            {item.originalName}
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {formatFileSize(item.fileSize)} · 删除于 {formatRelativeTime(item.deletedAt || item.createdAt)}
                          </p>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => restoreMutation.mutate(item.id)}
                            disabled={restoreMutation.isPending}
                            className="p-2 hover:bg-status-success-light dark:hover:bg-status-success/20 rounded-lg transition-colors text-status-success"
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
                            className="p-2 hover:bg-status-danger-light dark:hover:bg-status-danger/20 rounded-lg transition-colors text-status-danger"
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
              <AdminPagination
                page={page}
                total={data.total}
                totalPages={Math.ceil(data.total / 20)}
                pageSize={20}
                onPageChange={setPage}
                itemLabel="个"
                className="shrink-0"
              />
            )}
          </motion.div>
        </div>
      )}

      {/* 永久删除/批量删除走新的 DeleteMediaConfirmModal,带 deleteCloud 选项 */}
      {pendingConfirm && pendingConfirm.kind !== 'empty-trash' && (
        <DeleteMediaConfirmModal
          isOpen
          title={confirmCopy.title}
          message={confirmCopy.message}
          itemCount={pendingConfirm.kind === 'permanent-delete' ? 1 : pendingConfirm.ids.length}
          zIndex={10000}
          hasCloudItems={(() => {
            if (pendingConfirm.kind === 'permanent-delete') {
              const item = trashItems.find((m: { id: number }) => m.id === pendingConfirm.id);
              return !!item && (item as { storageType?: string }).storageType !== 'LOCAL';
            }
            return pendingConfirm.ids.some((id) => {
              const item = trashItems.find((m: { id: number }) => m.id === id);
              return !!item && (item as { storageType?: string }).storageType !== 'LOCAL';
            });
          })()}
          hasBackup={false}
          onConfirm={({ deleteCloud }) => {
            if (pendingConfirm.kind === 'permanent-delete') {
              permanentDeleteMutation.mutate({ id: pendingConfirm.id, deleteCloud });
            } else {
              batchPermanentDeleteMutation.mutate({ ids: pendingConfirm.ids, deleteCloud });
            }
            setPendingConfirm(null);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {/* 清空回收站仍走 ConfirmModal — 它没有"是否清云端"的二元选择,
          因为后端 EmptyTrash 已经默认连云一起删(整批分组按 provider 清干净),
          要保留云端原件得先把对应文件 restore 出回收站再操作 */}
      <ConfirmModal
        isOpen={!!pendingConfirm && pendingConfirm.kind === 'empty-trash'}
        variant="danger"
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmText={confirmCopy.confirmText}
        cancelText="取消"
        zIndex={10000}
        onConfirm={() => {
          emptyTrashMutation.mutate();
          setPendingConfirm(null);
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
