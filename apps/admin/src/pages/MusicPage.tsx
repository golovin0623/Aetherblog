import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Disc3,
  ExternalLink,
  FolderPlus,
  Headphones,
  LibraryBig,
  ListMusic,
  ListPlus,
  Loader2,
  Music2,
  MoreHorizontal,
  Palette,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCw,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import { Select, type SelectOption } from '@aetherblog/ui';
import { MUSIC_SKIN_PRESETS, resolveMusicSkinValue } from '@aetherblog/utils';
import { toast } from 'sonner';
import type {
  FolderTreeNode,
  MusicAudioCandidate,
  MusicPlaybackMode,
  MusicPlaylist,
  MusicPlaylistRequest,
  MusicSettings,
  MusicSettingsRequest,
  MusicTrack,
  MusicTrackRequest,
} from '@aetherblog/types';
import { AdminModuleHeader, type AdminModuleHeaderTab } from '@/components/layout/AdminModuleHeader';
import { AdminSectionCount, AdminSectionHeader } from '@/components/layout/AdminSectionHeader';
import { AdminPagination } from '@/components/common/AdminPagination';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAdminMusicPlayer } from '@/components/music/AdminMusicPlayerProvider';
import { cn, extractApiErrorMessage, formatFileSize } from '@/lib/utils';
import { folderService } from '@/services/folderService';
import { mediaService } from '@/services/mediaService';
import { musicService } from '@/services/musicService';
import {
  PLAYLIST_MEMBER_TRACK_PAGE_SIZE,
  PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE,
  buildPlaylistTrackIdSet,
  buildPlaylistTrackOptions,
  getMissingPlaylistMemberPageNumbers,
} from './music/playlistTrackOptions';
import {
  buildMusicPlaylistUpdate,
  buildMusicSettingsUpdate,
  buildMusicTrackUpdate,
  canSavePlaylistDraft,
  movePlaylistTrack,
  playlistToDraft,
  shouldApplyPlaylistSaveResult,
  shouldApplyTrackSaveResult,
  shouldConfirmPlaylistSwitch,
  shouldConfirmTrackDraftDiscard,
  type PlaylistDraft,
} from './music/musicDrafts';

type MusicTab = 'library' | 'playlists' | 'display';
type PendingTrackNavigation =
  | { kind: 'select'; track: MusicTrack }
  | { kind: 'close' }
  | { kind: 'tab'; tab: MusicTab };
type PendingDelete =
  | { kind: 'track'; track: MusicTrack; deleteMedia: boolean }
  | { kind: 'playlist'; playlist: MusicPlaylist };

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 10;
const MUSIC_HALL_FOLDER_NAME = '音乐大厅';
const MUSIC_SETTINGS_QUERY_KEY = ['music-settings'] as const;
const COMMON_AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'oga', 'opus', 'weba']);
const MUSIC_UPLOAD_ACCEPT = 'audio/*,.mp3,.flac,.m4a,.m4b,.aac,.wav,.ogg,.oga,.opus,.weba';

function isCommonAudioFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'webm') return false;
  if (COMMON_AUDIO_EXTENSIONS.has(ext)) return true;
  if (file.type.startsWith('audio/')) return true;
  return false;
}

async function fetchAllPlaylistTracks(playlistId: number): Promise<MusicTrack[]> {
  const firstPage = (await musicService.getTracks({
    playlistId,
    pageNum: 1,
    pageSize: PLAYLIST_MEMBER_TRACK_PAGE_SIZE,
  })).data;
  const tracks = [...(firstPage.list ?? [])];
  const missingPages = getMissingPlaylistMemberPageNumbers(
    firstPage.total,
    tracks.length,
    PLAYLIST_MEMBER_TRACK_PAGE_SIZE
  );
  if (missingPages.length === 0) return tracks;

  const remainingPages = await Promise.all(
    missingPages.map(async (pageNum) =>
      (await musicService.getTracks({
        playlistId,
        pageNum,
        pageSize: PLAYLIST_MEMBER_TRACK_PAGE_SIZE,
      })).data
    )
  );
  for (const page of remainingPages) {
    tracks.push(...(page.list ?? []));
  }
  return tracks;
}

const tabs: Array<AdminModuleHeaderTab<MusicTab>> = [
  {
    key: 'library',
    label: '音乐大厅',
    shortLabel: '曲库',
    description: '上传、扫描、试听与维护独立歌曲库。',
    icon: LibraryBig,
  },
  {
    key: 'playlists',
    label: '歌单编排',
    shortLabel: '歌单',
    description: '将歌曲映射到歌单，管理独立排序与展示策略。',
    icon: ListMusic,
  },
  {
    key: 'display',
    label: '展示播放',
    shortLabel: '展示',
    description: '配置个人卡片入口、随机与轮播播放策略。',
    icon: SlidersHorizontal,
  },
];

const panelClass = cn(
  'surface-leaf surface-admin-panel rounded-[1.25rem]',
  'p-3 sm:p-4'
);

const shellClass = cn(
  'surface-leaf overflow-hidden rounded-[1.25rem]'
);

function iconButtonClass(active = false, tone: 'default' | 'primary' | 'danger' = 'default') {
  return cn(
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-transparent transition-[background-color,color,box-shadow,opacity] duration-100 active:opacity-60 min-[769px]:h-10 min-[769px]:w-10',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]',
    active && 'bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)] text-[var(--aurora-1)]',
    tone === 'primary' &&
      'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)]',
    tone === 'danger' &&
      'text-[var(--ink-muted)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] hover:text-[var(--signal-danger)] focus-visible:text-[var(--signal-danger)]',
    tone === 'default' &&
      'bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)]'
  );
}

function textButtonClass(tone: 'default' | 'primary' | 'danger' = 'default') {
  return cn(
    'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-transparent px-3 text-sm font-semibold transition-[background-color,color,box-shadow,opacity] duration-100 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 min-[769px]:h-10',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]',
    tone === 'primary' &&
      'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
    tone === 'danger' &&
      'bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_13%,transparent)]',
    tone === 'default' &&
      'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]'
  );
}

function inputClass(extra?: string) {
  return cn(
    'h-10 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-3 text-sm text-[var(--ink-primary)]',
    'placeholder:text-[var(--ink-muted)] transition-[border-color,box-shadow] duration-200 focus:border-[color-mix(in_oklch,var(--aurora-1)_48%,transparent)] focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
    extra
  );
}

function PlaylistTrackActionMenu({
  trackTitle,
  moveUpDisabled,
  moveDownDisabled,
  removeDisabled,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  trackTitle: string;
  moveUpDisabled: boolean;
  moveDownDisabled: boolean;
  removeDisabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      right: Math.max(12, window.innerWidth - rect.right),
      top: Math.max(12, Math.min(window.innerHeight - 184, rect.bottom + 6)),
      zIndex: 90,
    });
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        closeMenu();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
      );
      if (items.length === 0) return;
      event.preventDefault();
      const activeIndex = items.findIndex((item) => item === document.activeElement);
      if (event.key === 'Home') {
        items[0]?.focus();
      } else if (event.key === 'End') {
        items.at(-1)?.focus();
      } else if (event.key === 'ArrowDown') {
        items[(activeIndex + 1 + items.length) % items.length]?.focus();
      } else {
        items[(activeIndex - 1 + items.length) % items.length]?.focus();
      }
    };
    const onViewportChange = () => closeMenu();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [closeMenu, open]);

  const runAction = (action: () => void) => {
    action();
    closeMenu(true);
  };

  return (
    <div className="min-[769px]:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={iconButtonClass()}
        aria-label={`更多「${trackTitle}」操作`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`「${trackTitle}」排序与移除`}
          style={menuStyle}
          className="surface-overlay w-44 overflow-hidden rounded-xl p-1 shadow-xl"
        >
          <button type="button" role="menuitem" onClick={() => runAction(onMoveUp)} disabled={moveUpDisabled} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)] disabled:opacity-40">
            <ArrowUp className="h-4 w-4" />
            上移
          </button>
          <button type="button" role="menuitem" onClick={() => runAction(onMoveDown)} disabled={moveDownDisabled} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)] disabled:opacity-40">
            <ArrowDown className="h-4 w-4" />
            下移
          </button>
          <button type="button" role="menuitem" onClick={() => runAction(onRemove)} disabled={removeDisabled} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--signal-danger)] disabled:opacity-40">
            <Trash2 className="h-4 w-4" />
            从歌单移除
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

function flattenFolders(nodes: FolderTreeNode[] | undefined, depth = 0): SelectOption[] {
  if (!nodes) return [];
  return nodes.flatMap((node) => [
    {
      value: String(node.id),
      label: `${depth > 0 ? ' '.repeat(depth * 2) : ''}${node.name}`,
      description: node.path,
    },
    ...flattenFolders(node.children, depth + 1),
  ]);
}

function defaultSettings(settings?: MusicSettings): MusicSettings {
  return {
    enabled: settings?.enabled ?? false,
    showOnHomePage: settings?.showOnHomePage ?? true,
    showOnProfileCard: settings?.showOnProfileCard ?? true,
    featuredPlaylistId: settings?.featuredPlaylistId,
    mediaFolderId: settings?.mediaFolderId,
    playbackMode: settings?.playbackMode ?? 'SEQUENTIAL',
    carouselEnabled: settings?.carouselEnabled ?? true,
    carouselIntervalSeconds: settings?.carouselIntervalSeconds ?? 8,
    randomEnabled: settings?.randomEnabled ?? false,
    skinMode: settings?.skinMode ?? 'preset',
    skinPreset: settings?.skinPreset ?? 'crimson',
    skinColorLight: settings?.skinColorLight,
    skinColorDark: settings?.skinColorDark,
    featuredPlaylist: settings?.featuredPlaylist,
  };
}

// 把皮肤配置解析为 data-music-skin 作用域属性;自定义模式按当前后台主题内联种子,
// 供中控台预览随站点默认皮肤即时着色(预设走纯 CSS,自定义需内联 --music-seed)。
function musicSkinScopeProps(
  settings: MusicSettings,
  isDark: boolean,
): { 'data-music-skin': string; style?: CSSProperties } {
  const value = resolveMusicSkinValue(settings.skinMode, settings.skinPreset);
  if (value === 'custom') {
    const seed = (isDark ? settings.skinColorDark : settings.skinColorLight) || settings.skinColorLight || settings.skinColorDark;
    if (seed) return { 'data-music-skin': 'custom', style: { ['--music-seed']: seed } as CSSProperties };
  }
  return { 'data-music-skin': value };
}

// ============================================================
// 纯展示子组件 —— 必须定义在模块作用域。
// 早前它们嵌在 MusicPage 函数体内,导致每次播放进度 tick(progress 变化触发
// MusicPage 重渲染)都会得到一个「新的」组件标识 → TrackEditor 整棵卸载重挂,
// 内部 draft / addPlaylistId 草稿状态在播放时被反复清空。提到模块作用域后组件
// 标识稳定,编辑态不再被打断。
// ============================================================

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
      <p className="text-xs text-[var(--ink-muted)]">{label}</p>
      <p className="tnum mt-1 text-2xl font-bold text-[var(--ink-primary)]">{value}</p>
    </div>
  );
}

function StageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-[color-mix(in_oklch,var(--bg-leaf)_82%,transparent)] p-3">
      <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">{label}</p>
      <p className="tnum mt-1 text-xl font-black text-[var(--ink-primary)]">{value}</p>
    </div>
  );
}

function TogglePill({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'inline-flex h-11 items-center justify-between gap-3 rounded-xl border border-transparent px-3 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150 min-[769px]:h-10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]',
        checked
          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--ink-primary)]'
          : 'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-muted)]'
      )}
    >
      <span>{label}</span>
      <span className={cn('h-2.5 w-2.5 rounded-full', checked ? 'bg-[var(--aurora-1)]' : 'bg-[var(--ink-muted)]/30')} />
    </button>
  );
}

