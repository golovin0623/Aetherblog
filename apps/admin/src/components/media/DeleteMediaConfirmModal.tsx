/**
 * @file DeleteMediaConfirmModal.tsx
 * @description 永久删除媒体文件确认对话框 — 带"是否同时清云端"选项
 * @ref 对象存储 rollout - Phase 3
 *
 * 与现有 ConfirmDialog 的区别:
 *   - 永久删除是双重操作 (DB 行 + 后端文件),需要让 admin 显式选择是否两者一起删。
 *   - 默认勾选"删除存储后端" — 大多数场景就是要彻底干净;若 admin 想"先抢救云端原件
 *     再清 catalog",可以把勾去掉。
 */

import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, X, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface DeleteMediaConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  itemCount: number;
  /** 当前选中文件是否有任意一个落在云端 (LOCAL 之外);决定是否显示"删除存储后端"复选框 */
  hasCloudItems: boolean;
  /** 是否有备份(Phase 4 启用后才有意义) */
  hasBackup: boolean;
  onConfirm: (options: { deleteCloud: boolean; deleteBackup: boolean }) => void;
  onCancel: () => void;
}

export function DeleteMediaConfirmModal({
  isOpen,
  title,
  message,
  itemCount,
  hasCloudItems,
  hasBackup,
  onConfirm,
  onCancel,
}: DeleteMediaConfirmModalProps) {
  const [deleteCloud, setDeleteCloud] = useState(true);
  const [deleteBackup, setDeleteBackup] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDeleteCloud(true);
      setDeleteBackup(false);
    }
  }, [isOpen]);

  const content = (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            className="relative w-full max-w-md"
          >
            <div className="relative overflow-hidden surface-overlay">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-overlay)] to-transparent pointer-events-none" />
              <button
                onClick={onCancel}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors z-10"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="relative p-6">
                <div className="flex items-start gap-4">
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', delay: 0.1, duration: 0.4, bounce: 0.4 }}
                    className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-status-danger/20 to-status-danger/10 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                  >
                    <Trash2 className="w-6 h-6 text-status-danger" />
                  </motion.div>
                  <div className="flex-1 pt-1">
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
                    <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
                      {message}
                    </p>
                  </div>
                </div>

                {/* 删除选项 */}
                <div className="mt-5 space-y-2 p-3 rounded-xl bg-[var(--bg-secondary)]/40 border border-[var(--border-subtle)]">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-1">删除选项</p>

                  <label className={cn(
                    'flex items-start gap-2.5 p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-[var(--bg-card-hover)]/40',
                    !hasCloudItems && 'opacity-60'
                  )}>
                    <input
                      type="checkbox"
                      checked={deleteCloud}
                      onChange={(e) => setDeleteCloud(e.target.checked)}
                      disabled={!hasCloudItems}
                      className="w-4 h-4 mt-0.5 rounded border-[var(--border-default)] bg-transparent text-primary focus:ring-primary/30"
                    />
                    <div className="flex-1">
                      <p className="text-sm text-[var(--text-primary)] font-medium">
                        同时删除主存储后端文件
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                        {hasCloudItems
                          ? '取消勾选可保留原始 key — 后续可手动从云端控制台找回'
                          : '本批次全部为本地文件 (LOCAL),将自动删除磁盘文件'}
                      </p>
                    </div>
                  </label>

                  {hasBackup && (
                    <label className="flex items-start gap-2.5 p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-[var(--bg-card-hover)]/40">
                      <input
                        type="checkbox"
                        checked={deleteBackup}
                        onChange={(e) => setDeleteBackup(e.target.checked)}
                        className="w-4 h-4 mt-0.5 rounded border-[var(--border-default)] bg-transparent text-primary focus:ring-primary/30"
                      />
                      <div className="flex-1">
                        <p className="text-sm text-[var(--text-primary)] font-medium">
                          同时删除关联的云端备份
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                          会清掉备份 provider 上的镜像 key (Phase 4 同步备份机制下的产物)
                        </p>
                      </div>
                    </label>
                  )}
                </div>

                {/* 警告条 */}
                <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-status-warning/8 border border-status-warning/30">
                  <AlertTriangle className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    本次操作不可撤销 — 共 <strong className="text-[var(--text-primary)]">{itemCount}</strong> 个文件将被永久删除。
                  </p>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onCancel}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-all duration-200"
                  >
                    取消
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => onConfirm({ deleteCloud, deleteBackup })}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-status-danger to-status-danger shadow-lg shadow-status-danger/25 transition-all duration-200"
                  >
                    永久删除
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

export default DeleteMediaConfirmModal;
