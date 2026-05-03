import { motion, AnimatePresence } from 'framer-motion';
import { X, EyeOff, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { SearchProfile } from '@/services/searchProfileService';
import { CHUNKER_KINDS } from './ChunkerKindSelector';

interface ProfileDetailDrawerProps {
  profile: SearchProfile | null;
  onClose: () => void;
  onDeprecate: () => void;
  onDelete: () => void;
}

/**
 * 右侧滑出抽屉，展示 profile 完整元数据 + 二级操作。
 *
 * UX 取舍：
 *   - 列表卡片 (ProfileListCard) 显示压缩 meta；想看完整时间戳 / description 全文
 *     需要点击行打开 drawer
 *   - active profile 不能 deprecate / delete；按钮 disabled + tooltip 解释
 *   - ESC + 点击 backdrop 关闭
 */
export function ProfileDetailDrawer({
  profile,
  onClose,
  onDeprecate,
  onDelete,
}: ProfileDetailDrawerProps) {
  // ESC 关闭 + body 锁滚
  useEffect(() => {
    if (!profile) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handler);
    };
  }, [profile, onClose]);

  const chunker = profile
    ? CHUNKER_KINDS.find((k) => k.value === profile.chunkerKind)
    : null;
  const canDeprecate = profile && profile.status !== 'active' && profile.status !== 'deprecated';
  const canDelete = profile && profile.status === 'deprecated';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {profile && (
        <div
          className="fixed inset-0 flex justify-end pointer-events-none"
          style={{ zIndex: 100 }}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-md pointer-events-auto"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className={cn(
              'relative w-full sm:w-[420px] max-w-[calc(100vw-2rem)] m-2 sm:m-4',
              'pointer-events-auto',
              'surface-overlay !rounded-2xl',
              'flex flex-col max-h-[calc(100vh-2rem)]'
            )}
          >
            <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
              <div className="min-w-0">
                <p className="text-[0.65rem] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Search Profile
                </p>
                <h3 className="text-lg font-bold text-[var(--text-primary)] truncate">
                  {profile.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
              <Field label="code" mono>{profile.code}</Field>
              <Field label="status">
                <span
                  className={cn(
                    'font-mono uppercase tracking-[0.18em] text-xs',
                    profile.status === 'active' && 'text-[var(--signal-success)]',
                    profile.status === 'shadow' && 'text-[var(--signal-warn)]',
                    profile.status === 'deprecated' && 'text-[var(--text-muted)]'
                  )}
                >
                  {profile.status}
                </span>
              </Field>
              <Field label="model_id" mono>{profile.modelId}</Field>
              <Field label="chunker_kind">
                <div className="space-y-0.5">
                  <p>{chunker?.label ?? profile.chunkerKind}</p>
                  {chunker && (
                    <p className="text-xs text-[var(--text-muted)]">{chunker.description}</p>
                  )}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="chunk_size_tokens" mono>{profile.chunkSizeTokens}</Field>
                <Field label="chunk_overlap_tokens" mono>{profile.chunkOverlapTokens}</Field>
              </div>
              {profile.description && (
                <Field label="description">
                  <p className="whitespace-pre-wrap text-[var(--text-secondary)]">
                    {profile.description}
                  </p>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="created_at" mono>
                  {profile.createdAt ? formatDate(profile.createdAt) : '—'}
                </Field>
                <Field label="updated_at" mono>
                  {profile.updatedAt ? formatDate(profile.updatedAt) : '—'}
                </Field>
              </div>
            </div>

            <footer className="px-5 py-4 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2 flex-wrap">
              <button
                type="button"
                onClick={onDeprecate}
                disabled={!canDeprecate}
                title={
                  !canDeprecate
                    ? profile.status === 'active'
                      ? '请先激活其他 profile 再 deprecate'
                      : '已 deprecated'
                    : undefined
                }
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs',
                  'bg-[var(--bg-input)] border border-[var(--border-subtle)]',
                  'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
                )}
              >
                <EyeOff className="w-3.5 h-3.5" />
                Deprecate
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={!canDelete}
                title={!canDelete ? '仅 deprecated profile 可删除' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs',
                  'bg-red-500/10 border border-red-500/20 text-red-300',
                  'hover:bg-red-500/20 hover:text-red-200',
                  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
                删除 profile
              </button>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[0.65rem] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </p>
      <div className={cn('text-[var(--text-primary)]', mono && 'font-mono text-xs break-all')}>
        {children}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
