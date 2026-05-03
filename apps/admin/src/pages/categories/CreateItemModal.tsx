import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Folder, Tag as TagIcon } from 'lucide-react';
import { spring, transition } from '@aetherblog/ui';
import { cn } from '@/lib/utils';

interface CreateItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description?: string }) => Promise<void>;
  type: 'category' | 'tag';
  loading?: boolean;
  /** 编辑模式下的初始值;不传或 null 表示创建 */
  initial?: { name: string; description?: string } | null;
}

export function CreateItemModal({
  isOpen,
  onClose,
  onSubmit,
  type,
  loading = false,
  initial = null,
}: CreateItemModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setName(initial?.name ?? '');
      setDescription(initial?.description ?? '');
      setTimeout(() => inputRef.current?.focus(), 120);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, initial]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || loading) return;
    await onSubmit({
      name: name.trim(),
      description: type === 'category' ? description.trim() : undefined,
    });
  };

  const isCategory = type === 'category';
  const isEdit = !!initial;
  const Icon = isCategory ? Folder : TagIcon;
  const title = isEdit
    ? isCategory ? '编辑分类' : '编辑标签'
    : isCategory ? '新建分类' : '新建标签';
  const eyebrow = isEdit ? 'EDIT · TAXONOMY' : 'CREATE · TAXONOMY';
  const submitLabel = isEdit ? '保存' : '创建';
  const submitLoadingLabel = isEdit ? '保存中…' : '创建中…';

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition.quick}
            className="absolute inset-0 bg-[rgb(from_var(--bg-void)_r_g_b/0.72)] backdrop-blur-md"
            onClick={() => !loading && onClose()}
          />

          {/* 弹窗 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={spring.soft}
            className="relative w-full max-w-[calc(100vw-2rem)] sm:max-w-md"
          >
            <div className="surface-overlay relative overflow-hidden">
              {/* 头部 */}
              <div className="relative px-6 pt-5 pb-4 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="relative inline-flex items-center justify-center w-10 h-10 shrink-0">
                      <span
                        className="absolute inset-0 rounded-xl"
                        style={{
                          background:
                            'color-mix(in oklch, var(--aurora-1) 14%, transparent)',
                        }}
                      />
                      <Icon
                        className="relative w-5 h-5 text-[var(--aurora-1)]"
                        strokeWidth={1.6}
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--ink-muted)]">
                        {eyebrow}
                      </p>
                      <h2 className="font-display text-[1.25rem] font-semibold text-[var(--ink-primary)] mt-1 leading-tight tracking-tight">
                        {title}
                      </h2>
                    </div>
                  </div>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    transition={spring.precise}
                    onClick={() => !loading && onClose()}
                    disabled={loading}
                    aria-label="关闭"
                    className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>
              </div>

              {/* 表单 */}
              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
                {/* 名称输入 */}
                <div className="space-y-2">
                  <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] flex items-center gap-1.5">
                    {isCategory ? '分类名称' : '标签名称'}
                    <span className="text-[var(--signal-danger)] font-sans">*</span>
                  </label>
                  <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={`输入${isCategory ? '分类' : '标签'}名称`}
                    disabled={loading}
                    className={cn(
                      'w-full px-4 py-3 rounded-xl text-[15px]',
                      'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]',
                      'border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
                      'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
                      'focus:outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]',
                      'focus:ring-2 focus:ring-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)]',
                      'transition-all',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  />
                </div>

                {/* 描述输入 - 仅分类 */}
                {isCategory && (
                  <div className="space-y-2">
                    <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)] flex items-center gap-1.5">
                      描述
                      <span className="text-[var(--ink-muted)] font-sans normal-case tracking-normal text-[11px]">
                        (可选)
                      </span>
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="简短描述这个分类…"
                      disabled={loading}
                      rows={3}
                      className={cn(
                        'w-full px-4 py-3 rounded-xl resize-none text-[15px]',
                        'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]',
                        'border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
                        'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
                        'focus:outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]',
                        'focus:ring-2 focus:ring-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)]',
                        'transition-all',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                    />
                  </div>
                )}

                {/* 按钮 */}
                <div className="flex gap-3 pt-2">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    transition={spring.precise}
                    onClick={() => !loading && onClose()}
                    disabled={loading}
                    className={cn(
                      'flex-1 px-4 py-3 rounded-xl text-[14px] font-medium',
                      'bg-transparent text-[var(--ink-secondary)]',
                      'border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]',
                      'hover:bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)]',
                      'hover:text-[var(--ink-primary)]',
                      'transition-colors',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    取消
                  </motion.button>
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    transition={spring.precise}
                    disabled={!name.trim() || loading}
                    className={cn(
                      'flex-1 px-4 py-3 rounded-xl text-[14px] font-medium',
                      'bg-[var(--aurora-1)] text-white',
                      'shadow-[0_8px_22px_-8px_color-mix(in_oklch,var(--aurora-1)_50%,transparent)]',
                      'hover:brightness-110',
                      'transition-all flex items-center justify-center gap-2',
                      'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none'
                    )}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {submitLoadingLabel}
                      </>
                    ) : (
                      submitLabel
                    )}
                  </motion.button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
