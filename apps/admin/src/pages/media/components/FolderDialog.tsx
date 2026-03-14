/**
 * 文件夹对话框组件
 * @ref 媒体库深度优化方案 - Phase 1
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Folder, Palette } from 'lucide-react';
import type { MediaFolder, CreateFolderRequest, UpdateFolderRequest } from '@aetherblog/types';
import { folderService } from '@/services/folderService';
import { cn } from '@aetherblog/utils';
import { toast } from 'sonner';

interface FolderDialogProps {
  open: boolean;
  onClose: () => void;
  folder?: MediaFolder; // 如果提供，则为编辑模式
  parentId?: number; // 创建时的父文件夹ID
}

const FOLDER_COLORS = [
  '#6366f1', // 靛蓝
  '#8b5cf6', // 紫色
  '#ec4899', // 粉色
  '#f59e0b', // 琥珀色
  '#10b981', // 翠绿
  '#3b82f6', // 蓝色
  '#ef4444', // 红色
  '#06b6d4', // 青色
];

export function FolderDialog({ open, onClose, folder, parentId }: FolderDialogProps) {
  const queryClient = useQueryClient();
  const isEditMode = !!folder;

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#6366f1',
  });

  useEffect(() => {
    if (folder) {
      setFormData({
        name: folder.name,
        description: folder.description || '',
        color: folder.color,
      });
    } else {
      setFormData({
        name: '',
        description: '',
        color: '#6366f1',
      });
    }
  }, [folder, open]);

  // 创建文件夹
  const createMutation = useMutation({
    mutationFn: (data: CreateFolderRequest) => folderService.create(data),
    onSuccess: (response) => {
      // 刷新文件夹树
      queryClient.invalidateQueries({ queryKey: ['folders', 'tree'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      toast.success(`文件夹 "${response.data.name}" 创建成功`);
      onClose();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || '创建文件夹失败');
    },
  });

  // 更新文件夹
  const updateMutation = useMutation({
    mutationFn: (data: UpdateFolderRequest) => folderService.update(folder!.id, data),
    onSuccess: (response) => {
      // 刷新文件夹树
      queryClient.invalidateQueries({ queryKey: ['folders', 'tree'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      toast.success(`文件夹 "${response.data.name}" 更新成功`);
      onClose();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || '更新文件夹失败');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isEditMode) {
      updateMutation.mutate({
        name: formData.name,
        description: formData.description,
        color: formData.color,
      });
    } else {
      createMutation.mutate({
        name: formData.name,
        description: formData.description,
        parentId,
      });
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* 对话框 */}
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-md bg-white border border-[var(--border-default)] dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* 内容 */}
              <div className="relative z-10">
                {/* 头部 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] dark:border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-lighter dark:bg-primary/20 rounded-lg">
                      <Folder className="w-5 h-5 text-primary dark:text-primary" />
                    </div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] dark:text-white">
                      {isEditMode ? '编辑文件夹' : '新建文件夹'}
                    </h2>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-[var(--bg-secondary)] dark:hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-[var(--text-muted)]" />
                  </button>
                </div>

                {/* 表单 */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                  {/* 文件夹名称 */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] dark:text-[var(--text-tertiary)] mb-2">
                      文件夹名称 *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="输入文件夹名称"
                      required
                      maxLength={100}
                      className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] dark:text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                  </div>

                  {/* 描述 */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] dark:text-[var(--text-tertiary)] mb-2">
                      描述 (可选)
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="输入文件夹描述"
                      rows={3}
                      maxLength={500}
                      className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] dark:text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all resize-none"
                    />
                  </div>

                  {/* 颜色选择 */}
                  {isEditMode && (
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-secondary)] dark:text-[var(--text-tertiary)] mb-3">
                        <div className="flex items-center gap-2">
                          <Palette className="w-4 h-4" />
                          <span>文件夹颜色</span>
                        </div>
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        {FOLDER_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setFormData({ ...formData, color })}
                            className={cn(
                              'w-10 h-10 rounded-lg transition-all',
                              formData.color === color
                                ? 'ring-2 ring-primary ring-offset-2 ring-offset-white dark:ring-offset-[var(--bg-primary)] scale-110'
                                : 'hover:scale-105'
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 按钮 */}
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 px-4 py-2.5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] dark:hover:bg-[var(--bg-tertiary)] border border-[var(--border-default)] rounded-lg text-[var(--text-secondary)] dark:text-[var(--text-tertiary)] font-medium transition-colors"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading || !formData.name.trim()}
                      className="flex-1 px-4 py-2.5 bg-gradient-to-r from-primary to-accent hover:from-primary hover:to-accent disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-all shadow-lg shadow-primary/25"
                    >
                      {isLoading ? '保存中...' : isEditMode ? '保存' : '创建'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
