import type { MusicPlaybackMode } from '../lib/services';

export interface MusicShuffleHistory {
  history: number[];
  cursor: number;
  cyclePlayed: number[];
}

export interface StoredMusicPlayback {
  trackId: number;
  position: number;
  volume: number;
}

export interface MusicTrackPresentationInput {
  title?: string | null;
  artist?: string | null;
}

export interface MusicTrackPresentation {
  title: string;
  artist: string;
}

const MAX_SHUFFLE_HISTORY = 100;

const UNKNOWN_MUSIC_ARTISTS = new Set(['', '未知艺术家', 'unknown artist']);

/**
 * 统一播放表面上的空值/占位艺人处理。
 * 绝不仅凭 title 里的连字符猜测艺人：「Love - Hate」也可以是合法歌名，元数据必须在导入层从音频标签确定。
 */
export function resolveMusicTrackPresentation(
  track: MusicTrackPresentationInput,
): MusicTrackPresentation {
  const title = track.title?.trim() || '未命名歌曲';
  const rawArtist = track.artist?.trim() || '';
  const artist = UNKNOWN_MUSIC_ARTISTS.has(rawArtist.toLocaleLowerCase()) ? '' : rawArtist;
  return { title, artist };
}

export function createShuffleHistory(currentIndex: number): MusicShuffleHistory {
  const safeIndex = Number.isInteger(currentIndex) && currentIndex >= 0 ? currentIndex : 0;
  return { history: [safeIndex], cursor: 0, cyclePlayed: [safeIndex] };
}

export function recordShuffleSelection(
  state: MusicShuffleHistory,
  selectedIndex: number,
): MusicShuffleHistory {
  const history = state.history.length > 0 ? state.history : [selectedIndex];
  const cursor = Math.min(Math.max(0, state.cursor), history.length - 1);
  const cyclePlayed = state.cyclePlayed ?? history;
  if (history[cursor] === selectedIndex) {
    return { history: [...history], cursor, cyclePlayed: [...cyclePlayed] };
  }

  const nextHistory = [...history.slice(0, cursor + 1), selectedIndex].slice(-MAX_SHUFFLE_HISTORY);
  return {
    history: nextHistory,
    cursor: nextHistory.length - 1,
    cyclePlayed: cyclePlayed.includes(selectedIndex)
      ? [...cyclePlayed]
      : [...cyclePlayed, selectedIndex],
  };
}

export function resolveShuffleNavigation({
  state,
  currentIndex,
  direction,
  trackCount,
  randomValue,
}: {
  state: MusicShuffleHistory;
  currentIndex: number;
  direction: -1 | 1;
  trackCount: number;
  randomValue: number;
}): {
  nextIndex: number;
  restartCurrent: boolean;
  state: MusicShuffleHistory;
} {
  if (trackCount <= 1) {
    return {
      nextIndex: Math.max(0, Math.min(currentIndex, trackCount - 1)),
      restartCurrent: trackCount === 1,
      state: createShuffleHistory(0),
    };
  }

  const validHistory = state.history.filter((index) => index >= 0 && index < trackCount);
  const validCyclePlayed = (state.cyclePlayed ?? validHistory)
    .filter((index, position, values) => (
      index >= 0 && index < trackCount && values.indexOf(index) === position
    ));
  const normalized = validHistory.length > 0
    ? {
        history: validHistory,
        cursor: Math.min(Math.max(0, state.cursor), validHistory.length - 1),
        cyclePlayed: validCyclePlayed.length > 0 ? validCyclePlayed : [currentIndex],
      }
    : createShuffleHistory(currentIndex);

  if (direction === -1) {
    if (normalized.cursor === 0) {
      return { nextIndex: currentIndex, restartCurrent: true, state: normalized };
    }
    const cursor = normalized.cursor - 1;
    return {
      nextIndex: normalized.history[cursor],
      restartCurrent: false,
      state: { ...normalized, cursor },
    };
  }

  if (normalized.cursor < normalized.history.length - 1) {
    const cursor = normalized.cursor + 1;
    return {
      nextIndex: normalized.history[cursor],
      restartCurrent: false,
      state: { ...normalized, cursor },
    };
  }

  let cyclePlayed = normalized.cyclePlayed;
  const playedThisCycle = new Set(cyclePlayed);
  let candidates = Array.from({ length: trackCount }, (_, index) => index)
    .filter((index) => !playedThisCycle.has(index));
  if (candidates.length === 0) {
    cyclePlayed = [currentIndex];
    candidates = Array.from({ length: trackCount }, (_, index) => index)
      .filter((index) => index !== currentIndex);
  }
  const boundedRandom = Number.isFinite(randomValue)
    ? Math.min(0.999999999, Math.max(0, randomValue))
    : 0;
  const nextIndex = candidates[Math.floor(boundedRandom * candidates.length)] ?? currentIndex;
  const nextState = recordShuffleSelection({ ...normalized, cyclePlayed }, nextIndex);
  return { nextIndex, restartCurrent: false, state: nextState };
}

