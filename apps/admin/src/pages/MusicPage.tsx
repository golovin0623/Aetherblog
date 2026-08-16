import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useBlocker } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from 'framer-motion';
import {
  Check,
  Disc3,
  ExternalLink,
  FileText,
  FolderPlus,
  Headphones,
  Heart,
  Image,
  LibraryBig,
  ListMusic,
  ListPlus,
  Loader2,
  Music2,
  Palette,
  Pause,
  Pencil,
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
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import { Select, Skeleton, transition, type SelectOption } from '@aetherblog/ui';
import { useMediaQuery } from '@aetherblog/hooks';
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
  MusicTagSummary,
  MusicTrack,
  MusicTrackRequest,
} from '@aetherblog/types';
import { AdminModuleHeader, type AdminModuleHeaderTab } from '@/components/layout/AdminModuleHeader';
import { AdminSectionCount, AdminSectionHeader } from '@/components/layout/AdminSectionHeader';
import { AdminPagination } from '@/components/common/AdminPagination';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAdminMusicPlayer, useAdminMusicPlayerTimeline } from '@/components/music/AdminMusicPlayerProvider';
import { hasSameAdminMusicQueueTrackIds } from '@/components/music/adminMusicQueueState';
import { acquireOverlayScrollLock } from '@/lib/overlayScrollLock';
import { cn, extractApiErrorMessage, formatFileSize } from '@/lib/utils';
import { folderService } from '@/services/folderService';
import { getMediaUrl, mediaService, type MediaItem } from '@/services/mediaService';
import { mediaTagService } from '@/services/mediaTagService';
import { musicService } from '@/services/musicService';
import { CurationSignalChain } from './music/CurationSignalChain';
import { LyricsWorkspace } from './music/LyricsWorkspace';
import {
  MusicCurationOverview,
  type MusicOverviewLibraryFilter,
} from './music/MusicCurationOverview';
import { MusicTagEditor } from './music/MusicTagEditor';
import { buildTrackCurationState } from './music/musicCuration';
import { isCurrentMusicCoverUploadRequest } from './music/musicCoverArt';
import { parseAudioMetadataFromFile } from './music/musicMetadataParser';
import { extractPaletteFromImageUrl, type ExtractedColorPalette } from './music/musicColorExtractor';
import { BatchActionBar } from './music/BatchActionBar';
import { AddTracksPanel } from './music/AddTracksPanel';
import { PlaylistRail } from './music/PlaylistRail';
import { PlaylistTrackTable, PlaylistTrackTableSkeleton } from './music/PlaylistTrackTable';
import { MusicCoverThumb } from './music/ResonantThumb';
import { formatClock, iconButtonClass, inputClass, panelClass, shellClass, solidButtonClass, textButtonClass } from './music/musicUi';
import {
  PLAYLIST_MEMBER_TRACK_PAGE_SIZE,
  PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE,
  buildPlaylistTrackIdSet,
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

type MusicTab = 'overview' | 'library' | 'lyrics' | 'playlists' | 'display';
type PendingTrackNavigation =
  | { kind: 'select'; track: MusicTrack }
  | { kind: 'close' }
  | { kind: 'tab'; tab: MusicTab; focusTrack?: MusicTrack };
type PendingDelete =
  | { kind: 'track'; track: MusicTrack; deleteMedia: boolean }
  | { kind: 'playlist'; playlist: MusicPlaylist };
type MusicConfirmationConfig = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: 'danger' | 'warning';
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function AdminMusicTimelineSlot({
  children,
}: {
  children: (timeline: ReturnType<typeof useAdminMusicPlayerTimeline>) => ReactNode;
}) {
  const timeline = useAdminMusicPlayerTimeline();
  return children(timeline);
}

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 10;
const MUSIC_HALL_FOLDER_NAME = '音乐大厅';
const MUSIC_SETTINGS_QUERY_KEY = ['music-settings'] as const;
const COMMON_AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'oga', 'opus', 'weba']);
const MUSIC_UPLOAD_ACCEPT = 'audio/*,.mp3,.flac,.m4a,.m4b,.aac,.wav,.ogg,.oga,.opus,.weba';
const OVERVIEW_TRACK_PAGE_SIZE = 100;
const OVERVIEW_FETCH_CONCURRENCY = 4;
const GenerativeCoverStudio = lazy(() => import('./music/GenerativeCoverStudio'));

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

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchAllMusicTracks(): Promise<MusicTrack[]> {
  const firstPage = (await musicService.getTracks({
    pageNum: 1,
    pageSize: OVERVIEW_TRACK_PAGE_SIZE,
  })).data;
  const tracks = [...(firstPage.list ?? [])];
  const missingPages = getMissingPlaylistMemberPageNumbers(
    firstPage.total,
    tracks.length,
    OVERVIEW_TRACK_PAGE_SIZE
  );
  if (missingPages.length === 0) return tracks;
  const remainingPages = await mapWithConcurrency(missingPages, OVERVIEW_FETCH_CONCURRENCY, async (pageNum) =>
    (await musicService.getTracks({
      pageNum,
      pageSize: OVERVIEW_TRACK_PAGE_SIZE,
    })).data
  );
  for (const page of remainingPages) tracks.push(...(page.list ?? []));
  return tracks;
}

const tabs: Array<AdminModuleHeaderTab<MusicTab>> = [
  {
    key: 'overview',
    label: '策展总览',
    shortLabel: '总览',
    description: '用完整度信号链定位曲库的策展缺口。',
    icon: Sparkles,
  },
  {
    key: 'library',
    label: '歌曲库',
    shortLabel: '曲库',
    description: '上传、扫描、筛选并维护歌曲元数据、标签与封面。',
    icon: LibraryBig,
  },
  {
    key: 'lyrics',
    label: '歌词工作台',
    shortLabel: '歌词',
    description: '独立上传、修正、审核并绑定歌词资产。',
    icon: FileText,
  },
  {
    key: 'playlists',
    label: '歌单策展',
    shortLabel: '歌单',
    description: '编排曲序、封面、收藏与公开展示策略。',
    icon: ListMusic,
  },
  {
    key: 'display',
    label: '展示与播放',
    shortLabel: '展示',
    description: '配置个人卡片入口、随机与轮播播放策略。',
    icon: SlidersHorizontal,
  },
];

// 面板 / 按钮 / 输入框样式工厂已抽至 ./music/musicUi(歌单子组件与本页共用);
// 歌单曲目的溢出菜单随曲目表迁至 ./music/PlaylistTrackTable。

