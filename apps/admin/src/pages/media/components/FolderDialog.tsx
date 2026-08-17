/**
 * 文件夹对话框组件（新建 / 编辑）
 * @ref 媒体库深度优化方案 - Phase 1
 * @ref .claude/design-system/02-surfaces.md · 05-components.md「Modal」
 *
 * Aether Codex 迁移说明（原实现是整块 legacy token，视觉事故的直接成因）:
 *   旧版弹窗底色写的是 `bg-[var(--bg-card)]`。`--bg-card` 在亮主题下是
 *   `rgba(0,0,0,0.02)` —— 它是设计给"叠在 --bg-primary 上的一层 2% 压深"用的，
 *   **不是一个实底**。当成 Modal 背景用，就等于弹窗几乎全透明，底下的
 *   `bg-black/50` 遮罩直接透上来变成一片灰；再叠上按亮主题取色的
 *   `--text-primary`(#0f172a 近黑) 标签与 `--bg-secondary`(#F4F2EC 米色) 输入框，
 *   于是就有了"弹窗和主题没适配、字看不清"的截图。
 *
 * 现在改用 `.surface-overlay`（四层玻璃体系里的弹层，自带实底 + 强模糊 + 极光边），
 * 文字/边框全部走 `--ink-*`，输入框走 `--bg-substrate`。token 通过 `:root.light`
 * 自动翻转，因此**不写任何 `dark:` 变体**（Codex 硬规则 #5）。
 */

import { useState, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Folder, Palette } from 'lucide-react';
import type { MediaFolder, CreateFolderRequest, UpdateFolderRequest } from '@aetherblog/types';
import { spring, transition } from '@aetherblog/ui';
import { folderService } from '@/services/folderService';
import { cn } from '@aetherblog/utils';
import { acquireOverlayScrollLock } from '@/lib/overlayScrollLock';
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

/** 表单标签:font-mono + 全大写 + 宽字距（Codex 排版阶梯的 label 档）。 */
const LABEL_CLASS =
  'block font-mono text-[length:var(--fs-micro)] uppercase tracking-[0.2em] text-[var(--ink-muted)]';

/**
 * 独立输入框（没有外壳、控件自己承担描边与底色）——按规范**不加** `data-field`，
 * 保留全局 `*:focus-visible` 焦点环即可。圆角取 `--radius-sm` 与该焦点环对齐，
 * 避免聚焦时出现"方框里套圆角环"的错位。
 */
const FIELD_CLASS = cn(
  'w-full rounded-[var(--radius-sm)] border px-4 py-2.5',
  'border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)]',
  'bg-[var(--bg-substrate)] text-[length:var(--fs-caption)] text-[var(--ink-primary)]',
  'placeholder:text-[var(--ink-muted)]',
  'transition-colors duration-200',
  'hover:border-[color-mix(in_oklch,var(--ink-primary)_20%,transparent)]',
  'focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
);

export function FolderDialog({ open, onClose, folder, parentId }: FolderDialogProps) {
  const queryClient = useQueryClient();
  const isEditMode = !!folder;
  const prefersReducedMotion = useReducedMotion();
  const titleId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);

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

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // 打开时锁滚动 —— 否则弹窗后面的媒体网格会跟着滚轮一起动。
  useLayoutEffect(() => {
    if (!open) return;
    return acquireOverlayScrollLock();
  }, [open]);

  // Esc 关闭 + 打开即聚焦名称输入框（新建文件夹的唯一必填项）。
  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

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

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4">
          {/* 背景遮罩 */}
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : transition.quick}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />

          {/* 对话框 */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
            transition={prefersReducedMotion ? { duration: 0 } : spring.soft}
            className="surface-overlay relative w-full max-w-md overflow-hidden"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] px-6 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]">
                  <Folder className="h-4.5 w-4.5 text-[var(--aurora-1)]" />
                </div>
                <h2
                  id={titleId}
                  className="font-display truncate text-[length:var(--fs-lede)] font-semibold text-[var(--ink-primary)]"
                >
                  {isEditMode ? '编辑文件夹' : '新建文件夹'}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭对话框"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] transition-colors duration-200 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 表单 */}
            <form onSubmit={handleSubmit} className="space-y-5 p-6">
              {/* 文件夹名称 */}
              <div className="space-y-2">
                <label htmlFor={`${titleId}-name`} className={LABEL_CLASS}>
                  文件夹名称 <span className="text-[var(--signal-danger)]">*</span>
                </label>
                <input
                  id={`${titleId}-name`}
                  ref={nameInputRef}
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="输入文件夹名称"
                  required
                  maxLength={100}
                  className={FIELD_CLASS}
                />
              </div>

              {/* 描述 */}
              <div className="space-y-2">
                <label htmlFor={`${titleId}-desc`} className={LABEL_CLASS}>
                  描述 (可选)
                </label>
                <textarea
                  id={`${titleId}-desc`}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="输入文件夹描述"
                  rows={3}
                  maxLength={500}
                  className={cn(FIELD_CLASS, 'resize-none')}
                />
              </div>

              {/* 颜色选择 */}
              {isEditMode && (
                <div className="space-y-3">
                  <span className={cn(LABEL_CLASS, 'flex items-center gap-2')}>
                    <Palette className="h-3.5 w-3.5" />
                    文件夹颜色
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {FOLDER_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`选择颜色 ${color}`}
                        aria-pressed={formData.color === color}
                        onClick={() => setFormData({ ...formData, color })}
                        className={cn(
                          'h-10 w-10 rounded-[var(--radius-sm)] transition-transform duration-200',
                          formData.color === color
                            ? 'scale-110 ring-2 ring-[var(--aurora-1)] ring-offset-2 ring-offset-[var(--bg-raised)]'
                            : 'hover:scale-105'
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 按钮 */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <motion.button
                  type="button"
                  onClick={onClose}
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                  transition={spring.precise}
                  className="min-h-11 rounded-[var(--radius-sm)] border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-[var(--bg-leaf)] text-[length:var(--fs-caption)] font-medium text-[var(--ink-secondary)] transition-colors duration-200 hover:border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] hover:text-[var(--ink-primary)]"
                >
                  取消
                </motion.button>
                <motion.button
                  type="submit"
                  disabled={isLoading || !formData.name.trim()}
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                  transition={spring.precise}
                  className="min-h-11 rounded-[var(--radius-sm)] bg-[var(--ink-primary)] text-[length:var(--fs-caption)] font-semibold text-[var(--bg-void)] transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isLoading ? '保存中...' : isEditMode ? '保存' : '创建'}
                </motion.button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
