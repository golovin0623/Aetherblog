import type {
  MusicLyric,
  MusicLyricFormat,
  MusicLyricRequest,
  MusicLyricStatus,
  MusicTrack,
} from '@aetherblog/types';

export interface MusicLyricDraft {
  id?: number;
  name: string;
  content: string;
  format: MusicLyricFormat;
  language: string;
  sourceFileName: string;
  timingOffsetMs: number;
  status: MusicLyricStatus;
  boundTrackId?: number;
}

export function createEmptyMusicLyricDraft({
  boundTrackId,
  trackTitle,
}: {
  boundTrackId?: number;
  trackTitle?: string;
} = {}): MusicLyricDraft {
  return {
    name: trackTitle?.trim() ? `${trackTitle.trim()} 歌词` : '',
    content: '',
    format: 'PLAIN',
    language: 'und',
    sourceFileName: '',
    timingOffsetMs: 0,
    status: 'DRAFT',
    boundTrackId,
  };
}

export function musicLyricToDraft(lyric: MusicLyric): MusicLyricDraft {
  return {
    id: lyric.id,
    name: lyric.name,
    content: lyric.content,
    format: lyric.format,
    language: lyric.language || 'und',
    sourceFileName: lyric.sourceFileName || '',
    timingOffsetMs: lyric.timingOffsetMs,
    status: lyric.status,
    boundTrackId: lyric.boundTrackId,
  };
}

export function createImportedMusicLyricDraftState(
  imported: MusicLyricDraft
): {
  draft: MusicLyricDraft;
  baseline: MusicLyricDraft;
} {
  return {
    draft: { ...imported },
    baseline: createEmptyMusicLyricDraft({
      boundTrackId: imported.boundTrackId,
    }),
  };
}

export function resolveMusicLyricBindingTrack({
  boundTrackId,
  availableTracks,
  focusTrack,
  selectedLyric,
}: {
  boundTrackId?: number;
  availableTracks: Array<Pick<MusicTrack, 'id' | 'title' | 'artist'>>;
  focusTrack?: Pick<MusicTrack, 'id' | 'title' | 'artist'>;
  selectedLyric?: Pick<
    MusicLyric,
    'boundTrackId' | 'boundTrackTitle' | 'boundTrackArtist'
  >;
}): Pick<MusicTrack, 'id' | 'title' | 'artist'> | undefined {
  if (!boundTrackId) return undefined;
  const availableTrack = availableTracks.find(
    (track) => track.id === boundTrackId
  );
  if (availableTrack) return availableTrack;
  if (focusTrack?.id === boundTrackId) return focusTrack;
  if (
    selectedLyric?.boundTrackId === boundTrackId
    && selectedLyric.boundTrackTitle
  ) {
    return {
      id: boundTrackId,
      title: selectedLyric.boundTrackTitle,
      artist: selectedLyric.boundTrackArtist || '',
    };
  }
  return undefined;
}

export function shouldInvalidatePendingLyricImport(
  replacementKind: 'select' | 'new' | 'import'
): boolean {
  return replacementKind !== 'import';
}

export function buildMusicLyricRequest(
  draft: MusicLyricDraft
): MusicLyricRequest {
  return {
    name: draft.name.trim() || undefined,
    content: draft.content.trim(),
    format: draft.format,
    language: draft.language.trim() || 'und',
    sourceFileName: draft.sourceFileName.trim() || undefined,
    timingOffsetMs: draft.timingOffsetMs,
    status: draft.status,
  };
}

function canonicalMusicLyricDraft(draft: MusicLyricDraft): MusicLyricDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    content: draft.content.replace(/\r\n?/g, '\n'),
    language: draft.language.trim() || 'und',
    sourceFileName: draft.sourceFileName.trim(),
    boundTrackId: draft.boundTrackId || undefined,
  };
}

export function hasMusicLyricDraftChanges(
  draft: MusicLyricDraft,
  baseline: MusicLyricDraft
): boolean {
  return JSON.stringify(canonicalMusicLyricDraft(draft))
    !== JSON.stringify(canonicalMusicLyricDraft(baseline));
}

export function shouldConfirmMusicLyricSwitch({
  dirty,
  currentLyricId,
  targetLyricId,
}: {
  dirty: boolean;
  currentLyricId?: number;
  targetLyricId?: number;
}): boolean {
  return Boolean(dirty && currentLyricId !== targetLyricId);
}
