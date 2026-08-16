import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import { Skeleton, transition } from '@aetherblog/ui';
import type { MusicTrack } from '@aetherblog/types';
import { cn } from '@/lib/utils';
import { MusicCoverThumb } from './ResonantThumb';
import { formatClock, iconButtonClass, inputClass } from './musicUi';

// 「添加歌曲」面板 —— 取代旧的下拉选择器:
// 候选就是一张可搜索的曲目列表,行内点 + 即加入,已在歌单的曲目保持可见并标记 ✓,
// 与 Apple Music 的「添加音乐」体验同构。挂载即聚焦搜索框。

interface AddTracksPanelProps {
  keyword: string;
  onKeywordChange: (value: string) => void;
  candidates: MusicTrack[];
  existingIds: Set<number>;
  statusText: string;
  fetching: boolean;
  /** 正在核对歌单现有曲目(去重依据),期间禁止加入 */
  memberCheckPending: boolean;
  addingTrackId: number | null;
  busy: boolean;
  onAdd: (trackId: number) => void;
  onClose: () => void;
}

export function AddTracksPanel({
  keyword,
  onKeywordChange,
  candidates,
  existingIds,
  statusText,
  fetching,
  memberCheckPending,
  addingTrackId,
  busy,
  onAdd,
  onClose,
}: AddTracksPanelProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const addDisabled = busy || memberCheckPending;
  const showSkeleton = fetching && candidates.length === 0;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={transition.quick}
      className="overflow-hidden border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_3%,transparent)]"
    >
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              ref={searchRef}
              value={keyword}
              onChange={(event) => onKeywordChange(event.target.value)}
              className={inputClass('pl-9')}
              placeholder="搜索曲库歌曲、艺术家或文件名"
              aria-label="搜索可加入歌单的歌曲"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(iconButtonClass(), 'h-10 w-10')}
            aria-label="收起添加歌曲面板"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_70%,transparent)]">
          {showSkeleton ? (
            <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 px-3 py-2">
                  <Skeleton variant="rectangular" width={36} height={36} />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton width="38%" height={12} />
                    <Skeleton width="22%" height={10} />
                  </div>
                  <Skeleton width={28} height={10} />
                </div>
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs leading-5 text-[var(--ink-muted)]">
              {keyword.trim() ? `没有匹配「${keyword.trim()}」的歌曲。` : '曲库暂时没有可加入的歌曲。'}
            </p>
          ) : (
            <ol className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
              {candidates.map((track) => {
                const added = existingIds.has(track.id);
                const adding = addingTrackId === track.id;
                return (
                  <li
                    key={track.id}
                    className="group flex items-center gap-3 px-3 py-2 transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]"
                  >
                    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-[var(--radius-sm)] ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                      <MusicCoverThumb
                        src={track.coverUrl || track.media?.thumbnailUrl}
                        identity={`track:${track.id}:${track.title}`}
                        alt=""
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--ink-primary)]">{track.title}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
                        {track.artist || '未知艺术家'}
                        {track.album ? ` · ${track.album}` : ''}
                      </p>
                    </div>
                    <span className="tnum hidden shrink-0 text-xs text-[var(--ink-muted)] sm:block">
                      {track.durationSeconds ? formatClock(track.durationSeconds) : ''}
                    </span>
                    {added ? (
                      <span className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] px-2.5 text-xs font-semibold text-[var(--signal-success)]">
                        <Check className="h-3.5 w-3.5" />
                        已加入
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAdd(track.id)}
                        className={cn(iconButtonClass(false, 'primary'), 'h-9 w-9 min-[769px]:h-9 min-[769px]:w-9')}
                        disabled={addDisabled || adding}
                        aria-label={`把「${track.title}」加入歌单`}
                        title="加入歌单"
                      >
                        {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <p className="text-xs leading-5 text-[var(--ink-muted)]" role="status">
          {statusText}
        </p>
      </div>
    </motion.div>
  );
}
