import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Check,
  Clock3,
  FileText,
  Languages,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wand2,
  Sparkles,
} from 'lucide-react';
import { Select, type SelectOption } from '@aetherblog/ui';
import type {
  MusicLyric,
  MusicLyricStatus,
  MusicTrack,
} from '@aetherblog/types';
import { toast } from 'sonner';
import { AdminPagination } from '@/components/common/AdminPagination';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAdminMusicPlayerTimeline } from '@/components/music/AdminMusicPlayerProvider';
import {
  AdminSectionCount,
  AdminSectionHeader,
} from '@/components/layout/AdminSectionHeader';
import { cn, extractApiErrorMessage } from '@/lib/utils';
import { musicService } from '@/services/musicService';
import { formatTimeTag, syncLineWithTimestamp } from './musicLiveSync';
import {
  analyzeLyricContent,
  inferMusicLyricFormat,
  normalizeLyricContent,
  shiftLyricTimestamps,
} from './musicCuration';
import {
  buildMusicLyricRequest,
  createEmptyMusicLyricDraft,
  createImportedMusicLyricDraftState,
  hasMusicLyricDraftChanges,
  musicLyricToDraft,
  resolveMusicLyricBindingTrack,
  shouldConfirmMusicLyricSwitch,
  shouldInvalidatePendingLyricImport,
  type MusicLyricDraft,
} from './musicLyricsDrafts';

interface LyricsWorkspaceProps {
  focusTrack?: MusicTrack;
  discardToken: number;
  onDirtyChange: (dirty: boolean) => void;
}

type PendingDraftReplacement =
  | { kind: 'select'; lyric: MusicLyric }
  | { kind: 'new'; track?: MusicTrack }
  | { kind: 'import'; draft: MusicLyricDraft };

const MAX_LYRIC_FILE_BYTES = 512 * 1024;
const LYRIC_PAGE_SIZE = 20;

function fieldClass(extra?: string): string {
  return cn(
    'h-11 w-full rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--bg-leaf)] px-3 text-sm text-[var(--ink-primary)]',
    'placeholder:text-[var(--ink-muted)] outline-none transition-[border-color,box-shadow] focus:border-[var(--aurora-1)] focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--aurora-1)_14%,transparent)]',
    extra
  );
}

function actionClass(
  tone: 'default' | 'primary' | 'danger' = 'default'
): string {
  return cn(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent px-3 text-sm font-bold transition-[background-color,color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] disabled:cursor-not-allowed disabled:opacity-50',
    tone === 'default'
      && 'bg-[color-mix(in_oklch,var(--ink-primary)_4%,transparent)] text-[var(--ink-secondary)] hover:bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] hover:text-[var(--ink-primary)]',
    tone === 'primary'
      && 'bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]',
    tone === 'danger'
      && 'bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_13%,transparent)]'
  );
}

function lyricStatusLabel(status: MusicLyricStatus): string {
  switch (status) {
    case 'READY':
      return '可发布';
    case 'NEEDS_REVIEW':
      return '需复核';
    default:
      return '草稿';
  }
}

function lyricStatusClass(status: MusicLyricStatus): string {
  switch (status) {
    case 'READY':
      return 'bg-[color-mix(in_oklch,var(--signal-success)_12%,transparent)] text-[var(--signal-success)]';
    case 'NEEDS_REVIEW':
      return 'bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)] text-[var(--signal-warn)]';
    default:
      return 'bg-[color-mix(in_oklch,var(--ink-primary)_7%,transparent)] text-[var(--ink-muted)]';
  }
}

