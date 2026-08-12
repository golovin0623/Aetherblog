import { CheckSquare, FolderPlus, Tag, Trash2, X } from 'lucide-react';
import type { MusicPlaylist, MusicTagSummary } from '@aetherblog/types';

interface BatchActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBatchAddTags?: () => void;
  onBatchAddToPlaylist?: () => void;
  onBatchDelete?: () => void;
  allPlaylists?: MusicPlaylist[];
  allTags?: MusicTagSummary[];
}

export function BatchActionBar({
  selectedCount,
  onClearSelection,
  onBatchAddTags,
  onBatchAddToPlaylist,
  onBatchDelete,
}: BatchActionBarProps) {
  if (selectedCount <= 0) return null;

  return (
    <aside
      aria-label="批量策展操作栏"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3.5 py-2 bg-[var(--bg-leaf)]/90 text-[var(--ink-primary)] backdrop-blur-2xl border border-[color-mix(in_oklch,var(--ink-primary)_14%,transparent)] rounded-full shadow-[0_16px_36px_-8px_rgba(0,0,0,0.18)] dark:shadow-[0_20px_48px_-10px_rgba(0,0,0,0.65)] ring-1 ring-white/10 transition-all duration-300 animate-in fade-in slide-in-from-bottom-3"
    >
      <div className="flex items-center gap-1.5 pl-1 pr-2.5 border-r border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)]">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--aurora-1)] text-white text-[10px] font-mono font-bold">
          {selectedCount}
        </span>
        <span className="text-xs font-semibold tracking-tight text-[var(--ink-primary)]">已选择</span>
      </div>

      <div className="flex items-center gap-1">
        {onBatchAddTags && (
          <button
            type="button"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] rounded-full transition-colors"
            onClick={onBatchAddTags}
          >
            <Tag className="w-3 h-3 text-[var(--signal-info)]" />
            标签
          </button>
        )}

        {onBatchAddToPlaylist && (
          <button
            type="button"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] rounded-full transition-colors"
            onClick={onBatchAddToPlaylist}
          >
            <FolderPlus className="w-3 h-3 text-[var(--aurora-1)]" />
            歌单
          </button>
        )}

        {onBatchDelete && (
          <button
            type="button"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] rounded-full transition-colors"
            onClick={onBatchDelete}
          >
            <Trash2 className="w-3 h-3" />
            删除
          </button>
        )}
      </div>

      <button
        type="button"
        aria-label="取消选择"
        onClick={onClearSelection}
        className="flex h-6 w-6 items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] rounded-full ml-0.5 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </aside>
  );
}
