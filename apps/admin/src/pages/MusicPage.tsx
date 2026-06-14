import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Disc3,
  FolderPlus,
  Headphones,
  LibraryBig,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
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
import { toast } from 'sonner';
import type {
  FolderTreeNode,
  MusicAudioCandidate,
  MusicPlaybackMode,
  MusicPlaylist,
  MusicPlaylistRequest,
  MusicSettings,
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

type MusicTab = 'library' | 'playlists' | 'display';
type PendingDelete =
  | { kind: 'track'; track: MusicTrack; deleteMedia: boolean }
  | { kind: 'playlist'; playlist: MusicPlaylist };
type PlaylistDraft = MusicPlaylistRequest & { sortOrder: number };

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 10;
const MUSIC_HALL_FOLDER_NAME = '音乐大厅';

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
    description: '配置个人卡片入口、首页展示、随机与轮播播放策略。',
    icon: SlidersHorizontal,
  },
];

const panelClass = cn(
  'access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-4'
);

const shellClass = cn(
  'access-surface overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

function iconButtonClass(active = false, tone: 'default' | 'primary' | 'danger' = 'default') {
  return cn(
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 active:translate-y-px',
    active && 'shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
    tone === 'primary' &&
      'border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_16%,transparent)]',
    tone === 'danger' &&
      'border-[color-mix(in_oklch,var(--signal-danger)_24%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_12%,transparent)]',
    tone === 'default' &&
      'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)]'
  );
}

function textButtonClass(tone: 'default' | 'primary' | 'danger' = 'default') {
  return cn(
    'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-all duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50',
    tone === 'primary' &&
      'border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
    tone === 'danger' &&
      'border-[color-mix(in_oklch,var(--signal-danger)_24%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_12%,transparent)]',
    tone === 'default' &&
      'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)]'
  );
}

function inputClass(extra?: string) {
  return cn(
    'h-10 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-3 text-sm text-[var(--ink-primary)]',
    'placeholder:text-[var(--ink-muted)] transition-[border-color,box-shadow] duration-200 focus:border-[color-mix(in_oklch,var(--aurora-1)_48%,transparent)] focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
    extra
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
    featuredPlaylist: settings?.featuredPlaylist,
  };
}

export default function MusicPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    queue,
    currentTrack,
    currentIndex,
    isPlaying,
    percent,
    playTracks,
  } = useAdminMusicPlayer();
  const [activeTab, setActiveTab] = useState<MusicTab>('library');
  const [trackPage, setTrackPage] = useState(1);
  const [trackPageSize, setTrackPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [trackKeyword, setTrackKeyword] = useState('');
  const [scanKeyword, setScanKeyword] = useState('');
  const [scanPage, setScanPage] = useState(1);
  const [scanPageSize, setScanPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [includeMapped, setIncludeMapped] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [newFolderName, setNewFolderName] = useState(MUSIC_HALL_FOLDER_NAME);
  const [uploadingLabel, setUploadingLabel] = useState('');
  const [editingTrack, setEditingTrack] = useState<MusicTrack | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [playlistForm, setPlaylistForm] = useState({
    name: '我的歌单',
    description: '',
    displayOnHome: true,
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
  const [trackToAdd, setTrackToAdd] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['music-settings'],
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

  const playlistsQuery = useQuery({
    queryKey: ['music-playlists'],
    queryFn: async () => (await musicService.getPlaylists({ pageNum: 1, pageSize: 100 })).data,
  });

  const foldersQuery = useQuery({
    queryKey: ['media-folders-tree'],
    queryFn: async () => (await folderService.getTree()).data,
  });

  const settings = defaultSettings(settingsQuery.data);
  const tracks = tracksQuery.data?.list ?? [];
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
  const trackOptions = useMemo<SelectOption[]>(
    () => tracks.map((item) => ({
      value: String(item.id),
      label: item.title,
      description: `${item.artist || '未知艺术家'} · ${item.media.originalName}`,
    })),
    [tracks]
  );

  const scanQuery = useQuery({
    queryKey: ['music-scan', settings.mediaFolderId, scanKeyword, includeMapped, scanPage, scanPageSize],
    enabled: Boolean(settings.mediaFolderId),
    queryFn: async () =>
      (await musicService.scanAudio({
        folderId: settings.mediaFolderId,
        keyword: scanKeyword || undefined,
        includeMapped,
        pageNum: scanPage,
        pageSize: scanPageSize,
      })).data,
  });

  const playlistDetailQuery = useQuery({
    queryKey: ['music-playlist-detail', selectedPlaylistId],
    enabled: activeTab === 'playlists' && Boolean(selectedPlaylistId),
    queryFn: async () => (await musicService.getPlaylist(selectedPlaylistId!, { includeTracks: true })).data,
  });
  const selectedCandidateSet = useMemo(() => new Set(selectedCandidateIds), [selectedCandidateIds]);

  const invalidateMusic = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['music-summary'] });
    queryClient.invalidateQueries({ queryKey: ['music-settings'] });
    queryClient.invalidateQueries({ queryKey: ['music-tracks'] });
    queryClient.invalidateQueries({ queryKey: ['music-scan'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['music-playlist-detail'] });
  }, [queryClient]);

  const settingsMutation = useMutation({
    mutationFn: musicService.updateSettings,
    onSuccess: () => {
      toast.success('播放展示设置已保存');
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '保存设置失败')),
  });

  const importMutation = useMutation({
    mutationFn: musicService.importMedia,
    onSuccess: (res) => {
      toast.success(`已纳入曲库：${res.data?.title || '音频'}`);
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
    mutationFn: ({ id, data }: { id: number; data: MusicTrackRequest }) => musicService.updateTrack(id, data),
    onSuccess: (res) => {
      toast.success('歌曲信息已更新');
      setEditingTrack(res.data);
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '更新歌曲失败')),
  });

  const deleteTrackMutation = useMutation({
    mutationFn: ({ id, deleteMedia }: { id: number; deleteMedia: boolean }) =>
      musicService.deleteTrack(id, { deleteMedia }),
    onSuccess: () => {
      toast.success('歌曲已移除');
      setEditingTrack(null);
      setPendingDelete(null);
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '移除歌曲失败')),
  });

  const createFolderMutation = useMutation({
    mutationFn: () => folderService.create({ name: newFolderName.trim() || MUSIC_HALL_FOLDER_NAME }),
    onSuccess: async (res) => {
      const folderId = res.data.id;
      toast.success(`已创建媒体目录：${res.data.name}`);
      queryClient.invalidateQueries({ queryKey: ['media-folders-tree'] });
      await settingsMutation.mutateAsync({ ...settings, mediaFolderId: folderId });
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '创建媒体目录失败')),
  });

  const createPlaylistMutation = useMutation({
    mutationFn: () =>
      musicService.createPlaylist({
        name: playlistForm.name.trim() || '我的歌单',
        description: playlistForm.description.trim() || undefined,
        displayOnHome: playlistForm.displayOnHome,
        displayOnProfile: playlistForm.displayOnProfile,
        carouselEnabled: playlistForm.carouselEnabled,
        randomEnabled: playlistForm.randomEnabled,
        visibility: 'PUBLIC',
        status: 'ACTIVE',
      }),
    onSuccess: (res) => {
      toast.success(`已创建歌单：${res.data.name}`);
      setSelectedPlaylistId(res.data.id);
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '创建歌单失败')),
  });

  const updatePlaylistMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: MusicPlaylistRequest }) =>
      musicService.updatePlaylist(id, data),
    onSuccess: (res) => {
      toast.success(`已保存歌单：${res.data.name}`);
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '保存歌单失败')),
  });

  const deletePlaylistMutation = useMutation({
    mutationFn: musicService.deletePlaylist,
    onSuccess: () => {
      toast.success('歌单已删除');
      setPendingDelete(null);
      setSelectedPlaylistId(null);
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '删除歌单失败')),
  });

  const playlistTrackMutation = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: number; trackId: number }) =>
      musicService.addTrackToPlaylist(playlistId, trackId),
    onSuccess: () => {
      toast.success('已加入歌单');
      setTrackToAdd('');
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '加入歌单失败')),
  });

  const removePlaylistTrackMutation = useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: number; trackId: number }) =>
      musicService.removeTrackFromPlaylist(playlistId, trackId),
    onSuccess: () => {
      toast.success('已从歌单移除');
      invalidateMusic();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '移出歌单失败')),
  });

  const reorderPlaylistMutation = useMutation({
    mutationFn: ({ playlistId, tracks }: { playlistId: number; tracks: MusicTrack[] }) =>
      musicService.reorderPlaylist(
        playlistId,
        tracks.map((track, index) => ({ trackId: track.id, sortOrder: index }))
      ),
    onSuccess: () => invalidateMusic(),
    onError: (error) => toast.error(extractApiErrorMessage(error, '调整排序失败')),
  });

  useEffect(() => {
    if (!selectedPlaylistId && playlists.length > 0) {
      setSelectedPlaylistId(playlists[0].id);
    }
  }, [playlists, selectedPlaylistId]);

  useEffect(() => {
    const detail = playlistDetailQuery.data;
    if (!detail) return;
    setPlaylistDraft({
      name: detail.name,
      description: detail.description || '',
      visibility: detail.visibility,
      status: detail.status,
      displayOnHome: detail.displayOnHome,
      displayOnProfile: detail.displayOnProfile,
      carouselEnabled: detail.carouselEnabled,
      randomEnabled: detail.randomEnabled,
      sortOrder: detail.sortOrder,
    });
  }, [playlistDetailQuery.data]);

  useEffect(() => {
    setSelectedCandidateIds([]);
  }, [settings.mediaFolderId, scanKeyword, includeMapped, scanPage, scanPageSize]);

  const saveSettingsPatch = (patch: Partial<MusicSettings>) => {
    settingsMutation.mutate({
      ...settings,
      ...patch,
      playbackMode: (patch.playbackMode || settings.playbackMode) as MusicPlaybackMode,
    });
  };

  const toggleCandidate = (id: number) => {
    setSelectedCandidateIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  };

  const saveSelectedPlaylist = () => {
    if (!selectedPlaylistId) return;
    updatePlaylistMutation.mutate({
      id: selectedPlaylistId,
      data: {
        ...playlistDraft,
        name: playlistDraft.name.trim() || selectedPlaylist?.name || '未命名歌单',
        description: playlistDraft.description?.trim() || undefined,
      },
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!settings.mediaFolderId) {
      toast.error('请先指定音乐大厅媒体目录，或创建一个目录后再上传');
      return;
    }
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('audio/')) {
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
    const source = tracks.length > 0 ? tracks : [track];
    const index = Math.max(0, source.findIndex((item) => item.id === track.id));
    playTracks(source, index);
  };

  const renderHallStage = () => {
    const stageTrack = currentTrack ?? tracks[0];
    const stageProgressPercent = currentTrack && stageTrack && currentTrack.id === stageTrack.id ? percent : 0;
    return (
      <div className="access-surface overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[linear-gradient(135deg,color-mix(in_oklch,var(--bg-leaf)_92%,#ff4d4f_8%),var(--bg-leaf)_50%,color-mix(in_oklch,var(--bg-leaf)_88%,var(--ink-primary)_12%))] shadow-[0_22px_70px_-52px_rgba(0,0,0,0.52)]">
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-5">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklch,#ff4d4f_28%,transparent)] bg-[color-mix(in_oklch,#ff4d4f_9%,transparent)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-[#d93d3f]">
              <Disc3 className={cn('h-3.5 w-3.5', isPlaying && 'animate-spin [animation-duration:3s]')} />
              Music Hall Control
            </div>
            <h2 className="mt-4 text-2xl font-black tracking-normal text-[var(--ink-primary)] sm:text-4xl">音乐大厅中控台</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ink-secondary)]">
              媒体库负责存储，音乐大厅负责策展、排序、公开展示、歌词封面和播放策略。上传入口会写入指定媒体目录，歌单排序与媒体库目录保持解耦。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StageMetric label="曲库" value={summaryQuery.data?.trackCount ?? tracksQuery.data?.total ?? 0} />
              <StageMetric label="展示中" value={summaryQuery.data?.activeTrackCount ?? 0} />
              <StageMetric label="歌单" value={summaryQuery.data?.playlistCount ?? playlists.length} />
              <StageMetric label="可扫音频" value={summaryQuery.data?.availableAudioCount ?? 0} />
            </div>
          </div>

          <div className="rounded-2xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[rgba(20,17,17,0.88)] p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ffb4a9]">Now Auditioning</p>
                <h3 className="mt-2 truncate text-xl font-black tracking-normal">{stageTrack?.title || '等待选择歌曲'}</h3>
                <p className="mt-1 truncate text-sm text-white/55">{stageTrack?.artist || '从曲库或歌单点击试听'}</p>
              </div>
              <span className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-xs font-bold',
                settings.enabled ? 'bg-emerald-400/14 text-emerald-200' : 'bg-white/8 text-white/45'
              )}>
                {settings.enabled ? '公开已启用' : '未公开'}
              </span>
            </div>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => tracks.length > 0 && playTracks(tracks, Math.max(0, stageTrack ? tracks.findIndex((track) => track.id === stageTrack.id) : 0))}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ff4d4f] text-white shadow-[0_16px_34px_-18px_rgba(255,77,79,0.95)] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={tracks.length === 0}
                aria-label="试听音乐大厅歌曲"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#ff4d4f] transition-[width] duration-200" style={{ width: `${stageProgressPercent}%` }} />
                </div>
                <p className="mt-2 truncate text-xs text-white/45">
                  {settings.mediaFolderId ? `媒体目录 #${settings.mediaFolderId}` : `未指定 ${MUSIC_HALL_FOLDER_NAME} 媒体目录`}
                </p>
              </div>
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
          onClick={() => createFolderMutation.mutate()}
          disabled={createFolderMutation.isPending}
          className={textButtonClass('primary')}
        >
          {createFolderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
          创建目录
        </button>
      </div>
    </div>
  );

  const renderLibrary = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
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
              accept="audio/*"
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
              <div className="p-6 text-sm text-[var(--ink-muted)]">暂无歌曲。请上传音频，或从媒体库扫描后纳入曲库。</div>
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
                    aria-label={`播放 ${track.title}`}
                  >
                    {currentTrack?.id === track.id && isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTrack(track)}
                    className="min-w-0 text-left"
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

        <div className={shellClass}>
          <AdminSectionHeader
            icon={<Wand2 className="h-4 w-4" />}
            title="媒体库音频扫描"
            description={settings.mediaFolderId ? '扫描音乐大厅目录下尚未纳入曲库的音频文件' : '指定目录后可扫描'}
            aside={
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIncludeMapped((value) => !value)}
                  className={textButtonClass(includeMapped ? 'primary' : 'default')}
                >
                  <RefreshCw className="h-4 w-4" />
                  {includeMapped ? '包含已纳入' : '仅未纳入'}
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
            ) : (scanQuery.data?.list ?? []).length === 0 ? (
              <div className="p-6 text-sm text-[var(--ink-muted)]">未发现可纳入的音频文件。</div>
            ) : (
              (scanQuery.data?.list ?? []).map((item: MusicAudioCandidate) => (
                <div key={item.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                  <label className="flex h-10 w-10 items-center justify-center rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)]">
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
                  >
                    <Plus className="h-4 w-4" />
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

      <div className="space-y-4">
        <TrackEditor
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSave={(track, data) => updateTrackMutation.mutate({ id: track.id, data })}
          saving={updateTrackMutation.isPending}
        />
      </div>
    </div>
  );

  function TrackEditor({
    track,
    onClose,
    onSave,
    saving,
  }: {
    track: MusicTrack | null;
    onClose: () => void;
    onSave: (track: MusicTrack, data: MusicTrackRequest) => void;
    saving: boolean;
  }) {
    const [draft, setDraft] = useState<MusicTrack | null>(track);
    useEffect(() => setDraft(track), [track]);
    if (!track || !draft) {
      return (
        <div className={cn(panelClass, 'text-sm text-[var(--ink-muted)]')}>
          选择一首歌曲后可编辑标题、艺术家、专辑、排序与展示状态。
        </div>
      );
    }
    return (
      <div className={cn(panelClass, 'sticky top-4 space-y-4')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[var(--ink-primary)]">歌曲信息</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">媒体文件：{track.media?.originalName || '未加载媒体文件名'}</p>
          </div>
          <button type="button" onClick={onClose} className={iconButtonClass()}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">标题</span>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputClass()} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">艺术家</span>
            <input value={draft.artist} onChange={(e) => setDraft({ ...draft, artist: e.target.value })} className={inputClass()} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">专辑</span>
            <input value={draft.album} onChange={(e) => setDraft({ ...draft, album: e.target.value })} className={inputClass()} />
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
                onChange={(e) => setDraft({
                  ...draft,
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
              onChange={(e) => setDraft({ ...draft, lyric: e.target.value })}
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
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
                className={inputClass()}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">状态</span>
              <Select
                value={draft.status}
                onValueChange={(value) => setDraft({ ...draft, status: value as MusicTrack['status'] })}
                options={[
                  { value: 'ACTIVE', label: '展示' },
                  { value: 'HIDDEN', label: '隐藏' },
                ]}
                ariaLabel="歌曲状态"
              />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setPendingDelete({ kind: 'track', track, deleteMedia: true })}
            className={textButtonClass('danger')}
          >
            <Trash2 className="h-4 w-4" />
            连媒体删除
          </button>
          <button type="button" onClick={() => playSingle(track)} className={textButtonClass()}>
            <Play className="h-4 w-4" />
            试听
          </button>
          <button
            type="button"
            onClick={() => onSave(track, {
              title: draft.title,
              artist: draft.artist,
              album: draft.album,
              coverMediaFileId: draft.coverMediaFileId,
              lyric: draft.lyric,
              status: draft.status,
              sortOrder: draft.sortOrder,
              isFeatured: draft.isFeatured,
            })}
            className={textButtonClass('primary')}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            保存
          </button>
        </div>
      </div>
    );
  }

  function renderPlaylists() {
    const detail = playlistDetailQuery.data;
    const detailTracks = detail?.tracks ?? [];
    const moveTrack = (index: number, direction: -1 | 1) => {
      if (!selectedPlaylistId || !detail) return;
      const next = [...detailTracks];
      const target = index + direction;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      reorderPlaylistMutation.mutate({ playlistId: selectedPlaylistId, tracks: next });
    };

    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className={cn(panelClass, 'space-y-3')}>
            <p className="text-sm font-bold text-[var(--ink-primary)]">创建歌单</p>
            <input value={playlistForm.name} onChange={(e) => setPlaylistForm((f) => ({ ...f, name: e.target.value }))} className={inputClass()} />
            <input value={playlistForm.description} onChange={(e) => setPlaylistForm((f) => ({ ...f, description: e.target.value }))} className={inputClass()} placeholder="歌单描述" />
            <div className="grid grid-cols-2 gap-2">
              <TogglePill checked={playlistForm.displayOnHome} label="首页展示" onClick={() => setPlaylistForm((f) => ({ ...f, displayOnHome: !f.displayOnHome }))} />
              <TogglePill checked={playlistForm.displayOnProfile} label="个人卡片" onClick={() => setPlaylistForm((f) => ({ ...f, displayOnProfile: !f.displayOnProfile }))} />
              <TogglePill checked={playlistForm.carouselEnabled} label="轮播" onClick={() => setPlaylistForm((f) => ({ ...f, carouselEnabled: !f.carouselEnabled }))} />
              <TogglePill checked={playlistForm.randomEnabled} label="随机" onClick={() => setPlaylistForm((f) => ({ ...f, randomEnabled: !f.randomEnabled }))} />
            </div>
            <button type="button" onClick={() => createPlaylistMutation.mutate()} className={textButtonClass('primary')} disabled={createPlaylistMutation.isPending}>
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
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => setSelectedPlaylistId(playlist.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]',
                    selectedPlaylistId === playlist.id && 'bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)]'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--ink-primary)]">{playlist.name}</span>
                    <span className="mt-1 block text-xs text-[var(--ink-muted)]">{playlist.trackCount} 首 · {playlist.visibility === 'PUBLIC' ? '公开' : '私有'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDelete({ kind: 'playlist', playlist });
                    }}
                    className={iconButtonClass(false, 'danger')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={shellClass}>
          <AdminSectionHeader
            icon={<Headphones className="h-4 w-4" />}
            title={selectedPlaylist?.name || '选择歌单'}
            description={selectedPlaylist ? '歌单排序独立于媒体库和曲库排序' : '创建或选择一个歌单后开始编排'}
            aside={selectedPlaylist ? <AdminSectionCount>{detailTracks.length} 首</AdminSectionCount> : null}
          />
          {selectedPlaylist ? (
            <>
              <div className="space-y-4 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">歌单名称</span>
                    <input
                      value={playlistDraft.name}
                      onChange={(e) => setPlaylistDraft((draft) => ({ ...draft, name: e.target.value }))}
                      className={inputClass()}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">描述</span>
                    <input
                      value={playlistDraft.description || ''}
                      onChange={(e) => setPlaylistDraft((draft) => ({ ...draft, description: e.target.value }))}
                      className={inputClass()}
                      placeholder="可选"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">排序</span>
                    <input
                      type="number"
                      value={playlistDraft.sortOrder}
                      onChange={(e) => setPlaylistDraft((draft) => ({ ...draft, sortOrder: Number(e.target.value) || 0 }))}
                      className={inputClass()}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[180px_180px_minmax(0,1fr)_auto]">
                  <Select
                    value={playlistDraft.visibility || 'PUBLIC'}
                    onValueChange={(value) => setPlaylistDraft((draft) => ({ ...draft, visibility: value as MusicPlaylist['visibility'] }))}
                    options={[
                      { value: 'PUBLIC', label: '公开' },
                      { value: 'PRIVATE', label: '私有' },
                    ]}
                    ariaLabel="歌单可见性"
                  />
                  <Select
                    value={playlistDraft.status || 'ACTIVE'}
                    onValueChange={(value) => setPlaylistDraft((draft) => ({ ...draft, status: value as MusicPlaylist['status'] }))}
                    options={[
                      { value: 'ACTIVE', label: '展示' },
                      { value: 'HIDDEN', label: '隐藏' },
                    ]}
                    ariaLabel="歌单状态"
                  />
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <TogglePill checked={playlistDraft.displayOnHome} label="首页" onClick={() => setPlaylistDraft((draft) => ({ ...draft, displayOnHome: !draft.displayOnHome }))} />
                    <TogglePill checked={playlistDraft.displayOnProfile} label="卡片" onClick={() => setPlaylistDraft((draft) => ({ ...draft, displayOnProfile: !draft.displayOnProfile }))} />
                    <TogglePill checked={playlistDraft.carouselEnabled} label="轮播" onClick={() => setPlaylistDraft((draft) => ({ ...draft, carouselEnabled: !draft.carouselEnabled }))} />
                    <TogglePill checked={playlistDraft.randomEnabled} label="随机" onClick={() => setPlaylistDraft((draft) => ({ ...draft, randomEnabled: !draft.randomEnabled }))} />
                  </div>
                  <button
                    type="button"
                    onClick={saveSelectedPlaylist}
                    className={textButtonClass('primary')}
                    disabled={updatePlaylistMutation.isPending || !playlistDraft.name.trim()}
                  >
                    {updatePlaylistMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                    保存歌单
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <Select
                  value={trackToAdd}
                  onValueChange={setTrackToAdd}
                  options={trackOptions}
                  placeholder="从当前曲库页选择歌曲"
                  prefix={<Music2 />}
                  ariaLabel="选择歌曲加入歌单"
                />
                <button
                  type="button"
                  onClick={() => selectedPlaylistId && trackToAdd && playlistTrackMutation.mutate({ playlistId: selectedPlaylistId, trackId: Number(trackToAdd) })}
                  className={textButtonClass('primary')}
                  disabled={!trackToAdd || playlistTrackMutation.isPending}
                >
                  <Plus className="h-4 w-4" />
                  加入歌单
                </button>
              </div>
              <div className="divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]">
                {playlistDetailQuery.isLoading ? (
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
                      <button type="button" onClick={() => playTracks(detailTracks, index)} className={iconButtonClass(false, 'primary')}>
                        <Play className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => moveTrack(index, -1)} className={iconButtonClass()} disabled={index === 0}>
                        <SkipBack className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => moveTrack(index, 1)} className={iconButtonClass()} disabled={index === detailTracks.length - 1}>
                        <SkipForward className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => selectedPlaylistId && removePlaylistTrackMutation.mutate({ playlistId: selectedPlaylistId, trackId: track.id })}
                        className={iconButtonClass(false, 'danger')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
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
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className={cn(panelClass, 'space-y-4')}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TogglePill checked={settings.enabled} label="启用公开播放器" onClick={() => saveSettingsPatch({ enabled: !settings.enabled })} />
            <TogglePill checked={settings.showOnProfileCard} label="个人卡片入口" onClick={() => saveSettingsPatch({ showOnProfileCard: !settings.showOnProfileCard })} />
            <TogglePill checked={settings.showOnHomePage} label="首页展示" onClick={() => saveSettingsPatch({ showOnHomePage: !settings.showOnHomePage })} />
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
                value={settings.carouselIntervalSeconds}
                onChange={(event) => saveSettingsPatch({ carouselIntervalSeconds: Number(event.target.value) || 8 })}
                className={inputClass()}
              />
            </label>
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
            <button type="button" onClick={() => createFolderMutation.mutate()} className={textButtonClass('primary')} disabled={createFolderMutation.isPending}>
              <FolderPlus className="h-4 w-4" />
              创建目录
            </button>
          </div>
        </div>

        <div className={cn(panelClass, 'space-y-4')}>
          <div className="flex items-start gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]">
              <Volume2 className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-bold text-[var(--ink-primary)]">公开播放器预案</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                前台首页和个人卡片会读取公开接口，只展示启用、公开且未删除媒体文件的歌曲。
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

  function Metric({ label, value }: { label: string; value: number }) {
    return (
      <div className="rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
        <p className="text-xs text-[var(--ink-muted)]">{label}</p>
        <p className="tnum mt-1 text-2xl font-bold text-[var(--ink-primary)]">{value}</p>
      </div>
    );
  }

  function StageMetric({ label, value }: { label: string; value: number }) {
    return (
      <div className="rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--bg-leaf)_82%,transparent)] p-3">
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
        className={cn(
          'inline-flex h-10 items-center justify-between gap-3 rounded-lg border px-3 text-sm font-semibold transition-all duration-200',
          checked
            ? 'border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--ink-primary)]'
            : 'border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] text-[var(--ink-muted)]'
        )}
      >
        <span>{label}</span>
        <span className={cn('h-2.5 w-2.5 rounded-full', checked ? 'bg-[var(--aurora-1)]' : 'bg-[var(--ink-muted)]/30')} />
      </button>
    );
  }

  const totalTracks = summaryQuery.data?.trackCount ?? tracksQuery.data?.total ?? 0;
  const activeTabLabel = tabs.find((tab) => tab.key === activeTab)?.label ?? '音乐大厅';
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

  return (
    <div className="admin-grid-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          title="音乐大厅"
          description="以媒体库音频为存储层，独立管理歌曲、歌单、展示入口与播放策略。"
          tabs={tabs}
          activeKey={activeTab}
          onTabChange={setActiveTab}
          currentLabel={activeTabLabel}
          activeSummary={`曲库 ${totalTracks} 首 · 歌单 ${summaryQuery.data?.playlistCount ?? playlists.length} 个 · ${settings.enabled ? '公开播放器已启用' : '公开播放器未启用'}`}
          actions={
            <>
              <button
                type="button"
                onClick={() => tracks.length > 0 && playTracks(tracks, 0)}
                className="admin-module-action-button"
                disabled={tracks.length === 0}
                aria-label="播放当前曲库页"
              >
                <Play className="h-4 w-4" />
                <span className="hidden sm:inline">播放当前页</span>
                <span className="sm:hidden">播放</span>
              </button>
              <button
                type="button"
                onClick={() => saveSettingsPatch({ enabled: !settings.enabled })}
                className="admin-module-action-button"
                aria-label={settings.enabled ? '停用公开播放器' : '启用公开播放器'}
              >
                <Volume2 className="h-4 w-4" />
                <span>{settings.enabled ? '已启用' : '启用'}</span>
              </button>
            </>
          }
        />

        {renderHallStage()}

        {activeTab === 'library' && renderLibrary()}
        {activeTab === 'playlists' && renderPlaylists()}
        {activeTab === 'display' && renderDisplay()}
      </div>

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title={pendingDeleteTitle}
        message={pendingDeleteMessage}
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === 'playlist') {
            deletePlaylistMutation.mutate(pendingDelete.playlist.id);
          } else {
            deleteTrackMutation.mutate({
              id: pendingDelete.track.id,
              deleteMedia: pendingDelete.deleteMedia,
            });
          }
        }}
      />
    </div>
  );
}
