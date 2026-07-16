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

export interface IdleMusicSeekPreview {
  trackId: number;
  position: number;
}

export interface MusicTrackPresentationInput {
  title?: string | null;
  artist?: string | null;
}

export interface MusicTrackPresentation {
  title: string;
  artist: string;
}

export type MusicArtworkSize = 'thumbnail' | 'hero';

export interface LyricLine {
  time: number | null;
  text: string;
}

export type MusicPlayerSurface = 'hidden' | 'orb' | 'compact' | 'immersive';

export type MusicPlayerGestureAction = 'none' | 'previous' | 'next' | 'collapse';

export interface MusicPlayerGestureInput {
  deltaX: number;
  deltaY: number;
  /** Framer Motion reports velocity in pixels per second. */
  velocityX: number;
  velocityY: number;
  allowHorizontal?: boolean;
  allowVertical?: boolean;
}

const MAX_SHUFFLE_HISTORY = 100;
const MUSIC_GESTURE_AXIS_DOMINANCE = 1.15;
const MUSIC_GESTURE_HORIZONTAL_DISTANCE_PX = 68;
const MUSIC_GESTURE_HORIZONTAL_VELOCITY_PX_S = 550;
const MUSIC_GESTURE_VERTICAL_DISTANCE_PX = 92;
const MUSIC_GESTURE_VERTICAL_VELOCITY_PX_S = 650;
const LRC_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_METADATA_LINE_PATTERN = /^(?:\s*\[(?:al|ar|au|by|la|length|offset|re|ti|ve):[^\]]*\])+\s*$/i;

const UNKNOWN_MUSIC_ARTISTS = new Set(['', '未知艺术家', 'unknown artist']);

/**
 * An empty preview and an empty current track both expose `undefined` ids.
 * Compare only after proving that both records exist, otherwise
 * `undefined === undefined` would select the preview branch and dereference null.
 */
export function resolveIdleMusicSeekPreviewPosition(
  preview: IdleMusicSeekPreview | null,
  currentTrackId: number | null,
): number {
  if (!preview || currentTrackId == null || preview.trackId !== currentTrackId) return 0;
  return Number.isFinite(preview.position) ? Math.max(0, preview.position) : 0;
}

function resolveCommittedGestureDirection({
  delta,
  velocity,
  distanceThreshold,
  velocityThreshold,
}: {
  delta: number;
  velocity: number;
  distanceThreshold: number;
  velocityThreshold: number;
}): -1 | 1 | null {
  if (Math.abs(delta) >= distanceThreshold) return delta < 0 ? -1 : 1;
  if (Math.abs(velocity) >= velocityThreshold) return velocity < 0 ? -1 : 1;
  return null;
}

/**
 * 播放生命周期与表面显隐分开：历史断点只恢复歌曲/位置，绝不能凭此激活全局播放器。
 */
export function resolveMusicPlayerSurface({
  canRender,
  hasPlaybackSession,
  routeBlocked,
  playbackSurfaceVisible = false,
  compactOpen,
  expanded,
}: {
  canRender: boolean;
  hasPlaybackSession: boolean;
  routeBlocked: boolean;
  playbackSurfaceVisible?: boolean;
  compactOpen: boolean;
  expanded: boolean;
}): MusicPlayerSurface {
  if (!canRender || routeBlocked) return 'hidden';
  // Opening Now Playing is a surface intent, not a playback command. This lets
  // profile-card visitors inspect the current selection without unexpectedly
  // starting audio, while restored history still stays completely hidden.
  if (expanded) return 'immersive';
  if (!hasPlaybackSession) return 'hidden';
  // A visible in-page player is already the closest and most contextual
  // control surface. Suppress only the redundant floating layers; an explicit
  // immersive intent above still wins.
  if (playbackSurfaceVisible) return 'hidden';
  return compactOpen ? 'compact' : 'orb';
}

/**
 * Pointer events originating from the compact surface must not be treated as
 * outside clicks. During a Framer Motion layout transition the mounted node
 * and its ref can briefly differ, so callers check both the target and the
 * event's composed path before collapsing to the orb.
 */
export function shouldCollapseMusicCompactFromPointer({
  targetInsideSurface,
  pathInsideSurface,
}: {
  targetInsideSurface: boolean;
  pathInsideSurface: boolean;
}): boolean {
  return !targetInsideSurface && !pathInsideSurface;
}

/**
 * Keeps the selected track stable across refreshed/reordered arrays before any
 * effect can observe a stale numeric index. If the track disappeared, the old
 * slot is clamped so the queue naturally advances to its successor or tail.
 */
export function resolveStableMusicTrackIndex(
  tracks: readonly { id: number }[],
  trackId: number | null,
  fallbackIndex: number,
): number {
  if (tracks.length === 0) return 0;
  if (trackId != null) {
    const matchingIndex = tracks.findIndex((track) => track.id === trackId);
    if (matchingIndex >= 0) return matchingIndex;
  }
  const finiteIndex = Number.isFinite(fallbackIndex) ? Math.trunc(fallbackIndex) : 0;
  return Math.min(Math.max(finiteIndex, 0), tracks.length - 1);
}

