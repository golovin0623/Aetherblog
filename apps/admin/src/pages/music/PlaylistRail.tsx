import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Heart, ListMusic, Loader2, Plus, Radio, Trash2 } from 'lucide-react';
import { Skeleton, stagger, transition, variants } from '@aetherblog/ui';
import type { MusicPlaylist } from '@aetherblog/types';
import { cn } from '@/lib/utils';
import { AdminSectionCount, AdminSectionHeader } from '@/components/layout/AdminSectionHeader';
import { MusicCoverThumb } from './ResonantThumb';
import { iconButtonClass, inputClass, shellClass, textButtonClass } from './musicUi';

// 歌单库(左栏):每行以封面缩略为视觉锚点,选中态用极光左光带,
// 管理操作(喜爱 / 设为公开 / 删除)hover 才浮现,触屏保持常驻。
// 「新建歌单」收成一个按钮 —— Apple 式:新建只要一个名字,其余细节进详情再调。

interface PlaylistRailProps {
  playlists: MusicPlaylist[];
  totalCount: number;
  loading: boolean;
  selectedId: number | null;
  favoriteFilter: 'ALL' | 'FAVORITE';
  onToggleFavoriteFilter: () => void;
  onSelect: (id: number) => void;
  featuredPlaylistId?: number;
  featuredEnabled: boolean;
  writeBusy: boolean;
  settingsReady: boolean;
  favoritePendingId: number | null;
  publishPendingId: number | null;
  draftSourceId: number | null;
  draftDirty: boolean;
  draftFavorite: boolean;
  onToggleFavoriteDraft: () => void;
  onToggleFavorite: (playlist: MusicPlaylist) => void;
  onPublish: (id: number) => void;
  onDelete: (playlist: MusicPlaylist) => void;
  creating: boolean;
  onCreate: (name: string) => Promise<unknown>;
}

