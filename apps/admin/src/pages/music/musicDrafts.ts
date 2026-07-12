import type {
  MusicPlaylist,
  MusicPlaylistRequest,
  MusicSettings,
  MusicSettingsRequest,
  MusicTrack,
  MusicTrackRequest,
} from '@aetherblog/types';

export type PlaylistDraft = MusicPlaylistRequest & { sortOrder: number };

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function buildMusicTrackUpdate(
  track: MusicTrack,
  changes: Partial<MusicTrackRequest>
): MusicTrackRequest {
  return {
    title: changes.title ?? track.title,
    artist: changes.artist ?? track.artist,
    album: changes.album ?? track.album,
    durationSeconds: hasOwn(changes, 'durationSeconds')
      ? changes.durationSeconds
      : track.durationSeconds,
    coverMediaFileId: hasOwn(changes, 'coverMediaFileId')
      ? changes.coverMediaFileId
      : track.coverMediaFileId,
    lyric: hasOwn(changes, 'lyric') ? changes.lyric : track.lyric,
    status: changes.status ?? track.status,
    sortOrder: changes.sortOrder ?? track.sortOrder,
    isFeatured: changes.isFeatured ?? track.isFeatured,
  };
}

export function playlistToDraft(playlist: MusicPlaylist): PlaylistDraft {
  return {
    name: playlist.name,
    description: playlist.description || '',
    coverMediaFileId: playlist.coverMediaFileId,
    visibility: playlist.visibility,
    status: playlist.status,
    displayOnHome: playlist.displayOnHome,
    displayOnProfile: playlist.displayOnProfile,
    carouselEnabled: playlist.carouselEnabled,
    randomEnabled: playlist.randomEnabled,
    sortOrder: playlist.sortOrder,
  };
}

export function buildMusicPlaylistUpdate(
  draft: PlaylistDraft,
  fallbackName: string
): MusicPlaylistRequest {
  return {
    ...draft,
    name: draft.name.trim() || fallbackName || '未命名歌单',
    description: draft.description?.trim() || undefined,
    coverMediaFileId: draft.coverMediaFileId,
  };
}

export function canSavePlaylistDraft({
  selectedPlaylistId,
  loadedPlaylistId,
  isFetching,
  isSaving,
}: {
  selectedPlaylistId: number | null;
  loadedPlaylistId: number | null | undefined;
  isFetching: boolean;
  isSaving: boolean;
}): boolean {
  return Boolean(
    selectedPlaylistId != null &&
      loadedPlaylistId === selectedPlaylistId &&
      !isFetching &&
      !isSaving
  );
}

export function buildMusicSettingsUpdate(
  current: MusicSettings,
  patch: Partial<MusicSettingsRequest>
): MusicSettingsRequest {
  return {
    enabled: patch.enabled ?? current.enabled,
    showOnHomePage: patch.showOnHomePage ?? current.showOnHomePage,
    showOnProfileCard: patch.showOnProfileCard ?? current.showOnProfileCard,
    featuredPlaylistId: hasOwn(patch, 'featuredPlaylistId')
      ? patch.featuredPlaylistId
      : current.featuredPlaylistId,
    mediaFolderId: hasOwn(patch, 'mediaFolderId')
      ? patch.mediaFolderId
      : current.mediaFolderId,
    playbackMode: patch.playbackMode ?? current.playbackMode,
    carouselEnabled: patch.carouselEnabled ?? current.carouselEnabled,
    carouselIntervalSeconds:
      patch.carouselIntervalSeconds ?? current.carouselIntervalSeconds,
    randomEnabled: patch.randomEnabled ?? current.randomEnabled,
    skinMode: hasOwn(patch, 'skinMode') ? patch.skinMode : current.skinMode,
    skinPreset: hasOwn(patch, 'skinPreset') ? patch.skinPreset : current.skinPreset,
    skinColorLight: hasOwn(patch, 'skinColorLight')
      ? patch.skinColorLight
      : current.skinColorLight,
    skinColorDark: hasOwn(patch, 'skinColorDark')
      ? patch.skinColorDark
      : current.skinColorDark,
  };
}

export function movePlaylistTrack(
  tracks: MusicTrack[],
  index: number,
  direction: -1 | 1
): MusicTrack[] {
  const targetIndex = index + direction;
  if (index < 0 || index >= tracks.length || targetIndex < 0 || targetIndex >= tracks.length) {
    return tracks;
  }
  const next = [...tracks];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function shouldConfirmPlaylistSwitch({
  selectedPlaylistId,
  targetPlaylistId,
  loadedPlaylistId,
  isDirty,
}: {
  selectedPlaylistId: number | null;
  targetPlaylistId: number;
  loadedPlaylistId: number | null;
  isDirty: boolean;
}): boolean {
  return Boolean(
    isDirty &&
      selectedPlaylistId != null &&
      targetPlaylistId !== selectedPlaylistId &&
      loadedPlaylistId === selectedPlaylistId
  );
}

export function shouldApplyPlaylistSaveResult({
  savedPlaylistId,
  selectedPlaylistId,
  savedRevision,
  currentRevision,
}: {
  savedPlaylistId: number;
  selectedPlaylistId: number | null;
  savedRevision: number;
  currentRevision: number;
}): boolean {
  return savedPlaylistId === selectedPlaylistId && savedRevision === currentRevision;
}

export function shouldApplyTrackSaveResult({
  savedTrackId,
  selectedTrackId,
  savedRevision,
  currentRevision,
}: {
  savedTrackId: number;
  selectedTrackId: number | null;
  savedRevision: number;
  currentRevision: number;
}): boolean {
  return savedTrackId === selectedTrackId && savedRevision === currentRevision;
}

export function shouldConfirmTrackDraftDiscard({
  isDirty,
  currentTrackId,
  targetTrackId,
}: {
  isDirty: boolean;
  currentTrackId: number | null;
  targetTrackId: number | null;
}): boolean {
  return Boolean(
    isDirty &&
      currentTrackId != null &&
      (targetTrackId == null || targetTrackId !== currentTrackId)
  );
}
