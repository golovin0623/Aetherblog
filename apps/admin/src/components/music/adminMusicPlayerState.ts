import type { MusicTrack } from '@aetherblog/types';

export const ADMIN_PLAYER_AUTO_COLLAPSE_MS = 8_000;
export const ADMIN_PLAYER_PAUSED_AUTO_COLLAPSE_MS = 14_000;
export const ADMIN_PLAYER_COMPACT_AUTO_MINIMIZE_MS = 10_000;
export const ADMIN_PLAYER_PAUSED_AUTO_MINIMIZE_MS = 16_000;

export const ADMIN_PLAYER_GESTURE_DISTANCE_PX = 72;
export const ADMIN_PLAYER_GESTURE_VELOCITY_PX_PER_SECOND = 650;
export const ADMIN_PLAYER_GESTURE_AXIS_DOMINANCE_RATIO = 1.15;

const ADMIN_LRC_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const ADMIN_LRC_METADATA_LINE_PATTERN = /^(?:\s*\[(?:al|ar|au|by|la|length|offset|re|ti|ve):[^\]]*\])+\s*$/i;

export interface AdminMusicLyricLine {
  time: number | null;
  text: string;
}

/** Mirrors the public player's LRC subset so editing preview and playback agree. */
export function parseAdminMusicLyric(raw: string | undefined | null): AdminMusicLyricLine[] {
  if (!raw || !raw.trim()) return [];
  const lines: AdminMusicLyricLine[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (ADMIN_LRC_METADATA_LINE_PATTERN.test(line)) continue;

    ADMIN_LRC_TIMESTAMP_PATTERN.lastIndex = 0;
    const matches = Array.from(line.matchAll(ADMIN_LRC_TIMESTAMP_PATTERN));
    ADMIN_LRC_TIMESTAMP_PATTERN.lastIndex = 0;
    const text = line.replace(ADMIN_LRC_TIMESTAMP_PATTERN, '').trim();
    const validMatches = matches.filter((match) => Number(match[2]) < 60);

    if (validMatches.length === 0) {
      if (text) lines.push({ time: null, text });
      continue;
    }

    for (const match of validMatches) {
      const fractionRaw = match[3] || '0';
      const fraction = Number(fractionRaw.padEnd(3, '0').slice(0, 3)) / 1000;
      lines.push({
        time: Number(match[1] || 0) * 60 + Number(match[2] || 0) + fraction,
        text: text || '♪',
      });
    }
  }

  return lines.sort((left, right) => (
    (left.time ?? Number.MAX_SAFE_INTEGER) - (right.time ?? Number.MAX_SAFE_INTEGER)
  ));
}

export type AdminPlayerGestureAction =
  | 'none'
  | 'next'
  | 'previous'
  | 'collapse'
  | 'expand';

export type AdminPlayerDensity = 'minimized' | 'compact' | 'expanded';
export type AdminPlayerDensityAction = 'restore' | 'toggle-detail' | 'minimize';

export function resolveAdminPlayerDensityTransition(
  density: AdminPlayerDensity,
  action: AdminPlayerDensityAction,
): AdminPlayerDensity {
  if (action === 'minimize') return 'minimized';
  if (action === 'restore') return density === 'minimized' ? 'compact' : density;
  if (density === 'expanded') return 'compact';
  return 'expanded';
}

type AdminPlayerGestureInput = {
  expanded: boolean;
  deltaX: number;
  deltaY: number;
  velocityX?: number;
  velocityY?: number;
};

function resolveCommittedDirection({
  delta,
  velocity,
}: {
  delta: number;
  velocity: number;
}): -1 | 1 | null {
  if (Math.abs(delta) >= ADMIN_PLAYER_GESTURE_DISTANCE_PX) {
    return delta < 0 ? -1 : 1;
  }
  if (Math.abs(velocity) >= ADMIN_PLAYER_GESTURE_VELOCITY_PX_PER_SECOND) {
    return velocity < 0 ? -1 : 1;
  }
  return null;
}

export function resolveAdminPlayerGesture({
  expanded,
  deltaX,
  deltaY,
  velocityX = 0,
  velocityY = 0,
}: AdminPlayerGestureInput): AdminPlayerGestureAction {
  const horizontalStrength = Math.max(
    Math.abs(deltaX) / ADMIN_PLAYER_GESTURE_DISTANCE_PX,
    Math.abs(velocityX) / ADMIN_PLAYER_GESTURE_VELOCITY_PX_PER_SECOND
  );
  const verticalStrength = Math.max(
    Math.abs(deltaY) / ADMIN_PLAYER_GESTURE_DISTANCE_PX,
    Math.abs(velocityY) / ADMIN_PLAYER_GESTURE_VELOCITY_PX_PER_SECOND
  );

  if (horizontalStrength < 1 && verticalStrength < 1) return 'none';

  if (horizontalStrength >= verticalStrength * ADMIN_PLAYER_GESTURE_AXIS_DOMINANCE_RATIO) {
    const direction = resolveCommittedDirection({ delta: deltaX, velocity: velocityX });
    if (direction === -1) return 'next';
    if (direction === 1) return 'previous';
    return 'none';
  }

  if (verticalStrength >= horizontalStrength * ADMIN_PLAYER_GESTURE_AXIS_DOMINANCE_RATIO) {
    const direction = resolveCommittedDirection({ delta: deltaY, velocity: velocityY });
    if (expanded && direction === 1) return 'collapse';
    if (!expanded && direction === -1) return 'expand';
  }

  return 'none';
}