export function PlaylistRail({
  playlists,
  totalCount,
  loading,
  selectedId,
  favoriteFilter,
  onToggleFavoriteFilter,
  onSelect,
  featuredPlaylistId,
  featuredEnabled,
  writeBusy,
  settingsReady,
  favoritePendingId,
  publishPendingId,
  draftSourceId,
  draftDirty,
  draftFavorite,
  onToggleFavoriteDraft,
  onToggleFavorite,
  onPublish,
  onDelete,
  creating,
  onCreate,
}: PlaylistRailProps) {
  const prefersReducedMotion = useReducedMotion();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerName, setComposerName] = useState('');
  const composerInputRef = useRef<HTMLInputElement>(null);

  const composerTriggerRef = useRef<HTMLButtonElement>(null);

  const openComposer = () => {
    setComposerOpen(true);
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const closeComposer = () => {
    setComposerOpen(false);
    window.requestAnimationFrame(() => composerTriggerRef.current?.focus({ preventScroll: true }));
  };

  const submitComposer = async () => {
    const name = composerName.trim();
    if (!name || creating) return;
    try {
      await onCreate(name);
      setComposerName('');
      closeComposer();
    } catch {
      // 创建失败:错误已由 mutation toast,保留输入让用户直接重试。
    }
  };

  return (
    <div className={shellClass}>
      <AdminSectionHeader
        icon={<ListMusic className="h-4 w-4" />}
        title="歌单"
        aside={(
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleFavoriteFilter}
              aria-pressed={favoriteFilter === 'FAVORITE'}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-xs font-black min-[769px]:min-h-9 transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
                favoriteFilter === 'FAVORITE'
                  ? 'bg-[color-mix(in_oklch,var(--aurora-4)_14%,transparent)] text-[var(--aurora-4)]'
                  : 'bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              )}
              title="只看喜爱歌单"
            >
              <Heart className={cn('h-3.5 w-3.5', favoriteFilter === 'FAVORITE' && 'fill-current')} />
              喜爱
            </button>
            <AdminSectionCount>{loading ? '载入中' : `${playlists.length}/${totalCount} 个`}</AdminSectionCount>
            <button
              type="button"
              ref={composerTriggerRef}
              onClick={() => (composerOpen ? closeComposer() : openComposer())}
              className={iconButtonClass(false, 'primary', 'sm')}
              aria-expanded={composerOpen}
              aria-label="新建歌单"
              title="新建歌单"
            >
              <Plus className={cn('h-4 w-4 transition-transform duration-[var(--dur-quick)] ease-[var(--ease-out)]', composerOpen && 'rotate-45')} />
            </button>
          </span>
        )}
      />

      <AnimatePresence initial={false}>
        {composerOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition.quick}
            className="overflow-hidden border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_3%,transparent)]"
          >
            <form
              className="flex items-center gap-2 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitComposer();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  closeComposer();
                }
              }}
            >
              <input
                ref={composerInputRef}
                value={composerName}
                onChange={(event) => setComposerName(event.target.value)}
                className={inputClass()}
                placeholder="给新歌单起个名字"
                aria-label="新歌单名称"
                maxLength={120}
              />
              <button
                type="submit"
                className={cn(textButtonClass('primary'), 'shrink-0')}
                disabled={!composerName.trim() || creating}
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                创建
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div role="status" aria-label="正在载入歌单列表" className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton variant="rectangular" width={44} height={44} />
              <div className="flex-1 space-y-1.5">
                <Skeleton width="52%" height={13} />
                <Skeleton width="30%" height={11} />
              </div>
            </div>
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
          {favoriteFilter === 'FAVORITE' ? (
            <>
              <p className="text-sm font-semibold text-[var(--ink-primary)]">还没有喜爱歌单</p>
              <p className="text-xs leading-5 text-[var(--ink-muted)]">取消筛选,或把歌单加入喜爱后再回来。</p>
            </>
          ) : (
            <>
              <span className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]">
                <ListMusic className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold text-[var(--ink-primary)]">从第一个歌单开始策展</p>
              <p className="text-xs leading-5 text-[var(--ink-muted)]">歌单是听者遇见你的方式。</p>
              <button type="button" onClick={openComposer} className={cn(textButtonClass('primary'), 'mt-3')}>
                <Plus className="h-4 w-4" />
                新建歌单
              </button>
            </>
          )}
        </div>
      ) : (
        <motion.ol
          initial={prefersReducedMotion ? false : 'initial'}
          animate="animate"
          variants={{ animate: { transition: stagger(30) } }}
          className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
        >
          {playlists.map((playlist) => {
            const selected = selectedId === playlist.id;
            const isDraftSource = playlist.id === draftSourceId;
            const displayedFavorite = isDraftSource ? draftFavorite : Boolean(playlist.isFavorite);
            const favoritePending = favoritePendingId === playlist.id;
            const publishPending = publishPendingId === playlist.id;
            const featured = featuredPlaylistId === playlist.id;
            return (
              <motion.li
                key={playlist.id}
                variants={variants.fadeUp}
                className={cn(
                  'group relative list-none transition-colors duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                  selected
                    ? 'bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
                    : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]'
                )}
              >
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-2.5 left-0 top-2.5 w-0.5 rounded-full bg-[var(--aurora-1)] shadow-[0_0_8px_var(--aurora-1)]"
                  />
                )}
                <div className="flex items-center gap-2 py-2 pl-3 pr-2">
                  <button
                    type="button"
                    onClick={() => onSelect(playlist.id)}
                    aria-pressed={selected}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-sm)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                  >
                    <span className="h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                      <MusicCoverThumb
                        src={playlist.coverUrl}
                        identity={`playlist:${playlist.id}:${playlist.name}`}
                        alt=""
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-[var(--ink-primary)]">{playlist.name}</span>
                        {featured && (
                          <span className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em]',
                            featuredEnabled
                              ? 'bg-[color-mix(in_oklch,var(--signal-success)_14%,transparent)] text-[var(--signal-success)]'
                              : 'bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)] text-[var(--signal-warn)]'
                          )}>
                            <Radio className="h-3 w-3" />
                            {featuredEnabled ? '公开中' : '未启用'}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ink-muted)]">
                        <span className="tnum">{playlist.trackCount} 首</span>
                        {playlist.visibility === 'PRIVATE' && <span>· 私有</span>}
                        {playlist.status === 'HIDDEN' && <span>· 已隐藏</span>}
                      </span>
                    </span>
                  </button>
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-0.5 transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-out)]',
                      'min-[769px]:opacity-0 min-[769px]:group-focus-within:opacity-100 min-[769px]:group-hover:opacity-100',
                      (favoritePending || publishPending) && 'min-[769px]:opacity-100'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isDraftSource && draftDirty) {
                          onToggleFavoriteDraft();
                          return;
                        }
                        onToggleFavorite(playlist);
                      }}
                      className={iconButtonClass(displayedFavorite, 'default', 'sm')}
                      disabled={writeBusy}
                      aria-pressed={displayedFavorite}
                      aria-label={displayedFavorite ? `取消喜爱歌单「${playlist.name}」` : `喜爱歌单「${playlist.name}」`}
                      title={
                        isDraftSource && draftDirty
                          ? '收藏状态会随当前歌单草稿一起保存'
                          : displayedFavorite
                            ? '取消喜爱'
                            : '加入喜爱'
                      }
                    >
                      {favoritePending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Heart className={cn('h-4 w-4', displayedFavorite && 'fill-current text-[var(--aurora-4)]')} />
                      )}
                    </button>
                    {!featured && (
                      <button
                        type="button"
                        onClick={() => onPublish(playlist.id)}
                        className={iconButtonClass(false, 'primary', 'sm')}
                        title={
                          isDraftSource && draftDirty
                            ? '请先保存当前歌单的修改'
                            : '设为公开展示并启用公开播放器'
                        }
                        aria-label={`将「${playlist.name}」设为公开展示`}
                        disabled={writeBusy || !settingsReady || (isDraftSource && draftDirty)}
                      >
                        {publishPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Radio className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(playlist)}
                      className={iconButtonClass(false, 'danger', 'sm')}
                      disabled={writeBusy}
                      aria-label={`删除歌单「${playlist.name}」`}
                      title="删除歌单"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </div>
              </motion.li>
            );
          })}
        </motion.ol>
      )}
    </div>
  );
}