function flattenFolders(nodes?: FolderTreeNode[] | null, depth = 0): SelectOption[] {
  if (!Array.isArray(nodes)) return [];
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

function CoverPicker({
  ownerKey,
  title,
  value,
  currentUrl,
  items,
  loading,
  uploadFolderId,
  onChange,
}: {
  ownerKey: string;
  title: string;
  value?: number;
  currentUrl?: string;
  items: MediaItem[];
  loading: boolean;
  uploadFolderId?: number;
  onChange: (media?: MediaItem) => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRequestRef = useRef(0);
  const currentOwnerKeyRef = useRef(ownerKey);
  const [uploadedItem, setUploadedItem] = useState<MediaItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  currentOwnerKeyRef.current = ownerKey;
  const selectedItem = items.find((item) => item.id === value);
  const previewItem = uploadedItem?.id === value ? uploadedItem : selectedItem;
  const previewUrl = previewItem ? getMediaUrl(previewItem) : currentUrl;

  useEffect(() => {
    uploadRequestRef.current += 1;
    setUploadedItem(null);
    setUploading(false);
    setStudioOpen(false);
  }, [ownerKey]);

  useEffect(() => {
    return () => {
      uploadRequestRef.current += 1;
    };
  }, []);

  const uploadCover = async (file: File): Promise<boolean> => {
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件作为音乐封面');
      return false;
    }
    const requestId = uploadRequestRef.current + 1;
    uploadRequestRef.current = requestId;
    const requestOwnerKey = ownerKey;
    setUploading(true);
    try {
      const media = await mediaService.upload(file, undefined, {
        folderId: uploadFolderId,
      });
      queryClient.invalidateQueries({ queryKey: ['music-cover-images'] });
      if (!isCurrentMusicCoverUploadRequest({
        requestId,
        requestOwnerKey,
        currentRequestId: uploadRequestRef.current,
        currentOwnerKey: currentOwnerKeyRef.current,
      })) {
        toast.info(`封面已上传到媒体库，但当前编辑对象已切换，未自动应用：${file.name}`);
        return false;
      }
      setUploadedItem(media);
      onChange(media);
      toast.success(`封面已上传：${file.name}`);
      return true;
    } catch (error) {
      toast.error(extractApiErrorMessage(error, '上传封面失败'));
      return false;
    } finally {
      if (isCurrentMusicCoverUploadRequest({
        requestId,
        requestOwnerKey,
        currentRequestId: uploadRequestRef.current,
        currentOwnerKey: currentOwnerKeyRef.current,
      })) {
        setUploading(false);
      }
    }
  };

  return (
    <>
      <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_2%,transparent)] p-3">
        <div className="relative flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.75)]">
          {previewUrl ? (
            <img src={previewUrl} alt="当前封面" className="h-full w-full object-cover" />
          ) : (
            <Disc3 className="h-8 w-8 text-[var(--ink-muted)]" aria-hidden="true" />
          )}
          {uploading ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white" role="status">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="sr-only">正在上传封面</span>
            </span>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-black text-[var(--ink-primary)]">封面工作流</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                直接上传、生成共振封面，或复用媒体库图片。
              </p>
            </div>
            <Link to="/media" className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs font-semibold text-[var(--aurora-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]">
              管理图片
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void uploadCover(file);
            }}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={textButtonClass('primary')}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              上传图片
            </button>
            <button
              type="button"
              onClick={() => setStudioOpen(true)}
              disabled={uploading}
              className={textButtonClass()}
            >
              <Sparkles className="h-4 w-4" />
              生成封面
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  setUploadedItem(null);
                  onChange(undefined);
                }}
                className={textButtonClass('danger')}
              >
                <X className="h-4 w-4" />
                清除
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="mt-2 flex min-h-12 items-center gap-2 text-xs text-[var(--ink-muted)]" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在载入媒体库图片
            </div>
          ) : items.length > 0 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {items.slice(0, 12).map((item) => {
                const url = getMediaUrl(item);
                const active = value === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setUploadedItem(null);
                      onChange(item);
                    }}
                    aria-pressed={active}
                    aria-label={`选择封面 ${item.originalName}`}
                    title={item.originalName}
                    className={cn(
                      'relative h-12 w-12 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border transition-[border-color,opacity,transform] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]',
                      active
                        ? 'border-[var(--aurora-1)] ring-1 ring-[var(--aurora-1)]'
                        : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] opacity-75 hover:opacity-100'
                    )}
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    {active ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white" aria-hidden="true">
                        <Check className="h-4 w-4" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
              媒体库还没有图片，可直接上传或生成第一张封面。
            </p>
          )}
        </div>
      </div>

      {studioOpen ? (
        <Suspense
          fallback={(
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 backdrop-blur-sm" role="status">
              <span className="surface-overlay inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-[var(--ink-primary)]">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--aurora-1)]" />
                正在载入生成式封面工作室
              </span>
            </div>
          )}
        >
          <GenerativeCoverStudio
            title={title}
            onClose={() => setStudioOpen(false)}
            onApply={async (blob, fileName) => {
              const file = new File([blob], fileName, { type: 'image/png' });
              return uploadCover(file);
            }}
          />
        </Suspense>
      ) : null}
    </>
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
  onOpenLyrics,
  onTagsChange,
  mobile = false,
  coverImages,
  coverImagesLoading,
  uploadFolderId,
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
  onOpenLyrics: (track: MusicTrack) => void;
  onTagsChange: (track: MusicTrack, tags: MusicTagSummary[]) => void;
  mobile?: boolean;
  coverImages: MediaItem[];
  coverImagesLoading: boolean;
  uploadFolderId?: number;
}) {
  const [draft, setDraft] = useState<MusicTrack>(track);
  const [ambientPalette, setAmbientPalette] = useState<ExtractedColorPalette | null>(null);

  useEffect(() => {
    const coverUrl = draft.coverUrl || draft.media?.thumbnailUrl;
    if (!coverUrl) {
      setAmbientPalette(null);
      return;
    }
    let active = true;
    void extractPaletteFromImageUrl(coverUrl).then((palette) => {
      if (active) setAmbientPalette(palette);
    });
    return () => {
      active = false;
    };
  }, [draft.coverUrl, draft.media?.thumbnailUrl]);
  const [addPlaylistId, setAddPlaylistId] = useState('');
  const selectedTrackRef = useRef(track);
  const sheetPanelRef = useRef<HTMLDivElement>(null);
  const sheetDragControls = useDragControls();
  const sheetY = useMotionValue(0);
  const prefersReducedMotion = useReducedMotion();
  selectedTrackRef.current = track;
  const mediaFileName = track.media?.originalName || '未加载媒体文件名';
  useEffect(() => {
    setDraft(selectedTrackRef.current);
    setAddPlaylistId('');
  }, [track.id]);
  useEffect(() => {
    if (!dirty) setDraft(track);
  }, [dirty, track]);
  useEffect(() => {
    sheetY.set(0);
  }, [sheetY, track.id]);
  const updateDraft = (changes: Partial<MusicTrack>) => {
    onDraftChange();
    setDraft((current) => ({ ...current, ...changes }));
  };
  const settleSheet = useCallback((onSettled?: () => void) => {
    if (prefersReducedMotion) {
      sheetY.set(0);
      onSettled?.();
      return;
    }
    const controls = animate(sheetY, 0, {
      type: 'spring',
      stiffness: 520,
      damping: 42,
      mass: 0.8,
    });
    if (onSettled) void controls.then(onSettled);
  }, [prefersReducedMotion, sheetY]);
  const exitSheet = useCallback(() => {
    if (!mobile || dirty || prefersReducedMotion) {
      onClose();
      return;
    }
    const targetY = (sheetPanelRef.current?.getBoundingClientRect().height ?? window.innerHeight * 0.66) + 32;
    const controls = animate(sheetY, targetY, {
      duration: 0.22,
      ease: [0.22, 1, 0.36, 1],
    });
    void controls.then(onClose);
  }, [dirty, mobile, onClose, prefersReducedMotion, sheetY]);
  const startSheetDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!mobile) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="combobox"]')) return;
    sheetDragControls.start(event);
  }, [mobile, sheetDragControls]);
  const handleSheetDragEnd = useCallback((
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    const sheetHeight = sheetPanelRef.current?.getBoundingClientRect().height ?? window.innerHeight * 0.66;
    const distanceThreshold = Math.min(132, Math.max(76, sheetHeight * 0.2));
    const shouldDismiss = info.offset.y >= distanceThreshold
      || (info.velocity.y >= 900 && info.offset.y >= 24);

    if (!shouldDismiss) {
      settleSheet();
      return;
    }
    if (dirty) {
      settleSheet(onClose);
      return;
    }
    if (prefersReducedMotion) {
      onClose();
      return;
    }
    const controls = animate(sheetY, sheetHeight + 32, {
      duration: 0.22,
      ease: [0.22, 1, 0.36, 1],
    });
    void controls.then(onClose);
  }, [dirty, onClose, prefersReducedMotion, settleSheet, sheetY]);
  return (
    <motion.div
      ref={sheetPanelRef}
      drag={mobile ? 'y' : false}
      dragControls={sheetDragControls}
      dragListener={false}
      dragMomentum={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.55 }}
      onDragEnd={handleSheetDragEnd}
      style={mobile ? { y: sheetY, touchAction: 'auto' } : (
        ambientPalette
          ? ({
              '--ambient-glow-light': ambientPalette.ambientGlowLight,
              '--ambient-glow-dark': ambientPalette.ambientGlowDark,
              backgroundImage: 'var(--ambient-glow-light)',
            } as CSSProperties)
          : undefined
      )}
      className={cn(
        panelClass,
        'relative overflow-hidden transition-[background] duration-500',
        mobile
          ? 'flex max-h-[66dvh] w-full flex-col !rounded-b-none !rounded-t-[var(--radius-xl)] !p-0'
          : 'sticky top-4 space-y-4'
      )}
    >
      {mobile && (
        <div
          data-track-editor-drag-handle
          onPointerDown={startSheetDrag}
          className="flex h-7 shrink-0 cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing"
          aria-hidden="true"
        >
          <span className="h-1 w-10 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]" />
        </div>
      )}
      <div
        data-track-editor-drag-region={mobile ? true : undefined}
        onPointerDown={mobile ? startSheetDrag : undefined}
        className={cn(
          'flex items-start justify-between gap-3',
          mobile && 'shrink-0 cursor-grab touch-none select-none pb-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] active:cursor-grabbing'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-[var(--ink-primary)]">歌曲信息</p>
            {dirty && (
              <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--signal-warn)]">
                未保存
              </span>
            )}
          </div>
          <p
            className="mt-1 truncate text-xs text-[var(--ink-muted)]"
            title={`媒体文件：${mediaFileName}`}
          >
            媒体文件：{mediaFileName}
          </p>
        </div>
        <button
          type="button"
          onClick={exitSheet}
          className={cn(iconButtonClass(), 'shrink-0')}
          aria-label="关闭歌曲信息"
          data-track-editor-initial-focus={mobile ? 'true' : undefined}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className={cn(
        'space-y-3',
        mobile && 'min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]'
      )}>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">标题</span>
          <input
            value={draft.title}
            onChange={(e) => updateDraft({ title: e.target.value })}
            className={inputClass()}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">艺术家</span>
          <input value={draft.artist} onChange={(e) => updateDraft({ artist: e.target.value })} className={inputClass()} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">专辑</span>
          <input value={draft.album} onChange={(e) => updateDraft({ album: e.target.value })} className={inputClass()} />
        </label>
        <CoverPicker
          ownerKey={`track:${track.id}`}
          title={`${draft.artist || '未知艺术家'} · ${draft.title || '未命名歌曲'}`}
          value={draft.coverMediaFileId}
          currentUrl={draft.coverUrl}
          items={coverImages}
          loading={coverImagesLoading}
          uploadFolderId={uploadFolderId}
          onChange={(media) => updateDraft({
            coverMediaFileId: media?.id,
            coverUrl: media ? getMediaUrl(media) : undefined,
          })}
        />
        <section className="rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_2%,transparent)] p-3">
          <div className="flex items-start gap-3">
            <span className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              draft.lyricAsset
                ? 'bg-[color-mix(in_oklch,var(--signal-success)_11%,transparent)] text-[var(--signal-success)]'
                : 'bg-[color-mix(in_oklch,var(--signal-warn)_11%,transparent)] text-[var(--signal-warn)]'
            )}>
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black text-[var(--ink-primary)]">
                {draft.lyricAsset?.name || (draft.lyric?.trim() ? '兼容歌词待迁移' : '尚未绑定歌词')}
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                {draft.lyricAsset
                  ? `${draft.lyricAsset.format} · ${draft.lyricAsset.language || 'und'} · ${
                    draft.lyricAsset.status === 'READY'
                      ? '可发布'
                      : draft.lyricAsset.status === 'NEEDS_REVIEW'
                        ? '需复核'
                        : '草稿'
                  }`
                  : '歌词正文已从歌曲元数据中拆分，请在歌词工作台上传、校时、审核与绑定。'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenLyrics(track)}
            className={cn(textButtonClass('primary'), 'mt-3 w-full')}
          >
            <Wand2 className="h-4 w-4" />
            前往歌词工作台
          </button>
        </section>
        <MusicTagEditor
          fileId={track.mediaFileId}
          initialTags={draft.tags}
          onTagsChange={(tags) => {
            setDraft((current) => ({ ...current, tags }));
            onTagsChange(track, tags);
          }}
        />
        <TogglePill
          checked={Boolean(draft.isFavorite)}
          label="策展人喜爱收藏"
          onClick={() => updateDraft({ isFavorite: !draft.isFavorite })}
        />
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
      <div className={cn(
        'flex flex-wrap justify-end gap-2',
        mobile && 'shrink-0 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3 max-[360px]:!grid max-[360px]:grid-cols-[1.35fr_0.8fr_0.9fr] max-[360px]:gap-1.5'
      )}>
        <button
          type="button"
          onClick={() => onRequestDeleteWithMedia(track)}
          className={cn(textButtonClass('danger'), mobile && 'max-[360px]:min-w-0 max-[360px]:gap-1.5 max-[360px]:px-2 max-[360px]:text-xs')}
        >
          <Trash2 className="h-4 w-4" />
          连媒体删除
        </button>
        <button type="button" onClick={() => onPreview(track)} className={cn(textButtonClass(), mobile && 'max-[360px]:min-w-0 max-[360px]:gap-1.5 max-[360px]:px-2 max-[360px]:text-xs')}>
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
            status: draft.status,
            sortOrder: draft.sortOrder,
            isFeatured: draft.isFeatured,
            isFavorite: draft.isFavorite,
          }))}
          className={cn(textButtonClass('primary'), mobile && 'max-[360px]:min-w-0 max-[360px]:gap-1.5 max-[360px]:px-2 max-[360px]:text-xs')}
          disabled={saving || !dirty}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : dirty ? <RotateCw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {saving ? '保存中' : dirty ? '保存' : '已保存'}
        </button>
      </div>
    </motion.div>
  );
}