export function parseStoredMusicPlayback(raw: string | null | undefined): StoredMusicPlayback | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMusicPlayback>;
    if (!Number.isInteger(parsed.trackId) || Number(parsed.trackId) <= 0) return null;
    if (!Number.isFinite(parsed.position) || !Number.isFinite(parsed.volume)) return null;
    return {
      trackId: Number(parsed.trackId),
      position: Math.max(0, Number(parsed.position)),
      volume: Math.min(1, Math.max(0, Number(parsed.volume))),
    };
  } catch {
    return null;
  }
}

export function resolveRestoredMusicPosition({
  position,
  duration,
}: {
  position: number;
  duration: number;
}): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return position;
  const clamped = Math.min(duration, position);
  return duration - clamped <= 2 ? 0 : clamped;
}

export function shouldRotateMusicPresentation({
  carouselEnabled,
  hasPlaybackSession,
  isPlaying,
  trackCount,
}: {
  carouselEnabled: boolean;
  hasPlaybackSession: boolean;
  isPlaying: boolean;
  trackCount: number;
}): boolean {
  return carouselEnabled && trackCount > 1 && !hasPlaybackSession && !isPlaying;
}

export function resolveAdjacentTrack({
  currentIndex,
  direction,
  trackCount,
}: {
  currentIndex: number;
  direction: -1 | 1;
  trackCount: number;
}): { nextIndex: number; restartCurrent: boolean } {
  if (trackCount <= 0) return { nextIndex: 0, restartCurrent: false };
  if (trackCount === 1) return { nextIndex: 0, restartCurrent: true };
  return {
    nextIndex: (currentIndex + direction + trackCount) % trackCount,
    restartCurrent: false,
  };
}

export function resolveMusicStartIndex({
  trackCount,
  currentIndex,
  shuffle,
  randomValue,
}: {
  trackCount: number;
  currentIndex: number;
  shuffle: boolean;
  randomValue: number;
}): number {
  if (trackCount <= 1) return 0;
  if (!shuffle) return 0;
  const safeCurrent = Math.min(trackCount - 1, Math.max(0, currentIndex));
  const candidates = Array.from({ length: trackCount }, (_, index) => index)
    .filter((index) => index !== safeCurrent);
  const boundedRandom = Number.isFinite(randomValue)
    ? Math.min(0.999999999, Math.max(0, randomValue))
    : 0;
  return candidates[Math.floor(boundedRandom * candidates.length)] ?? 0;
}

export function getMusicPlaybackModeLabel(mode: MusicPlaybackMode | undefined): string {
  switch (mode) {
    case 'SHUFFLE':
      return '随机播放';
    case 'LOOP':
      return '列表循环';
    case 'CAROUSEL':
      return '轮播展示';
    default:
      return '顺序播放';
  }
}
