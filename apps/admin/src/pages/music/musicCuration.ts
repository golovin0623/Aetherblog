import type {
  MusicLibrarySummary,
  MusicTagSummary,
  MusicTrack,
} from '@aetherblog/types';

export type MusicLyricFormat = 'LRC' | 'PLAIN';
export type MusicCurationStepKey =
  | 'metadata'
  | 'artwork'
  | 'tags'
  | 'lyrics'
  | 'playlist'
  | 'publication';

export interface MusicLyricAnalysis {
  format: MusicLyricFormat;
  timedLineCount: number;
  plainLineCount: number;
  invalidTimestampLineCount: number;
  metadataLineCount: number;
  firstTimestampMs?: number;
  lastTimestampMs?: number;
}

export interface MusicCurationStep {
  key: MusicCurationStepKey;
  label: string;
  complete: boolean;
}

export interface TrackCurationState {
  score: number;
  steps: MusicCurationStep[];
  missing: MusicCurationStepKey[];
}

export interface MusicOverviewCounts {
  trackCount: number;
  missingLyrics: number;
  missingCovers: number;
  taggedTracks: number;
  untaggedTracks: number;
  favoriteTracks: number;
}

export type CuratableMusicTrack = MusicTrack & {
  tags?: MusicTagSummary[];
  lyricAsset?: {
    id: number;
    status?: 'DRAFT' | 'READY' | 'NEEDS_REVIEW';
  };
  playlistCount?: number;
};

const LRC_METADATA_PATTERN = /^\[\s*(ar|ti|al|by|offset|re|ve|length|language)\s*:\s*(.*?)\s*\]$/i;
const LRC_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function fractionToMilliseconds(value: string | undefined): number {
  if (!value) return 0;
  if (value.length === 1) return Number(value) * 100;
  if (value.length === 2) return Number(value) * 10;
  return Number(value.slice(0, 3));
}

function timestampMatchToMilliseconds(match: RegExpMatchArray): number | null {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = fractionToMilliseconds(match[3]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) {
    return null;
  }
  return minutes * 60_000 + seconds * 1_000 + fraction;
}

function formatLrcTimestamp(milliseconds: number): string {
  const clamped = Math.max(0, Math.round(milliseconds / 10) * 10);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const centiseconds = Math.floor((clamped % 1_000) / 10);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
}

export function inferMusicLyricFormat(raw: string): MusicLyricFormat {
  LRC_TIMESTAMP_PATTERN.lastIndex = 0;
  for (const match of raw.matchAll(LRC_TIMESTAMP_PATTERN)) {
    if (timestampMatchToMilliseconds(match) != null) return 'LRC';
  }
  return 'PLAIN';
}

export function analyzeLyricContent(raw: string): MusicLyricAnalysis {
  let timedLineCount = 0;
  let plainLineCount = 0;
  let invalidTimestampLineCount = 0;
  let metadataLineCount = 0;
  let firstTimestampMs: number | undefined;
  let lastTimestampMs: number | undefined;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (LRC_METADATA_PATTERN.test(line)) {
      metadataLineCount += 1;
      continue;
    }

    LRC_TIMESTAMP_PATTERN.lastIndex = 0;
    const matches = Array.from(line.matchAll(LRC_TIMESTAMP_PATTERN));
    const validTimestamps = matches
      .map(timestampMatchToMilliseconds)
      .filter((value): value is number => value != null);

    if (validTimestamps.length > 0) {
      timedLineCount += validTimestamps.length;
      const localFirst = Math.min(...validTimestamps);
      const localLast = Math.max(...validTimestamps);
      firstTimestampMs = firstTimestampMs == null ? localFirst : Math.min(firstTimestampMs, localFirst);
      lastTimestampMs = lastTimestampMs == null ? localLast : Math.max(lastTimestampMs, localLast);
      if (validTimestamps.length !== matches.length) invalidTimestampLineCount += 1;
      continue;
    }

    if (/\[\s*\d{1,3}:/.test(line)) {
      invalidTimestampLineCount += 1;
    } else {
      plainLineCount += 1;
    }
  }

  return {
    format: timedLineCount > 0 ? 'LRC' : 'PLAIN',
    timedLineCount,
    plainLineCount,
    invalidTimestampLineCount,
    metadataLineCount,
    firstTimestampMs,
    lastTimestampMs,
  };
}

