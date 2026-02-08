/**
 * 移动对话框组件
 * @ref 媒体库深度优化方案 - Phase 1: 文件夹层级管理
 *
 * 用于选择目标文件夹，移动文件或文件夹
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Folder, FolderOpen, ChevronRight, Move, Check } from 'lucide-react';
import { Button } from '@aetherblog/ui';
import { folderService } from '@/services/folderService';
import { mediaService } from '@/services/mediaService';
import type { FolderTreeNode } from '@aetherblog/types';
import { cn } from '@aetherblog/utils';
import { toast } from 'sonner';

interface MoveDialogProps {
  open: boolean;
  onClose: () => void;
  /** 移动的类型：文件或文件夹 */
  type: 'file' | 'folder';
  /** 要移动的 ID (单个移动时使用) */
  itemId: number;
  /** 要移动的名称 (显示用) */
  itemName: string;
  /** 当前所在文件夹 ID (排除选项) */
  currentFolderId?: number;
  /** 批量移动的文件 ID 列表 (批量移动时使用) */
  batchFileIds?: number[];
  /** 批量移动成功后的回调 */
  onBatchMoveSuccess?: () => void;
}

export function MoveDialog({
  open,
  onClose,
  type,
  itemId,
  itemName,
  currentFolderId,
  batchFileIds,
  onBatchMoveSuccess,
}: MoveDialogProps) {
  const queryClient = useQueryClient();
  const [selectedFolderId, setSelectedFolderId] = useState<number | undefined>(undefined);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // 获取文件夹树
  const { data: response, isLoading } = useQuery({
    queryKey: ['folders', 'tree'],
    queryFn: () => folderService.getTree(),
    enabled: open,
  });

  const folders = response?.data || [];

  // 移动文件夹
  const moveFolderMutation = useMutation({
    mutationFn: ({ folderId, targetParentId }: { folderId: number; targetParentId?: number }) =>
      folderService.move(folderId, { targetParentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      toast.success('移动成功');
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '移动失败');
    },
  });

  // 移动文件
  const moveFileMutation = useMutation({
    mutationFn: ({ fileId, folderId }: { fileId: number; folderId?: number }) =>
      mediaService.moveToFolder(fileId, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      toast.success('移动成功');
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '移动失败');
    },
  });

  // 批量移动文件
  const batchMoveFileMutation = useMutation({
    mutationFn: ({ fileIds, folderId }: { fileIds: number[]; folderId?: number }) =>
      mediaService.batchMoveToFolder(fileIds, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      toast.success(`成功移动 ${batchFileIds?.length || 0} 个文件`);
      onBatchMoveSuccess?.();
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.msg || '批量移动失败');
    },
  });

  const isPending = moveFolderMutation.isPending || moveFileMutation.isPending || batchMoveFileMutation.isPending;

  // 判断是否是批量移动模式
  const isBatchMode = batchFileIds && batchFileIds.length > 0;

  // 判断是否是被移动文件夹的子文件夹
  const isDescendantOf = useMemo(() => {
    if (type !== 'folder') return () => false;

    const findFolder = (items: FolderTreeNode[], targetId: number): FolderTreeNode | null => {
      for (const item of items) {
        if (item.id === targetId) return item;
        if (item.children?.length) {
          const found = findFolder(item.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };

    const sourceFolder = findFolder(folders, itemId);
    if (!sourceFolder) return () => false;

    const collectDescendantIds = (node: FolderTreeNode): Set<number> => {
      const ids = new Set<number>([node.id]);
      node.children?.forEach((child) => {
        collectDescendantIds(child).forEach((id) => ids.add(id));
      });
      return ids;
    };

    const descendantIds = collectDescendantIds(sourceFolder);
    return (folderId: number) => descendantIds.has(folderId);
  }, [type, itemId, folders]);

  const handleConfirm = () => {
    // 批量移动模式
    if (isBatchMode) {
      batchMoveFileMutation.mutate({
        fileIds: batchFileIds!,
        folderId: selectedFolderId,
      });
      return;
    }

    // 单个移动模式
    if (type === 'folder') {
      moveFolderMutation.mutate({
        folderId: itemId,
        targetParentId: selectedFolderId,
      });
    } else {
      moveFileMutation.mutate({
        fileId: itemId,
        folderId: selectedFolderId,
      });
    }
  };

  const toggleExpanded = (folderId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const renderFolderNode = (folder: FolderTreeNode, depth: number = 0) => {
    const isExpanded = expandedIds.has(folder.id);
    const hasChildren = folder.children && folder.children.length > 0;
    const isDisabled = isDescendantOf(folder.id) || folder.id === itemId;
    const isSelected = selectedFolderId === folder.id;
    const isCurrent = folder.id === currentFolderId;

    return (
      <div key={folder.id}>
        <button
          onClick={() => {
            if (!isDisabled && !isCurrent) {
              setSelectedFolderId(folder.id);
            }
          }}
          disabled={isDisabled || isCurrent}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all',
            isDisabled || isCurrent
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:bg-gray-100 dark:hover:bg-white/10',
            isSelected && 'bg-indigo-50 dark:bg-primary/20 border border-indigo-300 dark:border-primary/40'
          )}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
        >
          {/* 展开/折叠 */}
          {hasChildren ? (
            <motion.div
              animate={{ rotate: isExpanded ? 90 : 0 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(folder.id);
              }}
              className="flex-shrink-0 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            </motion.div>
          ) : (
            <div className="w-4" />
          )}

          {/* 图标 */}
          {isExpanded && hasChildren ? (
            <FolderOpen className="w-5 h-5 flex-shrink-0" style={{ color: folder.color }} />
          ) : (
            <Folder className="w-5 h-5 flex-shrink-0" style={{ color: folder.color }} />
          )}

          {/* 名称 */}
          <span className="flex-1 text-sm text-gray-900 dark:text-white truncate">
            {folder.name}
          </span>

          {/* 标记 */}
          {isCurrent && (
            <span className="text-xs text-gray-400 dark:text-gray-500">当前位置</span>
          )}
          {isSelected && (
            <Check className="w-4 h-4 text-indigo-600 dark:text-primary" />
          )}
        </button>

        {/* 子文件夹 */}
        <AnimatePresence>
          {isExpanded && hasChildren && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
            >
              {folder.children.map((child) => renderFolderNode(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 dark:bg-primary/10 rounded-lg">
                <Move className="w-5 h-5 text-indigo-600 dark:text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  {isBatchMode ? '批量移动文件' : `移动${type === 'folder' ? '文件夹' : '文件'}`}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                  {isBatchMode ? `已选择 ${batchFileIds?.length} 个文件` : itemName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 文件夹选择区 */}
          <div className="flex-1 overflow-y-auto border border-gray-200 dark:border-white/10 rounded-xl p-2 mb-4 bg-gray-50 dark:bg-black/20">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <span className="text-gray-500 dark:text-gray-400">加载中...</span>
              </div>
            ) : (
              <div className="space-y-1">
                {/* 根目录选项 */}
                <button
                  onClick={() => setSelectedFolderId(undefined)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all',
                    'hover:bg-gray-100 dark:hover:bg-white/10',
                    selectedFolderId === undefined && 'bg-indigo-50 dark:bg-primary/20 border border-indigo-300 dark:border-primary/40'
                  )}
                >
                  <div className="w-4" />
                  <Folder className="w-5 h-5 text-indigo-500" />
                  <span className="flex-1 text-sm text-gray-900 dark:text-white">根目录</span>
                  {selectedFolderId === undefined && (
                    <Check className="w-4 h-4 text-indigo-600 dark:text-primary" />
                  )}
                </button>

                {/* 文件夹树 */}
                {folders.map((folder) => renderFolderNode(folder))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleConfirm}
              disabled={isPending}
              className="flex-1 gap-2"
            >
              <Move className="w-4 h-4" />
              {isPending ? '移动中...' : '确认移动'}
            </Button>
            <Button onClick={onClose} variant="secondary" className="flex-1">
              取消
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