export default function MusicPage() {
  const queryClient = useQueryClient();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trackEditorSheetRef = useRef<HTMLElement>(null);
  const trackEditorReturnFocusRef = useRef<HTMLElement | null>(null);
  const previousMobileEditorIdRef = useRef<number | null>(null);
  const initiallyFocusedMobileEditorIdRef = useRef<number | null>(null);
  const lastPlaylistQueueSyncRef = useRef<{
    playlistId: number;
    tracks: readonly MusicTrack[];
  } | null>(null);
  const settingsWriteLockRef = useRef(false);
  const deleteWriteLockRef = useRef(false);
  const batchDeleteInFlightRef = useRef(false);
  const batchPlaylistInFlightRef = useRef(false);
  const [activeTab, setActiveTab] = useState<MusicTab>('overview');
  const {
    queue,
    queueSource,
    currentTrack,
    currentIndex,
    isPlaying,
    playbackError,
    playTracks,
    togglePlayback,
    nextTrack,
    previousTrack,
    seekToPercent,
    retryPlayback,
    replaceQueueTrack,
    removeQueueTrack,
    reconcileQueue,
    updateQueueSourceLabel,
    setMusicSkin,
    setDockSuppressed,
  } = useAdminMusicPlayer();

  // 完整试听舞台只属于「展示播放」；曲库和歌单保持管理优先，继续使用紧凑全局播放器。
  useLayoutEffect(() => {
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
  const [trackFavoriteFilter, setTrackFavoriteFilter] = useState<'ALL' | 'FAVORITE' | 'NOT_FAVORITE'>('ALL');
  const [trackTagId, setTrackTagId] = useState('');
  const [trackTagState, setTrackTagState] = useState<'ALL' | 'WITH_TAGS' | 'WITHOUT_TAGS'>('ALL');
  const [trackLyricState, setTrackLyricState] = useState<'ALL' | 'WITH_LYRIC' | 'WITHOUT_LYRIC' | 'NEEDS_REVIEW'>('ALL');
  const [trackCoverState, setTrackCoverState] = useState<'ALL' | 'WITH_COVER' | 'WITHOUT_COVER'>('ALL');
  const [scanKeyword, setScanKeyword] = useState('');
  const [scanPage, setScanPage] = useState(1);
  const [scanPageSize, setScanPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<number[]>([]);
  const [newFolderName, setNewFolderName] = useState(MUSIC_HALL_FOLDER_NAME);
  const [uploadingLabel, setUploadingLabel] = useState('');
  const [editingTrack, setEditingTrack] = useState<MusicTrack | null>(null);
  const editingTrackIdRef = useRef<number | null>(null);
  const trackDraftRevisionRef = useRef(0);
  const [trackDraftDirty, setTrackDraftDirty] = useState(false);
  const [pendingTrackNavigation, setPendingTrackNavigation] = useState<PendingTrackNavigation | null>(null);
  const [lyricDraftDirty, setLyricDraftDirty] = useState(false);
  const [lyricDiscardToken, setLyricDiscardToken] = useState(0);
  const [lyricsFocusTrack, setLyricsFocusTrack] = useState<MusicTrack | undefined>();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const selectedPlaylistIdRef = useRef<number | null>(null);
  const [playlistDraft, setPlaylistDraft] = useState<PlaylistDraft>({
    name: '',
    description: '',
    visibility: 'PUBLIC',
    status: 'ACTIVE',
    displayOnHome: true,
    displayOnProfile: true,
    carouselEnabled: true,
    randomEnabled: false,
    isFavorite: false,
    sortOrder: 0,
  });
  const [playlistDraftSourceId, setPlaylistDraftSourceId] = useState<number | null>(null);
  const [playlistDraftDirty, setPlaylistDraftDirty] = useState(false);
  const playlistDraftRevisionRef = useRef(0);
  const [pendingPlaylistSelectionId, setPendingPlaylistSelectionId] = useState<number | null>(null);
  const [playlistEditOpen, setPlaylistEditOpen] = useState(false);
  const [addTracksPanelOpen, setAddTracksPanelOpen] = useState(false);
  const [playlistTrackKeyword, setPlaylistTrackKeyword] = useState('');
  const [playlistFavoriteFilter, setPlaylistFavoriteFilter] = useState<'ALL' | 'FAVORITE'>('ALL');
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);
  const [isSettingsWriteBusy, setIsSettingsWriteBusy] = useState(false);
  const deferredTrackKeyword = useDeferredValue(trackKeyword.trim());
  const deferredPlaylistTrackKeyword = useDeferredValue(playlistTrackKeyword);
  const dirtyNavigationBlocker = useBlocker(
    trackDraftDirty || playlistDraftDirty || lyricDraftDirty
  );
  const activeConfirmation = pendingDelete
    ? 'delete'
    : pendingBatchDelete
      ? 'batch-delete'
      : pendingTrackNavigation
        ? 'track-navigation'
        : pendingPlaylistSelectionId != null
          ? 'playlist-selection'
          : dirtyNavigationBlocker.state === 'blocked'
            ? 'route-navigation'
            : null;
  const activeMobileEditorId = isMobile ? (editingTrack?.id ?? null) : null;
  const mobileEditorCoveredByModal = Boolean(
    activeMobileEditorId != null && activeConfirmation != null
  );

  useEffect(() => {
    if (!trackDraftDirty && !playlistDraftDirty && !lyricDraftDirty) return;
    const protectUnsavedWork = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectUnsavedWork);
    return () => window.removeEventListener('beforeunload', protectUnsavedWork);
  }, [lyricDraftDirty, playlistDraftDirty, trackDraftDirty]);



  const selectPlaylist = useCallback((playlistId: number | null) => {
    playlistDraftRevisionRef.current += 1;
    selectedPlaylistIdRef.current = playlistId;
    setPlaylistDraftSourceId(null);
    setPlaylistDraftDirty(false);
    setSelectedPlaylistId(playlistId);
    // 换歌单 = 换策展对象:编辑面板与添加面板都归位,避免上一份歌单的展开态串场。
    setPlaylistEditOpen(false);
    setAddTracksPanelOpen(false);
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
    if (lyricDraftDirty) {
      setLyricDraftDirty(false);
      setLyricDiscardToken((token) => token + 1);
    }
    if (playlistDraftDirty) {
      playlistDraftRevisionRef.current += 1;
      setPlaylistDraftDirty(false);
    }
    // Leaving the library unmounts the editor sheet. Clear its state first so
    // the scroll lock, document-level focus trap and return-focus lifecycle all
    // run their cleanup instead of surviving as an invisible modal.
    editingTrackIdRef.current = null;
    setEditingTrack(null);
    if (navigation.tab === 'lyrics') {
      setLyricsFocusTrack(navigation.focusTrack);
    }
    setActiveTab(navigation.tab);
  }, [lyricDraftDirty, playlistDraftDirty]);
  const requestTrackNavigation = useCallback((navigation: PendingTrackNavigation) => {
    if (navigation.kind === 'tab' && navigation.tab === activeTab) return;
    const targetTrackId = navigation.kind === 'select' ? navigation.track.id : null;
    const discardsTrackDraft = shouldConfirmTrackDraftDiscard({
      isDirty: trackDraftDirty,
      currentTrackId: editingTrackIdRef.current,
      targetTrackId,
    });
    const discardsLyricDraft = navigation.kind === 'tab'
      && activeTab === 'lyrics'
      && lyricDraftDirty;
    const discardsPlaylistDraft = navigation.kind === 'tab'
      && activeTab === 'playlists'
      && playlistDraftDirty;
    if (discardsTrackDraft || discardsLyricDraft || discardsPlaylistDraft) {
      setPendingTrackNavigation(navigation);
      return;
    }
    if (navigation.kind === 'select' && navigation.track.id === editingTrackIdRef.current) return;
    performTrackNavigation(navigation);
  }, [
    activeTab,
    lyricDraftDirty,
    performTrackNavigation,
    playlistDraftDirty,
    trackDraftDirty,
  ]);
  useEffect(() => {
    const editorId = isMobile ? (editingTrack?.id ?? null) : null;
    if (editorId != null && previousMobileEditorIdRef.current == null) {
      trackEditorReturnFocusRef.current = document.activeElement as HTMLElement | null;
    }
    if (editorId == null && previousMobileEditorIdRef.current != null) {
      const target = trackEditorReturnFocusRef.current;
      window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
      trackEditorReturnFocusRef.current = null;
      initiallyFocusedMobileEditorIdRef.current = null;
    }
    previousMobileEditorIdRef.current = editorId;
  }, [editingTrack?.id, isMobile]);
  useEffect(() => {
    if (activeMobileEditorId == null) return;
    return acquireOverlayScrollLock();
  }, [activeMobileEditorId]);
  useEffect(() => {
    if (
      !editingTrack
      || !isMobile
      || mobileEditorCoveredByModal
    ) return;
    const shouldMoveInitialFocus = initiallyFocusedMobileEditorIdRef.current !== editingTrack.id;
    if (shouldMoveInitialFocus) initiallyFocusedMobileEditorIdRef.current = editingTrack.id;
    const focusFrame = shouldMoveInitialFocus
      ? window.requestAnimationFrame(() => {
          const initialFocusTarget = trackEditorSheetRef.current?.querySelector<HTMLElement>('[data-track-editor-initial-focus]');
          initialFocusTarget?.focus({ preventScroll: true });
        })
      : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestTrackNavigation({ kind: 'close' });
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(trackEditorSheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        trackEditorSheetRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      if (focusFrame != null) window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    editingTrack,
    isMobile,
    mobileEditorCoveredByModal,
    requestTrackNavigation,
  ]);
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

  const overviewTracksQuery = useQuery({
    queryKey: ['music-overview-tracks'],
    enabled: activeTab === 'overview',
    queryFn: fetchAllMusicTracks,
    staleTime: 30_000,
  });

  const tracksQuery = useQuery({
    queryKey: [
      'music-tracks',
      trackPage,
      trackPageSize,
      deferredTrackKeyword,
      trackFavoriteFilter,
      trackTagId,
      trackTagState,
      trackLyricState,
      trackCoverState,
    ],
    queryFn: async () =>
      (await musicService.getTracks({
        pageNum: trackPage,
        pageSize: trackPageSize,
        keyword: deferredTrackKeyword || undefined,
        favorite: trackFavoriteFilter === 'ALL'
          ? undefined
          : trackFavoriteFilter === 'FAVORITE',
        tagId: trackTagId ? Number(trackTagId) : undefined,
        tagState: trackTagState === 'ALL' ? undefined : trackTagState,
        lyricState: trackLyricState === 'ALL' ? undefined : trackLyricState,
        coverState: trackCoverState === 'ALL' ? undefined : trackCoverState,
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

  const favoritePlaylistsQuery = useQuery({
    queryKey: ['music-playlists', 'favorite'],
    enabled: playlistFavoriteFilter === 'FAVORITE',
    queryFn: async () =>
      (await musicService.getPlaylists({ favorite: true, pageNum: 1, pageSize: 100 })).data,
  });

  const mediaTagsQuery = useQuery({
    queryKey: ['media-tags'],
    queryFn: () => mediaTagService.getAll(),
    staleTime: 60_000,
  });

  const foldersQuery = useQuery({
    queryKey: ['media-folders-tree'],
    queryFn: async () => (await folderService.getTree()).data,
  });
  const coverImagesQuery = useQuery({
    queryKey: ['music-cover-images'],
    enabled: Boolean(editingTrack) || activeTab === 'playlists',
    queryFn: async () => (await mediaService.getList({
      fileType: 'IMAGE',
      sortBy: 'newest',
      pageNum: 1,
      pageSize: 24,
    })).data,
    staleTime: 60_000,
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

  useEffect(() => {
    const handleGlobalMusicShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        activeConfirmation != null
      ) {
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (currentTrack) {
          void togglePlayback();
        } else if (tracks.length > 0) {
          playSingle(tracks[0]);
        }
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="搜索歌曲"]');
        searchInput?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalMusicShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalMusicShortcuts);
  }, [activeConfirmation, currentTrack, isPlaying, togglePlayback, tracks]);
  const playlistTrackCandidates = playlistTrackCandidatesQuery.data?.list ?? [];
  const playlists = playlistsQuery.data?.list ?? [];
  const visiblePlaylists = playlistFavoriteFilter === 'FAVORITE'
    ? (favoritePlaylistsQuery.data?.list ?? [])
    : playlists;
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
  const musicTagFilterOptions = useMemo<SelectOption[]>(
    () => [
      { value: '__all__', label: '全部标签' },
      { value: '__untagged__', label: '未打标签' },
      { value: '__tagged__', label: '已有标签' },
      ...(Array.isArray(mediaTagsQuery.data?.data) ? mediaTagsQuery.data.data : Array.isArray(mediaTagsQuery.data) ? mediaTagsQuery.data : []).map((tag) => ({
        value: `tag:${tag.id}`,
        label: tag.name,
        description: `${tag.usageCount ?? 0} 个媒体文件`,
      })),
    ],
    [mediaTagsQuery.data]
  );
  const trackTagFilterValue = trackTagId
    ? `tag:${trackTagId}`
    : trackTagState === 'WITHOUT_TAGS'
      ? '__untagged__'
      : trackTagState === 'WITH_TAGS'
        ? '__tagged__'
        : '__all__';
  const hasTrackFilters = Boolean(
    trackKeyword.trim()
      || trackFavoriteFilter !== 'ALL'
      || trackTagId
      || trackTagState !== 'ALL'
      || trackLyricState !== 'ALL'
      || trackCoverState !== 'ALL'
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
  const selectedPlaylistTracks = playlistMemberTracksQuery.data
    ?? (playlistDetailQuery.data?.id === selectedPlaylistId ? playlistDetailQuery.data.tracks : undefined)
    ?? [];
  useEffect(() => {
    const refreshedTracks = playlistMemberTracksQuery.data;
    if (selectedPlaylistId == null || !refreshedTracks) return;
    const previousSync = lastPlaylistQueueSyncRef.current;
    if (
      previousSync?.playlistId === selectedPlaylistId
      && previousSync.tracks === refreshedTracks
    ) {
      return;
    }
    lastPlaylistQueueSyncRef.current = {
      playlistId: selectedPlaylistId,
      tracks: refreshedTracks,
    };
    reconcileQueue(refreshedTracks, { type: 'playlist', playlistId: selectedPlaylistId });
  }, [playlistMemberTracksQuery.data, reconcileQueue, selectedPlaylistId]);
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
    queryClient.invalidateQueries({ queryKey: ['music-overview-tracks'] });
    queryClient.invalidateQueries({ queryKey: ['music-settings'] });
    queryClient.invalidateQueries({ queryKey: ['music-tracks'] });
    queryClient.invalidateQueries({ queryKey: ['music-lyrics'] });
    queryClient.invalidateQueries({ queryKey: ['music-lyric-for-track'] });
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
      replaceQueueTrack(res.data);
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

  const trackFavoriteMutation = useMutation({
    mutationFn: (track: MusicTrack) =>
      musicService.updateTrack(
        track.id,
        buildMusicTrackUpdate(track, { isFavorite: !track.isFavorite })
      ),
    onSuccess: (response) => {
      const updated = response.data;
      toast.success(updated.isFavorite ? '已加入喜爱歌曲' : '已取消喜爱歌曲');
      replaceQueueTrack(updated);
      if (editingTrackIdRef.current === updated.id && !trackDraftDirty) {
        setEditingTrack(updated);
      }
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '更新歌曲收藏失败')),
  });

  const deleteTrackMutation = useMutation({
    mutationFn: ({ id, deleteMedia }: { id: number; deleteMedia: boolean }) =>
      musicService.deleteTrack(id, { deleteMedia }),
    onSuccess: (_response, { id }) => {
      if (!batchDeleteInFlightRef.current) toast.success('歌曲已移除');
      removeQueueTrack(id);
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
    onError: (error) => {
      if (!batchDeleteInFlightRef.current) toast.error(extractApiErrorMessage(error, '移除歌曲失败'));
    },
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

  // 新建只要一个名字(Apple 式);展示开关等细节创建后在详情编辑面板里调。
  const createPlaylistMutation = useMutation({
    mutationFn: (name: string) =>
      musicService.createPlaylist({
        name: name.trim() || '我的歌单',
        description: undefined,
        displayOnHome: false,
        displayOnProfile: true,
        carouselEnabled: true,
        randomEnabled: false,
        isFavorite: false,
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
      updateQueueSourceLabel(
        { type: 'playlist', playlistId: id },
        res.data.name
      );
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '保存歌单失败')),
  });

  const playlistFavoriteMutation = useMutation({
    mutationFn: (playlist: MusicPlaylist) =>
      musicService.updatePlaylist(
        playlist.id,
        buildMusicPlaylistUpdate({
          ...playlistToDraft(playlist),
          isFavorite: !playlist.isFavorite,
        }, playlist.name)
      ),
    onSuccess: (response) => {
      const updated = response.data;
      toast.success(updated.isFavorite ? '已加入喜爱歌单' : '已取消喜爱歌单');
      if (selectedPlaylistIdRef.current === updated.id && !playlistDraftDirty) {
        setPlaylistDraft(playlistToDraft(updated));
        setPlaylistDraftSourceId(updated.id);
      }
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '更新歌单收藏失败')),
  });

  const deletePlaylistMutation = useMutation({
    mutationFn: musicService.deletePlaylist,
    onSuccess: (_data, deletedPlaylistId) => {
      toast.success('歌单已删除');
      reconcileQueue([], { type: 'playlist', playlistId: deletedPlaylistId });
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
    onSuccess: async (_data, { playlistId }) => {
      if (batchPlaylistInFlightRef.current) return;
      toast.success('已加入歌单');
      try {
        const refreshedTracks = await fetchAllPlaylistTracks(playlistId);
        queryClient.setQueryData(['music-playlist-member-tracks', playlistId], refreshedTracks);
        reconcileQueue(refreshedTracks, { type: 'playlist', playlistId });
      } catch {
        // The write already succeeded. Query invalidation below remains the
        // authoritative fallback when an immediate queue refresh is unavailable.
      }
      queryClient.invalidateQueries({ queryKey: ['music-playlist-detail', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlist-member-tracks', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    },
    onError: (error) => {
      if (!batchPlaylistInFlightRef.current) toast.error(extractApiErrorMessage(error, '加入歌单失败'));
    },
  });

  const batchPlaylistAddMutation = useMutation({
    mutationFn: async ({ playlistId, trackIds }: { playlistId: number; trackIds: number[] }) => {
      batchPlaylistInFlightRef.current = true;
      try {
        const results = await Promise.allSettled(
          trackIds.map((trackId) => playlistTrackMutation.mutateAsync({ playlistId, trackId }))
        );
        return { playlistId, trackIds, results };
      } finally {
        batchPlaylistInFlightRef.current = false;
      }
    },
    onSuccess: ({ playlistId, trackIds, results }) => {
      const succeeded = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = trackIds.length - succeeded;
      const playlist = playlists.find((item) => item.id === playlistId);
      if (failedCount === 0) {
        toast.success(`已批量将 ${succeeded} 首歌曲加入歌单「${playlist?.name ?? ''}」`);
        setSelectedTrackIds([]);
      } else {
        setSelectedTrackIds(trackIds.filter((_id, index) => results[index].status === 'rejected'));
        toast.error(`已加入 ${succeeded} 首，${failedCount} 首失败，失败歌曲保留在选中列表，请重试`);
      }
      queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
      queryClient.invalidateQueries({ queryKey: ['music-playlist-detail', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['music-playlist-member-tracks', playlistId] });
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '批量加入歌单失败')),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async ({ trackIds }: { trackIds: number[] }) => {
      batchDeleteInFlightRef.current = true;
      try {
        const results = await Promise.allSettled(
          trackIds.map((id) => deleteTrackMutation.mutateAsync({ id, deleteMedia: false }))
        );
        return { trackIds, results };
      } finally {
        batchDeleteInFlightRef.current = false;
      }
    },
    onSuccess: ({ trackIds, results }) => {
      const succeeded = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = trackIds.length - succeeded;
      if (failedCount === 0) {
        toast.success(`已批量删除 ${succeeded} 首歌曲`);
        setSelectedTrackIds([]);
      } else {
        setSelectedTrackIds(trackIds.filter((_id, index) => results[index].status === 'rejected'));
        toast.error(`已删除 ${succeeded} 首，${failedCount} 首失败，失败歌曲保留在选中列表，请重试`);
      }
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '批量删除失败')),
  });

  const batchTagMutation = useMutation({
    mutationFn: async ({ tagIds, trackIds }: { tagIds: number[]; trackIds: number[] }) => {
      const resolvedTracks = tracks.filter((track) => trackIds.includes(track.id));
      const unresolvedCount = trackIds.length - resolvedTracks.length;
      const fileIds = resolvedTracks
        .map((track) => track.mediaFileId)
        .filter((fileId) => fileId > 0);
      const results = await Promise.allSettled(
        tagIds.map((tagId) => mediaTagService.batchTag(fileIds, tagId))
      );
      return {
        tagIds,
        resolvedTrackIds: resolvedTracks.map((track) => track.id),
        fileIds,
        unresolvedCount,
        results,
      };
    },
    onSuccess: ({ tagIds, resolvedTrackIds, fileIds, unresolvedCount, results }) => {
      const succeeded = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = tagIds.length - succeeded;
      if (failedCount > 0) {
        toast.error(`已应用 ${succeeded}/${tagIds.length} 个标签，${failedCount} 个失败，选中歌曲已保留，请重试`);
      } else if (unresolvedCount > 0) {
        toast.success(`已为 ${resolvedTrackIds.length} 首歌曲添加 ${tagIds.length} 个标签`);
        toast.error(`另有 ${unresolvedCount} 首不在当前页，未处理`);
        setSelectedTrackIds((ids) => ids.filter((id) => !resolvedTrackIds.includes(id)));
      } else {
        toast.success(`已为 ${resolvedTrackIds.length} 首歌曲添加 ${tagIds.length} 个标签`);
        setSelectedTrackIds([]);
      }
      for (const fileId of fileIds) {
        queryClient.invalidateQueries({ queryKey: ['media-file-tags', fileId] });
      }
      queryClient.invalidateQueries({ queryKey: ['media-tags'] });
      queryClient.invalidateQueries({ queryKey: ['music-tracks'] });
      queryClient.invalidateQueries({ queryKey: ['music-summary'] });
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '批量添加标签失败')),
  });

  const removePlaylistTrackMutation = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: number; trackId: number }) =>
      musicService.removeTrackFromPlaylist(playlistId, trackId),
    onSuccess: (_data, { playlistId, trackId }) => {
      toast.success('已从歌单移除');
      removeQueueTrack(trackId, { type: 'playlist', playlistId });
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
      reconcileQueue(tracks, { type: 'playlist', playlistId });
      return { previousTracks, previousDetail };
    },
    onError: (error, { playlistId }, context) => {
      const rollbackTracks = context?.previousTracks ?? context?.previousDetail?.tracks;
      if (context?.previousTracks !== undefined) {
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
      if (rollbackTracks) {
        reconcileQueue(rollbackTracks, { type: 'playlist', playlistId });
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
          isFavorite: target.isFavorite,
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
    playlistFavoriteMutation.isPending ||
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
    if (
      playlistId === playlistDraftSourceId
      && playlistDraftDirty
    ) {
      toast.error('请先保存当前歌单的修改，再设为公开展示');
      return;
    }
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
    if (!playlistDraftDirty) return;
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

  const openLibraryWithFilter = (filter: MusicOverviewLibraryFilter = {}) => {
    setTrackKeyword('');
    setTrackFavoriteFilter(filter.favorite ?? 'ALL');
    setTrackLyricState(filter.lyricState ?? 'ALL');
    setTrackCoverState(filter.coverState ?? 'ALL');
    setTrackTagState(filter.tagState ?? 'ALL');
    setTrackTagId('');
    setTrackPage(1);
    requestTrackNavigation({ kind: 'tab', tab: 'library' });
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
        const meta = await parseAudioMetadataFromFile(file);
        const media = await mediaService.upload(file, undefined, { folderId: settings.mediaFolderId });
        const imported = await musicService.importMedia({ mediaFileId: media.id });
        if (imported?.data?.id && (meta.title || meta.artist || meta.album)) {
          const trackId = imported.data.id;
          await musicService.updateTrack(trackId, {
            title: meta.title || imported.data.title,
            artist: meta.artist || imported.data.artist,
            album: meta.album || imported.data.album,
            status: imported.data.status,
            sortOrder: imported.data.sortOrder,
          });
        }
        toast.success(`上传并自动解析入库：${meta.title || file.name}`);
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
    const isCurrentLibraryPageQueue = queueSource.type === 'library'
      && hasSameAdminMusicQueueTrackIds(queue, tracks);
    if (isCurrentLibraryPageQueue && currentTrack?.id === track.id) {
      void (playbackError ? retryPlayback() : togglePlayback());
      return;
    }
    const source = tracks.length > 0 ? tracks : [track];
    const index = Math.max(0, source.findIndex((item) => item.id === track.id));
    playTracks(source, index, { type: 'library' }, '歌曲库 · 当前页');
  };

  const renderTrackEditor = (mobile: boolean) => editingTrack ? (
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
      onOpenLyrics={(track) => requestTrackNavigation({
        kind: 'tab',
        tab: 'lyrics',
        focusTrack: track,
      })}
      onTagsChange={(track, tags) => {
        if (editingTrackIdRef.current !== track.id) return;
        setEditingTrack((current) => current?.id === track.id
          ? { ...current, tags }
          : current);
      }}
      mobile={mobile}
      coverImages={coverImagesQuery.data?.list ?? []}
      coverImagesLoading={coverImagesQuery.isLoading}
      uploadFolderId={settings.mediaFolderId}
    />
  ) : null;

  const renderHallStage = ({
    progress,
    duration,
    percent,
  }: ReturnType<typeof useAdminMusicPlayerTimeline>) => {
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
        playTracks(
          tracks,
          Math.max(0, tracks.findIndex((t) => t.id === stageTrack.id)),
          { type: 'library' },
          '展示试听 · 当前曲库页'
        );
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
                    <span className="block h-full origin-left rounded-full bg-[var(--aurora-1)] transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scaleX(${stageProgressPercent / 100})` }} />
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

  const resetTrackFilters = () => {
    setTrackKeyword('');
    setTrackFavoriteFilter('ALL');
    setTrackTagId('');
    setTrackTagState('ALL');
    setTrackLyricState('ALL');
    setTrackCoverState('ALL');
    setTrackPage(1);
  };

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
          <div className="border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pt-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(150px,0.8fr)_minmax(190px,1fr)_minmax(160px,0.9fr)_minmax(150px,0.8fr)_auto]">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  喜爱
                </span>
                <Select
                  value={trackFavoriteFilter}
                  onValueChange={(value) => {
                    setTrackFavoriteFilter(value as typeof trackFavoriteFilter);
                    setTrackPage(1);
                  }}
                  options={[
                    { value: 'ALL', label: '全部歌曲' },
                    { value: 'FAVORITE', label: '已喜爱' },
                    { value: 'NOT_FAVORITE', label: '未喜爱' },
                  ]}
                  prefix={<Heart />}
                  ariaLabel="按喜爱状态筛选歌曲"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  标签
                </span>
                <Select
                  value={trackTagFilterValue}
                  onValueChange={(value) => {
                    setTrackTagId(value.startsWith('tag:') ? value.slice(4) : '');
                    setTrackTagState(
                      value === '__untagged__'
                        ? 'WITHOUT_TAGS'
                        : value === '__tagged__'
                          ? 'WITH_TAGS'
                          : 'ALL'
                    );
                    setTrackPage(1);
                  }}
                  options={musicTagFilterOptions}
                  prefix={<Tag />}
                  ariaLabel="按媒体标签筛选歌曲"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  歌词
                </span>
                <Select
                  value={trackLyricState}
                  onValueChange={(value) => {
                    setTrackLyricState(value as typeof trackLyricState);
                    setTrackPage(1);
                  }}
                  options={[
                    { value: 'ALL', label: '全部歌词状态' },
                    { value: 'WITH_LYRIC', label: '已有歌词' },
                    { value: 'WITHOUT_LYRIC', label: '缺歌词' },
                    { value: 'NEEDS_REVIEW', label: '歌词需复核' },
                  ]}
                  prefix={<FileText />}
                  ariaLabel="按歌词状态筛选歌曲"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  封面
                </span>
                <Select
                  value={trackCoverState}
                  onValueChange={(value) => {
                    setTrackCoverState(value as typeof trackCoverState);
                    setTrackPage(1);
                  }}
                  options={[
                    { value: 'ALL', label: '全部封面状态' },
                    { value: 'WITH_COVER', label: '已有封面' },
                    { value: 'WITHOUT_COVER', label: '缺封面' },
                  ]}
                  prefix={<Image />}
                  ariaLabel="按封面状态筛选歌曲"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={resetTrackFilters}
                  className={cn(textButtonClass(), 'w-full xl:w-auto')}
                  disabled={!hasTrackFilters}
                >
                  <RotateCw className="h-4 w-4" />
                  重置筛选
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
              筛选直接对应策展缺口，可从总览下钻后继续组合搜索、标签、歌词与封面状态。
            </p>
          </div>
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
                {hasTrackFilters ? (
                  <>
                    <p className="font-semibold text-[var(--ink-primary)]">没有符合当前策展筛选的歌曲。</p>
                    <p className="mt-1">可以调整搜索条件，或重置筛选查看完整曲库。</p>
                    <button
                      type="button"
                      onClick={resetTrackFilters}
                      className={cn(textButtonClass('primary'), 'mt-4')}
                    >
                      <RotateCw className="h-4 w-4" />
                      重置筛选
                    </button>
                  </>
                ) : (
                  <>
                    曲库还是空的。<span className="text-[var(--ink-secondary)]">上传音频</span>或在下方「媒体库音频扫描」纳入曲库；入库后补齐元数据、封面、标签、歌词与歌单，即可进入完整发布链路。
                  </>
                )}
              </div>
            ) : (
              tracks.map((track) => {
                const curationState = buildTrackCurationState(track);
                const artworkUrl = track.coverUrl || track.media?.thumbnailUrl;
                const isCurrentTrack = currentTrack?.id === track.id;
                const favoriteBlockedByDraft =
                  editingTrackIdRef.current === track.id && trackDraftDirty;
                const favoritePending =
                  trackFavoriteMutation.isPending
                  && trackFavoriteMutation.variables?.id === track.id;
                const lyricLabel = track.lyricAsset
                  ? track.lyricAsset.status === 'READY'
                    ? '歌词可发布'
                    : track.lyricAsset.status === 'NEEDS_REVIEW'
                      ? '歌词需复核'
                      : '歌词草稿'
                  : track.lyric?.trim()
                    ? '兼容歌词'
                    : '缺歌词';
                const lyricReady = track.lyricAsset?.status === 'READY' || Boolean(track.lyric?.trim());
                const visibleTags = track.tags?.slice(0, 3) ?? [];

                const isTrackSelected = selectedTrackIds.includes(track.id);
                return (
                  <div
                    key={track.id}
                    className={cn(
                      'grid grid-cols-[44px_64px_minmax(0,1fr)] items-start gap-3 px-4 py-4 transition-colors [contain-intrinsic-size:auto_112px] [content-visibility:auto] sm:grid-cols-[44px_64px_minmax(0,1fr)_auto]',
                      'hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]',
                      isTrackSelected && 'bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)]',
                      editingTrack?.id === track.id && 'bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)]'
                    )}
                  >
                    <label className="flex h-16 w-11 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isTrackSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedTrackIds((prev) =>
                            prev.includes(track.id)
                              ? prev.filter((id) => id !== track.id)
                              : [...prev, track.id]
                          );
                        }}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800/80 text-[var(--aurora-1)] focus:ring-[var(--aurora-1)] cursor-pointer"
                        aria-label={`选择歌曲 ${track.title}`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => playSingle(track)}
                      className="group relative h-16 w-16 overflow-hidden rounded-[var(--radius-md)] bg-[radial-gradient(circle_at_50%_38%,color-mix(in_oklch,var(--aurora-1)_24%,var(--bg-raised)),color-mix(in_oklch,var(--bg-void)_88%,var(--aurora-1)_12%))] shadow-[0_16px_34px_-24px_rgba(0,0,0,0.8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                      aria-label={isCurrentTrack && isPlaying ? `暂停 ${track.title}` : `播放 ${track.title}`}
                    >
                      {artworkUrl ? (
                        <img
                          src={artworkUrl}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.04]"
                        />
                      ) : (
                        <span className="relative flex h-full w-full items-center justify-center bg-[radial-gradient(circle,color-mix(in_oklch,var(--ink-primary)_6%,transparent)_1px,transparent_1px)] [background-size:6px_6px] [box-shadow:inset_0_0_12px_color-mix(in_oklch,var(--ink-primary)_12%,transparent)]">
                          <Disc3 className="h-7 w-7 text-[var(--ink-muted)] transition-transform duration-700 motion-safe:group-hover:rotate-45" aria-hidden="true" />
                          <span className="pointer-events-none absolute inset-0 rounded-[var(--radius-md)] [box-shadow:inset_0_1px_1px_rgba(255,255,255,0.15)]" />
                        </span>
                      )}
                      <span
                        className={cn(
                          'absolute inset-0 flex items-center justify-center bg-black/34 text-white transition-opacity',
                          isCurrentTrack ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                        )}
                        aria-hidden="true"
                      >
                        {isCurrentTrack && isPlaying ? (
                          <Pause className="h-5 w-5 fill-current" />
                        ) : (
                          <Play className="h-5 w-5 translate-x-px fill-current" />
                        )}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => requestTrackNavigation({ kind: 'select', track })}
                      className="min-h-16 min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
                    >
                      <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black text-[var(--ink-primary)]">
                            {track.title}
                          </span>
                          <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">
                            {track.artist || '未知艺术家'} · {track.album || '未分专辑'} · {formatFileSize(track.media?.fileSize ?? 0)}
                          </span>
                        </span>
                        <span className="tnum shrink-0 rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-2 py-1 text-[10px] font-black text-[var(--ink-secondary)]">
                          {curationState.score}%
                        </span>
                      </span>

                      <span className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className={cn(
                          'rounded-full px-2 py-1 text-[10px] font-bold',
                          track.status === 'ACTIVE'
                            ? 'bg-[color-mix(in_oklch,var(--signal-success)_10%,transparent)] text-[var(--signal-success)]'
                            : 'bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] text-[var(--ink-muted)]'
                        )}>
                          {track.status === 'ACTIVE' ? '展示' : '隐藏'}
                        </span>
                        <span className={cn(
                          'rounded-full px-2 py-1 text-[10px] font-bold',
                          lyricReady
                            ? 'bg-[color-mix(in_oklch,var(--signal-success)_9%,transparent)] text-[var(--signal-success)]'
                            : track.lyricAsset?.status === 'NEEDS_REVIEW'
                              ? 'bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)] text-[var(--signal-warn)]'
                              : 'bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] text-[var(--ink-muted)]'
                        )}>
                          {lyricLabel}
                        </span>
                        <span className="rounded-full bg-[color-mix(in_oklch,var(--ink-primary)_5%,transparent)] px-2 py-1 text-[10px] font-bold text-[var(--ink-muted)]">
                          {track.playlistCount ?? 0} 个歌单
                        </span>
                        {visibleTags.map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold text-[var(--ink-secondary)]"
                            style={{
                              borderColor: `${tag.color}66`,
                              backgroundColor: `${tag.color}12`,
                            }}
                          >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </span>
                        ))}
                        {(track.tags?.length ?? 0) > visibleTags.length ? (
                          <span className="text-[10px] font-bold text-[var(--ink-muted)]">
                            +{(track.tags?.length ?? 0) - visibleTags.length}
                          </span>
                        ) : null}
                      </span>

                      <CurationSignalChain
                        state={curationState}
                        compact
                        className="mt-3 max-w-[320px]"
                      />
                    </button>

                    <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1 sm:self-center">
                      <button
                        type="button"
                        onClick={() => trackFavoriteMutation.mutate(track)}
                        className={iconButtonClass(Boolean(track.isFavorite))}
                        disabled={favoritePending || favoriteBlockedByDraft}
                        aria-pressed={Boolean(track.isFavorite)}
                        aria-label={track.isFavorite ? `取消喜爱 ${track.title}` : `喜爱 ${track.title}`}
                        title={favoriteBlockedByDraft ? '请先保存当前歌曲草稿' : track.isFavorite ? '取消喜爱' : '加入喜爱'}
                      >
                        {favoritePending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Heart className={cn('h-4 w-4', track.isFavorite && 'fill-current text-[var(--aurora-4)]')} />
                        )}
                      </button>
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
                );
              })
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

        {editingTrack && !isMobile && renderTrackEditor(false)}
        </div>

        {editingTrack && isMobile && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 z-[90] flex items-end" role="presentation">
            <button
              type="button"
              className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
              onClick={() => requestTrackNavigation({ kind: 'close' })}
              aria-label="关闭歌曲编辑面板"
            />
            <section
              ref={trackEditorSheetRef}
              role="dialog"
              aria-modal="true"
              aria-label={`编辑歌曲：${editingTrack.title}`}
              aria-hidden={mobileEditorCoveredByModal ? true : undefined}
              inert={mobileEditorCoveredByModal ? true : undefined}
              tabIndex={-1}
              className="relative z-10 w-full"
            >
              {renderTrackEditor(true)}
            </section>
          </div>,
          document.body
        )}

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

      <BatchActionBar
        selectedCount={selectedTrackIds.length}
        onClearSelection={() => setSelectedTrackIds([])}
        allPlaylists={playlists}
        allTags={mediaTagsQuery.data?.data ?? []}
        busy={batchTagMutation.isPending || batchPlaylistAddMutation.isPending || batchDeleteMutation.isPending}
        onBatchAddTags={(tagIds) => batchTagMutation.mutate({ tagIds, trackIds: selectedTrackIds })}
        onBatchAddToPlaylist={(playlistId) => batchPlaylistAddMutation.mutate({ playlistId, trackIds: selectedTrackIds })}
        onBatchDelete={() => setPendingBatchDelete(true)}
      />
    </div>
  );

  function renderPlaylists() {
    const detail = playlistDetailQuery.data?.id === selectedPlaylistId
      ? playlistDetailQuery.data
      : undefined;
    const detailTracks = selectedPlaylistTracks;
    const existingTrackIds = buildPlaylistTrackIdSet(playlistMemberTracksQuery.data ?? []);
    const playlistCandidateTotal = playlistTrackCandidatesQuery.data?.total ?? 0;
    const playlistCandidateLoaded = playlistTrackCandidates.length;
    const hasMorePlaylistCandidates = playlistCandidateTotal > playlistCandidateLoaded;
    const isPlaylistMemberTrackLoading = Boolean(selectedPlaylistId) && playlistMemberTracksQuery.isLoading;
    const isPlaylistMemberTrackUnavailable = Boolean(selectedPlaylistId) && playlistMemberTracksQuery.isError;
    let addTracksStatusText = playlistCandidateTotal
      ? `曲库匹配 ${playlistCandidateTotal} 首`
      : '输入关键词搜索曲库';
    if (isPlaylistMemberTrackLoading) {
      addTracksStatusText = '正在核对歌单内全部歌曲，避免重复加入已存在曲目...';
    } else if (isPlaylistMemberTrackUnavailable) {
      addTracksStatusText = '无法核对歌单内歌曲，请刷新后重试。';
    } else if (playlistTrackCandidatesQuery.isFetching) {
      addTracksStatusText = '正在更新候选歌曲...';
    } else if (hasMorePlaylistCandidates) {
      addTracksStatusText = `已载入 ${playlistCandidateLoaded} / ${playlistCandidateTotal} 首，输入关键词可继续定位更多歌曲。`;
    }
    const trackActionsBusy =
      reorderPlaylistMutation.isPending ||
      playlistTrackMutation.isPending ||
      removePlaylistTrackMutation.isPending ||
      deletePlaylistMutation.isPending;
    const moveTrack = (index: number, direction: -1 | 1) => {
      if (!selectedPlaylistId || !detail || trackActionsBusy) return;
      const next = movePlaylistTrack(detailTracks, index, direction);
      if (next === detailTracks) return;
      reorderPlaylistMutation.mutate({ playlistId: selectedPlaylistId, tracks: next });
    };
    const commitTrackOrder = (next: MusicTrack[]) => {
      if (!selectedPlaylistId || !detail || trackActionsBusy) return;
      const unchanged = next.length === detailTracks.length
        && next.every((track, index) => track.id === detailTracks[index]?.id);
      if (unchanged) return;
      reorderPlaylistMutation.mutate({ playlistId: selectedPlaylistId, tracks: next });
    };
    const nowPlayingTrackId =
      selectedPlaylistId != null
        && queueSource.type === 'playlist'
        && queueSource.playlistId === selectedPlaylistId
        ? currentTrack?.id
        : undefined;
    const playFromIndex = (index: number) => {
      if (!selectedPlaylistId || detailTracks.length === 0) return;
      playTracks(
        detailTracks,
        index,
        { type: 'playlist', playlistId: selectedPlaylistId },
        selectedPlaylist?.name || '歌单播放'
      );
    };
    const playShuffled = () => {
      if (detailTracks.length === 0) return;
      playFromIndex(Math.floor(Math.random() * detailTracks.length));
    };
    const playingThisPlaylist = nowPlayingTrackId != null && isPlaying;
    const totalDurationSeconds = detailTracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0);
    const draftLoaded = playlistDraftSourceId === selectedPlaylistId;
    const heroTitle = draftLoaded
      ? (playlistDraft.name.trim() || '未命名歌单')
      : (selectedPlaylist?.name || '');
    const heroDescription = draftLoaded
      ? (playlistDraft.description || '')
      : (selectedPlaylist?.description || '');
    const heroCoverUrl = draftLoaded
      ? (playlistDraft.coverMediaFileId ? (detail?.coverUrl || selectedPlaylist?.coverUrl) : undefined)
      : selectedPlaylist?.coverUrl;
    const heroVisibility = (draftLoaded ? playlistDraft.visibility : selectedPlaylist?.visibility) || 'PUBLIC';
    const heroStatus = (draftLoaded ? playlistDraft.status : selectedPlaylist?.status) || 'ACTIVE';
    const isFeaturedSelected = selectedPlaylist != null && settings.featuredPlaylistId === selectedPlaylist.id;
    const canSaveDraftNow = canSavePlaylistDraft({
      selectedPlaylistId,
      loadedPlaylistId: playlistDraftSourceId,
      isFetching: playlistDetailQuery.isFetching,
      isSaving: isPlaylistWriteBusy,
    }) && Boolean(playlistDraft.name.trim());
    const addTracksToggle = (
      <button
        type="button"
        onClick={() => setAddTracksPanelOpen((value) => !value)}
        className={textButtonClass('primary')}
        aria-expanded={addTracksPanelOpen}
      >
        <ListPlus className="h-4 w-4" />
        添加歌曲
      </button>
    );

    return (
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <PlaylistRail
          playlists={visiblePlaylists}
          totalCount={playlists.length}
          loading={playlistsQuery.isLoading}
          selectedId={selectedPlaylistId}
          favoriteFilter={playlistFavoriteFilter}
          onToggleFavoriteFilter={() => setPlaylistFavoriteFilter((value) => value === 'FAVORITE' ? 'ALL' : 'FAVORITE')}
          onSelect={requestPlaylistSelection}
          featuredPlaylistId={settings.featuredPlaylistId}
          featuredEnabled={Boolean(settings.enabled)}
          writeBusy={isPlaylistWriteBusy || isSettingsWriteBusy}
          settingsReady={Boolean(settingsQuery.data)}
          favoritePendingId={playlistFavoriteMutation.isPending ? (playlistFavoriteMutation.variables?.id ?? null) : null}
          publishPendingId={publishPlaylistMutation.isPending ? (publishPlaylistMutation.variables?.playlistId ?? null) : null}
          draftSourceId={playlistDraftSourceId}
          draftDirty={playlistDraftDirty}
          draftFavorite={Boolean(playlistDraft.isFavorite)}
          onToggleFavoriteDraft={() => updatePlaylistDraft((draft) => ({ ...draft, isFavorite: !draft.isFavorite }))}
          onToggleFavorite={(playlist) => playlistFavoriteMutation.mutate(playlist)}
          onPublish={publishPlaylist}
          onDelete={(playlist) => setPendingDelete({ kind: 'playlist', playlist })}
          creating={createPlaylistMutation.isPending}
          onCreate={(name) => createPlaylistMutation.mutateAsync(name)}
        />

        <div className={shellClass}>
          {!selectedPlaylist ? (
            <div className="flex min-h-80 flex-col items-center justify-center gap-1.5 p-8 text-center">
              <div className="mb-3 h-20 w-20 overflow-hidden rounded-[var(--radius-lg)] opacity-90 shadow-[0_16px_36px_-16px_color-mix(in_oklch,var(--aurora-1)_40%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]">
                <MusicCoverThumb identity="aether:playlist-stage" alt="" />
              </div>
              <p className="text-sm font-semibold text-[var(--ink-primary)]">选择一个歌单开始策展</p>
              <p className="max-w-72 text-xs leading-5 text-[var(--ink-muted)]">在左侧选择或新建歌单;排序、封面与公开状态都在这里打理。</p>
            </div>
          ) : playlistDetailQuery.isError ? (
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
          ) : !draftLoaded ? (
            <div role="status" aria-label={`正在载入「${selectedPlaylist.name}」`}>
              <div className="border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 min-[769px]:p-5">
                <div className="flex gap-4 min-[769px]:gap-5">
                  <Skeleton variant="rectangular" width={112} height={112} className="shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2.5 py-1">
                    <Skeleton width={128} height={10} />
                    <Skeleton width="42%" height={24} />
                    <Skeleton width="30%" height={12} />
                    <div className="flex gap-2 pt-2">
                      <Skeleton width={108} height={40} className="rounded-[var(--radius-md)]" />
                      <Skeleton width={100} height={40} className="rounded-[var(--radius-md)]" />
                    </div>
                  </div>
                </div>
              </div>
              <PlaylistTrackTableSkeleton />
            </div>
          ) : (
            <>
              {/* Hero:歌单是一件作品 —— 封面、标题层级、元信息与主行动,编辑细节收进折叠面板 */}
              <div className="relative overflow-hidden border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                <div
                  className="pointer-events-none absolute inset-0 bg-[linear-gradient(130deg,color-mix(in_oklch,var(--aurora-1)_7%,transparent)_0%,transparent_52%)]"
                  aria-hidden="true"
                />
                <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch sm:gap-5 min-[769px]:p-5">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-[var(--radius-lg)] shadow-[0_18px_40px_-16px_color-mix(in_oklch,var(--aurora-1)_45%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] min-[769px]:h-32 min-[769px]:w-32">
                    <MusicCoverThumb
                      src={heroCoverUrl}
                      identity={`playlist:${selectedPlaylist.id}:${selectedPlaylist.name}`}
                      alt={`歌单「${selectedPlaylist.name}」封面`}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      <span className="inline-block h-3 w-0.5 rounded-full bg-[var(--aurora-1)]" aria-hidden="true" />
                      Playlist
                      <span>· {heroVisibility === 'PUBLIC' ? '公开' : '私有'}</span>
                      <span>· {heroStatus === 'ACTIVE' ? '展示' : '隐藏'}</span>
                      {isFeaturedSelected && (
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-bold',
                          settings.enabled
                            ? 'bg-[color-mix(in_oklch,var(--signal-success)_14%,transparent)] text-[var(--signal-success)]'
                            : 'bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)] text-[var(--signal-warn)]'
                        )}>
                          <Radio className="h-3 w-3" />
                          {settings.enabled ? '公开中' : '未启用'}
                        </span>
                      )}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-2xl font-bold leading-snug text-[var(--ink-primary)] min-[1100px]:text-3xl">
                        {heroTitle}
                      </h2>
                      {playlistDraftDirty && (
                        <span className="rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)] px-2 py-1 text-[10px] font-bold text-[var(--signal-warn)]">
                          未保存
                        </span>
                      )}
                    </div>
                    {heroDescription ? (
                      <p className="mt-1 line-clamp-1 text-sm text-[var(--ink-secondary)]">{heroDescription}</p>
                    ) : (
                      <p className="mt-1 text-sm text-[var(--ink-subtle)]">还没有描述 —— 在「编辑详情」里补一句。</p>
                    )}
                    <p className="tnum mt-1.5 text-xs text-[var(--ink-muted)]">
                      {detailTracks.length || selectedPlaylist.trackCount} 首
                      {totalDurationSeconds > 0 ? ` · ${formatClock(totalDurationSeconds)}` : ''}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 min-[769px]:mt-auto min-[769px]:pt-3">
                      <button
                        type="button"
                        onClick={() => (playingThisPlaylist ? void togglePlayback() : playFromIndex(0))}
                        className={solidButtonClass()}
                        disabled={detailTracks.length === 0 || isPlaylistMemberTrackLoading}
                      >
                        {playingThisPlaylist
                          ? <Pause className="h-4 w-4 fill-current" />
                          : <Play className="h-4 w-4 fill-current" />}
                        {playingThisPlaylist ? '暂停' : '播放全部'}
                      </button>
                      <button
                        type="button"
                        onClick={playShuffled}
                        className={textButtonClass()}
                        disabled={detailTracks.length === 0 || isPlaylistMemberTrackLoading}
                        title="从随机一首开始播放"
                      >
                        <Shuffle className="h-4 w-4" />
                        随机播放
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlaylistEditOpen((value) => !value)}
                        className={textButtonClass()}
                        aria-expanded={playlistEditOpen}
                      >
                        <Pencil className="h-4 w-4" />
                        {playlistEditOpen ? '收起编辑' : '编辑详情'}
                      </button>
                      {playlistDraftDirty && (
                        <button
                          type="button"
                          onClick={saveSelectedPlaylist}
                          className={textButtonClass('primary')}
                          disabled={!canSaveDraftNow}
                        >
                          {updatePlaylistMutation.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <RotateCw className="h-4 w-4" />}
                          保存修改
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {playlistEditOpen && (
                  <motion.div
                    key="playlist-edit"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={transition.quick}
                    className="overflow-hidden border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]"
                  >
                    <div className="space-y-4 p-4">
                      <CoverPicker
                        ownerKey={`playlist:${selectedPlaylist.id}`}
                        title={playlistDraft.name || selectedPlaylist.name}
                        value={playlistDraft.coverMediaFileId}
                        currentUrl={playlistDraft.coverMediaFileId ? (detail?.coverUrl || selectedPlaylist.coverUrl) : undefined}
                        items={coverImagesQuery.data?.list ?? []}
                        loading={coverImagesQuery.isLoading}
                        uploadFolderId={settings.mediaFolderId}
                        onChange={(media) => updatePlaylistDraft((draft) => ({
                          ...draft,
                          coverMediaFileId: media?.id,
                        }))}
                      />
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
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <TogglePill checked={playlistDraft.displayOnProfile} label="个人卡片" onClick={() => updatePlaylistDraft((draft) => ({ ...draft, displayOnProfile: !draft.displayOnProfile }))} />
                        <TogglePill checked={playlistDraft.carouselEnabled} label="轮播" onClick={() => updatePlaylistDraft((draft) => ({ ...draft, carouselEnabled: !draft.carouselEnabled }))} />
                        <TogglePill checked={playlistDraft.randomEnabled} label="随机" onClick={() => updatePlaylistDraft((draft) => ({ ...draft, randomEnabled: !draft.randomEnabled }))} />
                        <TogglePill checked={Boolean(playlistDraft.isFavorite)} label="喜爱歌单" onClick={() => updatePlaylistDraft((draft) => ({ ...draft, isFavorite: !draft.isFavorite }))} />
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
                          disabled={!canSaveDraftNow || !playlistDraftDirty}
                        >
                          {updatePlaylistMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                          {playlistDraftDirty ? '保存歌单' : '已保存'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] px-4 py-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  曲目 · <span className="tnum">{detailTracks.length}</span>
                </p>
                {addTracksToggle}
              </div>

              <AnimatePresence initial={false}>
                {addTracksPanelOpen && (
                  <AddTracksPanel
                    key="add-tracks"
                    keyword={playlistTrackKeyword}
                    onKeywordChange={setPlaylistTrackKeyword}
                    candidates={playlistTrackCandidates}
                    existingIds={existingTrackIds}
                    statusText={addTracksStatusText}
                    fetching={playlistTrackCandidatesQuery.isFetching}
                    memberCheckPending={isPlaylistMemberTrackLoading || isPlaylistMemberTrackUnavailable}
                    addingTrackId={playlistTrackMutation.isPending ? (playlistTrackMutation.variables?.trackId ?? null) : null}
                    busy={isPlaylistWriteBusy}
                    onAdd={(trackId) => selectedPlaylistId && playlistTrackMutation.mutate({ playlistId: selectedPlaylistId, trackId })}
                    onClose={() => setAddTracksPanelOpen(false)}
                  />
                )}
              </AnimatePresence>

              <PlaylistTrackTable
                tracks={detailTracks}
                loading={playlistDetailQuery.isLoading || isPlaylistMemberTrackLoading}
                busy={trackActionsBusy}
                nowPlayingTrackId={nowPlayingTrackId}
                isPlaying={isPlaying}
                onPlayAt={playFromIndex}
                onTogglePlayback={() => void togglePlayback()}
                onCommitOrder={commitTrackOrder}
                onMove={moveTrack}
                onRemove={(trackId) => selectedPlaylistId && removePlaylistTrackMutation.mutate({ playlistId: selectedPlaylistId, trackId })}
                addAction={addTracksToggle}
              />
            </>
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
  const dirtyDraftDescriptions = [
    trackDraftDirty ? `歌曲「${editingTrack?.title || '当前歌曲'}」的元数据` : null,
    lyricDraftDirty ? '当前歌词资产' : null,
    playlistDraftDirty ? `歌单「${selectedPlaylist?.name || '当前歌单'}」的编排设置` : null,
  ].filter((description): description is string => Boolean(description));
  const dirtyDraftSummary = dirtyDraftDescriptions.length > 0
    ? dirtyDraftDescriptions.join('、')
    : '当前音乐内容';
  const pendingTrackNavigationTarget = pendingTrackNavigation?.kind === 'select'
    ? `切换到歌曲「${pendingTrackNavigation.track.title}」`
    : pendingTrackNavigation?.kind === 'tab'
      ? `切换到「${tabs.find((tab) => tab.key === pendingTrackNavigation.tab)?.label || '目标页签'}」`
      : '关闭歌曲编辑器';
  const pendingTrackNavigationMessage =
    `${pendingTrackNavigationTarget}会丢弃${dirtyDraftSummary}尚未保存的修改。`;
  const activeConfirmationConfig: MusicConfirmationConfig | null = (() => {
    switch (activeConfirmation) {
      case 'delete':
        if (!pendingDelete) return null;
        return {
          title: pendingDeleteTitle,
          message: pendingDeleteMessage,
          confirmText: '确认删除',
          cancelText: '取消',
          variant: 'danger',
          pending: deletePlaylistMutation.isPending || deleteTrackMutation.isPending,
          onCancel: () => {
            if (deleteWriteLockRef.current || deletePlaylistMutation.isPending || deleteTrackMutation.isPending) return;
            setPendingDelete(null);
          },
          onConfirm: () => {
            if (deleteWriteLockRef.current) return;
            if (pendingDelete.kind === 'playlist') {
              if (isPlaylistWriteBusy) return;
              deleteWriteLockRef.current = true;
              deletePlaylistMutation.mutate(pendingDelete.playlist.id);
              return;
            }
            if (deleteTrackMutation.isPending || updateTrackMutation.isPending) return;
            deleteWriteLockRef.current = true;
            deleteTrackMutation.mutate({
              id: pendingDelete.track.id,
              deleteMedia: pendingDelete.deleteMedia,
            });
          },
        };
      case 'batch-delete':
        return {
          title: `批量删除 ${selectedTrackIds.length} 首歌曲？`,
          message: '所选歌曲会从音乐管理中移除，歌单成员关系将一并清除；媒体库原文件会保留。',
          confirmText: '确认删除',
          cancelText: '取消',
          variant: 'danger',
          pending: batchDeleteMutation.isPending,
          onCancel: () => setPendingBatchDelete(false),
          onConfirm: () => {
            if (batchDeleteMutation.isPending) return;
            setPendingBatchDelete(false);
            batchDeleteMutation.mutate({ trackIds: selectedTrackIds });
          },
        };
      case 'track-navigation':
        if (!pendingTrackNavigation) return null;
        return {
          title: '放弃未保存的音乐修改？',
          message: pendingTrackNavigationMessage,
          confirmText: pendingTrackNavigation.kind === 'close' ? '放弃并关闭' : '放弃并继续',
          cancelText: '继续编辑',
          variant: 'warning',
          pending: false,
          onCancel: () => setPendingTrackNavigation(null),
          onConfirm: () => performTrackNavigation(pendingTrackNavigation),
        };
      case 'playlist-selection':
        if (pendingPlaylistSelectionId == null) return null;
        return {
          title: '放弃未保存的歌单修改？',
          message: `切换到「${playlists.find((playlist) => playlist.id === pendingPlaylistSelectionId)?.name || '目标歌单'}」会丢弃当前尚未保存的名称、描述或展示设置。`,
          confirmText: '放弃并切换',
          cancelText: '继续编辑',
          variant: 'warning',
          pending: false,
          onCancel: () => setPendingPlaylistSelectionId(null),
          onConfirm: () => {
            const targetId = pendingPlaylistSelectionId;
            setPendingPlaylistSelectionId(null);
            selectPlaylist(targetId);
          },
        };
      case 'route-navigation':
        return {
          title: '放弃未保存的音乐修改？',
          message: `${dirtyDraftSummary}还有尚未保存的修改。继续前往其他页面会丢弃这些修改。`,
          confirmText: '放弃并离开',
          cancelText: '继续编辑',
          variant: 'warning',
          pending: false,
          onCancel: () => {
            if (dirtyNavigationBlocker.state === 'blocked') dirtyNavigationBlocker.reset();
          },
          onConfirm: () => {
            if (dirtyNavigationBlocker.state !== 'blocked') return;
            trackDraftRevisionRef.current += 1;
            playlistDraftRevisionRef.current += 1;
            setTrackDraftDirty(false);
            setPlaylistDraftDirty(false);
            setLyricDraftDirty(false);
            setLyricDiscardToken((token) => token + 1);
            dirtyNavigationBlocker.proceed();
          },
        };
      default:
        return null;
    }
  })();
  const hasHeaderPlaybackActions = activeTab === 'library' || activeTab === 'playlists';
  const headerPlaybackTracks = activeTab === 'library' ? tracks : selectedPlaylistTracks;
  const headerPlaybackLabel = activeTab === 'library' ? '播放当前曲库页' : '播放当前歌单';

  return (
    <div
      {...musicSkinScopeProps(settings, isDark)}
      className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] overflow-x-clip p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6"
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          className="music-module-header"
          title="音乐策展工作室"
          description="从音频入库到元数据、封面、标签、歌词、歌单与发布，沿一条可下钻的策展信号链完成管理。"
          tabs={tabs}
          activeKey={activeTab}
          onTabChange={(tab) => requestTrackNavigation({ kind: 'tab', tab })}
          tabPanelIdPrefix="admin-module"
          showCurrentLabel={false}
          showActiveSummary={false}
          actions={hasHeaderPlaybackActions ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (headerPlaybackTracks.length === 0) return;
                  if (activeTab === 'playlists' && selectedPlaylistId) {
                    playTracks(
                      headerPlaybackTracks,
                      0,
                      { type: 'playlist', playlistId: selectedPlaylistId },
                      selectedPlaylist?.name || '歌单播放'
                    );
                    return;
                  }
                  playTracks(headerPlaybackTracks, 0, { type: 'library' }, '歌曲库 · 当前页');
                }}
                className="admin-module-action-button"
                disabled={headerPlaybackTracks.length === 0}
                aria-label={headerPlaybackLabel}
                title={headerPlaybackLabel}
              >
                <Play className="h-4 w-4" />
                <span className="hidden sm:inline">{activeTab === 'library' ? '播放当前页' : '播放歌单'}</span>
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
          ) : undefined}
        />

        {activeTab === 'overview' && (
          <section id="admin-module-panel-overview" role="tabpanel" aria-labelledby="admin-module-tab-overview" tabIndex={0}>
            {overviewTracksQuery.isError ? (
              <div className={cn(panelClass, 'flex min-h-48 items-center justify-center text-center')} role="alert">
                <div>
                  <p className="text-sm font-black text-[var(--ink-primary)]">策展总览载入失败</p>
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">歌曲不会被修改，可以重新拉取完整度信号。</p>
                  <button
                    type="button"
                    onClick={() => void overviewTracksQuery.refetch()}
                    className={cn(textButtonClass('primary'), 'mt-4')}
                  >
                    <RefreshCw className="h-4 w-4" />
                    重新载入
                  </button>
                </div>
              </div>
            ) : (
              <MusicCurationOverview
                summary={summaryQuery.data}
                tracks={overviewTracksQuery.data ?? []}
                loading={overviewTracksQuery.isLoading}
                onOpenLibrary={openLibraryWithFilter}
                onOpenLyrics={() => requestTrackNavigation({ kind: 'tab', tab: 'lyrics' })}
                onOpenPlaylists={() => requestTrackNavigation({ kind: 'tab', tab: 'playlists' })}
                onOpenDisplay={() => requestTrackNavigation({ kind: 'tab', tab: 'display' })}
              />
            )}
          </section>
        )}
        {activeTab === 'library' && (
          <section id="admin-module-panel-library" role="tabpanel" aria-labelledby="admin-module-tab-library" tabIndex={0}>
            {renderLibrary()}
          </section>
        )}
        {activeTab === 'lyrics' && (
          <section id="admin-module-panel-lyrics" role="tabpanel" aria-labelledby="admin-module-tab-lyrics" tabIndex={0}>
            <LyricsWorkspace
              focusTrack={lyricsFocusTrack}
              discardToken={lyricDiscardToken}
              onDirtyChange={setLyricDraftDirty}
            />
          </section>
        )}
        {activeTab === 'playlists' && (
          <section id="admin-module-panel-playlists" role="tabpanel" aria-labelledby="admin-module-tab-playlists" tabIndex={0}>
            {renderPlaylists()}
          </section>
        )}
        {activeTab === 'display' && (
          <section id="admin-module-panel-display" role="tabpanel" aria-labelledby="admin-module-tab-display" tabIndex={0} className="space-y-4">
            <AdminMusicTimelineSlot>
              {(timeline) => renderHallStage(timeline)}
            </AdminMusicTimelineSlot>
            {renderDisplay()}
          </section>
        )}
      </div>

      <ConfirmDialog
        isOpen={activeConfirmationConfig != null}
        title={activeConfirmationConfig?.title ?? ''}
        message={activeConfirmationConfig?.message ?? ''}
        confirmText={activeConfirmationConfig?.confirmText}
        cancelText={activeConfirmationConfig?.cancelText}
        variant={activeConfirmationConfig?.variant}
        pending={activeConfirmationConfig?.pending}
        onCancel={() => activeConfirmationConfig?.onCancel()}
        onConfirm={() => activeConfirmationConfig?.onConfirm()}
      />
    </div>
  );
}