export function normalizeLyricContent(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return '';

      const metadata = line.match(LRC_METADATA_PATTERN);
      if (metadata) {
        return `[${metadata[1].toLowerCase()}:${metadata[2].trim()}]`;
      }

      LRC_TIMESTAMP_PATTERN.lastIndex = 0;
      const normalizedTimestamps = line.replace(
        LRC_TIMESTAMP_PATTERN,
        (fullMatch, minutes: string, seconds: string, fraction?: string) => {
          const timestamp = timestampMatchToMilliseconds([
            fullMatch,
            minutes,
            seconds,
            fraction,
          ] as RegExpMatchArray);
          return timestamp == null ? fullMatch : formatLrcTimestamp(timestamp);
        }
      );
      const lyricText = normalizedTimestamps.replace(
        /^((?:\[\d{2,}:\d{2}\.\d{2}\])+)\s*/,
        '$1'
      );
      return lyricText.trim();
    })
    .filter(Boolean)
    .join('\n');
}

export function shiftLyricTimestamps(raw: string, deltaMilliseconds: number): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      if (LRC_METADATA_PATTERN.test(line.trim())) return line;
      LRC_TIMESTAMP_PATTERN.lastIndex = 0;
      return line.replace(
        LRC_TIMESTAMP_PATTERN,
        (fullMatch, minutes: string, seconds: string, fraction?: string) => {
          const timestamp = timestampMatchToMilliseconds([
            fullMatch,
            minutes,
            seconds,
            fraction,
          ] as RegExpMatchArray);
          return timestamp == null
            ? fullMatch
            : formatLrcTimestamp(timestamp + deltaMilliseconds);
        }
      );
    })
    .join('\n');
}

function hasCuratedMetadata(track: CuratableMusicTrack): boolean {
  const title = track.title?.trim();
  const artist = track.artist?.trim();
  const originalName = track.media?.originalName?.trim();
  return Boolean(
    title &&
      artist &&
      (!originalName || title.toLocaleLowerCase() !== originalName.toLocaleLowerCase())
  );
}

export function buildTrackCurationState(track: CuratableMusicTrack): TrackCurationState {
  const steps: MusicCurationStep[] = [
    {
      key: 'metadata',
      label: '元数据',
      complete: hasCuratedMetadata(track),
    },
    {
      key: 'artwork',
      label: '封面',
      complete: Boolean(
        track.coverMediaFileId ||
          track.coverUrl ||
          track.media?.thumbnailUrl
      ),
    },
    {
      key: 'tags',
      label: '标签',
      complete: Boolean(track.tags?.length),
    },
    {
      key: 'lyrics',
      label: '歌词',
      complete: Boolean(
        track.lyricAsset?.status === 'READY' ||
          track.lyric?.trim()
      ),
    },
    {
      key: 'playlist',
      label: '歌单',
      complete: (track.playlistCount ?? 0) > 0,
    },
    {
      key: 'publication',
      label: '发布',
      complete: track.status === 'ACTIVE',
    },
  ];
  const completeCount = steps.filter((step) => step.complete).length;

  return {
    score: Math.round((completeCount / steps.length) * 100),
    steps,
    missing: steps
      .filter((step) => !step.complete)
      .map((step) => step.key),
  };
}

export function deriveMusicOverviewCounts(
  tracks: MusicTrack[],
  summary?: MusicLibrarySummary
): MusicOverviewCounts {
  const trackCount = summary?.trackCount ?? tracks.length;
  const fallbackMissingLyrics = tracks.filter(
    (track) => !track.lyricAsset && !track.lyric?.trim()
  ).length;
  const fallbackMissingCovers = tracks.filter(
    (track) => !track.coverMediaFileId
      && !track.coverUrl
      && !track.media?.thumbnailUrl
  ).length;
  const fallbackTaggedTracks = tracks.filter(
    (track) => Boolean(track.tags?.length)
  ).length;
  const taggedTracks = summary?.taggedTrackCount ?? fallbackTaggedTracks;

  return {
    trackCount,
    missingLyrics: summary?.missingLyricCount ?? fallbackMissingLyrics,
    missingCovers: summary?.missingCoverCount ?? fallbackMissingCovers,
    taggedTracks,
    untaggedTracks: Math.max(0, trackCount - taggedTracks),
    favoriteTracks: summary?.favoriteTrackCount
      ?? tracks.filter((track) => Boolean(track.isFavorite)).length,
  };
}