function TrackEditor({
  track,
  onClose,
  onSave,
  onDraftChange,
  dirty,
  saving,
  playlistOptions,
  playlistCount,
  onAddToPlaylist,
  addingToPlaylist,
  onRequestDeleteWithMedia,
  onPreview,
}: {
  track: MusicTrack;
  onClose: () => void;
  onSave: (track: MusicTrack, data: MusicTrackRequest) => void;
  onDraftChange: () => void;
  dirty: boolean;
  saving: boolean;
  playlistOptions: SelectOption[];
  playlistCount: number;
  onAddToPlaylist: (playlistId: number, trackId: number) => void;
  addingToPlaylist: boolean;
  onRequestDeleteWithMedia: (track: MusicTrack) => void;
  onPreview: (track: MusicTrack) => void;
}) {
  const [draft, setDraft] = useState<MusicTrack>(track);
  const [addPlaylistId, setAddPlaylistId] = useState('');
  useEffect(() => {
    setDraft(track);
    setAddPlaylistId('');
  }, [track]);
  const updateDraft = (changes: Partial<MusicTrack>) => {
    onDraftChange();
    setDraft((current) => ({ ...current, ...changes }));
  };
  return (
    <div className={cn(panelClass, 'sticky top-4 space-y-4')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-[var(--ink-primary)]">歌曲信息</p>
            {dirty && (
              <span className="rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--signal-warn)]">
                未保存
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">媒体文件：{track.media?.originalName || '未加载媒体文件名'}</p>
        </div>
        <button type="button" onClick={onClose} className={iconButtonClass()} aria-label="关闭歌曲信息">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">标题</span>
          <input value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} className={inputClass()} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">艺术家</span>
          <input value={draft.artist} onChange={(e) => updateDraft({ artist: e.target.value })} className={inputClass()} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">专辑</span>
          <input value={draft.album} onChange={(e) => updateDraft({ album: e.target.value })} className={inputClass()} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[96px_minmax(0,1fr)]">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)]">
            {draft.coverUrl ? (
              <img src={draft.coverUrl} alt={`${draft.title} 封面`} className="h-full w-full object-cover" />
            ) : (
              <Disc3 className="h-8 w-8 text-[var(--ink-muted)]" />
            )}
          </div>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">封面媒体 ID</span>
            <input
              type="number"
              min={1}
              value={draft.coverMediaFileId ?? ''}
              onChange={(e) => updateDraft({
                coverMediaFileId: e.target.value ? Number(e.target.value) : undefined,
              })}
              className={inputClass()}
              placeholder="选择媒体库图片 ID"
            />
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">封面仍存储在媒体库，这里只保存歌曲到封面文件的映射。</p>
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">歌词 / LRC</span>
          <textarea
            value={draft.lyric || ''}
            onChange={(e) => updateDraft({ lyric: e.target.value })}
            className={cn(inputClass(), 'h-auto min-h-32 resize-y py-2 leading-6')}
            placeholder="[00:12.00] 第一行歌词，也支持普通纯文本"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">排序</span>
            <input
              type="number"
              value={draft.sortOrder}
              onChange={(e) => updateDraft({ sortOrder: Number(e.target.value) || 0 })}
              className={inputClass()}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">状态</span>
            <Select
              value={draft.status}
              onValueChange={(value) => updateDraft({ status: value as MusicTrack['status'] })}
              options={[
                { value: 'ACTIVE', label: '展示' },
                { value: 'HIDDEN', label: '隐藏' },
              ]}
              ariaLabel="歌曲状态"
            />
          </label>
        </div>
        <div className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            <ListPlus className="h-3.5 w-3.5" />
            加入歌单
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Select
              value={addPlaylistId}
              onValueChange={setAddPlaylistId}
              options={playlistOptions}
              placeholder={playlistCount > 0 ? '选择歌单' : '先在「歌单编排」创建歌单'}
              prefix={<ListMusic />}
              ariaLabel="选择要加入的歌单"
            />
            <button
              type="button"
              onClick={() => {
                if (!addPlaylistId) return;
                onAddToPlaylist(Number(addPlaylistId), track.id);
              }}
              className={textButtonClass('primary')}
              disabled={!addPlaylistId || addingToPlaylist}
            >
              {addingToPlaylist ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              加入
            </button>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">把这首歌加入歌单后,到「歌单编排」可调整顺序;把歌单设为公开即对外展示。</p>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => onRequestDeleteWithMedia(track)}
          className={textButtonClass('danger')}
        >
          <Trash2 className="h-4 w-4" />
          连媒体删除
        </button>
        <button type="button" onClick={() => onPreview(track)} className={textButtonClass()}>
          <Play className="h-4 w-4" />
          试听
        </button>
        <button
          type="button"
          onClick={() => onSave(track, buildMusicTrackUpdate(track, {
            title: draft.title,
            artist: draft.artist,
            album: draft.album,
            coverMediaFileId: draft.coverMediaFileId,
            lyric: draft.lyric,
            status: draft.status,
            sortOrder: draft.sortOrder,
            isFeatured: draft.isFeatured,
          }))}
          className={textButtonClass('primary')}
          disabled={saving || !dirty}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : dirty ? <RotateCw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {saving ? '保存中' : dirty ? '保存' : '已保存'}
        </button>
      </div>
    </div>
  );
}

export default function MusicPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsWriteLockRef = useRef(false);
  const deleteWriteLockRef = useRef(false);
  const [activeTab, setActiveTab] = useState<MusicTab>('library');
  const {
    queue,
    currentTrack,
    currentIndex,
    isPlaying,
    progress,
    duration,
    percent,
    playbackError,
    playTracks,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    retryPlayback,
    setMusicSkin,
    setDockSuppressed,
  } = useAdminMusicPlayer();

  // 完整试听舞台只属于「展示播放」；曲库和歌单保持管理优先，继续使用紧凑全局播放器。
  useEffect(() => {
    setDockSuppressed(activeTab === 'display');
    return () => setDockSuppressed(false);
  }, [activeTab, setDockSuppressed]);
  // 后台明暗主题 —— 自定义皮肤预览按当前主题取对应光源种子
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const [trackPage, setTrackPage] = useState(1);
  const [trackPageSize, setTrackPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [trackKeyword, setTrackKeyword] = useState('');
  const [scanKeyword, setScanKeyword] = useState('');
  const [scanPage, setScanPage] = useState(1);
  const [scanPageSize, setScanPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [newFolderName, setNewFolderName] = useState(MUSIC_HALL_FOLDER_NAME);
  const [uploadingLabel, setUploadingLabel] = useState('');
  const [editingTrack, setEditingTrack] = useState<MusicTrack | null>(null);
  const editingTrackIdRef = useRef<number | null>(null);
  const trackDraftRevisionRef = useRef(0);
  const [trackDraftDirty, setTrackDraftDirty] = useState(false);
  const [pendingTrackNavigation, setPendingTrackNavigation] = useState<PendingTrackNavigation | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const selectedPlaylistIdRef = useRef<number | null>(null);
  const [playlistForm, setPlaylistForm] = useState({
    name: '我的歌单',
    description: '',
    displayOnProfile: true,
    carouselEnabled: true,
    randomEnabled: false,
  });
  const [playlistDraft, setPlaylistDraft] = useState<PlaylistDraft>({
    name: '',
    description: '',
    visibility: 'PUBLIC',
    status: 'ACTIVE',
    displayOnHome: true,
    displayOnProfile: true,
    carouselEnabled: true,
    randomEnabled: false,
    sortOrder: 0,
  });
  const [playlistDraftSourceId, setPlaylistDraftSourceId] = useState<number | null>(null);
  const [playlistDraftDirty, setPlaylistDraftDirty] = useState(false);
  const playlistDraftRevisionRef = useRef(0);
  const [pendingPlaylistSelectionId, setPendingPlaylistSelectionId] = useState<number | null>(null);
  const [trackToAdd, setTrackToAdd] = useState('');
  const [playlistTrackKeyword, setPlaylistTrackKeyword] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [isSettingsWriteBusy, setIsSettingsWriteBusy] = useState(false);
  const deferredPlaylistTrackKeyword = useDeferredValue(playlistTrackKeyword);

  const selectPlaylist = useCallback((playlistId: number | null) => {
    playlistDraftRevisionRef.current += 1;
    selectedPlaylistIdRef.current = playlistId;
    setPlaylistDraftSourceId(null);
    setPlaylistDraftDirty(false);
    setSelectedPlaylistId(playlistId);
  }, []);
  const updatePlaylistDraft = useCallback(
    (updater: (draft: PlaylistDraft) => PlaylistDraft) => {
      playlistDraftRevisionRef.current += 1;
      setPlaylistDraftDirty(true);
      setPlaylistDraft(updater);
    },
    []
  );
  const performTrackNavigation = useCallback((navigation: PendingTrackNavigation) => {
    trackDraftRevisionRef.current += 1;
    setTrackDraftDirty(false);
    setPendingTrackNavigation(null);
    if (navigation.kind === 'select') {
      editingTrackIdRef.current = navigation.track.id;
      setEditingTrack(navigation.track);
      return;
    }
    if (navigation.kind === 'close') {
      editingTrackIdRef.current = null;
      setEditingTrack(null);
      return;
    }
    setActiveTab(navigation.tab);
  }, []);
  const requestTrackNavigation = useCallback((navigation: PendingTrackNavigation) => {
    if (navigation.kind === 'tab' && navigation.tab === activeTab) return;
    const targetTrackId = navigation.kind === 'select' ? navigation.track.id : null;
    if (shouldConfirmTrackDraftDiscard({
      isDirty: trackDraftDirty,
      currentTrackId: editingTrackIdRef.current,
      targetTrackId,
    })) {
      setPendingTrackNavigation(navigation);
      return;
    }
    if (navigation.kind === 'select' && navigation.track.id === editingTrackIdRef.current) return;
    performTrackNavigation(navigation);
  }, [activeTab, performTrackNavigation, trackDraftDirty]);
  const requestPlaylistSelection = useCallback((playlistId: number) => {
    if (playlistId === selectedPlaylistId) return;
    if (shouldConfirmPlaylistSwitch({
      selectedPlaylistId,
      targetPlaylistId: playlistId,
      loadedPlaylistId: playlistDraftSourceId,
      isDirty: playlistDraftDirty,
    })) {
      setPendingPlaylistSelectionId(playlistId);
      return;
    }
    selectPlaylist(playlistId);
  }, [playlistDraftDirty, playlistDraftSourceId, selectPlaylist, selectedPlaylistId]);

  const settingsQuery = useQuery({
    queryKey: MUSIC_SETTINGS_QUERY_KEY,
    queryFn: async () => (await musicService.getSettings()).data,
  });

  const summaryQuery = useQuery({
    queryKey: ['music-summary'],
    queryFn: async () => (await musicService.getSummary()).data,
  });

  const tracksQuery = useQuery({
    queryKey: ['music-tracks', trackPage, trackPageSize, trackKeyword],
    queryFn: async () =>
      (await musicService.getTracks({
        pageNum: trackPage,
        pageSize: trackPageSize,
        keyword: trackKeyword || undefined,
      })).data,
  });

  const playlistTrackCandidatesQuery = useQuery({
    queryKey: ['music-track-candidates', deferredPlaylistTrackKeyword],
    enabled: activeTab === 'playlists',
    queryFn: async () =>
      (await musicService.getTracks({
        pageNum: 1,
        pageSize: PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE,
        keyword: deferredPlaylistTrackKeyword.trim() || undefined,
      })).data,
  });

  const playlistsQuery = useQuery({
    queryKey: ['music-playlists'],
    queryFn: async () => (await musicService.getPlaylists({ pageNum: 1, pageSize: 100 })).data,
  });

  const foldersQuery = useQuery({
    queryKey: ['media-folders-tree'],
    queryFn: async () => (await folderService.getTree()).data,
  });

  const settings = defaultSettings(settingsQuery.data);
  useEffect(() => {
    const value = resolveMusicSkinValue(settings.skinMode, settings.skinPreset);
    const seed = value === 'custom'
      ? ((isDark ? settings.skinColorDark : settings.skinColorLight) || settings.skinColorLight || settings.skinColorDark)
      : undefined;
    setMusicSkin(value, seed);
  }, [isDark, setMusicSkin, settings.skinColorDark, settings.skinColorLight, settings.skinMode, settings.skinPreset]);
  // 自定义皮肤取色草稿 —— 从后台已存值回填,点击「应用」才落库(避免拖动取色器时狂发请求)
  const [skinDraftLight, setSkinDraftLight] = useState('#DC3D44');
  const [skinDraftDark, setSkinDraftDark] = useState('#FF6B6E');
  const [carouselIntervalDraft, setCarouselIntervalDraft] = useState('8');
  const [carouselIntervalDirty, setCarouselIntervalDirty] = useState(false);
  // 只在首次拿到后台存值时回填一次草稿。之后后台因其它设置保存而 refetch 时不再覆盖,
  // 避免把正在拖动的取色器重置(load-window 抖动)。
  const skinDraftSeededRef = useRef(false);
  useEffect(() => {
    if (skinDraftSeededRef.current) return;
    if (settings.skinColorLight || settings.skinColorDark) {
      if (settings.skinColorLight) setSkinDraftLight(settings.skinColorLight);
      if (settings.skinColorDark) setSkinDraftDark(settings.skinColorDark);
      skinDraftSeededRef.current = true;
    }
  }, [settings.skinColorLight, settings.skinColorDark]);

  useEffect(() => {
    if (!settingsQuery.data || carouselIntervalDirty) return;
    setCarouselIntervalDraft(String(settingsQuery.data.carouselIntervalSeconds));
  }, [carouselIntervalDirty, settingsQuery.data]);
  const tracks = tracksQuery.data?.list ?? [];
  const playlistTrackCandidates = playlistTrackCandidatesQuery.data?.list ?? [];
  const playlists = playlistsQuery.data?.list ?? [];
  const selectedPlaylist = playlists.find((item) => item.id === selectedPlaylistId);
  const folderOptions = useMemo<SelectOption[]>(
    () => flattenFolders(foldersQuery.data).filter((option) => option.value !== '1'),
    [foldersQuery.data]
  );
  const playlistOptions = useMemo<SelectOption[]>(
    () => playlists.map((item) => ({
      value: String(item.id),
      label: item.name,
      description: `${item.trackCount} 首 · ${item.visibility === 'PUBLIC' ? '公开' : '私有'}`,
    })),
    [playlists]
  );
  const scanQuery = useQuery({
    queryKey: ['music-scan', settings.mediaFolderId, scanKeyword, scanPage, scanPageSize],
    enabled: Boolean(settings.mediaFolderId),
    queryFn: async () =>
      (await musicService.scanAudio({
        folderId: settings.mediaFolderId,
        keyword: scanKeyword || undefined,
        includeMapped: false,
        pageNum: scanPage,
        pageSize: scanPageSize,
      })).data,
  });

  const playlistDetailQuery = useQuery({
    queryKey: ['music-playlist-detail', selectedPlaylistId],
    enabled: activeTab === 'playlists' && Boolean(selectedPlaylistId),
    queryFn: async () => (await musicService.getPlaylist(selectedPlaylistId!, { includeTracks: true })).data,
  });
  const playlistMemberTracksQuery = useQuery({
    queryKey: ['music-playlist-member-tracks', selectedPlaylistId],
    enabled: activeTab === 'playlists' && Boolean(selectedPlaylistId),
    queryFn: async () => fetchAllPlaylistTracks(selectedPlaylistId!),
  });
  const scanItems = useMemo(() => scanQuery.data?.list ?? [], [scanQuery.data]);
  const selectedCandidateSet = useMemo(() => new Set(selectedCandidateIds), [selectedCandidateIds]);
  const currentPageCandidateIds = useMemo(
    () => scanItems.filter((item) => !item.mappedTrackId).map((item) => item.id),
    [scanItems]
  );
  const selectedCurrentPageCount = useMemo(
    () => currentPageCandidateIds.filter((id) => selectedCandidateSet.has(id)).length,
    [currentPageCandidateIds, selectedCandidateSet]
  );
  const isCurrentPageFullySelected =
    currentPageCandidateIds.length > 0 && selectedCurrentPageCount === currentPageCandidateIds.length;

  const invalidateMusic = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['music-summary'] });
    queryClient.invalidateQueries({ queryKey: ['music-settings'] });
    queryClient.invalidateQueries({ queryKey: ['music-tracks'] });
    queryClient.invalidateQueries({ queryKey: ['music-track-candidates'] });
    queryClient.invalidateQueries({ queryKey: ['music-scan'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlist-detail'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlist-member-tracks'] });
  }, [queryClient]);

  const beginSettingsWrite = useCallback(() => {
    if (settingsWriteLockRef.current) return false;
    settingsWriteLockRef.current = true;
    setIsSettingsWriteBusy(true);
    return true;
  }, []);

  const finishSettingsWrite = useCallback(() => {
    settingsWriteLockRef.current = false;
    setIsSettingsWriteBusy(false);
  }, []);

  const getLatestSettings = useCallback(() => {
    const latest = queryClient.getQueryData<MusicSettings>(MUSIC_SETTINGS_QUERY_KEY);
    if (!latest) {
      throw new Error('播放设置尚未载入，请刷新后重试。');
    }
    return latest;
  }, [queryClient]);

  const settingsMutation = useMutation({
    mutationFn: (patch: Partial<MusicSettingsRequest>) =>
      musicService.updateSettings(buildMusicSettingsUpdate(getLatestSettings(), patch)),
    onSuccess: (response) => {
      queryClient.setQueryData(MUSIC_SETTINGS_QUERY_KEY, response.data);
      toast.success('播放展示设置已保存');
      queryClient.invalidateQueries({ queryKey: ['music-summary'] });
    },
    onError: async (error, patch) => {
      if ('carouselIntervalSeconds' in patch) {
        const latest = queryClient.getQueryData<MusicSettings>(MUSIC_SETTINGS_QUERY_KEY);
        if (latest) setCarouselIntervalDraft(String(latest.carouselIntervalSeconds));
        setCarouselIntervalDirty(false);
      }
      toast.error(extractApiErrorMessage(error, '保存设置失败'));
      await queryClient.invalidateQueries({ queryKey: MUSIC_SETTINGS_QUERY_KEY });
    },
    onSettled: finishSettingsWrite,
  });

  const importMutation = useMutation({
    mutationFn: musicService.importMedia,
    onSuccess: (res) => {
      toast.success(`已纳入曲库：${res.data?.title || '音频'}`);
      if (res.data?.mediaFileId) {
        setSelectedCandidateIds((ids) => ids.filter((id) => id !== res.data?.mediaFileId));
      }
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '纳入曲库失败')),
  });

  const batchImportMutation = useMutation({
    mutationFn: musicService.batchImportMedia,
    onSuccess: (res) => {
      toast.success(`已纳入 ${res.data?.length ?? selectedCandidateIds.length} 首音频`);
      setSelectedCandidateIds([]);
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '批量纳入曲库失败')),
  });

  const updateTrackMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: MusicTrackRequest; revision: number }) => musicService.updateTrack(id, data),
    onSuccess: (res, { id, revision }) => {
      toast.success('歌曲信息已更新');
      const shouldApply = shouldApplyTrackSaveResult({
        savedTrackId: id,
        selectedTrackId: editingTrackIdRef.current,
        savedRevision: revision,
        currentRevision: trackDraftRevisionRef.current,
      });
      if (shouldApply) {
        setEditingTrack(res.data);
        setTrackDraftDirty(false);
        setPendingTrackNavigation(null);
      }
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '更新歌曲失败')),
  });

  const deleteTrackMutation = useMutation({
    mutationFn: ({ id, deleteMedia }: { id: number; deleteMedia: boolean }) =>
      musicService.deleteTrack(id, { deleteMedia }),
    onSuccess: (_response, { id }) => {
      toast.success('歌曲已移除');
      if (editingTrackIdRef.current === id) {
        editingTrackIdRef.current = null;
        trackDraftRevisionRef.current += 1;
        setEditingTrack(null);
        setTrackDraftDirty(false);
        setPendingTrackNavigation(null);
      }
      setPendingDelete(null);
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '移除歌曲失败')),
    onSettled: () => {
      deleteWriteLockRef.current = false;
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async () => {
      const folderResponse = await folderService.create({
        name: newFolderName.trim() || MUSIC_HALL_FOLDER_NAME,
      });
      try {
        const settingsResponse = await musicService.updateSettings(
          buildMusicSettingsUpdate(getLatestSettings(), {
            mediaFolderId: folderResponse.data.id,
          })
        );
        return { folder: folderResponse.data, settings: settingsResponse.data };
      } catch (error) {
        throw new Error(
          `目录「${folderResponse.data.name}」已创建，但未能设为音乐大厅目录：${extractApiErrorMessage(error, '请重新选择目录')}`
        );
      }
    },
    onSuccess: ({ folder, settings: updatedSettings }) => {
      queryClient.setQueryData(MUSIC_SETTINGS_QUERY_KEY, updatedSettings);
      toast.success(`已创建并启用媒体目录：${folder.name}`);
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '创建媒体目录失败')),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['media-folders-tree'] }),
        queryClient.invalidateQueries({ queryKey: MUSIC_SETTINGS_QUERY_KEY }),
      ]);
      finishSettingsWrite();
    },
  });

  const createPlaylistMutation = useMutation({
    mutationFn: () =>
      musicService.createPlaylist({
        name: playlistForm.name.trim() || '我的歌单',
        description: playlistForm.description.trim() || undefined,
        displayOnHome: false,
        displayOnProfile: playlistForm.displayOnProfile,
        carouselEnabled: playlistForm.carouselEnabled,
        randomEnabled: playlistForm.randomEnabled,
        visibility: 'PUBLIC',
        status: 'ACTIVE',
      }),
    onSuccess: (res) => {
      toast.success(`已创建歌单：${res.data.name}`);
      queryClient.setQueryData(
        ['music-playlists'],
        (current: typeof playlistsQuery.data) => current
          ? {
              ...current,
              list: [res.data, ...current.list.filter((playlist) => playlist.id !== res.data.id)],
              total: current.total + 1,
            }
          : current
      );
      requestPlaylistSelection(res.data.id);
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '创建歌单失败')),
  });

  const updatePlaylistMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: MusicPlaylistRequest; revision: number }) =>
      musicService.updatePlaylist(id, data),
    onSuccess: (res, { id, revision }) => {
      toast.success(`已保存歌单：${res.data.name}`);
      queryClient.setQueryData(['music-playlist-detail', id], res.data);
      if (shouldApplyPlaylistSaveResult({
        savedPlaylistId: id,
        selectedPlaylistId: selectedPlaylistIdRef.current,
        savedRevision: revision,
        currentRevision: playlistDraftRevisionRef.current,
      })) {
        setPlaylistDraft(playlistToDraft(res.data));
        setPlaylistDraftSourceId(res.data.id);
        setPlaylistDraftDirty(false);
      }
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '保存歌单失败')),
  });

  const deletePlaylistMutation = useMutation({
    mutationFn: musicService.deletePlaylist,
    onSuccess: (_data, deletedPlaylistId) => {
      toast.success('歌单已删除');
      setPendingDelete(null);
      const nextPlaylist = playlists.find((playlist) => playlist.id !== deletedPlaylistId);
      queryClient.setQueryData(
        ['music-playlists'],
        (current: typeof playlistsQuery.data) => current
          ? {
              ...current,
              list: current.list.filter((playlist) => playlist.id !== deletedPlaylistId),
              total: Math.max(0, current.total - 1),
            }
          : current
      );
      if (selectedPlaylistIdRef.current === deletedPlaylistId) {
        selectPlaylist(nextPlaylist?.id ?? null);
      }
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '删除歌单失败')),
    onSettled: () => {
      deleteWriteLockRef.current = false;
    },
  });

  const playlistTrackMutation = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: number; trackId: number }) =>
      musicService.addTrackToPlaylist(playlistId, trackId),
    onSuccess: (_data, { playlistId }) => {
      toast.success('已加入歌单');
      if (selectedPlaylistIdRef.current === playlistId) setTrackToAdd('');
      queryClient.invalidateQueries({ queryKey: ['music-playlist-detail', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlist-member-tracks', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '加入歌单失败')),
  });

  const removePlaylistTrackMutation = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: number; trackId: number }) =>
      musicService.removeTrackFromPlaylist(playlistId, trackId),
    onSuccess: (_data, { playlistId }) => {
      toast.success('已从歌单移除');
      queryClient.invalidateQueries({ queryKey: ['music-playlist-detail', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlist-member-tracks', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '移出歌单失败')),
  });

  const reorderPlaylistMutation = useMutation({
    mutationFn: ({ playlistId, tracks }: { playlistId: number; tracks: MusicTrack[] }) =>
      musicService.reorderPlaylist(
        playlistId,
        tracks.map((track, index) => ({ trackId: track.id, sortOrder: index }))
      ),
    onMutate: async ({ playlistId, tracks }) => {
      const memberKey = ['music-playlist-member-tracks', playlistId] as const;
      const detailKey = ['music-playlist-detail', playlistId] as const;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: memberKey }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ]);
      const previousTracks = queryClient.getQueryData<MusicTrack[]>(memberKey);
      const previousDetail = queryClient.getQueryData<MusicPlaylist>(detailKey);
      queryClient.setQueryData(memberKey, tracks);
      if (previousDetail) {
        queryClient.setQueryData<MusicPlaylist>(detailKey, {
          ...previousDetail,
          tracks,
        });
      }
      return { previousTracks, previousDetail };
    },
    onError: (error, { playlistId }, context) => {
      if (context?.previousTracks) {
        queryClient.setQueryData(
          ['music-playlist-member-tracks', playlistId],
          context.previousTracks
        );
      } else {
        queryClient.removeQueries({
          queryKey: ['music-playlist-member-tracks', playlistId],
          exact: true,
        });
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ['music-playlist-detail', playlistId],
          context.previousDetail
        );
      }
      toast.error(extractApiErrorMessage(error, '调整排序失败，已恢复原顺序'));
    },
    onSettled: (_data, _error, { playlistId }) => {
      queryClient.invalidateQueries({ queryKey: ['music-playlist-member-tracks', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlist-detail', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    },
  });

  // 一键发布:把「编排歌单」与「对外发布」串成一步。
  // 关键修复:发布前先确保歌单本体 PUBLIC/ACTIVE(否则公开 API 会静默隐藏私有/下架歌单),
  // 再设为展示位并启用公开播放器;两步都成功后才提示(原实现 toast 抢在 mutation 之前)。
  const publishPlaylistMutation = useMutation({
    mutationFn: async ({ playlistId }: { playlistId: number }) => {
      const target = playlists.find((item) => item.id === playlistId);
      if (target && (target.visibility !== 'PUBLIC' || target.status !== 'ACTIVE')) {
        // 带全字段回传 —— Go 端 UpdatePlaylist 把缺省字段映射为 nil/0,
        // 漏传 coverMediaFileId / sortOrder 会清掉封面并把排序重置为 0。
        await musicService.updatePlaylist(playlistId, {
          name: target.name,
          description: target.description,
          coverMediaFileId: target.coverMediaFileId,
          visibility: 'PUBLIC',
          status: 'ACTIVE',
          displayOnHome: target.displayOnHome,
          displayOnProfile: target.displayOnProfile,
          carouselEnabled: target.carouselEnabled,
          randomEnabled: target.randomEnabled,
          sortOrder: target.sortOrder,
        });
      }
      const response = await musicService.updateSettings(
        buildMusicSettingsUpdate(getLatestSettings(), {
          featuredPlaylistId: playlistId,
          enabled: true,
        })
      );
      queryClient.setQueryData(MUSIC_SETTINGS_QUERY_KEY, response.data);
    },
    onSuccess: (_data, { playlistId }) => {
      const name = playlists.find((item) => item.id === playlistId)?.name;
      toast.success(`已公开展示「${name || '该歌单'}」 · 公开播放器已启用`);
      invalidateMusic();
    },
    onError: async (error, { playlistId }) => {
      toast.error(extractApiErrorMessage(error, '发布歌单失败'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MUSIC_SETTINGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['music-playlists'] }),
        queryClient.invalidateQueries({ queryKey: ['music-playlist-detail', playlistId] }),
      ]);
    },
    onSettled: finishSettingsWrite,
  });

  const isPlaylistWriteBusy =
    createPlaylistMutation.isPending ||
    updatePlaylistMutation.isPending ||
    deletePlaylistMutation.isPending ||
    playlistTrackMutation.isPending ||
    removePlaylistTrackMutation.isPending ||
    reorderPlaylistMutation.isPending ||
    publishPlaylistMutation.isPending;

  useEffect(() => {
    if (!selectedPlaylistId && playlists.length > 0) {
      selectPlaylist(playlists[0].id);
    }
  }, [playlists, selectPlaylist, selectedPlaylistId]);

  useEffect(() => {
    const detail = playlistDetailQuery.data;
    if (!detail || detail.id !== selectedPlaylistId) return;
    if (playlistDraftSourceId === detail.id && playlistDraftDirty) return;
    playlistDraftRevisionRef.current += 1;
    setPlaylistDraft(playlistToDraft(detail));
    setPlaylistDraftSourceId(detail.id);
    setPlaylistDraftDirty(false);
  }, [playlistDetailQuery.data, playlistDraftDirty, playlistDraftSourceId, selectedPlaylistId]);

  useEffect(() => {
    setSelectedCandidateIds([]);
  }, [settings.mediaFolderId, scanKeyword, scanPage, scanPageSize]);

  useEffect(() => {
    setTrackToAdd('');
  }, [selectedPlaylistId, deferredPlaylistTrackKeyword]);

  const saveSettingsPatch = (patch: Partial<MusicSettingsRequest>) => {
    if (!settingsQuery.data || settingsWriteLockRef.current) return;
    if (!beginSettingsWrite()) return;
    settingsMutation.mutate(patch);
  };

  const commitCarouselInterval = () => {
    const value = Math.min(60, Math.max(3, Number(carouselIntervalDraft) || 8));
    setCarouselIntervalDraft(String(value));
    setCarouselIntervalDirty(false);
    if (value !== settings.carouselIntervalSeconds) {
      saveSettingsPatch({ carouselIntervalSeconds: value });
    }
  };

  const publishPlaylist = (playlistId: number) => {
    if (publishPlaylistMutation.isPending || deletePlaylistMutation.isPending || !settingsQuery.data || !beginSettingsWrite()) return;
    publishPlaylistMutation.mutate({ playlistId });
  };
  const createMusicFolder = () => {
    if (createFolderMutation.isPending || !settingsQuery.data || !beginSettingsWrite()) return;
    createFolderMutation.mutate();
  };
  const unpublishPlayer = () => {
    saveSettingsPatch({ enabled: false });
  };

  const toggleCandidate = (id: number) => {
    setSelectedCandidateIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  };

  const toggleCurrentPageCandidates = () => {
    if (currentPageCandidateIds.length === 0) return;
    setSelectedCandidateIds((ids) => {
      const pageIds = new Set(currentPageCandidateIds);
      const allCurrentPageSelected = currentPageCandidateIds.every((id) => ids.includes(id));
      if (allCurrentPageSelected) {
        return ids.filter((id) => !pageIds.has(id));
      }
      const next = new Set(ids);
      currentPageCandidateIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  };

  const saveSelectedPlaylist = () => {
    if (!canSavePlaylistDraft({
      selectedPlaylistId,
      loadedPlaylistId: playlistDraftSourceId,
      isFetching: playlistDetailQuery.isFetching,
      isSaving: updatePlaylistMutation.isPending || publishPlaylistMutation.isPending || deletePlaylistMutation.isPending,
    })) return;
    updatePlaylistMutation.mutate({
      id: selectedPlaylistId!,
      data: buildMusicPlaylistUpdate(playlistDraft, selectedPlaylist?.name || '未命名歌单'),
      revision: playlistDraftRevisionRef.current,
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!settings.mediaFolderId) {
      toast.error('请先指定音乐大厅媒体目录，或创建一个目录后再上传');
      return;
    }
    for (const file of Array.from(files)) {
      if (!isCommonAudioFile(file)) {
        toast.error(`${file.name} 不是音频文件`);
        continue;
      }
      try {
        setUploadingLabel(file.name);
        const media = await mediaService.upload(file, undefined, { folderId: settings.mediaFolderId });
        await musicService.importMedia({ mediaFileId: media.id });
        toast.success(`上传并纳入曲库：${file.name}`);
      } catch (error) {
        toast.error(extractApiErrorMessage(error, `上传失败：${file.name}`));
      } finally {
        setUploadingLabel('');
      }
    }
    invalidateMusic();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const playSingle = (track: MusicTrack) => {
    if (currentTrack?.id === track.id) {
      void (playbackError ? retryPlayback() : togglePlayback());
      return;
    }
    const source = tracks.length > 0 ? tracks : [track];
    const index = Math.max(0, source.findIndex((item) => item.id === track.id));
    playTracks(source, index);
  };

  const renderHallStage = () => {
    const stageTrack = currentTrack ?? tracks[0];
    const featuredName = settings.featuredPlaylistId
      ? playlists.find((p) => p.id === settings.featuredPlaylistId)?.name
      : undefined;
    const surfaceList = ['公开音乐页', settings.showOnProfileCard && '个人卡片'].filter(Boolean).join(' · ');
    const stageIsCurrent = Boolean(currentTrack && stageTrack && currentTrack.id === stageTrack.id);
    const stagePlaying = stageIsCurrent && isPlaying;
    const stageProgressPercent = stageIsCurrent ? percent : 0;
    const stageCover = stageTrack?.coverUrl || stageTrack?.media?.thumbnailUrl || '';
    const stageQueueIndex = stageIsCurrent ? currentIndex : 0;
    const handleStageMain = () => {
      if (!stageTrack) return;
      if (stageIsCurrent) {
        void (playbackError ? retryPlayback() : togglePlayback());
        return;
      }
      if (tracks.length > 0) {
        playTracks(tracks, Math.max(0, tracks.findIndex((t) => t.id === stageTrack.id)));
      }
    };
    const fmtClock = (s: number) => {
      if (!Number.isFinite(s) || s <= 0) return '0:00';
      const w = Math.floor(s);
      return `${Math.floor(w / 60)}:${String(w % 60).padStart(2, '0')}`;
    };
    const handleStageSeekPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!stageIsCurrent) return;
      if (event.type === 'pointercancel') {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }
      if (event.type === 'pointerdown') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (event.type === 'pointermove' && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width > 0) {
        seekToPercent(((event.clientX - rect.left) / rect.width) * 100);
      }
      if (event.type === 'pointerup' && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };
    return (
      <div {...musicSkinScopeProps(settings, isDark)} className="access-surface overflow-hidden rounded-[var(--music-radius-panel)]">
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-5">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--aurora-1)]">
              <Disc3 className="h-3.5 w-3.5" />
              Music Hall Control
            </div>
            <h2 className="mt-3 text-xl font-black tracking-normal text-[var(--ink-primary)] sm:text-3xl">音乐大厅中控台</h2>
            <p className="mt-3 hidden max-w-3xl text-sm leading-7 text-[var(--ink-secondary)] min-[769px]:block">
              媒体库负责存储，音乐大厅负责策展、排序、公开展示、歌词封面和播放策略。上传入口会写入指定媒体目录，歌单排序与媒体库目录保持解耦。
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <span className="flex items-center gap-2 font-bold">
                  <span className={cn('h-2 w-2 rounded-full', settings.enabled ? 'bg-[var(--signal-success)]' : 'bg-[color-mix(in_oklch,var(--ink-primary)_30%,transparent)]')} />
                  {settings.enabled ? <span className="text-[var(--signal-success)]">已对外公开</span> : <span className="text-[var(--ink-muted)]">未公开</span>}
                </span>
                <span className="text-[var(--ink-secondary)]">公开歌单<span className="ml-1.5 font-semibold text-[var(--ink-primary)]">{featuredName || '未设置'}</span></span>
                <span className="text-[var(--ink-muted)]">展示位 {surfaceList || '无'}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (settings.enabled ? unpublishPlayer() : saveSettingsPatch({ enabled: true }))}
                  className={textButtonClass(settings.enabled ? 'default' : 'primary')}
                  disabled={!settingsQuery.data || isSettingsWriteBusy}
                >
                  <Radio className="h-4 w-4" />
                  {settings.enabled ? '停止公开' : '启用公开'}
                </button>
                <a href="/music" target="_blank" rel="noreferrer" className={textButtonClass()}>
                  <ExternalLink className="h-4 w-4" />
                  预览公开页
                </a>
              </div>
            </div>
            {settings.enabled && !settings.featuredPlaylistId && (
              <p className="mt-2 flex items-center gap-2 text-xs text-[var(--signal-warn)]">
                <Radio className="h-3.5 w-3.5 shrink-0" />
                已启用公开播放器,但还没有选择公开歌单 —— 到「歌单编排」点某个歌单的「设为公开」即可对外展示。
              </p>
            )}

            <div className="mt-5 hidden grid-cols-2 gap-3 md:grid md:grid-cols-4">
              <StageMetric label="曲库" value={summaryQuery.data?.trackCount ?? tracksQuery.data?.total ?? 0} />
              <StageMetric label="展示中" value={summaryQuery.data?.activeTrackCount ?? 0} />
              <StageMetric label="歌单" value={summaryQuery.data?.playlistCount ?? playlists.length} />
              <StageMetric label="可扫音频" value={summaryQuery.data?.availableAudioCount ?? 0} />
            </div>
          </div>

          <div className="relative isolate overflow-hidden rounded-[var(--music-radius-detail)] bg-[linear-gradient(180deg,color-mix(in_oklch,var(--bg-raised)_88%,white_6%),color-mix(in_oklch,var(--bg-void)_82%,var(--aurora-1)_18%))] p-4 text-[var(--ink-primary)] shadow-[0_20px_50px_-40px_color-mix(in_oklch,black_80%,transparent)]">
            {stageCover && (
              <img
                src={stageCover}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-10 -top-10 h-56 w-[calc(100%+5rem)] scale-110 object-cover opacity-[0.22] blur-3xl saturate-150"
              />
            )}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklch,black_4%,transparent),color-mix(in_oklch,var(--bg-void)_62%,transparent)_72%),radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--aurora-1)_22%,transparent),transparent_48%)]" />

            <div className="relative z-10">
              <div className="flex items-center justify-between gap-3">
                <p className="flex min-w-0 items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--aurora-1)]" />
                  <span className="truncate">后台试听</span>
                </p>
                <span className="shrink-0 rounded-full border border-[color-mix(in_oklch,white_12%,transparent)] bg-[color-mix(in_oklch,var(--bg-raised)_62%,transparent)] px-2.5 py-1 text-[11px] font-bold text-[var(--ink-secondary)] [backdrop-filter:blur(14px)_saturate(140%)]">
                  {queue.length > 0 ? `${stageQueueIndex + 1}/${queue.length}` : '队列 0'}
                </span>
              </div>

              <div className="mx-auto mt-4 block w-[min(58vw,11.5rem)] rounded-[var(--music-radius-artwork-lg)]">
                <span className="relative block aspect-square overflow-hidden rounded-[var(--music-radius-artwork-lg)] bg-[radial-gradient(circle_at_50%_44%,color-mix(in_oklch,var(--aurora-1)_24%,var(--bg-raised)),color-mix(in_oklch,var(--bg-void)_88%,var(--aurora-1)_12%))] shadow-[var(--music-shadow-artwork)]">
                  {stageCover ? (
                    <img src={stageCover} alt={stageTrack?.title || ''} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <Disc3 className="h-16 w-16 text-[color-mix(in_oklch,var(--ink-secondary)_88%,transparent)]" />
                    </span>
                  )}
                </span>
              </div>

              <div className="mx-auto mt-4 max-w-[18rem] text-center">
                <h3 className="truncate text-xl font-black leading-tight tracking-normal text-[var(--ink-primary)]" title={stageTrack?.title}>
                  {stageTrack?.title || '等待选择歌曲'}
                </h3>
                <p className="mt-1 truncate text-sm font-medium text-[var(--ink-secondary)]" title={stageTrack?.artist || stageTrack?.album || stageTrack?.media?.originalName}>
                  {stageTrack?.artist || '未知艺术家'}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
                  {stageTrack ? (stageTrack.album || '未分专辑') : (settings.mediaFolderId ? `媒体目录 #${settings.mediaFolderId}` : '未指定媒体目录')}
                </p>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onPointerDown={handleStageSeekPointer}
                  onPointerMove={handleStageSeekPointer}
                  onPointerUp={handleStageSeekPointer}
                  onPointerCancel={handleStageSeekPointer}
                  onKeyDown={(event) => {
                    if (!stageIsCurrent) return;
                    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      seekToPercent(Math.min(100, stageProgressPercent + 5));
                    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      seekToPercent(Math.max(0, stageProgressPercent - 5));
                    } else if (event.key === 'Home') {
                      event.preventDefault();
                      seekToPercent(0);
                    } else if (event.key === 'End') {
                      event.preventDefault();
                      seekToPercent(100);
                    }
                  }}
                  disabled={!stageTrack || !stageIsCurrent}
                  role={stageIsCurrent ? 'slider' : undefined}
                  aria-valuemin={stageIsCurrent ? 0 : undefined}
                  aria-valuemax={stageIsCurrent ? 100 : undefined}
                  aria-valuenow={stageIsCurrent ? Math.round(stageProgressPercent) : undefined}
                  aria-valuetext={stageIsCurrent ? `${fmtClock(progress)} / ${fmtClock(duration || stageTrack?.durationSeconds || 0)}` : undefined}
                  className="flex min-h-11 w-full touch-none items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] disabled:cursor-not-allowed"
                  aria-label={stageIsCurrent ? '调整试听进度' : '播放后可调整进度'}
                >
                  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)]">
                    <span className="block h-full rounded-full bg-[var(--aurora-1)] transition-[width] duration-200" style={{ width: `${stageProgressPercent}%` }} />
                  </span>
                </button>
                <div className="mt-2 flex items-center justify-between text-[10px] tnum text-[var(--ink-muted)]">
                  <span>{fmtClock(stageIsCurrent ? progress : 0)}</span>
                  <span>{fmtClock(stageIsCurrent ? duration : (stageTrack?.durationSeconds || 0))}</span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-center gap-4">
                <button type="button" onClick={previousTrack} disabled={queue.length === 0} className="flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-[var(--ink-secondary)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-40" aria-label="上一首" title="上一首">
                  <SkipBack className="h-5 w-5 fill-current" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={handleStageMain}
                  disabled={!stageTrack}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ink-primary)] text-[var(--bg-void)] shadow-[inset_0_0_0_0.5px_color-mix(in_oklch,var(--bg-void)_16%,transparent)] transition-opacity duration-100 hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={stageIsCurrent && playbackError ? '重新尝试试听' : stagePlaying ? '暂停试听' : '播放试听'}
                  title={stageIsCurrent && playbackError ? '重新尝试' : stagePlaying ? '暂停' : '播放'}
                >
                  {stagePlaying ? <Pause className="h-5 w-5 fill-current" strokeWidth={1.5} /> : <Play className="h-5 w-5 translate-x-px fill-current" strokeWidth={1.5} />}
                </button>
                <button type="button" onClick={nextTrack} disabled={queue.length === 0} className="flex h-11 w-11 items-center justify-center rounded-full bg-transparent text-[var(--ink-secondary)] transition-[background-color,color,opacity] duration-100 hover:bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] hover:text-[var(--ink-primary)] active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-40" aria-label="下一首" title="下一首">
                  <SkipForward className="h-5 w-5 fill-current" strokeWidth={1.5} />
                </button>
              </div>
              {playbackError && stageIsCurrent && (
                <div role="alert" className="mt-3 flex items-center gap-2 rounded-xl border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_9%,transparent)] px-3 py-2 text-xs text-[var(--ink-primary)]">
                  <span className="min-w-0 flex-1">{playbackError}</span>
                  <button
                    type="button"
                    onClick={() => void retryPlayback()}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] px-3 font-bold text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重试
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDirectoryGuard = () => (
    <div className={cn(panelClass, 'space-y-3')}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] text-[var(--signal-warn)]">
          <FolderPlus className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--ink-primary)]">需要先指定音乐大厅媒体目录</p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            音乐大厅只保存播放管理映射，音频文件仍放在媒体库。请选择已有目录，或创建一个专用目录后再上传/扫描。
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <Select
          value={settings.mediaFolderId ? String(settings.mediaFolderId) : ''}
          onValueChange={(value) => saveSettingsPatch({ mediaFolderId: value ? Number(value) : undefined })}
          options={folderOptions}
          placeholder="选择已有媒体目录"
          prefix={<Disc3 />}
          ariaLabel="音乐大厅媒体目录"
        />
        <input
          value={newFolderName}
          onChange={(event) => setNewFolderName(event.target.value)}
          className={inputClass()}
          placeholder={MUSIC_HALL_FOLDER_NAME}
          aria-label="新音乐大厅目录名称"
        />
        <button
          type="button"
          onClick={createMusicFolder}
          disabled={createFolderMutation.isPending || isSettingsWriteBusy || !settingsQuery.data}
          className={textButtonClass('primary')}
        >
          {createFolderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
          创建目录
        </button>
      </div>
    </div>
  );

  const renderLibrary = () => (
    <div className="space-y-4">
      {!settings.mediaFolderId && renderDirectoryGuard()}

      <div className={cn(panelClass, 'space-y-3')}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                value={trackKeyword}
                onChange={(event) => {
                  setTrackKeyword(event.target.value);
                  setTrackPage(1);
                }}
                className={inputClass('pl-9')}
                placeholder="搜索歌曲、艺术家、专辑或文件名"
                aria-label="搜索歌曲"
              />
            </div>
            <input
              id="music-hall-audio-upload"
              ref={fileInputRef}
              type="file"
              multiple
              accept={MUSIC_UPLOAD_ACCEPT}
              className="sr-only"
              disabled={!settings.mediaFolderId || Boolean(uploadingLabel)}
              onChange={(event) => handleFiles(event.target.files)}
            />
            <label
              htmlFor="music-hall-audio-upload"
              role="button"
              tabIndex={!settings.mediaFolderId || Boolean(uploadingLabel) ? -1 : 0}
              aria-disabled={!settings.mediaFolderId || Boolean(uploadingLabel)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                fileInputRef.current?.click();
              }}
              className={cn(
                textButtonClass('primary'),
                (!settings.mediaFolderId || Boolean(uploadingLabel)) && 'pointer-events-none opacity-50'
              )}
            >
              {uploadingLabel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploadingLabel ? '上传中' : '上传音频'}
            </label>
            <button
              type="button"
              onClick={() => scanQuery.refetch()}
              className={textButtonClass()}
              disabled={!settings.mediaFolderId || scanQuery.isFetching}
            >
              <RefreshCw className={cn('h-4 w-4', scanQuery.isFetching && 'animate-spin')} />
              刷新扫描
            </button>
          </div>
          {uploadingLabel && (
            <p className="truncate text-xs text-[var(--ink-muted)]">
              正在上传并纳入曲库：<span className="text-[var(--ink-primary)]">{uploadingLabel}</span>
            </p>
          )}
        </div>

        <div className={cn('grid grid-cols-1 gap-4', editingTrack && 'xl:grid-cols-[minmax(0,1fr)_360px]')}>
        <div className={shellClass}>
          <AdminSectionHeader
            icon={<Music2 className="h-4 w-4" />}
            title="歌曲库"
            description="独立于媒体库排序的播放管理层"
            aside={<AdminSectionCount>{tracksQuery.isLoading ? '加载中' : `${tracks.length}/${tracksQuery.data?.total ?? 0}`}</AdminSectionCount>}
          />
          <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
            {tracksQuery.isLoading ? (
              <div className="p-6 text-sm text-[var(--ink-muted)]">正在加载歌曲库...</div>
            ) : tracks.length === 0 ? (
              <div className="p-6 text-sm leading-6 text-[var(--ink-muted)]">
                曲库还是空的。<span className="text-[var(--ink-secondary)]">上传音频</span>或在下方「媒体库音频扫描」纳入曲库;入库后点歌曲「加入歌单」,再到「歌单编排」把歌单「设为公开」即可对外展示。
              </div>
            ) : (
              tracks.map((track) => (
                <div
                  key={track.id}
                  className={cn(
                    'grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]',
                    editingTrack?.id === track.id && 'bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)]'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => playSingle(track)}
                    className={iconButtonClass(currentTrack?.id === track.id, 'primary')}
                    aria-label={currentTrack?.id === track.id && isPlaying ? `暂停 ${track.title}` : `播放 ${track.title}`}
                  >
                    {currentTrack?.id === track.id && isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => requestTrackNavigation({ kind: 'select', track })}
                    className="flex min-h-11 min-w-0 flex-col justify-center rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                  >
                    <p className="truncate text-sm font-semibold text-[var(--ink-primary)]">{track.title}</p>
                    <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">
                      {track.artist || '未知艺术家'} · {track.album || '未分专辑'} · {formatFileSize(track.media?.fileSize ?? 0)}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'hidden rounded-full px-2 py-1 text-xs font-semibold sm:inline-flex',
                      track.status === 'ACTIVE'
                        ? 'bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] text-[var(--signal-success)]'
                        : 'bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[var(--ink-muted)]'
                    )}>
                      {track.status === 'ACTIVE' ? '展示' : '隐藏'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingDelete({ kind: 'track', track, deleteMedia: false })}
                      className={iconButtonClass(false, 'danger')}
                      aria-label={`移除 ${track.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <AdminPagination
            page={tracksQuery.data?.pageNum ?? trackPage}
            total={tracksQuery.data?.total ?? 0}
            totalPages={tracksQuery.data?.pages ?? 1}
            pageSize={trackPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setTrackPage}
            onPageSizeChange={(size) => {
              setTrackPageSize(size);
              setTrackPage(1);
            }}
            itemLabel="首"
            loading={tracksQuery.isFetching}
          />
        </div>

        {editingTrack && (
          <TrackEditor
            track={editingTrack}
            onClose={() => requestTrackNavigation({ kind: 'close' })}
            onDraftChange={() => {
              trackDraftRevisionRef.current += 1;
              setTrackDraftDirty(true);
            }}
            dirty={trackDraftDirty}
            onSave={(track, data) => updateTrackMutation.mutate({
              id: track.id,
              data,
              revision: trackDraftRevisionRef.current,
            })}
            saving={updateTrackMutation.isPending}
            playlistOptions={playlistOptions}
            playlistCount={playlists.length}
            onAddToPlaylist={(playlistId, trackId) => playlistTrackMutation.mutate({ playlistId, trackId })}
            addingToPlaylist={playlistTrackMutation.isPending || reorderPlaylistMutation.isPending || removePlaylistTrackMutation.isPending || deletePlaylistMutation.isPending}
            onRequestDeleteWithMedia={(track) => setPendingDelete({ kind: 'track', track, deleteMedia: true })}
            onPreview={playSingle}
          />
        )}
        </div>

        <div className={shellClass}>
          <AdminSectionHeader
            icon={<Wand2 className="h-4 w-4" />}
            title="媒体库音频扫描"
            description={settings.mediaFolderId ? '扫描音乐大厅目录下尚未纳入曲库的音频文件' : '指定目录后可扫描'}
            aside={
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={toggleCurrentPageCandidates}
                  className={textButtonClass(isCurrentPageFullySelected ? 'default' : 'primary')}
                  disabled={currentPageCandidateIds.length === 0 || scanQuery.isFetching || batchImportMutation.isPending}
                  aria-label={isCurrentPageFullySelected ? '取消选择当前页扫描结果' : '选择当前页扫描结果'}
                >
                  <Check className="h-4 w-4" />
                  {isCurrentPageFullySelected ? '取消本页' : '全选本页'}
                  {currentPageCandidateIds.length > 0 ? ` ${currentPageCandidateIds.length}` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => batchImportMutation.mutate(selectedCandidateIds)}
                  className={textButtonClass('primary')}
                  disabled={selectedCandidateIds.length === 0 || batchImportMutation.isPending}
                >
                  {batchImportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  批量纳入 {selectedCandidateIds.length > 0 ? selectedCandidateIds.length : ''}
                </button>
              </div>
            }
          />
          <div className="border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                value={scanKeyword}
                onChange={(event) => {
                  setScanKeyword(event.target.value);
                  setScanPage(1);
                }}
                className={inputClass('pl-9')}
                placeholder="按媒体文件名筛选扫描结果"
                aria-label="扫描结果搜索"
              />
            </div>
          </div>
          <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
            {!settings.mediaFolderId ? (
              <div className="p-6 text-sm text-[var(--ink-muted)]">请先指定音乐大厅媒体目录。</div>
            ) : scanQuery.isLoading ? (
              <div className="p-6 text-sm text-[var(--ink-muted)]">正在扫描媒体目录...</div>
            ) : scanItems.length === 0 ? (
              <div className="p-6 text-sm text-[var(--ink-muted)]">未发现可纳入的音频文件。</div>
            ) : (
              scanItems.map((item: MusicAudioCandidate) => (
                <div key={item.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                  <label className="flex h-11 w-11 items-center justify-center rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] min-[769px]:h-10 min-[769px]:w-10">
                    <input
                      type="checkbox"
                      checked={selectedCandidateSet.has(item.id)}
                      disabled={Boolean(item.mappedTrackId)}
                      onChange={() => toggleCandidate(item.id)}
                      className="h-4 w-4 accent-[var(--aurora-1)] disabled:opacity-40"
                      aria-label={`选择 ${item.originalName}`}
                    />
                  </label>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--ink-primary)]">{item.originalName}</p>
                    <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">
                      {item.mimeType || 'audio'} · {formatFileSize(item.fileSize)}
                      {item.mappedTrackId ? ` · 已纳入：${item.mappedTitle || item.mappedTrackId}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => importMutation.mutate({ mediaFileId: item.id })}
                    className={textButtonClass(item.mappedTrackId ? 'default' : 'primary')}
                    disabled={Boolean(item.mappedTrackId) || importMutation.isPending}
                    aria-label={`将 ${item.originalName} 纳入曲库`}
                  >
                    {importMutation.isPending && importMutation.variables?.mediaFileId === item.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    纳入
                  </button>
                </div>
              ))
            )}
          </div>
          <AdminPagination
            page={scanQuery.data?.pageNum ?? scanPage}
            total={scanQuery.data?.total ?? 0}
            totalPages={scanQuery.data?.pages ?? 1}
            pageSize={scanPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setScanPage}
            onPageSizeChange={(size) => {
              setScanPageSize(size);
              setScanPage(1);
            }}
            itemLabel="个"
            loading={scanQuery.isFetching}
          />
        </div>
    </div>
  );

  function renderPlaylists() {
    const detail = playlistDetailQuery.data?.id === selectedPlaylistId
      ? playlistDetailQuery.data
      : undefined;
    const detailTracks = playlistMemberTracksQuery.data ?? detail?.tracks ?? [];
    const existingTrackIds = buildPlaylistTrackIdSet(playlistMemberTracksQuery.data ?? []);
    const playlistTrackOptions = buildPlaylistTrackOptions(playlistTrackCandidates, existingTrackIds);
    const playlistCandidateTotal = playlistTrackCandidatesQuery.data?.total ?? 0;
    const playlistCandidateLoaded = playlistTrackCandidates.length;
    const hasMorePlaylistCandidates = playlistCandidateTotal > playlistCandidateLoaded;
    const isPlaylistMemberTrackLoading = Boolean(selectedPlaylistId) && playlistMemberTracksQuery.isLoading;
    const isPlaylistMemberTrackUnavailable = Boolean(selectedPlaylistId) && playlistMemberTracksQuery.isError;
    const playlistTrackPickerDisabled =
      playlistTrackOptions.length === 0 ||
      playlistTrackCandidatesQuery.isFetching ||
      isPlaylistMemberTrackLoading ||
      isPlaylistMemberTrackUnavailable;
    let playlistTrackPlaceholder = '没有可加入歌曲';
    let playlistTrackStatusText = `可加入 ${playlistTrackOptions.length} 首${playlistCandidateTotal ? ` · 曲库匹配 ${playlistCandidateTotal} 首` : ''}`;
    if (isPlaylistMemberTrackLoading) {
      playlistTrackPlaceholder = '正在核对已加入歌曲';
      playlistTrackStatusText = '正在核对歌单内全部歌曲，避免重复加入已存在曲目...';
    } else if (isPlaylistMemberTrackUnavailable) {
      playlistTrackPlaceholder = '无法核对已加入歌曲';
      playlistTrackStatusText = '无法核对歌单内歌曲，请刷新后重试。';
    } else if (playlistTrackCandidatesQuery.isFetching) {
      playlistTrackPlaceholder = '正在加载曲库';
      playlistTrackStatusText = '正在更新候选歌曲...';
    } else if (playlistTrackOptions.length > 0) {
      playlistTrackPlaceholder = '从候选歌曲加入';
    } else if (playlistTrackKeyword.trim()) {
      playlistTrackPlaceholder = '没有匹配的可加入歌曲';
    }
    if (!isPlaylistMemberTrackLoading && !isPlaylistMemberTrackUnavailable && !playlistTrackCandidatesQuery.isFetching && hasMorePlaylistCandidates) {
      playlistTrackStatusText = `已载入 ${playlistCandidateLoaded} / ${playlistCandidateTotal} 首，输入关键词可继续定位更多歌曲。`;
    }
    const moveTrack = (index: number, direction: -1 | 1) => {
      if (
        !selectedPlaylistId ||
        !detail ||
        reorderPlaylistMutation.isPending ||
        playlistTrackMutation.isPending ||
        removePlaylistTrackMutation.isPending ||
        deletePlaylistMutation.isPending
      ) return;
      const next = movePlaylistTrack(detailTracks, index, direction);
      if (next === detailTracks) return;
      reorderPlaylistMutation.mutate({ playlistId: selectedPlaylistId, tracks: next });
    };

    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className={cn(panelClass, 'space-y-3')}>
            <p className="text-sm font-bold text-[var(--ink-primary)]">创建歌单</p>
            <input value={playlistForm.name} onChange={(e) => setPlaylistForm((f) => ({ ...f, name: e.target.value }))} className={inputClass()} />
            <input value={playlistForm.description} onChange={(e) => setPlaylistForm((f) => ({ ...f, description: e.target.value }))} className={inputClass()} placeholder="歌单描述" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <TogglePill checked={playlistForm.displayOnProfile} label="个人卡片" onClick={() => setPlaylistForm((f) => ({ ...f, displayOnProfile: !f.displayOnProfile }))} />
              <TogglePill checked={playlistForm.carouselEnabled} label="轮播" onClick={() => setPlaylistForm((f) => ({ ...f, carouselEnabled: !f.carouselEnabled }))} />
              <TogglePill checked={playlistForm.randomEnabled} label="随机" onClick={() => setPlaylistForm((f) => ({ ...f, randomEnabled: !f.randomEnabled }))} />
            </div>
            <button type="button" onClick={() => createPlaylistMutation.mutate()} className={textButtonClass('primary')} disabled={isPlaylistWriteBusy}>
              <Plus className="h-4 w-4" />
              创建歌单
            </button>
          </div>

          <div className={shellClass}>
            <AdminSectionHeader icon={<ListMusic className="h-4 w-4" />} title="歌单列表" aside={<AdminSectionCount>{playlists.length} 个</AdminSectionCount>} />
            <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
              {playlists.length === 0 ? (
                <div className="p-4 text-sm text-[var(--ink-muted)]">暂无歌单。</div>
              ) : playlists.map((playlist) => (
                <div
                  key={playlist.id}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]',
                    selectedPlaylistId === playlist.id && 'bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)]'
                  )}
                >
                  {/* 左侧选择区改回原生 <button> —— 不再用 role=button 容器套子按钮(ARIA 禁止嵌套交互控件);原生按钮自带 Enter/Space 键盘支持 */}
                  <button
                    type="button"
                    onClick={() => requestPlaylistSelection(playlist.id)}
                    aria-pressed={selectedPlaylistId === playlist.id}
                    className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--ink-primary)]">{playlist.name}</span>
                      {settings.featuredPlaylistId === playlist.id && (
                        <span className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
                          settings.enabled
                            ? 'bg-[color-mix(in_oklch,var(--signal-success)_16%,transparent)] text-[var(--signal-success)]'
                            : 'bg-[color-mix(in_oklch,var(--signal-warn)_16%,transparent)] text-[var(--signal-warn)]'
                        )}>
                          <Radio className="h-3 w-3" />
                          {settings.enabled ? '公开中' : '已选·未启用'}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--ink-muted)]">{playlist.trackCount} 首</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-1">
                    {settings.featuredPlaylistId !== playlist.id && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          publishPlaylist(playlist.id);
                        }}
                        className={iconButtonClass(false, 'primary')}
                        title="设为公开展示并启用公开播放器"
                        aria-label={`将「${playlist.name}」设为公开展示`}
                        disabled={isPlaylistWriteBusy || isSettingsWriteBusy || !settingsQuery.data}
                      >
                        {publishPlaylistMutation.isPending && publishPlaylistMutation.variables?.playlistId === playlist.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Radio className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingDelete({ kind: 'playlist', playlist });
                      }}
                      className={iconButtonClass(false, 'danger')}
                      disabled={isPlaylistWriteBusy || isSettingsWriteBusy}
                      aria-label={`删除歌单「${playlist.name}」`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={shellClass}>
          <AdminSectionHeader
            icon={<Headphones className="h-4 w-4" />}
            title={selectedPlaylist?.name || '选择歌单'}
            description={selectedPlaylist ? '歌单排序独立于媒体库和曲库排序' : '创建或选择一个歌单后开始编排'}
            aside={selectedPlaylist ? (
              <span className="flex items-center gap-2">
                {playlistDraftDirty && playlistDraftSourceId === selectedPlaylistId && (
                  <span className="rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)] px-2 py-1 text-[10px] font-bold text-[var(--signal-warn)]">
                    未保存
                  </span>
                )}
                <AdminSectionCount>{selectedPlaylist.trackCount} 首</AdminSectionCount>
              </span>
            ) : null}
          />
          {selectedPlaylist ? (
            playlistDetailQuery.isError ? (
              <div className="p-6 text-sm text-[var(--ink-muted)]" role="alert">
                <p className="font-semibold text-[var(--ink-primary)]">歌单详情载入失败</p>
                <p className="mt-1">为避免把其他歌单的草稿误存到当前歌单，编辑区已锁定。</p>
                <button
                  type="button"
                  onClick={() => void playlistDetailQuery.refetch()}
                  className={cn(textButtonClass('primary'), 'mt-4')}
                >
                  <RefreshCw className="h-4 w-4" />
                  重新载入
                </button>
              </div>
            ) : playlistDraftSourceId !== selectedPlaylistId ? (
              <div className="flex min-h-48 items-center justify-center p-6 text-center" role="status">
                <div>
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--aurora-1)]" />
                  <p className="mt-3 text-sm font-semibold text-[var(--ink-primary)]">正在切换到「{selectedPlaylist.name}」</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">载入完成前不会显示或保存上一份歌单草稿。</p>
                </div>
              </div>
            ) : (
            <>
              <div className="space-y-4 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">歌单名称</span>
                    <input
                      value={playlistDraft.name}
                      onChange={(e) => updatePlaylistDraft((draft) => ({ ...draft, name: e.target.value }))}
                      className={inputClass()}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">描述</span>
                    <input
                      value={playlistDraft.description || ''}
                      onChange={(e) => updatePlaylistDraft((draft) => ({ ...draft, description: e.target.value }))}
                      className={inputClass()}
                      placeholder="可选"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">排序</span>
                    <input
                      type="number"
                      value={playlistDraft.sortOrder}
                      onChange={(e) => updatePlaylistDraft((draft) => ({ ...draft, sortOrder: Number(e.target.value) || 0 }))}
                      className={inputClass()}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <TogglePill checked={playlistDraft.displayOnProfile} label="卡片" onClick={() => updatePlaylistDraft((draft) => ({ ...draft, displayOnProfile: !draft.displayOnProfile }))} />
                  <TogglePill checked={playlistDraft.carouselEnabled} label="轮播" onClick={() => updatePlaylistDraft((draft) => ({ ...draft, carouselEnabled: !draft.carouselEnabled }))} />
                  <TogglePill checked={playlistDraft.randomEnabled} label="随机" onClick={() => updatePlaylistDraft((draft) => ({ ...draft, randomEnabled: !draft.randomEnabled }))} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Select
                    value={playlistDraft.visibility || 'PUBLIC'}
                    onValueChange={(value) => updatePlaylistDraft((draft) => ({ ...draft, visibility: value as MusicPlaylist['visibility'] }))}
                    options={[
                      { value: 'PUBLIC', label: '公开' },
                      { value: 'PRIVATE', label: '私有' },
                    ]}
                    ariaLabel="歌单可见性"
                  />
                  <Select
                    value={playlistDraft.status || 'ACTIVE'}
                    onValueChange={(value) => updatePlaylistDraft((draft) => ({ ...draft, status: value as MusicPlaylist['status'] }))}
                    options={[
                      { value: 'ACTIVE', label: '展示' },
                      { value: 'HIDDEN', label: '隐藏' },
                    ]}
                    ariaLabel="歌单状态"
                  />
                  <button
                    type="button"
                    onClick={saveSelectedPlaylist}
                    className={textButtonClass('primary')}
                    disabled={!canSavePlaylistDraft({
                      selectedPlaylistId,
                      loadedPlaylistId: playlistDraftSourceId,
                      isFetching: playlistDetailQuery.isFetching,
                      isSaving: isPlaylistWriteBusy,
                    }) || !playlistDraft.name.trim()}
                  >
                    {updatePlaylistMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                    保存歌单
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(180px,0.75fr)_minmax(0,1fr)]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
                    <input
                      value={playlistTrackKeyword}
                      onChange={(event) => setPlaylistTrackKeyword(event.target.value)}
                      className={inputClass('pl-9')}
                      placeholder="搜索曲库歌曲、艺术家或文件名"
                      aria-label="搜索可加入歌单的歌曲"
                    />
                  </div>
                  <Select
                    value={trackToAdd}
                    onValueChange={setTrackToAdd}
                    options={playlistTrackOptions}
                    placeholder={playlistTrackPlaceholder}
                    disabled={playlistTrackPickerDisabled}
                    disabledHint={playlistTrackPlaceholder}
                    prefix={<Music2 />}
                    ariaLabel="选择歌曲加入歌单"
                  />
                  <p className="text-xs leading-5 text-[var(--ink-muted)] lg:col-span-2">
                    {playlistTrackStatusText}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => selectedPlaylistId && trackToAdd && playlistTrackMutation.mutate({ playlistId: selectedPlaylistId, trackId: Number(trackToAdd) })}
                  className={textButtonClass('primary')}
                  disabled={!trackToAdd || playlistTrackMutation.isPending || reorderPlaylistMutation.isPending || removePlaylistTrackMutation.isPending || deletePlaylistMutation.isPending || playlistTrackPickerDisabled}
                >
                  <Plus className="h-4 w-4" />
                  加入歌单
                </button>
              </div>
              <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                {playlistDetailQuery.isLoading || isPlaylistMemberTrackLoading ? (
                  <div className="p-6 text-sm text-[var(--ink-muted)]">正在加载歌单歌曲...</div>
                ) : detailTracks.length === 0 ? (
                  <div className="p-6 text-sm text-[var(--ink-muted)]">这个歌单还没有歌曲。</div>
                ) : detailTracks.map((track, index) => (
                  <div key={track.id} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                    <span className="tnum text-xs font-semibold text-[var(--ink-muted)]">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--ink-primary)]">{track.title}</p>
                      <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{track.artist || '未知艺术家'} · {track.media?.originalName || '未加载媒体文件名'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => playTracks(detailTracks, index)} className={iconButtonClass(false, 'primary')} aria-label={`从「${track.title}」开始播放歌单`} title="试听">
                        <Play className="h-4 w-4" />
                      </button>
                      <div className="hidden items-center gap-2 min-[769px]:flex">
                        <button type="button" onClick={() => moveTrack(index, -1)} className={iconButtonClass()} disabled={index === 0 || reorderPlaylistMutation.isPending || playlistTrackMutation.isPending || removePlaylistTrackMutation.isPending || deletePlaylistMutation.isPending} aria-label={`将「${track.title}」上移`} title="上移">
                          <ArrowUp className="h-4 w-4" strokeWidth={1.9} />
                        </button>
                        <button type="button" onClick={() => moveTrack(index, 1)} className={iconButtonClass()} disabled={index === detailTracks.length - 1 || reorderPlaylistMutation.isPending || playlistTrackMutation.isPending || removePlaylistTrackMutation.isPending || deletePlaylistMutation.isPending} aria-label={`将「${track.title}」下移`} title="下移">
                          <ArrowDown className="h-4 w-4" strokeWidth={1.9} />
                        </button>
                        <button
                          type="button"
                          onClick={() => selectedPlaylistId && removePlaylistTrackMutation.mutate({ playlistId: selectedPlaylistId, trackId: track.id })}
                          className={iconButtonClass(false, 'danger')}
                          disabled={reorderPlaylistMutation.isPending || playlistTrackMutation.isPending || removePlaylistTrackMutation.isPending || deletePlaylistMutation.isPending}
                          aria-label={`从歌单移除「${track.title}」`}
                          title="从歌单移除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <PlaylistTrackActionMenu
                        trackTitle={track.title}
                        moveUpDisabled={index === 0 || reorderPlaylistMutation.isPending || playlistTrackMutation.isPending || removePlaylistTrackMutation.isPending || deletePlaylistMutation.isPending}
                        moveDownDisabled={index === detailTracks.length - 1 || reorderPlaylistMutation.isPending || playlistTrackMutation.isPending || removePlaylistTrackMutation.isPending || deletePlaylistMutation.isPending}
                        removeDisabled={reorderPlaylistMutation.isPending || playlistTrackMutation.isPending || removePlaylistTrackMutation.isPending || deletePlaylistMutation.isPending}
                        onMoveUp={() => moveTrack(index, -1)}
                        onMoveDown={() => moveTrack(index, 1)}
                        onRemove={() => selectedPlaylistId && removePlaylistTrackMutation.mutate({ playlistId: selectedPlaylistId, trackId: track.id })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
            )
          ) : (
            <div className="p-6 text-sm text-[var(--ink-muted)]">选择左侧歌单后可以加入歌曲、试听和调整排序。</div>
          )}
        </div>
      </div>
    );
  }

  function renderDisplay() {
    const modeOptions: SelectOption[] = [
      { value: 'SEQUENTIAL', label: '顺序播放', icon: ListMusic },
      { value: 'SHUFFLE', label: '随机播放', icon: Shuffle },
      { value: 'LOOP', label: '列表循环', icon: RotateCw },
      { value: 'CAROUSEL', label: '轮播展示', icon: Disc3 },
    ];
    if (settingsQuery.isLoading) {
      return (
        <div className={cn(panelClass, 'flex min-h-48 items-center justify-center text-center')} role="status">
          <div>
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-[var(--aurora-1)]" />
            <p className="mt-3 text-sm font-bold text-[var(--ink-primary)]">正在载入播放设置</p>
          </div>
        </div>
      );
    }
    if (settingsQuery.isError || !settingsQuery.data) {
      return (
        <div className={cn(panelClass, 'flex min-h-48 items-center justify-center text-center')} role="alert">
          <div>
            <p className="text-sm font-bold text-[var(--ink-primary)]">播放设置载入失败</p>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">未使用默认值覆盖现有配置。</p>
            <button type="button" onClick={() => void settingsQuery.refetch()} className={cn(textButtonClass('primary'), 'mt-4')}>
              <RefreshCw className="h-4 w-4" />
              重新载入
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <fieldset disabled={isSettingsWriteBusy} aria-busy={isSettingsWriteBusy} className={cn(panelClass, 'space-y-4 disabled:opacity-70')}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TogglePill checked={settings.enabled} label="启用公开播放器" onClick={() => saveSettingsPatch({ enabled: !settings.enabled })} />
            <TogglePill checked={settings.showOnProfileCard} label="个人卡片入口" onClick={() => saveSettingsPatch({ showOnProfileCard: !settings.showOnProfileCard })} />
            <TogglePill checked={settings.carouselEnabled} label="轮播控件" onClick={() => saveSettingsPatch({ carouselEnabled: !settings.carouselEnabled })} />
            <TogglePill checked={settings.randomEnabled} label="随机按钮默认开启" onClick={() => saveSettingsPatch({ randomEnabled: !settings.randomEnabled })} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">默认歌单</span>
              <Select
                value={settings.featuredPlaylistId ? String(settings.featuredPlaylistId) : ''}
                onValueChange={(value) => saveSettingsPatch({ featuredPlaylistId: value ? Number(value) : undefined })}
                options={playlistOptions}
                placeholder="自动选择首个公开歌单"
                prefix={<ListMusic />}
                ariaLabel="默认展示歌单"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">播放策略</span>
              <Select
                value={settings.playbackMode}
                onValueChange={(value) => saveSettingsPatch({ playbackMode: value as MusicPlaybackMode })}
                options={modeOptions}
                ariaLabel="播放策略"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">轮播间隔</span>
              <input
                type="number"
                min={3}
                max={60}
                value={carouselIntervalDraft}
                onChange={(event) => {
                  setCarouselIntervalDraft(event.target.value);
                  setCarouselIntervalDirty(true);
                }}
                onBlur={commitCarouselInterval}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitCarouselInterval();
                    event.currentTarget.blur();
                  }
                }}
                className={inputClass()}
              />
            </label>
          </div>
          <div className="rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-4">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-[var(--aurora-1)]" />
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">音乐皮肤(站点默认)</span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[var(--ink-muted)]">
              一个光源、四色派生,随明暗主题自动翻转。访客可在前台本地临时切换,不影响此处默认。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {MUSIC_SKIN_PRESETS.map((preset) => {
                const active = settings.skinMode === 'preset' && settings.skinPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => saveSettingsPatch({ skinMode: 'preset', skinPreset: preset.id })}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-xl border border-transparent px-3 py-1.5 text-xs font-bold transition-[background-color,color,box-shadow] min-[769px]:min-h-10',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]',
                      active
                        ? 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--ink-primary)]'
                        : 'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]'
                    )}
                    aria-pressed={active}
                  >
                    <span className="h-3.5 w-3.5 rounded-full" style={{ background: isDark ? preset.seedDark : preset.seedLight }} />
                    {preset.label}
                    {active && <Check className="h-3.5 w-3.5 text-[var(--aurora-1)]" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-[var(--ink-muted)]">自定义</span>
              <label className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                <input
                  type="color"
                  value={skinDraftLight}
                  onChange={(event) => setSkinDraftLight(event.target.value)}
                  className="h-11 w-12 cursor-pointer rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] min-[769px]:h-10"
                  aria-label="亮主题光源"
                />
                亮
              </label>
              <label className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                <input
                  type="color"
                  value={skinDraftDark}
                  onChange={(event) => setSkinDraftDark(event.target.value)}
                  className="h-11 w-12 cursor-pointer rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_12%,transparent)] bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] min-[769px]:h-10"
                  aria-label="暗主题光源"
                />
                暗
              </label>
              <button
                type="button"
                onClick={() => saveSettingsPatch({ skinMode: 'custom', skinColorLight: skinDraftLight, skinColorDark: skinDraftDark })}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-black transition-[background-color,color,box-shadow] min-[769px]:min-h-10',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-leaf)]',
                  settings.skinMode === 'custom'
                    ? 'bg-[var(--aurora-1)] text-[var(--bg-void)]'
                    : 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)]'
                )}
              >
                {settings.skinMode === 'custom' ? '自定义已应用' : '应用自定义'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
            <Select
              value={settings.mediaFolderId ? String(settings.mediaFolderId) : ''}
              onValueChange={(value) => saveSettingsPatch({ mediaFolderId: value ? Number(value) : undefined })}
              options={folderOptions}
              placeholder="音乐大厅媒体目录"
              prefix={<Disc3 />}
              ariaLabel="音乐大厅媒体目录"
            />
            <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} className={inputClass()} />
            <button type="button" onClick={createMusicFolder} className={textButtonClass('primary')} disabled={createFolderMutation.isPending || isSettingsWriteBusy || !settingsQuery.data}>
              <FolderPlus className="h-4 w-4" />
              创建目录
            </button>
          </div>
        </fieldset>

        <div className={cn(panelClass, 'space-y-4')}>
          <div className="flex items-start gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]">
              <Volume2 className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-bold text-[var(--ink-primary)]">公开播放器预案</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                公开音乐页和个人卡片会读取公开接口，只展示启用、公开且未删除媒体文件的歌曲。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="歌曲" value={summaryQuery.data?.trackCount ?? 0} />
            <Metric label="展示中" value={summaryQuery.data?.activeTrackCount ?? 0} />
            <Metric label="歌单" value={summaryQuery.data?.playlistCount ?? 0} />
            <Metric label="音频文件" value={summaryQuery.data?.availableAudioCount ?? 0} />
          </div>
        </div>
      </div>
    );
  }

  const pendingDeleteTitle =
    pendingDelete?.kind === 'playlist'
      ? '删除歌单'
      : pendingDelete?.deleteMedia
        ? '移除歌曲并删除媒体文件'
        : '移除歌曲映射';
  const pendingDeleteMessage =
    pendingDelete?.kind === 'playlist'
      ? `歌单「${pendingDelete.playlist.name}」会被删除，媒体库文件和曲库歌曲不会受影响。`
      : pendingDelete?.deleteMedia
        ? `歌曲「${pendingDelete.track.title}」会从曲库移除，并把对应媒体文件移入媒体库回收站。`
        : `歌曲「${pendingDelete?.track.title ?? ''}」只会从音乐管理中移除，媒体库原文件会保留。`;
  const pendingTrackNavigationMessage = pendingTrackNavigation?.kind === 'select'
    ? `切换到「${pendingTrackNavigation.track.title}」会丢弃「${editingTrack?.title || '当前歌曲'}」尚未保存的元数据或歌词修改。`
    : pendingTrackNavigation?.kind === 'tab'
      ? `切换到「${tabs.find((tab) => tab.key === pendingTrackNavigation.tab)?.label || '目标页签'}」会丢弃「${editingTrack?.title || '当前歌曲'}」尚未保存的修改。`
      : `关闭歌曲编辑器会丢弃「${editingTrack?.title || '当前歌曲'}」尚未保存的元数据或歌词修改。`;

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] overflow-x-clip p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          className="music-module-header"
          title="音乐大厅"
          description="以媒体库音频为存储层，独立管理歌曲、歌单、展示入口与播放策略。"
          tabs={tabs}
          activeKey={activeTab}
          onTabChange={(tab) => requestTrackNavigation({ kind: 'tab', tab })}
          tabPanelIdPrefix="admin-module"
          showCurrentLabel={false}
          showActiveSummary={false}
          actions={
            <>
              <button
                type="button"
                onClick={() => tracks.length > 0 && playTracks(tracks, 0)}
                className="admin-module-action-button"
                disabled={tracks.length === 0}
                aria-label="播放当前曲库页"
                title="播放当前曲库页"
              >
                <Play className="h-4 w-4" />
                <span className="hidden sm:inline">播放当前页</span>
                <span className="sm:hidden">播放</span>
              </button>
              <button
                type="button"
                onClick={() => saveSettingsPatch({ enabled: !settings.enabled })}
                className="admin-module-action-button"
                disabled={!settingsQuery.data || isSettingsWriteBusy}
                aria-label={settings.enabled ? '停用公开播放器' : '启用公开播放器'}
                title={settings.enabled ? '公开播放器:已启用(点击停用)' : '公开播放器:未启用(点击启用)'}
              >
                <Volume2 className="h-4 w-4" />
                <span>{settings.enabled ? '已启用' : '启用'}</span>
              </button>
            </>
          }
        />

        {activeTab === 'library' && (
          <section id="admin-module-panel-library" role="tabpanel" aria-labelledby="admin-module-tab-library" tabIndex={0}>
            {renderLibrary()}
          </section>
        )}
        {activeTab === 'playlists' && (
          <section id="admin-module-panel-playlists" role="tabpanel" aria-labelledby="admin-module-tab-playlists" tabIndex={0}>
            {renderPlaylists()}
          </section>
        )}
        {activeTab === 'display' && (
          <section id="admin-module-panel-display" role="tabpanel" aria-labelledby="admin-module-tab-display" tabIndex={0} className="space-y-4">
            {renderHallStage()}
            {renderDisplay()}
          </section>
        )}
      </div>

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title={pendingDeleteTitle}
        message={pendingDeleteMessage}
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        pending={deletePlaylistMutation.isPending || deleteTrackMutation.isPending}
        onCancel={() => {
          if (deleteWriteLockRef.current || deletePlaylistMutation.isPending || deleteTrackMutation.isPending) return;
          setPendingDelete(null);
        }}
        onConfirm={() => {
          if (!pendingDelete || deleteWriteLockRef.current) return;
          if (pendingDelete.kind === 'playlist') {
            if (isPlaylistWriteBusy) return;
            deleteWriteLockRef.current = true;
            deletePlaylistMutation.mutate(pendingDelete.playlist.id);
          } else {
            if (deleteTrackMutation.isPending || updateTrackMutation.isPending) return;
            deleteWriteLockRef.current = true;
            deleteTrackMutation.mutate({
              id: pendingDelete.track.id,
              deleteMedia: pendingDelete.deleteMedia,
            });
          }
        }}
      />
      <ConfirmDialog
        isOpen={pendingTrackNavigation != null}
        title="放弃未保存的歌曲修改？"
        message={pendingTrackNavigationMessage}
        confirmText={pendingTrackNavigation?.kind === 'close' ? '放弃并关闭' : '放弃并继续'}
        cancelText="继续编辑"
        variant="warning"
        onCancel={() => setPendingTrackNavigation(null)}
        onConfirm={() => {
          if (!pendingTrackNavigation) return;
          performTrackNavigation(pendingTrackNavigation);
        }}
      />
      <ConfirmDialog
        isOpen={pendingPlaylistSelectionId != null}
        title="放弃未保存的歌单修改？"
        message={`切换到「${playlists.find((playlist) => playlist.id === pendingPlaylistSelectionId)?.name || '目标歌单'}」会丢弃当前尚未保存的名称、描述或展示设置。`}
        confirmText="放弃并切换"
        cancelText="继续编辑"
        variant="warning"
        onCancel={() => setPendingPlaylistSelectionId(null)}
        onConfirm={() => {
          if (pendingPlaylistSelectionId == null) return;
          const targetId = pendingPlaylistSelectionId;
          setPendingPlaylistSelectionId(null);
          selectPlaylist(targetId);
        }}
      />
    </div>
  );
}
