import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Folder, Tag as TagIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreateItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description?: string }) => Promise<void>;
  type: 'category' | 'tag';
  loading?: boolean;
}

export function CreateItemModal({
  isOpen,
  onClose,
  onSubmit,
  type,
  loading = false,
}: CreateItemModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // 延迟聚焦，等待动画完成
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      document.body.style.overflow = '';
      setName('');
      setDescription('');
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

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
      description: type === 'category' ? description.trim() : undefined 
    });
  };

  const isCategory = type === 'category';
  const Icon = isCategory ? Folder : TagIcon;
  const title = isCategory ? '新建分类' : '新建标签';

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !loading && onClose()}
          />
          
          {/* 弹窗 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            className="relative w-full max-w-[calc(100vw-2rem)] sm:max-w-md"
          >
            <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-primary)] dark:bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl">
              {/* 头部 */}
              <div className="relative flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'p-2 rounded-xl',
                    isCategory 
                      ? 'bg-primary/10 text-primary' 
                      : 'bg-blue-500/10 text-blue-400'
                  )}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    {title}
                  </h2>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => !loading && onClose()}
                  disabled={loading}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>
              
              {/* 表单 */}
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                {/* 名称输入 */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-secondary)]">
                    {isCategory ? '分类名称' : '标签名称'}
                    <span className="text-red-400 ml-1">*</span>
                  </label>
                  <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={`请输入${isCategory ? '分类' : '标签'}名称`}
                    disabled={loading}
                    className={cn(
                      'w-full px-4 py-3 rounded-xl',
                      'bg-[var(--bg-input)] border border-[var(--border-subtle)]',
                      'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
                      'focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20',
                      'transition-all duration-200',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  />
                </div>

                {/* 描述输入 - 仅分类 */}
                {isCategory && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">
                      描述
                      <span className="text-[var(--text-muted)] ml-1 font-normal">（可选）</span>
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="简短描述这个分类..."
                      disabled={loading}
                      rows={3}
                      className={cn(
                        'w-full px-4 py-3 rounded-xl resize-none',
                        'bg-[var(--bg-input)] border border-[var(--border-subtle)]',
                        'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
                        'focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20',
                        'transition-all duration-200',
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
                    whileTap={{ scale: 0.98 }}
                    onClick={() => !loading && onClose()}
                    disabled={loading}
                    className={cn(
                      'flex-1 px-4 py-3 rounded-xl font-medium',
                      'bg-[var(--bg-secondary)] text-[var(--text-secondary)]',
                      'hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
                      'transition-colors',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    取消
                  </motion.button>
                  <motion.button
                    type="submit"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={!name.trim() || loading}
                    className={cn(
                      'flex-1 px-4 py-3 rounded-xl font-medium',
                      'bg-primary text-white',
                      'hover:bg-primary/90',
                      'transition-colors flex items-center justify-center gap-2',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        创建中...
                      </>
                    ) : (
                      '创建'
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
