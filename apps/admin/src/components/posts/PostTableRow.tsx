import React, { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit, Copy, Trash2, Settings, Loader2 } from 'lucide-react';
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
      className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-card-hover)] transition-colors group"
    >
      <td className="px-4 py-3.5 w-[40%]">
        <button
          onClick={(e) => onEdit(post, e)}
          className="text-left w-full"
        >
          <p className="text-[var(--text-primary)] font-medium truncate group-hover:text-primary hover:text-primary transition-colors cursor-pointer" title={post.title}>
            {post.title}
          </p>
        </button>
      </td>
      <td className="px-4 py-3.5 w-20 whitespace-nowrap">
        <StatusBadge status={post.status} />
      </td>
      <td className="px-4 py-3.5 w-24 whitespace-nowrap">
        <span className="px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
          {post.categoryName || '-'}
        </span>
      </td>
      <td className="px-4 py-3.5 w-40 overflow-visible">
        <div className="flex items-center gap-1.5 overflow-visible relative">
          {post.tagNames?.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1.5 max-w-[120px]">
                <span className="px-2 py-0.5 text-[10px] bg-primary/10 border border-primary/20 rounded-md text-primary-light truncate max-w-[80px]">
                  {post.tagNames[0]}
                </span>
                {post.tagNames.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePopover(post.id);
                      }}
                      className={cn(
                        "px-1.5 py-0.5 text-[10px] rounded-md font-mono transition-all",
                        isActivePopover
                          ? "bg-primary text-white border-primary shadow-lg shadow-primary/20"
                          : "bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
                      )}
                    >
                      +{post.tagNames.length - 1}
                    </button>

                    <AnimatePresence>
                      {isActivePopover && (
                        <motion.div
                          ref={popoverRef}
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 10 }}
                          className="absolute left-0 bottom-full mb-2 z-[60] min-w-[120px] p-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] backdrop-blur-xl shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex flex-wrap gap-1.5 max-w-[200px]">
                            {post.tagNames.map((tag) => (
                              <span
                                key={tag}
                                className="px-2 py-0.5 text-[10px] bg-primary/10 border border-primary/20 rounded-md text-primary-light whitespace-nowrap"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="absolute left-4 -bottom-1 w-2 h-2 bg-gray-900 border-r border-b border-white/10 rotate-45" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </>
          ) : (
            <span className="text-[var(--text-muted)] text-[10px] ml-1">无标签</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3.5 w-24 text-sm text-[var(--text-muted)] whitespace-nowrap">
        {formatDate(post.publishedAt || post.createdAt)}
      </td>
      <td className="px-4 py-3.5 w-16 text-sm text-[var(--text-muted)] font-mono whitespace-nowrap">
        {post.viewCount}
      </td>
      <td className="px-4 py-3 w-28">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => onOpenProperties(post, e)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-200"
            title="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => onEdit(post, e)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-200"
            title="编辑"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => onCopy(post, e)}
            disabled={actionLoading}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-200 disabled:opacity-50"
            title="复制"
          >
            {actionLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={(e) => onDelete(post, e)}
            disabled={actionLoading}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-red-400 transition-all duration-200 disabled:opacity-50"
            title="删除"
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
