import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MusicTrack } from '@aetherblog/types';
import {
  ADMIN_PLAYER_AUTO_COLLAPSE_MS,
  ADMIN_PLAYER_COMPACT_AUTO_MINIMIZE_MS,
  ADMIN_PLAYER_GESTURE_DISTANCE_PX,
  ADMIN_PLAYER_GESTURE_VELOCITY_PX_PER_SECOND,
  ADMIN_PLAYER_PAUSED_AUTO_MINIMIZE_MS,
  ADMIN_PLAYER_PAUSED_AUTO_COLLAPSE_MS,
  isAdminPlaybackRequestCurrent,
  parseAdminMusicLyric,
  resolveAdminAdjacentTrack,
  resolveAdminAudioUrl,
  resolveAdminPlayerGesture,
  resolveAdminPlayerAutoCollapseDelay,
  resolveAdminPlayerAutoMinimizeDelay,
  resolveAdminPlayerDensityTransition,
  resolveAdminPlayerViewportCorrection,
  resolveAdminMediaErrorMessage,
  shouldCommitAdminAudioEvent,
} from './adminMusicPlayerState';

const providerSource = readFileSync(
  path.resolve(__dirname, './AdminMusicPlayerProvider.tsx'),
  'utf8'
);
const adminStylesSource = readFileSync(
  path.resolve(__dirname, '../../index.css'),
  'utf8'
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return '';
  return source.slice(startIndex, endIndex);
}