function formatTimestamp(milliseconds: number | undefined): string {
  if (milliseconds == null) return '—';
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function LyricsWorkspace({
  focusTrack,
  discardToken,
  onDirtyChange,
}: LyricsWorkspaceProps) {
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const lyricImportRequestRef = useRef(0);
  const initializedRef = useRef(false);
  const previousDiscardTokenRef = useRef(discardToken);
  const lyricDraftRevisionRef = useRef(0);
  const pendingCreatedLyricRef = useRef<{ id: number; boundTrackId?: number } | null>(null);
  const playerTimeline = useAdminMusicPlayerTimeline();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MusicLyricStatus>('ALL');
  const [bindingFilter, setBindingFilter] = useState<'ALL' | 'BOUND' | 'UNBOUND'>('ALL');
  const [page, setPage] = useState(1);
  const [trackKeyword, setTrackKeyword] = useState('');
  const [draft, setDraft] = useState<MusicLyricDraft>(() =>
    createEmptyMusicLyricDraft({
      boundTrackId: focusTrack?.id,
      trackTitle: focusTrack?.title,
    })
  );
  const [baseline, setBaseline] = useState<MusicLyricDraft>(() => draft);
  const [pendingReplacement, setPendingReplacement] = useState<PendingDraftReplacement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MusicLyric | null>(null);
  const deferredKeyword = useDeferredValue(keyword.trim());
  const deferredTrackKeyword = useDeferredValue(trackKeyword.trim());
  const dirty = useMemo(
    () => hasMusicLyricDraftChanges(draft, baseline),
    [baseline, draft]
  );
  const analysis = useMemo(
    () => analyzeLyricContent(draft.content),
    [draft.content]
  );

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const lyricsQuery = useQuery({
    queryKey: [
      'music-lyrics',
      deferredKeyword,
      statusFilter,
      bindingFilter,
      page,
    ],
    queryFn: async () =>
      (await musicService.getLyrics({
        keyword: deferredKeyword || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        bound: bindingFilter === 'ALL' ? undefined : bindingFilter === 'BOUND',
        pageNum: page,
        pageSize: LYRIC_PAGE_SIZE,
      })).data,
  });

  const focusLyricQuery = useQuery({
    queryKey: ['music-lyric-for-track', focusTrack?.id],
    enabled: Boolean(focusTrack?.id),
    queryFn: async () =>
      (await musicService.getLyrics({
        trackId: focusTrack!.id,
        pageNum: 1,
        pageSize: 1,
      })).data,
  });

  const tracksQuery = useQuery({
    queryKey: ['music-lyric-binding-tracks', deferredTrackKeyword],
    queryFn: async () =>
      (await musicService.getTracks({
        keyword: deferredTrackKeyword || undefined,
        pageNum: 1,
        pageSize: 100,
      })).data,
    staleTime: 30_000,
  });

  const applyDraft = useCallback((next: MusicLyricDraft) => {
    setDraft({ ...next });
    setBaseline({ ...next });
    setPendingReplacement(null);
  }, []);

  const applyReplacement = useCallback((replacement: PendingDraftReplacement) => {
    if (replacement.kind === 'select') {
      applyDraft(musicLyricToDraft(replacement.lyric));
      return;
    }
    if (replacement.kind === 'import') {
      const importedState = createImportedMusicLyricDraftState(replacement.draft);
      setDraft(importedState.draft);
      setBaseline(importedState.baseline);
      setPendingReplacement(null);
      return;
    }
    applyDraft(createEmptyMusicLyricDraft({
      boundTrackId: replacement.track?.id,
      trackTitle: replacement.track?.title,
    }));
  }, [applyDraft]);

  const requestReplacement = useCallback((replacement: PendingDraftReplacement) => {
    if (shouldInvalidatePendingLyricImport(replacement.kind)) {
      lyricImportRequestRef.current += 1;
    }
    const targetLyricId = replacement.kind === 'select'
      ? replacement.lyric.id
      : undefined;
    if (shouldConfirmMusicLyricSwitch({
      dirty,
      currentLyricId: draft.id,
      targetLyricId,
    })) {
      setPendingReplacement(replacement);
      return;
    }
    applyReplacement(replacement);
  }, [applyReplacement, dirty, draft.id]);

  useEffect(() => {
    if (initializedRef.current) return;
    if (focusTrack) {
      if (!focusLyricQuery.isSuccess) return;
      const focusedLyric = focusLyricQuery.data.list?.[0];
      if (focusedLyric) {
        applyDraft(musicLyricToDraft(focusedLyric));
      } else {
        applyDraft(createEmptyMusicLyricDraft({
          boundTrackId: focusTrack.id,
          trackTitle: focusTrack.title,
        }));
      }
      initializedRef.current = true;
      return;
    }
    if (!lyricsQuery.isSuccess) return;
    const firstLyric = lyricsQuery.data.list?.[0];
    if (firstLyric) applyDraft(musicLyricToDraft(firstLyric));
    initializedRef.current = true;
  }, [
    applyDraft,
    focusLyricQuery.data,
    focusLyricQuery.isSuccess,
    focusTrack,
    lyricsQuery.data,
    lyricsQuery.isSuccess,
  ]);

  useEffect(() => {
    if (previousDiscardTokenRef.current === discardToken) return;
    previousDiscardTokenRef.current = discardToken;
    setDraft({ ...baseline });
    setPendingReplacement(null);
  }, [baseline, discardToken]);

  useEffect(() => {
    return () => {
      lyricImportRequestRef.current += 1;
    };
  }, [focusTrack?.id]);

  const invalidateMusicCuration = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['music-lyrics'] }),
      queryClient.invalidateQueries({ queryKey: ['music-lyric-for-track'] }),
      queryClient.invalidateQueries({ queryKey: ['music-tracks'] }),
      queryClient.invalidateQueries({ queryKey: ['music-track-candidates'] }),
      queryClient.invalidateQueries({ queryKey: ['music-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['music-playlist-member-tracks'] }),
    ]);
  }, [queryClient]);

  const saveMutation = useMutation({
    mutationFn: async ({ revision: _revision, ...snapshot }: MusicLyricDraft & { revision: number }) => {
      const request = buildMusicLyricRequest(snapshot);
      let saved: MusicLyric;
      if (snapshot.id) {
        saved = (await musicService.updateLyric(snapshot.id, request)).data;
      } else {
        const retained = pendingCreatedLyricRef.current;
        if (retained && retained.boundTrackId === snapshot.boundTrackId) {
          pendingCreatedLyricRef.current = null;
          saved = (await musicService.updateLyric(retained.id, request)).data;
        } else {
          saved = (await musicService.createLyric(request)).data;
        }
      }
      if (saved.boundTrackId !== snapshot.boundTrackId) {
        if (!snapshot.id) {
          pendingCreatedLyricRef.current = { id: saved.id, boundTrackId: snapshot.boundTrackId };
        }
        try {
          saved = (await musicService.bindLyric(saved.id, {
            trackId: snapshot.boundTrackId,
          })).data;
          pendingCreatedLyricRef.current = null;
        } catch (bindError) {
          if (!snapshot.id) {
            throw new Error('歌词资产已创建，但绑定歌曲失败，请直接重试保存');
          }
          throw bindError;
        }
      }
      return saved;
    },
    onSuccess: async (saved, { revision }) => {
      toast.success(saved.status === 'READY' ? '歌词已保存并标记为可发布' : '歌词资产已保存');
      if (lyricDraftRevisionRef.current === revision) {
        applyDraft(musicLyricToDraft(saved));
      }
      await invalidateMusicCuration();
    },
    onError: async (error) => {
      toast.error(extractApiErrorMessage(error, '保存歌词失败'));
      await invalidateMusicCuration();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (lyric: MusicLyric) => musicService.deleteLyric(lyric.id),
    onSuccess: async (_response, deleted) => {
      toast.success(`已删除歌词：${deleted.name}`);
      setPendingDelete(null);
      applyDraft(createEmptyMusicLyricDraft({
        boundTrackId: focusTrack?.id,
        trackTitle: focusTrack?.title,
      }));
      initializedRef.current = true;
      await invalidateMusicCuration();
    },
    onError: (error) => toast.error(extractApiErrorMessage(error, '删除歌词失败')),
  });

  const lyrics = lyricsQuery.data?.list ?? [];
  const selectedLyric = useMemo(() => {
    if (!draft.id) return undefined;
    return lyrics.find((lyric) => lyric.id === draft.id)
      ?? focusLyricQuery.data?.list?.find((lyric) => lyric.id === draft.id);
  }, [draft.id, focusLyricQuery.data, lyrics]);
  const bindingTracks = tracksQuery.data?.list ?? [];
  const bindingOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [
      {
        value: '__none__',
        label: '不绑定歌曲',
        description: '保留为独立歌词资产',
      },
    ];
    const seen = new Set<number>();
    const appendTrack = (track: Pick<MusicTrack, 'id' | 'title' | 'artist'>) => {
      if (seen.has(track.id)) return;
      seen.add(track.id);
      options.push({
        value: String(track.id),
        label: track.title,
        description: track.artist || '未知艺术家',
      });
    };
    const selectedBindingTrack = resolveMusicLyricBindingTrack({
      boundTrackId: draft.boundTrackId,
      availableTracks: bindingTracks,
      focusTrack,
      selectedLyric,
    });
    if (selectedBindingTrack) {
      appendTrack(selectedBindingTrack);
    } else if (draft.boundTrackId) {
      appendTrack({
        id: draft.boundTrackId,
        title: `歌曲 #${draft.boundTrackId}`,
        artist: '',
      });
    }
    bindingTracks.forEach(appendTrack);
    return options;
  }, [bindingTracks, draft.boundTrackId, focusTrack, selectedLyric]);

  const updateDraft = (changes: Partial<MusicLyricDraft>) => {
    lyricDraftRevisionRef.current += 1;
    setDraft((current) => ({ ...current, ...changes }));
  };

  const shiftTimeline = (deltaMilliseconds: number) => {
    if (analysis.format !== 'LRC') {
      toast.error('当前歌词没有可调整的 LRC 时间轴');
      return;
    }
    updateDraft({
      content: shiftLyricTimestamps(draft.content, deltaMilliseconds),
      timingOffsetMs: Math.max(
        -600_000,
        Math.min(600_000, draft.timingOffsetMs + deltaMilliseconds)
      ),
    });
  };

  const normalizeTimeline = () => {
    if (!draft.content.trim()) return;
    const normalized = normalizeLyricContent(draft.content);
    updateDraft({
      content: normalized,
      format: inferMusicLyricFormat(normalized),
    });
  };

  const saveDraft = () => {
    if (!draft.content.trim()) {
      toast.error('歌词内容不能为空');
      return;
    }
    if (draft.status === 'READY' && analysis.invalidTimestampLineCount > 0) {
      toast.error('请先修正无效时间戳，再标记为可发布');
      return;
    }
    saveMutation.mutate({ ...draft, revision: lyricDraftRevisionRef.current });
  };

  const importLyricFile = async (file: File) => {
    const importRequestId = lyricImportRequestRef.current + 1;
    lyricImportRequestRef.current = importRequestId;
    if (file.size > MAX_LYRIC_FILE_BYTES) {
      toast.error('歌词文件不能超过 512 KB');
      return;
    }
    const extension = file.name.split('.').pop()?.toLocaleLowerCase();
    if (extension !== 'lrc' && extension !== 'txt' && file.type !== 'text/plain') {
      toast.error('请选择 .lrc 或 .txt 歌词文件');
      return;
    }
    try {
      const content = await file.text();
      if (importRequestId !== lyricImportRequestRef.current) return;
      if (!content.trim()) {
        toast.error('歌词文件为空');
        return;
      }
      const name = file.name.replace(/\.[^.]+$/, '').trim();
      const imported = createEmptyMusicLyricDraft({
        boundTrackId: focusTrack?.id,
        trackTitle: focusTrack?.title,
      });
      imported.name = name || imported.name;
      imported.content = content.replace(/\r\n?/g, '\n');
      imported.format = inferMusicLyricFormat(content);
      imported.sourceFileName = file.name;
      requestReplacement({ kind: 'import', draft: imported });
    } catch {
      if (importRequestId !== lyricImportRequestRef.current) return;
      toast.error('无法读取歌词文件，请确认文件编码为 UTF-8');
    }
  };

  const statusOptions: SelectOption[] = [
    { value: 'DRAFT', label: '草稿' },
    { value: 'NEEDS_REVIEW', label: '需复核' },
    { value: 'READY', label: '可发布' },
  ];
  const formatOptions: SelectOption[] = [
    { value: 'LRC', label: 'LRC 时间轴' },
    { value: 'PLAIN', label: '纯文本' },
  ];

  return (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept=".lrc,.txt,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importLyricFile(file);
        }}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="surface-leaf overflow-hidden rounded-[var(--radius-lg)]">
          <AdminSectionHeader
            icon={<FileText className="h-4 w-4" />}
            title="歌词资产库"
            description="独立上传、复核，再绑定到歌曲"
            aside={<AdminSectionCount>{lyricsQuery.data?.total ?? 0} 份</AdminSectionCount>}
          />
          <div className="space-y-3 border-b border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => requestReplacement({ kind: 'new' })}
                className={actionClass('primary')}
              >
                <Plus className="h-4 w-4" />
                新建
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className={actionClass()}
              >
                <Upload className="h-4 w-4" />
                导入文件
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setPage(1);
                }}
                className={fieldClass('pl-9')}
                placeholder="搜索名称、来源、歌曲或正文"
                aria-label="搜索歌词资产"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as typeof statusFilter);
                  setPage(1);
                }}
                options={[
                  { value: 'ALL', label: '全部状态' },
                  ...statusOptions,
                ]}
                ariaLabel="歌词状态筛选"
              />
              <Select
                value={bindingFilter}
                onValueChange={(value) => {
                  setBindingFilter(value as typeof bindingFilter);
                  setPage(1);
                }}
                options={[
                  { value: 'ALL', label: '全部绑定' },
                  { value: 'BOUND', label: '已绑定' },
                  { value: 'UNBOUND', label: '未绑定' },
                ]}
                ariaLabel="歌词绑定筛选"
              />
            </div>
          </div>

          <div className="max-h-[58dvh] divide-y divide-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
            {lyricsQuery.isLoading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 p-5 text-sm text-[var(--ink-muted)]" role="status">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在载入歌词
              </div>
            ) : lyricsQuery.isError ? (
              <div className="p-5 text-sm text-[var(--ink-muted)]" role="alert">
                <p className="font-bold text-[var(--ink-primary)]">歌词资产载入失败</p>
                <button
                  type="button"
                  onClick={() => void lyricsQuery.refetch()}
                  className={cn(actionClass('primary'), 'mt-3')}
                >
                  <RefreshCw className="h-4 w-4" />
                  重试
                </button>
              </div>
            ) : lyrics.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-[var(--ink-muted)]">
                没有匹配的歌词资产。可以导入 `.lrc` / `.txt`，或新建后粘贴歌词。
              </div>
            ) : (
              lyrics.map((lyric) => (
                <button
                  key={lyric.id}
                  type="button"
                  onClick={() => requestReplacement({ kind: 'select', lyric })}
                  className={cn(
                    'block min-h-[92px] w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--aurora-1)]',
                    draft.id === lyric.id
                      ? 'bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
                      : 'hover:bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)]'
                  )}
                  aria-pressed={draft.id === lyric.id}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-[var(--ink-primary)]">
                        {lyric.name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">
                        {lyric.boundTrackTitle
                          ? `${lyric.boundTrackTitle} · ${lyric.boundTrackArtist || '未知艺术家'}`
                          : '未绑定歌曲'}
                      </span>
                    </span>
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-1 text-[10px] font-black',
                      lyricStatusClass(lyric.status)
                    )}>
                      {lyricStatusLabel(lyric.status)}
                    </span>
                  </span>
                  <span className="mt-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                    <span>{lyric.format}</span>
                    <span aria-hidden="true">·</span>
                    <span>{lyric.language || 'und'}</span>
                    {lyric.sourceFileName ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate normal-case tracking-normal">{lyric.sourceFileName}</span>
                      </>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
          <AdminPagination
            page={lyricsQuery.data?.pageNum ?? page}
            total={lyricsQuery.data?.total ?? 0}
            totalPages={lyricsQuery.data?.pages ?? 1}
            pageSize={LYRIC_PAGE_SIZE}
            pageSizeOptions={[LYRIC_PAGE_SIZE]}
            onPageChange={setPage}
            onPageSizeChange={() => undefined}
            itemLabel="份"
            loading={lyricsQuery.isFetching}
          />
        </aside>

        <section className="surface-leaf overflow-hidden rounded-[var(--radius-lg)]">
          <AdminSectionHeader
            icon={<Wand2 className="h-4 w-4" />}
            title={draft.name.trim() || (draft.id ? '未命名歌词' : '新歌词资产')}
            description={draft.id ? `资产 #${draft.id}` : '尚未写入服务器'}
            aside={(
              <span className="flex items-center gap-2">
                {dirty ? (
                  <span className="rounded-full bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)] px-2 py-1 text-[10px] font-black text-[var(--signal-warn)]">
                    未保存
                  </span>
                ) : null}
                <span className={cn(
                  'rounded-full px-2 py-1 text-[10px] font-black',
                  lyricStatusClass(draft.status)
                )}>
                  {lyricStatusLabel(draft.status)}
                </span>
              </span>
            )}
          />

          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  资产名称
                </span>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  className={fieldClass()}
                  placeholder="歌曲名 + 版本，例如：夜航（现场版）"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  格式
                </span>
                <Select
                  value={draft.format}
                  onValueChange={(value) => updateDraft({
                    format: value as MusicLyricDraft['format'],
                  })}
                  options={formatOptions}
                  ariaLabel="歌词格式"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  审核状态
                </span>
                <Select
                  value={draft.status}
                  onValueChange={(value) => updateDraft({
                    status: value as MusicLyricStatus,
                  })}
                  options={statusOptions}
                  ariaLabel="歌词审核状态"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[160px_minmax(0,1fr)_180px]">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  <Languages className="h-3 w-3" />
                  语言
                </span>
                <input
                  value={draft.language}
                  onChange={(event) => updateDraft({ language: event.target.value })}
                  className={fieldClass()}
                  placeholder="zh-Hans / en / und"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  来源文件
                </span>
                <input
                  value={draft.sourceFileName}
                  onChange={(event) => updateDraft({ sourceFileName: event.target.value })}
                  className={fieldClass()}
                  placeholder="导入文件名或来源备注"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  <Clock3 className="h-3 w-3" />
                  累计修正
                </span>
                <input
                  type="number"
                  min={-600000}
                  max={600000}
                  step={100}
                  value={draft.timingOffsetMs}
                  onChange={(event) => updateDraft({
                    timingOffsetMs: Math.max(
                      -600_000,
                      Math.min(600_000, Number(event.target.value) || 0)
                    ),
                  })}
                  className={fieldClass()}
                />
              </label>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--ink-primary)_9%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_2%,transparent)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-black text-[var(--ink-primary)]">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--aurora-1)]" />
                    实时打点与时间轴校正
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    在当前歌词句播放瞬间点击打点，自动填充毫秒级 LRC 时间戳。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!Number.isFinite(playerTimeline.duration) || playerTimeline.duration <= 0) {
                      toast.error('请先在播放器中播放这首歌，再进行打点');
                      return;
                    }
                    const lines = draft.content.split('\n');
                    const playbackSeconds = Math.max(0, playerTimeline.progress);
                    // 找到第一个没有时间戳或首行进行打点演示
                    let synced = false;
                    const newLines = lines.map((l) => {
                      if (!synced && l.trim() && !/^\[\d{1,3}:/.test(l)) {
                        synced = true;
                        return syncLineWithTimestamp(l, playbackSeconds);
                      }
                      return l;
                    });
                    updateDraft({
                      content: newLines.join('\n'),
                      format: 'LRC',
                    });
                    toast.success(`已为当前行注入时间戳 ${formatTimeTag(playbackSeconds)}`);
                  }}
                  className={actionClass('primary')}
                  disabled={!draft.content.trim()}
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  打点当前行 (Tap)
                </button>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] bg-[color-mix(in_oklch,var(--ink-primary)_2%,transparent)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-black text-[var(--ink-primary)]">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--aurora-1)]" />
                    时间轴修正
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    修正会直接改写每个有效时间戳，并记录累计偏移。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[-1000, -500, -200, 200, 500, 1000].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => shiftTimeline(delta)}
                      className={actionClass()}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      {delta > 0 ? '+' : ''}{delta} ms
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={normalizeTimeline}
                    className={actionClass('primary')}
                    disabled={!draft.content.trim()}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    规范化
                  </button>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  歌词正文
                </span>
                <span className={cn(
                  'text-xs',
                  analysis.invalidTimestampLineCount > 0
                    ? 'font-bold text-[var(--signal-warn)]'
                    : 'text-[var(--ink-muted)]'
                )}>
                  {analysis.invalidTimestampLineCount > 0
                    ? `${analysis.invalidTimestampLineCount} 行时间戳需修正`
                    : `${analysis.timedLineCount} 个时间点 · ${analysis.plainLineCount} 行纯文本`}
                </span>
              </span>
              <textarea
                value={draft.content}
                onChange={(event) => updateDraft({
                  content: event.target.value,
                  format: draft.content.trim()
                    ? draft.format
                    : inferMusicLyricFormat(event.target.value),
                })}
                className={fieldClass('min-h-[360px] resize-y py-3 font-mono text-[13px] leading-6 lg:min-h-[440px]')}
                placeholder={'[ar:艺术家]\n[ti:歌曲名]\n[00:12.00]第一行歌词'}
                spellCheck={false}
                aria-label="歌词正文"
              />
            </label>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
                <p className="text-[10px] text-[var(--ink-muted)]">时间点</p>
                <p className="tnum mt-1 text-lg font-black text-[var(--ink-primary)]">{analysis.timedLineCount}</p>
              </div>
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
                <p className="text-[10px] text-[var(--ink-muted)]">纯文本</p>
                <p className="tnum mt-1 text-lg font-black text-[var(--ink-primary)]">{analysis.plainLineCount}</p>
              </div>
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
                <p className="text-[10px] text-[var(--ink-muted)]">元信息</p>
                <p className="tnum mt-1 text-lg font-black text-[var(--ink-primary)]">{analysis.metadataLineCount}</p>
              </div>
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
                <p className="text-[10px] text-[var(--ink-muted)]">首句</p>
                <p className="tnum mt-1 text-lg font-black text-[var(--ink-primary)]">{formatTimestamp(analysis.firstTimestampMs)}</p>
              </div>
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] p-3">
                <p className="text-[10px] text-[var(--ink-muted)]">末句</p>
                <p className="tnum mt-1 text-lg font-black text-[var(--ink-primary)]">{formatTimestamp(analysis.lastTimestampMs)}</p>
              </div>
            </div>

            <section className="rounded-[var(--radius-md)] border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] p-3">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)]">
                  <Link2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-[var(--ink-primary)]">歌曲绑定</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                    一首歌曲只绑定一份歌词。重新绑定会自动释放该歌曲原来的歌词资产。
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(180px,0.7fr)_minmax(0,1fr)]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
                  <input
                    value={trackKeyword}
                    onChange={(event) => setTrackKeyword(event.target.value)}
                    className={fieldClass('pl-9')}
                    placeholder="搜索待绑定歌曲"
                    aria-label="搜索待绑定歌曲"
                  />
                </div>
                <Select
                  value={draft.boundTrackId ? String(draft.boundTrackId) : '__none__'}
                  onValueChange={(value) => updateDraft({
                    boundTrackId: value === '__none__' ? undefined : Number(value),
                  })}
                  options={bindingOptions}
                  prefix={<Link2 />}
                  ariaLabel="绑定歌曲"
                />
              </div>
            </section>

            <div className="flex flex-col-reverse gap-2 border-t border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {draft.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      const lyric = selectedLyric ?? {
                        ...draft,
                        id: draft.id!,
                        boundTrackTitle: focusTrack?.title,
                        boundTrackArtist: focusTrack?.artist,
                      } as MusicLyric;
                      setPendingDelete(lyric);
                    }}
                    className={actionClass('danger')}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除歌词
                  </button>
                ) : (
                  <p className="text-xs leading-5 text-[var(--ink-muted)]">
                    新资产保存后才会出现在左侧列表。
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={saveDraft}
                className={actionClass('primary')}
                disabled={!dirty || saveMutation.isPending || !draft.content.trim()}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : dirty ? (
                  <Save className="h-4 w-4" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {saveMutation.isPending ? '保存中' : dirty ? '保存歌词资产' : '已保存'}
              </button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        isOpen={pendingDelete != null || pendingReplacement != null}
        title={pendingDelete ? '删除歌词资产？' : '放弃未保存的歌词修改？'}
        message={pendingDelete
          ? `歌词「${pendingDelete.name}」会被删除，并解除与歌曲的绑定；歌曲和媒体文件不会被删除。`
          : '切换歌词资产会丢弃当前尚未保存的正文、时间轴、审核状态或绑定修改。'}
        confirmText={pendingDelete ? '确认删除' : '放弃并继续'}
        cancelText={pendingDelete ? '取消' : '继续编辑'}
        variant={pendingDelete ? 'danger' : 'warning'}
        pending={deleteMutation.isPending}
        onCancel={() => {
          if (deleteMutation.isPending) return;
          setPendingDelete(null);
          setPendingReplacement(null);
        }}
        onConfirm={() => {
          if (pendingDelete) {
            if (!deleteMutation.isPending) deleteMutation.mutate(pendingDelete);
            return;
          }
          if (pendingReplacement) applyReplacement(pendingReplacement);
        }}
      />
    </>
  );
}