/** Small playback surfaces should not decode the full cover when an uploaded thumbnail exists. */
export function resolveMusicArtworkSource({
  coverUrl,
  thumbnailUrl,
  size,
}: {
  coverUrl?: string | null;
  thumbnailUrl?: string | null;
  size: MusicArtworkSize;
}): string {
  const cover = coverUrl?.trim() || '';
  const thumbnail = thumbnailUrl?.trim() || '';
  return size === 'thumbnail'
    ? (thumbnail || cover)
    : (cover || thumbnail);
}

/**
 * Parses the public LRC subset used by every blog playback surface. Common LRC
 * metadata is not rendered as lyrics; malformed seconds are kept only as
 * untimed text instead of being converted into a different minute.
 */
export function parseMusicLyric(raw: string | undefined | null): LyricLine[] {
  if (!raw || !raw.trim()) return [];
  const lines: LyricLine[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (LRC_METADATA_LINE_PATTERN.test(line)) continue;

    LRC_TIMESTAMP_PATTERN.lastIndex = 0;
    const matches = Array.from(line.matchAll(LRC_TIMESTAMP_PATTERN));
    LRC_TIMESTAMP_PATTERN.lastIndex = 0;
    const text = line.replace(LRC_TIMESTAMP_PATTERN, '').trim();
    const validMatches = matches.filter((match) => Number(match[2]) < 60);

    if (validMatches.length === 0) {
      if (text) lines.push({ time: null, text });
      continue;
    }

    for (const match of validMatches) {
      const minutes = Number(match[1] || 0);
      const seconds = Number(match[2] || 0);
      const fractionRaw = match[3] || '0';
      const fraction = Number(fractionRaw.padEnd(3, '0').slice(0, 3)) / 1000;
      lines.push({ time: minutes * 60 + seconds + fraction, text: text || '...' });
    }
  }

  return lines.sort((left, right) => {
    if (left.time == null && right.time == null) return 0;
    if (left.time == null) return 1;
    if (right.time == null) return -1;
    return left.time - right.time;
  });
}

/**
 * 播放器手势只在主轴明确且达到位移/速度阈值时提交，避免斜滑、短滑与页面滚动误触。
 */
export function resolveMusicPlayerGesture({
  deltaX,
  deltaY,
  velocityX,
  velocityY,
  allowHorizontal = true,
  allowVertical = true,
}: MusicPlayerGestureInput): MusicPlayerGestureAction {
  const absoluteX = Math.abs(deltaX);
  const absoluteY = Math.abs(deltaY);
  const absoluteVelocityX = Math.abs(velocityX);
  const absoluteVelocityY = Math.abs(velocityY);

  const horizontalCommitted = absoluteX >= MUSIC_GESTURE_HORIZONTAL_DISTANCE_PX
    || absoluteVelocityX >= MUSIC_GESTURE_HORIZONTAL_VELOCITY_PX_S;
  const verticalCommitted = absoluteY >= MUSIC_GESTURE_VERTICAL_DISTANCE_PX
    || absoluteVelocityY >= MUSIC_GESTURE_VERTICAL_VELOCITY_PX_S;
  if (!horizontalCommitted && !verticalCommitted) return 'none';

  // Compare axes in one physical unit. Normalizing each axis by a different
  // threshold would turn a near-45° flick into a false horizontal gesture.
  const useDistanceVector = absoluteX >= MUSIC_GESTURE_HORIZONTAL_DISTANCE_PX
    || absoluteY >= MUSIC_GESTURE_VERTICAL_DISTANCE_PX;
  const horizontalStrength = horizontalCommitted
    ? (useDistanceVector ? absoluteX : absoluteVelocityX)
    : 0;
  const verticalStrength = verticalCommitted
    ? (useDistanceVector ? absoluteY : absoluteVelocityY)
    : 0;

  if (allowHorizontal && horizontalStrength >= verticalStrength * MUSIC_GESTURE_AXIS_DOMINANCE) {
    const direction = resolveCommittedGestureDirection({
      delta: deltaX,
      velocity: velocityX,
      distanceThreshold: MUSIC_GESTURE_HORIZONTAL_DISTANCE_PX,
      velocityThreshold: MUSIC_GESTURE_HORIZONTAL_VELOCITY_PX_S,
    });
    if (direction === -1) return 'next';
    if (direction === 1) return 'previous';
    return 'none';
  }

  if (allowVertical && verticalStrength >= horizontalStrength * MUSIC_GESTURE_AXIS_DOMINANCE) {
    const direction = resolveCommittedGestureDirection({
      delta: deltaY,
      velocity: velocityY,
      distanceThreshold: MUSIC_GESTURE_VERTICAL_DISTANCE_PX,
      velocityThreshold: MUSIC_GESTURE_VERTICAL_VELOCITY_PX_S,
    });
    return direction === 1 ? 'collapse' : 'none';
  }

  return 'none';
}

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