describe('admin music player state', () => {
  it('restarts a one-track queue instead of reporting a fake index change', () => {
    expect(resolveAdminAdjacentTrack({ currentIndex: 0, direction: 1, trackCount: 1 })).toEqual({
      nextIndex: 0,
      restartCurrent: true,
    });
  });

  it('does not treat a track without a media URL as playable', () => {
    const unavailable = {
      id: 9,
      title: 'Unavailable',
      media: { fileUrl: '', publicUrl: '' },
    } as MusicTrack;

    expect(resolveAdminAudioUrl(unavailable)).toBe('');
    expect(resolveAdminAudioUrl({
      ...unavailable,
      media: { ...unavailable.media, fileUrl: 'uploads/audio/example.mp3' },
    })).toBe('/uploads/audio/example.mp3');
  });

  it('surfaces audio errors and offers recovery', () => {
    expect(providerSource).toContain('playbackError');
    expect(providerSource).toContain('onError={(event) =>');
    expect(providerSource).toContain('重新尝试');
    expect(providerSource).toContain('找不到可播放的媒体文件');
    expect(providerSource).toContain('retryPlayback,');
  });

  it('turns MediaError codes into specific recovery guidance', () => {
    expect(resolveAdminMediaErrorMessage(1)).toBe('播放已中断，请重新尝试。');
    expect(resolveAdminMediaErrorMessage(2)).toBe('网络连接失败，请检查网络后重试。');
    expect(resolveAdminMediaErrorMessage(3)).toBe('音频解码失败，文件可能已损坏。');
    expect(resolveAdminMediaErrorMessage(4)).toBe('当前浏览器不支持该音频格式或链接已失效。');
    expect(resolveAdminMediaErrorMessage(undefined)).toBe('这首歌暂时无法播放。');
    expect(resolveAdminMediaErrorMessage(99)).toBe('这首歌暂时无法播放。');
  });

  it('rejects stale playback completions after a rapid source switch', () => {
    expect(isAdminPlaybackRequestCurrent({
      requestId: 8,
      latestRequestId: 8,
      expectedUrl: 'https://example.com/b.mp3',
      loadedUrl: 'https://example.com/b.mp3',
    })).toBe(true);
    expect(isAdminPlaybackRequestCurrent({
      requestId: 7,
      latestRequestId: 8,
      expectedUrl: 'https://example.com/a.mp3',
      loadedUrl: 'https://example.com/b.mp3',
    })).toBe(false);
    expect(isAdminPlaybackRequestCurrent({
      requestId: 7,
      latestRequestId: 8,
      expectedUrl: 'https://example.com/b.mp3',
      loadedUrl: 'https://example.com/b.mp3',
    })).toBe(false);
    expect(providerSource).toContain('const playbackRequestRef = useRef(0)');
    expect(providerSource).toContain('isCurrentPlaybackRequest(requestId, expectedUrl)');
  });

  it('guards delayed media events with desired source, intent, and physical state', () => {
    const base = {
      actualUrl: 'https://example.com/b.mp3',
      desiredUrl: 'https://example.com/b.mp3',
      desiredPlaying: true,
      transitioning: false,
      paused: false,
      ended: false,
      hasError: false,
    };

    expect(shouldCommitAdminAudioEvent({ ...base, kind: 'play' })).toBe(true);
    expect(shouldCommitAdminAudioEvent({
      ...base,
      kind: 'play',
      desiredPlaying: false,
    })).toBe(false);
    expect(shouldCommitAdminAudioEvent({
      ...base,
      kind: 'error',
      actualUrl: 'https://example.com/a.mp3',
      hasError: true,
    })).toBe(false);
    expect(shouldCommitAdminAudioEvent({
      ...base,
      kind: 'pause',
      transitioning: true,
      paused: true,
    })).toBe(false);
    expect(shouldCommitAdminAudioEvent({
      ...base,
      kind: 'pause',
      paused: true,
      ended: true,
    })).toBe(false);
    expect(shouldCommitAdminAudioEvent({
      ...base,
      kind: 'ended',
      paused: true,
      ended: true,
    })).toBe(true);
    expect(shouldCommitAdminAudioEvent({
      ...base,
      kind: 'ended',
      transitioning: true,
      paused: true,
      ended: true,
    })).toBe(false);
    expect(shouldCommitAdminAudioEvent({
      ...base,
      kind: 'error',
      hasError: true,
    })).toBe(true);
    expect(shouldCommitAdminAudioEvent({
      ...base,
      kind: 'timeupdate',
      transitioning: true,
    })).toBe(false);

    expect(providerSource).toContain('const desiredUrlRef = useRef');
    expect(providerSource).toContain('const desiredPlayingRef = useRef');
    expect(providerSource).toContain('const loadedTrackIdRef = useRef');
    expect(providerSource).toContain('const reservePlaybackRequest = useCallback');
    expect(providerSource).toContain('commitPlaybackStarted(reservation.requestId, expectedUrl)');
    expect(providerSource).toContain('restartRequestedTrack(nextQueueTrack);');
    expect(providerSource).toContain("isCurrentAudioEvent(event.currentTarget, 'play')");
    expect(providerSource).toContain("isCurrentAudioEvent(event.currentTarget, 'ended')");
  });

  it('parses the same long-form LRC subset as public playback', () => {
    expect(parseAdminMusicLyric([
      '[ti:Long mix]',
      '[ar:Aether Artist]',
      '[1:02.5]Short token',
      '[123:59.125]Long timeline',
      '[03:60.00]Invalid timestamp text',
      'Untimed outro',
    ].join('\n'))).toEqual([
      { time: 62.5, text: 'Short token' },
      { time: 7439.125, text: 'Long timeline' },
      { time: null, text: 'Invalid timestamp text' },
      { time: null, text: 'Untimed outro' },
    ]);
    expect(providerSource).toContain('parseAdminMusicLyric(currentTrack?.lyric)');
  });

  it('does not rebuild every expanded lyric row for progress ticks inside the same line', () => {
    expect(providerSource).toContain('const renderedLyricLines = useMemo(() =>');
    expect(providerSource).toContain(': renderedLyricLines}');
    expect(providerSource).toContain('[activeLyric, lyrics, resolvedDuration, seekToPercent]');
  });

  it('classifies a downward gesture without coupling free-position dragging to player density', () => {
    expect(resolveAdminPlayerGesture({
      expanded: true,
      deltaX: 0,
      deltaY: ADMIN_PLAYER_GESTURE_DISTANCE_PX,
      velocityX: 0,
      velocityY: 0,
    })).toBe('collapse');
    expect(providerSource).toContain("resolveAdminPlayerDensityTransition(playerDensity, 'toggle-detail')");
    expect(providerSource).not.toContain("if (action === 'collapse') setPlayerDensity");
    expect(providerSource).toContain('dragConstraints={dockBoundsRef}');
    expect(providerSource).toContain('aria-label="关闭后台播放器"');
  });

  it('auto-collapses an idle expanded player on a calmer schedule when paused', () => {
    expect(ADMIN_PLAYER_AUTO_COLLAPSE_MS).toBe(8_000);
    expect(ADMIN_PLAYER_PAUSED_AUTO_COLLAPSE_MS).toBe(14_000);
    expect(resolveAdminPlayerAutoCollapseDelay({
      expanded: true,
      isPlaying: true,
      pointerInside: false,
      focusWithin: false,
    })).toBe(8_000);
    expect(resolveAdminPlayerAutoCollapseDelay({
      expanded: true,
      isPlaying: false,
      pointerInside: false,
      focusWithin: false,
    })).toBe(14_000);

    for (const state of [
      { expanded: false, isPlaying: true, pointerInside: false, focusWithin: false },
      { expanded: true, isPlaying: true, pointerInside: true, focusWithin: false },
      { expanded: true, isPlaying: true, pointerInside: false, focusWithin: true },
      {
        expanded: true,
        isPlaying: true,
        pointerInside: false,
        focusWithin: false,
        isDragging: true,
      },
      {
        expanded: true,
        isPlaying: true,
        pointerInside: false,
        focusWithin: false,
        hasPlaybackError: true,
      },
    ]) {
      expect(resolveAdminPlayerAutoCollapseDelay(state)).toBeNull();
    }

    expect(providerSource).toContain('resolveAdminPlayerAutoCollapseDelay({');
    expect(providerSource).toContain("window.setTimeout(() => setPlayerDensity('compact'), autoCollapseDelay)");
    expect(providerSource).toContain('[audioUrl, autoCollapseDelay, currentIndex, interactionVersion]');
    expect(providerSource).toMatch(/const playTracks = useCallback\([\s\S]*?setInteractionVersion\(\(version\) => version \+ 1\);/);
  });

  it('auto-minimizes an idle compact player without hiding recovery or active interaction', () => {
    expect(ADMIN_PLAYER_COMPACT_AUTO_MINIMIZE_MS).toBe(10_000);
    expect(ADMIN_PLAYER_PAUSED_AUTO_MINIMIZE_MS).toBe(16_000);
    expect(resolveAdminPlayerAutoMinimizeDelay({
      density: 'compact',
      isPlaying: true,
      pointerInside: false,
      focusWithin: false,
    })).toBe(10_000);
    expect(resolveAdminPlayerAutoMinimizeDelay({
      density: 'compact',
      isPlaying: false,
      pointerInside: false,
      focusWithin: false,
    })).toBe(16_000);

    for (const state of [
      { density: 'minimized' as const, isPlaying: true, pointerInside: false, focusWithin: false },
      { density: 'expanded' as const, isPlaying: true, pointerInside: false, focusWithin: false },
      { density: 'compact' as const, isPlaying: true, pointerInside: true, focusWithin: false },
      { density: 'compact' as const, isPlaying: true, pointerInside: false, focusWithin: true },
      { density: 'compact' as const, isPlaying: true, pointerInside: false, focusWithin: false, isDragging: true },
      { density: 'compact' as const, isPlaying: true, pointerInside: false, focusWithin: false, hasPlaybackError: true },
    ]) {
      expect(resolveAdminPlayerAutoMinimizeDelay(state)).toBeNull();
    }

    expect(providerSource).toContain('resolveAdminPlayerAutoMinimizeDelay({');
    expect(providerSource).toContain("setPlayerDensity('minimized')");
    expect(providerSource).toContain('onPointerDownCapture={markPlayerActivity}');
    expect(providerSource).not.toContain('onPointerDown={markPlayerActivity}');
  });

  it('keeps density transitions explicit and predictable', () => {
    expect(resolveAdminPlayerDensityTransition('minimized', 'restore')).toBe('compact');
    expect(resolveAdminPlayerDensityTransition('compact', 'toggle-detail')).toBe('expanded');
    expect(resolveAdminPlayerDensityTransition('expanded', 'toggle-detail')).toBe('compact');
    expect(resolveAdminPlayerDensityTransition('expanded', 'minimize')).toBe('minimized');
    expect(resolveAdminPlayerDensityTransition('compact', 'minimize')).toBe('minimized');
  });

  it('returns the smallest correction that keeps a draggable player inside the viewport margin', () => {
    expect(resolveAdminPlayerViewportCorrection({
      left: 4,
      top: 8,
      width: 200,
      height: 120,
      viewportWidth: 1024,
      viewportHeight: 768,
      edgeMargin: 16,
    })).toEqual({ x: 12, y: 8 });
    expect(resolveAdminPlayerViewportCorrection({
      left: 900,
      top: 690,
      width: 200,
      height: 100,
      viewportWidth: 1024,
      viewportHeight: 768,
      edgeMargin: 16,
    })).toEqual({ x: -92, y: -38 });
    expect(resolveAdminPlayerViewportCorrection({
      left: 200,
      top: 120,
      width: 320,
      height: 220,
      viewportWidth: 1024,
      viewportHeight: 768,
      edgeMargin: 16,
    })).toEqual({ x: 0, y: 0 });
  });

  it('maps committed horizontal swipes to one adjacent-track action', () => {
    expect(resolveAdminPlayerGesture({
      expanded: false,
      deltaX: -ADMIN_PLAYER_GESTURE_DISTANCE_PX,
      deltaY: 12,
      velocityX: 0,
      velocityY: 0,
    })).toBe('next');
    expect(resolveAdminPlayerGesture({
      expanded: true,
      deltaX: ADMIN_PLAYER_GESTURE_DISTANCE_PX,
      deltaY: -8,
      velocityX: 0,
      velocityY: 0,
    })).toBe('previous');
  });

  it('accepts a deliberate flick without requiring the full travel distance', () => {
    expect(resolveAdminPlayerGesture({
      expanded: false,
      deltaX: -18,
      deltaY: 2,
      velocityX: -ADMIN_PLAYER_GESTURE_VELOCITY_PX_PER_SECOND,
      velocityY: 40,
    })).toBe('next');
    expect(resolveAdminPlayerGesture({
      expanded: true,
      deltaX: 16,
      deltaY: 3,
      velocityX: ADMIN_PLAYER_GESTURE_VELOCITY_PX_PER_SECOND,
      velocityY: 20,
    })).toBe('previous');
  });

  it('uses direction locking before resolving vertical density gestures', () => {
    expect(resolveAdminPlayerGesture({
      expanded: true,
      deltaX: 16,
      deltaY: ADMIN_PLAYER_GESTURE_DISTANCE_PX,
      velocityX: 0,
      velocityY: 0,
    })).toBe('collapse');
    expect(resolveAdminPlayerGesture({
      expanded: false,
      deltaX: -14,
      deltaY: -ADMIN_PLAYER_GESTURE_DISTANCE_PX,
      velocityX: 0,
      velocityY: 0,
    })).toBe('expand');

    expect(resolveAdminPlayerGesture({
      expanded: true,
      deltaX: -90,
      deltaY: 110,
      velocityX: 0,
      velocityY: 0,
    })).toBe('collapse');
  });

  it('ignores short, ambiguous, and unsupported-direction gestures', () => {
    expect(resolveAdminPlayerGesture({
      expanded: false,
      deltaX: 36,
      deltaY: 7,
      velocityX: 420,
      velocityY: 50,
    })).toBe('none');
    expect(resolveAdminPlayerGesture({
      expanded: true,
      deltaX: 80,
      deltaY: 76,
      velocityX: 0,
      velocityY: 0,
    })).toBe('none');
    expect(resolveAdminPlayerGesture({
      expanded: true,
      deltaX: 3,
      deltaY: -ADMIN_PLAYER_GESTURE_DISTANCE_PX,
      velocityX: 0,
      velocityY: 0,
    })).toBe('none');
    expect(resolveAdminPlayerGesture({
      expanded: false,
      deltaX: 3,
      deltaY: ADMIN_PLAYER_GESTURE_DISTANCE_PX,
      velocityX: 0,
      velocityY: 0,
    })).toBe('none');
  });

  it('uses minimized, compact, and expanded densities with one symmetric expanded transport', () => {
    expect(providerSource).toContain('data-admin-player-minimized');
    expect(providerSource).toContain('data-admin-player-compact-layout');
    expect(providerSource).toContain('data-admin-player-expanded-layout');
    expect(providerSource).toContain('data-admin-player-density-toggle');
    expect(providerSource).toContain('data-admin-player-transport');
    expect(providerSource).toContain('data-admin-player-core-transport');
    expect(adminStylesSource).toContain('grid-template-columns: 2.75rem 3.5rem 2.75rem;');
    expect(adminStylesSource).toContain('gap: 0.75rem;');
    expect(providerSource).toContain('<Maximize2');
    expect(providerSource).toContain('<Minimize2');
    expect(providerSource).not.toContain('data-admin-player-drag-handle');
    expect(providerSource).not.toContain('-top-8');
    expect(providerSource).not.toContain('紧凑常驻行');
  });

  it('morphs all three densities through one persistent core instead of swapping keyed layouts', () => {
    expect(providerSource).toContain('data-admin-player-density={playerDensity}');
    expect(providerSource).toContain('data-admin-player-morph-content');
    expect(providerSource.match(/data-admin-player-core-cover/g)).toHaveLength(1);
    expect(providerSource.match(/data-admin-player-core-identity/g)).toHaveLength(1);
    expect(providerSource.match(/data-admin-player-core-transport/g)).toHaveLength(1);
    expect(providerSource.match(/data-admin-player-core-play/g)).toHaveLength(1);
    expect(providerSource.match(/data-admin-player-core-progress/g)).toHaveLength(1);
    expect(providerSource).not.toContain('<AnimatePresence initial={false} mode="popLayout">\n                    {playerDensity');
    expect(providerSource).not.toContain('key="minimized"');
    expect(providerSource).not.toContain('key="compact"');
    expect(providerSource).not.toContain('key="expanded"');
    expect(providerSource).not.toContain('{ opacity: 0, scale: 0.985 }');
    expect(providerSource).not.toContain('{ opacity: 0, scale: 0.92 }');
    expect(providerSource).toContain('const secondaryMorphTransition = (visible: boolean, enterDelay = 0)');
    expect(providerSource).toContain('duration: motionDuration.instant / 2');
    expect(providerSource).toContain('ADMIN_PLAYER_COMPACT_MINIMIZED_ACTION_ENTER_DELAY');
    expect(providerSource).toContain('ADMIN_PLAYER_EXPANDED_MINIMIZED_ACTION_ENTER_DELAY');
    expect(providerSource).toContain("const minimizeSourceDensityRef = useRef<AdminPlayerDensity>('compact')");
    expect(providerSource).toContain("minimizeSourceDensityRef.current === 'expanded'");
    expect(providerSource).toContain('enterMinimizedDensity(playerDensity)');
    expect(providerSource).toContain('? { ...transition.quick, delay: enterDelay }');
    expect(providerSource).toContain(': ADMIN_PLAYER_SECONDARY_EXIT_TRANSITION');
    expect(providerSource.match(/secondaryMorphTransition\(/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });

  it('uses symmetric card insets and never renders a visual drag handle', () => {
    expect(adminStylesSource).toContain(".admin-music-player-root[data-admin-player-density='compact'] .admin-player-core-cover");
    expect(adminStylesSource).toContain('left: 1.5rem;');
    expect(adminStylesSource).toContain('right: 1.5rem;');
    expect(adminStylesSource).toContain('bottom: 0.75rem;');
    expect(adminStylesSource).toContain(".admin-music-player-root[data-admin-player-density='expanded'] .admin-player-core-cover");
    expect(adminStylesSource).toContain(".admin-music-player-root[data-admin-player-density='expanded'] .admin-player-expanded-detail");
    expect(providerSource).not.toContain('data-admin-player-drag-handle');
    expect(providerSource).not.toContain('data-admin-player-grabber');
    expect(providerSource).not.toContain('<span className="h-1 w-9 rounded-full');
  });

  it('keeps every density inside a safe draggable viewport and grows the card from its bottom edge', () => {
    const surfaceSource = sourceBetween(
      providerSource,
      'data-admin-player-surface',
      'data-admin-player-morph-content',
    );

    expect(providerSource).toContain('data-admin-player-bounds');
    expect(providerSource).toContain('dragConstraints={dockBoundsRef}');
    expect(providerSource).toContain('x: dockX,');
    expect(providerSource).toContain('y: dockY,');
    expect(providerSource).toContain('originX: 0.5');
    expect(providerSource).toContain('originY: 1');
    expect(providerSource).toContain('const ADMIN_PLAYER_MINIMIZED_RADIUS = 30;');
    expect(providerSource).toContain('const ADMIN_PLAYER_MOBILE_MINIMIZED_RADIUS = 26;');
    expect(providerSource).toContain('const ADMIN_PLAYER_PANEL_RADIUS = 24;');
    expect(providerSource).toContain("const playerSurfaceRadius = playerDensity === 'minimized'");
    expect(providerSource).toContain('? (isMobile ? ADMIN_PLAYER_MOBILE_MINIMIZED_RADIUS : ADMIN_PLAYER_MINIMIZED_RADIUS)');
    expect(providerSource).toContain(': ADMIN_PLAYER_PANEL_RADIUS;');
    expect(surfaceSource).toContain('initial={{ borderRadius: playerSurfaceRadius }}');
    expect(surfaceSource).toContain('animate={{ borderRadius: playerSurfaceRadius }}');
    expect(surfaceSource).toContain('borderRadius: spring.soft');
    expect(surfaceSource).not.toContain('rounded-full');
    expect(surfaceSource).not.toContain('rounded-[var(--music-radius-floating)]');
    expect(surfaceSource).not.toContain('rounded-[var(--music-radius-capsule)]');
    expect(providerSource).toContain('resolveAdminPlayerViewportCorrection({');
    expect(providerSource).toContain('.catch(() => undefined)');
    expect(providerSource).toContain('ResizeObserver');
    expect(providerSource).toContain('ADMIN_PLAYER_DOCK_POSITION_KEY');
    expect(providerSource).toContain('data-admin-player-drag-zone');
    expect(providerSource).toContain('dragControls.start(event);');
    expect(providerSource).not.toContain('dragSnapToOrigin');
    expect(adminStylesSource).toContain('width: min(100%, 32.5rem);');
    expect(providerSource).toContain('layout="position"');
    expect(providerSource).not.toContain('layout="size"');
    expect(providerSource).not.toContain('<AnimatePresence initial={false} mode="popLayout">\n                    {playerDensity');
    expect(providerSource).toContain('scaleX(${percent / 100})');
    expect(providerSource).toContain('motion-reduce:transition-none');
    expect(providerSource).toContain('const percentRef = useRef(percent)');
    expect(providerSource).toContain('const currentPercent = percentRef.current');
    expect(providerSource).toContain('}, [seekToPercent]);');
    expect(providerSource).not.toContain('}, [percent, seekToPercent]);');
    expect(providerSource).not.toContain("height: 'auto'");
    expect(providerSource).not.toContain('mode="wait"');
    expect(providerSource).not.toContain('whileDrag={prefersReducedMotion ? undefined : { scale:');
    expect(providerSource).toContain('dockDraggedRef.current = true');
    expect(providerSource).not.toContain('initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}');
  });

  it('uses a compact desktop mini card and the same 52px ambient icon scale as the public player on mobile', () => {
    const coreSource = sourceBetween(
      providerSource,
      'data-admin-player-morph-content',
      '{playbackError && (',
    );

    expect(providerSource).toContain('data-admin-player-desktop-mini-card');
    expect(providerSource).toContain('data-admin-player-mobile-orb');
    expect(providerSource).toContain('data-admin-player-surface');
    expect(adminStylesSource).toContain('width: 3.25rem;');
    expect(adminStylesSource).toContain('height: 3.25rem;');
    expect(adminStylesSource).toContain('width: 22.5rem;');
    expect(adminStylesSource).toContain('height: 4rem;');
    expect(adminStylesSource).toContain('padding: 0.125rem 0.25rem;');
    expect(providerSource).toContain('rounded-[var(--music-radius-capsule)]');
    expect(coreSource).toContain('data-admin-player-mini-cover');
    expect(coreSource).toContain('data-admin-player-mini-title');
    expect(providerSource).toContain('data-admin-player-mini-play');
    expect(providerSource).not.toContain('renderMiniPlayButton');
    expect(providerSource.match(/renderPlayButton\(\)/g)).toHaveLength(1);
    expect(providerSource).toContain('data-admin-player-compact-progress');
  });

  it('keeps the desktop minimized artwork fully inside the visible capsule', () => {
    const surfaceSource = sourceBetween(
      providerSource,
      'data-admin-player-surface',
      'data-admin-player-morph-content',
    );

    expect(surfaceSource).toContain(
      'surface-raised relative h-full w-full overflow-hidden text-[var(--ink-primary)]',
    );
    expect(adminStylesSource).toContain('top: 0.375rem;');
    expect(adminStylesSource).toContain('left: 0.5rem;');
    expect(adminStylesSource).toContain('width: 2.75rem;');
    expect(adminStylesSource).toContain('height: 2.75rem;');
  });

  it('keeps the 52px mobile orb inside a matching 52px minimized row', () => {
    expect(providerSource).toContain('data-admin-player-mobile-orb');
    expect(adminStylesSource).toContain(".admin-music-player-root[data-admin-player-density='minimized']");
    expect(adminStylesSource).toContain('width: 3.25rem;');
    expect(adminStylesSource).toContain('height: 3.25rem;');
    expect(adminStylesSource).not.toContain('height: 3.125rem;');
    expect(providerSource).toContain(
      "playerDensity === 'minimized' && 'max-[768px]:!border-0'",
    );
  });

  it('centers the compact desktop transport independently from metadata, actions, and progress', () => {
    expect(providerSource).toContain('data-admin-player-compact-identity');
    expect(providerSource).toContain('data-admin-player-compact-transport');
    expect(providerSource).toContain('data-admin-player-compact-actions');
    expect(providerSource).toMatch(/data-admin-player-core-transport[\s\S]*?<SkipBack[\s\S]*?renderPlayButton\(\)[\s\S]*?<SkipForward/);
    expect(providerSource).toMatch(/data-admin-player-core-actions[\s\S]*?minimizePlayer[\s\S]*?renderDensityToggle\(\)/);
    expect(adminStylesSource).toContain('left: calc(50% - 4.75rem);');
    expect(adminStylesSource).toContain('left: calc(50% - 5.25rem);');
    expect(adminStylesSource).toContain('right: 1.5rem;');
    expect(adminStylesSource).toContain('left: 1.5rem;');
    expect(adminStylesSource).toContain('top: auto;');
    expect(adminStylesSource).toContain('bottom: 2rem;');
    expect(providerSource).toContain('const topActionControlClass =');
    expect(providerSource).not.toMatch(/const topActionControlClass = '[^']*hover:bg/);
    expect(adminStylesSource).toContain("data-admin-player-density='compact'] .admin-player-core-actions svg");
    expect(adminStylesSource).toContain('width: 0.875rem;');
    expect(adminStylesSource).toContain("data-admin-player-density='expanded'] .admin-player-core-actions svg");
    expect(adminStylesSource).toContain('width: 1.125rem;');
    expect(adminStylesSource).toMatch(
      /data-admin-player-density='expanded'] \.admin-player-action-close\s*{\s*right: 5\.5rem;/,
    );
    expect(adminStylesSource).not.toMatch(
      /data-admin-player-density='expanded'] \.admin-player-action-(?:density|minimize)\s*{/,
    );
    expect(providerSource).toContain('<X className="h-[18px] w-[18px]"');
    expect(providerSource).not.toContain('<ArrowLeft className="h-[18px] w-[18px]"');
  });

  it('returns keyboard focus when the persistent player changes density or closes', () => {
    expect(providerSource).toContain('const densityToggleRef = useRef<HTMLButtonElement>(null)');
    expect(providerSource).toContain('const minimizedTriggerRef = useRef<HTMLButtonElement>(null)');
    expect(providerSource).toContain('const playerReturnFocusRef = useRef<HTMLElement | null>(null)');
    expect(providerSource).toContain('ref={densityToggleRef}');
    expect(providerSource).toContain('ref={minimizedTriggerRef}');
    expect(providerSource).toContain('focusDensityToggle();');
    expect(providerSource).toContain('focusMinimizedTrigger();');
    expect(providerSource).toContain('restorePlayerReturnFocus();');
    expect(providerSource).toContain('if (target?.isConnected) target.focus({ preventScroll: true });');
    expect(providerSource).toContain('const expandedHeadingRef = useRef<HTMLHeadingElement>(null)');
    expect(providerSource).toContain("nextDensity === 'expanded'");
    expect(providerSource).toContain("inputModalityRef.current === 'keyboard'");
    expect(providerSource).toContain('expandedHeadingRef.current?.focus({ preventScroll: true });');
    expect(providerSource).toContain(
      'focus-visible:shadow-[inset_0_-2px_0_color-mix(in_oklch,var(--aurora-1)_72%,transparent)]',
    );
  });

  it('settles an idle source change instead of suppressing the next real pause event', () => {
    expect(providerSource).toMatch(
      /if \(shouldContinuePlaying\) \{[\s\S]*?\} else \{[\s\S]*?sourceTransitionRef\.current = false;/
    );
  });
});
