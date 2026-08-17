import { useMemo, useState } from 'react';
import { Check, FolderPlus, Tag, Trash2, X } from 'lucide-react';
import { Select } from '@aetherblog/ui';
import type { MusicPlaylist, MusicTagSummary } from '@aetherblog/types';
import { cn } from '@/lib/utils';

type BatchPanelMode = 'playlist' | 'tags' | null;

interface BatchActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBatchAddTags?: (tagIds: number[]) => void;
  onBatchAddToPlaylist?: (playlistId: number) => void;
  onBatchDelete?: () => void;
  allPlaylists?: MusicPlaylist[];
  allTags?: MusicTagSummary[];
  busy?: boolean;
}

export function BatchActionBar({
  selectedCount,
  onClearSelection,
  onBatchAddTags,
  onBatchAddToPlaylist,
  onBatchDelete,
  allPlaylists = [],
  allTags = [],
  busy = false,
}: BatchActionBarProps) {
  const [panelMode, setPanelMode] = useState<BatchPanelMode>(null);
  const [playlistDraft, setPlaylistDraft] = useState('');
  const [tagDraftIds, setTagDraftIds] = useState<Set<number>>(new Set());

  const playlistOptions = useMemo(
    () => allPlaylists.map((playlist) => ({
      value: String(playlist.id),
      label: playlist.name,
    })),
    [allPlaylists]
  );

  if (selectedCount <= 0) return null;

  const openPlaylistPanel = () => {
    setPanelMode('playlist');
    if (playlistOptions.length > 0) setPlaylistDraft(playlistOptions[0].value);
  };

  const openTagsPanel = () => setPanelMode('tags');

  const closePanel = () => {
    setPanelMode(null);
    setTagDraftIds(new Set());
  };

  const toggleTagDraft = (tagId: number) => {
    setTagDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const confirmPlaylistTarget = () => {
    const playlistId = Number(playlistDraft);
    if (!playlistId || busy) return;
    onBatchAddToPlaylist?.(playlistId);
    closePanel();
  };

  const confirmTags = () => {
    const tagIds = [...tagDraftIds];
    if (tagIds.length === 0 || busy) return;
    onBatchAddTags?.(tagIds);
    closePanel();
  };

  return (
    <aside
      aria-label="批量策展操作栏"
      className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2"
    >
      {panelMode && (
        <div
          role="dialog"
          aria-label={panelMode === 'playlist' ? '选择目标歌单' : '选择要添加的标签'}
          className={cn(
            'surface-raised w-[min(92vw,340px)] p-3 text-[var(--ink-primary)] animate-in fade-in slide-in-from-bottom-2',
            'max-h-[60vh] overflow-y-auto overscroll-contain'
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-black text-[var(--ink-primary)]">
              {panelMode === 'playlist'
                ? `将 ${selectedCount} 首歌曲加入歌单`
                : `为 ${selectedCount} 首歌曲添加标签`}
            </p>
            <button
              type="button"
              aria-label="关闭面板"
              onClick={closePanel}
              className="flex h-11 w-11 -m-2 items-center justify-center rounded-full text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {panelMode === 'playlist' ? (
            <div className="mt-3">
              <Select
                value={playlistDraft}
                onValueChange={setPlaylistDraft}
                options={playlistOptions}
                placeholder="选择目标歌单"
                prefix={<FolderPlus />}
                ariaLabel="选择目标歌单"
              />
            </div>
          ) : (
            <div className="mt-3 flex max-h-[38vh] flex-wrap gap-2 overflow-y-auto overscroll-contain">
              {allTags.length === 0 ? (
                <p className="py-2 text-xs text-[var(--ink-muted)]">还没有媒体标签，可在歌曲编辑器中先创建。</p>
              ) : (
                allTags.map((tag) => {
                  const selected = tagDraftIds.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTagDraft(tag.id)}
                      aria-pressed={selected}
                      className={cn(
                        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-[background-color,border-color,color]',
                        selected
                          ? 'text-[var(--ink-primary)]'
                          : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                      )}
                      style={selected ? {
                        borderColor: `${tag.color}88`,
                        backgroundColor: `${tag.color}18`,
                      } : undefined}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                      {selected ? <Check className="h-3 w-3" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closePanel}
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-bold text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] hover:text-[var(--ink-primary)] transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={panelMode === 'playlist' ? confirmPlaylistTarget : confirmTags}
              disabled={
                busy ||
                (panelMode === 'playlist' ? !playlistDraft : tagDraftIds.size === 0)
              }
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] px-3.5 text-xs font-black text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {panelMode === 'playlist' ? '加入' : '应用标签'}
            </button>
          </div>
        </div>
      )}

      <div className="surface-raised flex items-center gap-2 rounded-full px-3.5 py-2 text-[var(--ink-primary)] transition-all duration-[var(--dur-quick)] ease-[var(--ease-out)] animate-in fade-in slide-in-from-bottom-3">
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
              className="flex min-h-11 items-center gap-1 px-2.5 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] rounded-full transition-colors"
              onClick={openTagsPanel}
              aria-expanded={panelMode === 'tags'}
            >
              <Tag className="w-3 h-3 text-[var(--signal-info)]" />
              标签
            </button>
          )}

          {onBatchAddToPlaylist && (
            <button
              type="button"
              className="flex min-h-11 items-center gap-1 px-2.5 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] rounded-full transition-colors"
              onClick={openPlaylistPanel}
              aria-expanded={panelMode === 'playlist'}
              disabled={playlistOptions.length === 0}
              title={playlistOptions.length === 0 ? '请先创建一个歌单' : undefined}
            >
              <FolderPlus className="w-3 h-3 text-[var(--aurora-1)]" />
              歌单
            </button>
          )}

          {onBatchDelete && (
            <button
              type="button"
              className="flex min-h-11 items-center gap-1 px-2.5 text-xs font-medium text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] rounded-full transition-colors"
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
          className="relative flex h-11 w-11 -mr-2 -ml-0.5 items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] rounded-full transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