export function resolveAdminPlayerAutoCollapseDelay({
  expanded,
  isPlaying,
  pointerInside,
  focusWithin,
  isDragging = false,
  hasPlaybackError = false,
}: {
  expanded: boolean;
  isPlaying: boolean;
  pointerInside: boolean;
  focusWithin: boolean;
  isDragging?: boolean;
  hasPlaybackError?: boolean;
}): number | null {
  if (
    !expanded
    || pointerInside
    || focusWithin
    || isDragging
    || hasPlaybackError
  ) {
    return null;
  }

  return isPlaying
    ? ADMIN_PLAYER_AUTO_COLLAPSE_MS
    : ADMIN_PLAYER_PAUSED_AUTO_COLLAPSE_MS;
}

export function resolveAdminPlayerAutoMinimizeDelay({
  density,
  isPlaying,
  pointerInside,
  focusWithin,
  isDragging = false,
  hasPlaybackError = false,
}: {
  density: AdminPlayerDensity;
  isPlaying: boolean;
  pointerInside: boolean;
  focusWithin: boolean;
  isDragging?: boolean;
  hasPlaybackError?: boolean;
}): number | null {
  if (
    density !== 'compact'
    || pointerInside
    || focusWithin
    || isDragging
    || hasPlaybackError
  ) {
    return null;
  }

  return isPlaying
    ? ADMIN_PLAYER_COMPACT_AUTO_MINIMIZE_MS
    : ADMIN_PLAYER_PAUSED_AUTO_MINIMIZE_MS;
}

export function resolveAdminPlayerViewportCorrection({
  left,
  top,
  width,
  height,
  viewportWidth,
  viewportHeight,
  edgeMargin,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  edgeMargin: number;
}): { x: number; y: number } {
  const safeLeft = edgeMargin;
  const safeTop = edgeMargin;
  const safeRight = viewportWidth - edgeMargin;
  const safeBottom = viewportHeight - edgeMargin;
  const right = left + width;
  const bottom = top + height;

  let x = 0;
  let y = 0;
  if (left < safeLeft) x = safeLeft - left;
  else if (right > safeRight) x = safeRight - right;
  if (top < safeTop) y = safeTop - top;
  else if (bottom > safeBottom) y = safeBottom - bottom;

  return { x, y };
}

export function resolveAdminAudioUrl(track: MusicTrack | undefined): string {
  if (!track) return '';
  const raw = track.media?.publicUrl || track.media?.fileUrl || '';
  if (!raw) return '';
  return raw.startsWith('uploads/') ? `/${raw}` : raw;
}

export function resolveAdminMediaErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1:
      return '播放已中断，请重新尝试。';
    case 2:
      return '网络连接失败，请检查网络后重试。';
    case 3:
      return '音频解码失败，文件可能已损坏。';
    case 4:
      return '当前浏览器不支持该音频格式或链接已失效。';
    default:
      return '这首歌暂时无法播放。';
  }
}

/**
 * A play() promise may reject after the visitor already swiped to another
 * source. Only the latest request for the still-loaded URL may commit status.
 */
export function isAdminPlaybackRequestCurrent({
  requestId,
  latestRequestId,
  expectedUrl,
  loadedUrl,
}: {
  requestId: number;
  latestRequestId: number;
  expectedUrl: string;
  loadedUrl: string;
}): boolean {
  return requestId === latestRequestId
    && expectedUrl !== ''
    && expectedUrl === loadedUrl;
}

export type AdminAudioEventKind =
  | 'play'
  | 'pause'
  | 'error'
  | 'ended'
  | 'metadata'
  | 'timeupdate';

/**
 * A single HTMLAudioElement is reused across queue transitions. Delayed DOM
 * events therefore need to agree with both the latest desired source and the
 * media element's current physical state before they may update React state.
 */
export function shouldCommitAdminAudioEvent({
  kind,
  actualUrl,
  desiredUrl,
  desiredPlaying,
  transitioning,
  paused,
  ended,
  hasError,
}: {
  kind: AdminAudioEventKind;
  actualUrl: string;
  desiredUrl: string;
  desiredPlaying: boolean;
  transitioning: boolean;
  paused: boolean;
  ended: boolean;
  hasError: boolean;
}): boolean {
  if (!desiredUrl || actualUrl !== desiredUrl) return false;

  switch (kind) {
    case 'play':
      return desiredPlaying && !paused;
    case 'pause':
      return paused
        && !(transitioning && desiredPlaying)
        && !(ended && desiredPlaying);
    case 'error':
      return desiredPlaying && hasError;
    case 'ended':
      return desiredPlaying && ended && !transitioning;
    case 'metadata':
      return true;
    case 'timeupdate':
      return !transitioning;
  }
}

export function resolveAdminAdjacentTrack({
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
