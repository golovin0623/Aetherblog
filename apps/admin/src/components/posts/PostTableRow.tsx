import React, { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit, Copy, Trash2, Settings, Loader2, EyeOff, Lock } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PostListItem } from '@/services/postService';

interface PostTableRowProps {
  post: PostListItem;
  isActivePopover: boolean;
  actionLoading: boolean;
  onTogglePopover: (id: number) => void;
  onEdit: (post: PostListItem, e: React.MouseEvent) => void;
  onOpenProperties: (post: PostListItem, e: React.MouseEvent) => void;
  onCopy: (post: PostListItem, e: React.MouseEvent) => void;
  onDelete: (post: PostListItem, e: React.MouseEvent) => void;
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

const PostTableRow = memo(({
  post,
  isActivePopover,
  actionLoading,
  onTogglePopover,
  onEdit,
  onOpenProperties,
  onCopy,
  onDelete,
  popoverRef
}: PostTableRowProps) => {
  return (
    <tr
      className="group h-[76px] border-b border-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] transition-colors last:border-b-0 hover:bg-[var(--bg-card-hover)]"
    >
      <td className="h-[76px] px-4 py-2 w-[40%] align-middle">
        <button
          type="button"
          onClick={(e) => onEdit(post, e)}
          className="grid h-[52px] w-full grid-rows-[22px_18px] text-left"
        >
          <p className="cursor-pointer truncate font-semibold text-[var(--ink-primary)] transition-colors hover:text-[var(--aurora-1)] group-hover:text-[var(--aurora-1)]" title={post.title}>
            {post.title}
          </p>
          <div className="mt-1 flex h-[18px] items-center gap-2 overflow-hidden">
            {(post.isHidden || post.passwordRequired) && (
              <>
              {post.isHidden && (
                <span className="inline-flex h-[18px] items-center gap-1 whitespace-nowrap text-[10px] text-status-warning">
                  <EyeOff className="w-3 h-3" />
                  已隐藏
                </span>
              )}
              {post.passwordRequired && (
                <span className="inline-flex h-[18px] items-center gap-1 whitespace-nowrap text-[10px] text-status-info">
                  <Lock className="w-3 h-3" />
                  已加密
                </span>
              )}
              </>
            )}
          </div>
        </button>
      </td>
      <td className="h-[76px] px-4 py-2 w-20 whitespace-nowrap align-middle">
        <StatusBadge status={post.status} />
      </td>
      <td className="h-[76px] px-4 py-2 w-24 whitespace-nowrap align-middle">
        <span className="inline-flex max-w-full truncate rounded-md border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-2 py-1 text-xs text-[var(--ink-secondary)]">
          {post.categoryName || '-'}
        </span>
      </td>
      <td className="h-[76px] px-4 py-2 w-40 overflow-visible align-middle">
        <div className="flex items-center gap-1.5 overflow-visible relative">
          {post.tagNames?.length > 0 ? (
            <>
              <div className="flex items-center gap-1.5 flex-nowrap">
                {post.tagNames.slice(0, 2).map((tag) => (
                  <span key={tag} className="max-w-[72px] truncate whitespace-nowrap rounded-md border border-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] px-2 py-0.5 text-[10px] leading-4 text-[var(--aurora-1)]">
                    {tag}
                  </span>
                ))}
                {post.tagNames.length > 2 && (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePopover(post.id);
                      }}
                      className={cn(
                        "px-2 py-0.5 text-[10px] leading-4 rounded-md font-mono transition-all whitespace-nowrap",
                        isActivePopover
                          ? "bg-primary text-white border border-primary shadow-lg shadow-primary/20"
                          : "bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
                      )}
                    >
                      +{post.tagNames.length - 2}
                    </button>

                    <AnimatePresence>
                      {isActivePopover && (
                        <motion.div
                          ref={popoverRef}
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 10 }}
                          className="absolute bottom-full left-0 z-[60] mb-2 min-w-[120px] rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-2 shadow-2xl shadow-black/20 backdrop-blur-2xl"
                          style={{ backgroundColor: 'var(--bg-leaf)' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex flex-wrap gap-1.5 max-w-[200px]">
                            {post.tagNames.map((tag) => (
                              <span
                                key={tag}
                                className="whitespace-nowrap rounded-md border border-[color-mix(in_oklch,var(--aurora-1)_20%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] px-2 py-0.5 text-[10px] leading-4 text-[var(--aurora-1)]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="absolute -bottom-1 left-4 h-2 w-2 rotate-45 border-b border-r border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" style={{ backgroundColor: 'var(--bg-leaf)' }} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </>
          ) : (
            <span className="ml-1 text-[10px] text-[var(--ink-muted)]">无标签</span>
          )}
        </div>
      </td>
      <td className="h-[76px] px-4 py-2 w-24 text-sm text-[var(--ink-muted)] whitespace-nowrap align-middle">
        {formatDate(post.publishedAt || post.createdAt)}
      </td>
      <td className="h-[76px] px-4 py-2 w-16 text-sm text-[var(--ink-muted)] font-mono whitespace-nowrap align-middle">
        {post.viewCount}
      </td>
      <td className="h-[76px] px-4 py-2 w-28 align-middle">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(e) => onOpenProperties(post, e)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-all duration-200 hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]"
            title="设置"
            aria-label={`设置文章 ${post.title}`}
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => onEdit(post, e)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-all duration-200 hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]"
            title="编辑"
            aria-label={`编辑文章 ${post.title}`}
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => onCopy(post, e)}
            disabled={actionLoading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-all duration-200 hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)] disabled:opacity-50"
            title="复制"
            aria-label={`复制文章 ${post.title}`}
          >
            {actionLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => onDelete(post, e)}
            disabled={actionLoading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-all duration-200 hover:bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] hover:text-status-danger disabled:opacity-50"
            title="删除"
            aria-label={`删除文章 ${post.title}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
});

PostTableRow.displayName = 'PostTableRow';

export default PostTableRow;
