import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getMusicPlaybackModeLabel,
  parseMusicLyric,
  resolveAdjacentTrack,
  resolveMusicArtworkSource,
  resolveMusicPlayerGesture,
  resolveMusicPlayerSurface,
  resolveStableMusicTrackIndex,
  resolveMusicTrackPresentation,
  resolveMusicStartIndex,
  shouldCollapseMusicCompactFromPointer,
  shouldRotateMusicPresentation,
} from '../apps/blog/app/components/musicPlayerState';
import { resolveDialogTabTarget } from '../apps/blog/app/hooks/useDialogLifecycle';

const providerSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/MusicPlayerProvider.tsx'),
  'utf8'
);
const skinSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/MusicSkinSwitcher.tsx'),
  'utf8'
);
const dialogLifecycleSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/hooks/useDialogLifecycle.ts'),
  'utf8'
);
const globalsSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/globals.css'),
  'utf8'
);
const musicSkinSource = readFileSync(
  path.resolve(__dirname, '../packages/ui/src/styles/music-skin.css'),
  'utf8'
);
const adminMusicPageSource = readFileSync(
  path.resolve(__dirname, '../apps/admin/src/pages/MusicPage.tsx'),
  'utf8'
);
const adminPlayerSource = readFileSync(
  path.resolve(__dirname, '../apps/admin/src/components/music/AdminMusicPlayerProvider.tsx'),
  'utf8'
);
const adminHeaderSource = readFileSync(
  path.resolve(__dirname, '../apps/admin/src/components/layout/AdminModuleHeader.tsx'),
  'utf8'
);
const adminIndexSource = readFileSync(
  path.resolve(__dirname, '../apps/admin/src/index.css'),
  'utf8'
);
const confirmDialogSource = readFileSync(
  path.resolve(__dirname, '../apps/admin/src/components/common/ConfirmDialog.tsx'),
  'utf8'
);
const motionVerifierSource = readFileSync(
  path.resolve(__dirname, './verify-music-player-motion.mjs'),
  'utf8'
);
const rootPackage = JSON.parse(readFileSync(
  path.resolve(__dirname, '../package.json'),
  'utf8'
)) as {
  devDependencies?: Record<string, string>;
};

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('dialog focus trap policy', () => {
  const baseState = {
    shiftKey: false,
    activeIsContainer: false,
    activeIsFirst: false,
    activeIsLast: false,
    activeIsInside: true,
  };

  it('moves forward from the focused dialog container to the first control', () => {
    expect(resolveDialogTabTarget({
      ...baseState,
      activeIsContainer: true,
    })).toBe('first');
  });

  it('moves backward from the focused dialog container to the last control', () => {
    expect(resolveDialogTabTarget({
      ...baseState,
      shiftKey: true,
      activeIsContainer: true,
    })).toBe('last');
  });

  it('wraps forward from the last control to the first control', () => {
    expect(resolveDialogTabTarget({
      ...baseState,
      activeIsLast: true,
    })).toBe('first');
  });

  it('wraps backward from the first control to the last control', () => {
    expect(resolveDialogTabTarget({
      ...baseState,
      shiftKey: true,
      activeIsFirst: true,
    })).toBe('last');
  });

  it('leaves focus movement inside the dialog to the browser', () => {
    expect(resolveDialogTabTarget(baseState)).toBeNull();
  });

  it('recovers forward focus that has escaped outside the dialog', () => {
    expect(resolveDialogTabTarget({
      ...baseState,
      activeIsInside: false,
    })).toBe('first');
  });

  it('recovers backward focus that has escaped outside the dialog', () => {
    expect(resolveDialogTabTarget({
      ...baseState,
      shiftKey: true,
      activeIsInside: false,
    })).toBe('last');
  });

  it('wires the focused dialog container into the lifecycle trap', () => {
    expect(dialogLifecycleSource).toContain('activeIsContainer: active === container');
  });
});

describe('music playback policy', () => {
  it('keeps restored history hidden until the visitor explicitly starts playback', () => {
    expect(resolveMusicPlayerSurface({
      canRender: true,
      hasPlaybackSession: false,
      routeBlocked: false,
      compactOpen: false,
      expanded: false,
    })).toBe('hidden');
  });

  it('opens Now Playing without coupling surface navigation to audio playback', () => {
    expect(resolveMusicPlayerSurface({
      canRender: true,
      hasPlaybackSession: false,
      routeBlocked: false,
      compactOpen: false,
      expanded: true,
    })).toBe('immersive');
  });

  it('progressively discloses the ambient orb, compact player, and immersive player', () => {
    expect(resolveMusicPlayerSurface({
      canRender: true,
      hasPlaybackSession: true,
      routeBlocked: false,
      compactOpen: false,
      expanded: false,
    })).toBe('orb');
    expect(resolveMusicPlayerSurface({
      canRender: true,
      hasPlaybackSession: true,
      routeBlocked: false,
      compactOpen: true,
      expanded: false,
    })).toBe('compact');
    expect(resolveMusicPlayerSurface({
      canRender: true,
      hasPlaybackSession: true,
      routeBlocked: false,
      compactOpen: false,
      expanded: true,
    })).toBe('immersive');
  });

  it('suppresses non-modal floating controls while an in-page playback surface is visible', () => {
    expect(resolveMusicPlayerSurface({
      canRender: true,
      hasPlaybackSession: true,
      routeBlocked: false,
      playbackSurfaceVisible: true,
      compactOpen: false,
      expanded: false,
    })).toBe('hidden');
    expect(resolveMusicPlayerSurface({
      canRender: true,
      hasPlaybackSession: true,
      routeBlocked: false,
      playbackSurfaceVisible: true,
      compactOpen: true,
      expanded: false,
    })).toBe('hidden');
    expect(resolveMusicPlayerSurface({
      canRender: true,
      hasPlaybackSession: true,
      routeBlocked: false,
      playbackSurfaceVisible: true,
      compactOpen: false,
      expanded: true,
    })).toBe('immersive');
  });

  it('lets route and render guards hide every persistent playback surface', () => {
    const otherwiseImmersive = {
      canRender: true,
      hasPlaybackSession: true,
      routeBlocked: false,
      compactOpen: true,
      expanded: true,
    };

    expect(resolveMusicPlayerSurface({
      ...otherwiseImmersive,
      canRender: false,
    })).toBe('hidden');
    expect(resolveMusicPlayerSurface({
      ...otherwiseImmersive,
      routeBlocked: true,
    })).toBe('hidden');
  });

  it('treats compact-pointer origins as inside even while the panel ref is unavailable', () => {
    expect(shouldCollapseMusicCompactFromPointer({
      targetInsideSurface: true,
      pathInsideSurface: false,
    })).toBe(false);
    expect(shouldCollapseMusicCompactFromPointer({
      targetInsideSurface: false,
      pathInsideSurface: true,
    })).toBe(false);
    expect(shouldCollapseMusicCompactFromPointer({
      targetInsideSurface: false,
      pathInsideSurface: false,
    })).toBe(true);
  });

  it('starts card playback without forcing a duplicate compact player', () => {
    expect(providerSource).not.toContain(
      'const compactSurfaceOpen = compactOpen || (hasPlaybackSession && !previousSessionRef.current);',
    );
    expect(providerSource).toContain('playbackSurfaceVisible,');
    expect(providerSource).toContain('compactOpen,');
    expect(providerSource).toContain('if (hasPlaybackSession && !previousSessionRef.current)');
    expect(providerSource).toContain('setCompactOpen(false);');
  });

  it('locks swipe intent and only commits deliberate navigation or collapse gestures', () => {
    expect(resolveMusicPlayerGesture({ deltaX: -74, deltaY: 7, velocityX: -240, velocityY: 0 })).toBe('next');
    expect(resolveMusicPlayerGesture({ deltaX: 72, deltaY: 4, velocityX: 180, velocityY: 0 })).toBe('previous');
    expect(resolveMusicPlayerGesture({ deltaX: 8, deltaY: 98, velocityX: 0, velocityY: 180 })).toBe('collapse');
    expect(resolveMusicPlayerGesture({ deltaX: -34, deltaY: 7, velocityX: -260, velocityY: 0 })).toBe('none');
    expect(resolveMusicPlayerGesture({ deltaX: 38, deltaY: 36, velocityX: 900, velocityY: 850 })).toBe('none');
    expect(resolveMusicPlayerGesture({ deltaX: 12, deltaY: 2, velocityX: -760, velocityY: 0 })).toBe('next');
    expect(resolveMusicPlayerGesture({ deltaX: 2, deltaY: -12, velocityX: 0, velocityY: 760 })).toBe('collapse');
    expect(resolveMusicPlayerGesture({ deltaX: 72, deltaY: 0, velocityX: -900, velocityY: 0 })).toBe('previous');
  });

  it('keeps track identity stable across queue reorder and deletion', () => {
    const original = [{ id: 10 }, { id: 20 }, { id: 30 }];
    expect(resolveStableMusicTrackIndex(original, 20, 1)).toBe(1);
    expect(resolveStableMusicTrackIndex([{ id: 30 }, { id: 10 }, { id: 20 }], 20, 1)).toBe(2);
    expect(resolveStableMusicTrackIndex([{ id: 10 }, { id: 30 }], 20, 1)).toBe(1);
    expect(resolveStableMusicTrackIndex([{ id: 10 }], 30, 2)).toBe(0);
  });

  it('parses long LRC timelines while excluding metadata and invalid seconds', () => {
    expect(parseMusicLyric([
      '[ti:Long-form mix]',
      '[ar:Aether Artist]',
      '[1:02.5]Short minute token',
      '[123:59.125]Long timeline',
      '[03:60.00]Invalid timestamp text',
      'Untimed outro',
    ].join('\n'))).toEqual([
      { time: 62.5, text: 'Short minute token' },
      { time: 7439.125, text: 'Long timeline' },
      { time: null, text: 'Invalid timestamp text' },
      { time: null, text: 'Untimed outro' },
    ]);
  });

  it('uses uploaded thumbnails for compact artwork and full covers for hero artwork', () => {
    const artwork = {
      coverUrl: '/media/full-cover.jpg',
      thumbnailUrl: '/media/cover-thumb.jpg',
    };
    expect(resolveMusicArtworkSource({ ...artwork, size: 'thumbnail' })).toBe('/media/cover-thumb.jpg');
    expect(resolveMusicArtworkSource({ ...artwork, size: 'hero' })).toBe('/media/full-cover.jpg');
    expect(resolveMusicArtworkSource({ coverUrl: artwork.coverUrl, size: 'thumbnail' })).toBe(artwork.coverUrl);
    expect(providerSource).toContain("resolveMusicCoverSrc(track, '', size)");
    expect(sourceBetween(providerSource, 'function MusicArtwork({', 'export function NowPlayingGlyph')).toContain('unoptimized');
  });

  it('disables native image dragging so artwork swipes stay with the player gesture', () => {
    const musicArtworkSource = sourceBetween(
      providerSource,
      'function MusicArtwork({',
      'export function NowPlayingGlyph',
    );

    expect(musicArtworkSource).toContain('draggable={false}');
    expect(musicArtworkSource).toContain('className="select-none object-cover"');
  });

  it('keeps transport previous and swipe previous as distinct navigation intents', () => {
    const previousNavigationSource = sourceBetween(
      providerSource,
      'const navigateToPreviousTrack',
      'const nextTrack',
    );

    expect(providerSource).toContain('skipToPreviousTrack: () => void;');
    expect(previousNavigationSource).toContain('navigateToPreviousTrack(true);');
    expect(previousNavigationSource).toContain('navigateToPreviousTrack(false);');
    expect(providerSource).toContain('const goToPreviousTrackByGesture = useCallback');
    expect(providerSource).toContain('skipToPreviousTrack();');
    expect(
      providerSource.match(/if \(action === 'previous'\) goToPreviousTrackByGesture\(\);/g),
    ).toHaveLength(2);
  });

  it('keeps previous and next as presentation-only actions before playback starts', () => {
    expect(providerSource).toContain('if (!hasPlaybackSession) {\n      previewAdjacentTrack(-1);');
    expect(providerSource).toContain('if (!hasPlaybackSession) {\n      previewAdjacentTrack(1);');
    expect(providerSource).not.toContain('previewIndex: (index: number) => void');
  });

  it('never rotates the real playback track after a playback session exists', () => {
    expect(shouldRotateMusicPresentation({
      carouselEnabled: true,
      hasPlaybackSession: true,
      isPlaying: false,
      trackCount: 8,
    })).toBe(false);
  });

  it('allows idle presentation rotation before playback begins', () => {
    expect(shouldRotateMusicPresentation({
      carouselEnabled: true,
      hasPlaybackSession: false,
      isPlaying: false,
      trackCount: 8,
    })).toBe(true);
  });

  it('restarts a one-track queue for previous and next actions', () => {
    expect(resolveAdjacentTrack({ currentIndex: 0, direction: 1, trackCount: 1 })).toEqual({
      nextIndex: 0,
      restartCurrent: true,
    });
    expect(resolveAdjacentTrack({ currentIndex: 0, direction: -1, trackCount: 1 })).toEqual({
      nextIndex: 0,
      restartCurrent: true,
    });
  });

  it('describes LOOP consistently as list repeat', () => {
    expect(getMusicPlaybackModeLabel('LOOP')).toBe('列表循环');
    expect(getMusicPlaybackModeLabel('CAROUSEL')).toBe('轮播展示');
  });

  it('keeps Play deterministic and Shuffle explicit when starting a playlist', () => {
    expect(resolveMusicStartIndex({ trackCount: 5, currentIndex: 3, shuffle: false, randomValue: 0.9 })).toBe(0);
    expect(resolveMusicStartIndex({ trackCount: 5, currentIndex: 3, shuffle: true, randomValue: 0 })).toBe(0);
    expect(resolveMusicStartIndex({ trackCount: 5, currentIndex: 0, shuffle: true, randomValue: 0 })).toBe(1);
    expect(resolveMusicStartIndex({ trackCount: 1, currentIndex: 0, shuffle: true, randomValue: 0.7 })).toBe(0);
  });

  it('never guesses artist metadata from punctuation in a title', () => {
    expect(resolveMusicTrackPresentation({
      title: '杨千嬅 - 假如让我说下去',
      artist: '未知艺术家',
    })).toEqual({ title: '杨千嬅 - 假如让我说下去', artist: '' });

    expect(resolveMusicTrackPresentation({
      title: 'Love - Hate',
      artist: '',
    })).toEqual({ title: 'Love - Hate', artist: '' });

    expect(resolveMusicTrackPresentation({
      title: 'Artist — Song',
      artist: 'Recorded Artist',
    })).toEqual({ title: 'Artist — Song', artist: 'Recorded Artist' });
  });
});

describe('music modal product quality gates', () => {
  it('isolates immersive lyric and queue row construction from unchanged timeline frames', () => {
    const persistentDockSource = providerSource.slice(providerSource.indexOf('function PersistentMusicDock'));
    expect({
      memoizedLyricLeaf: providerSource.includes('const MemoizedMusicLyricRows = memo('),
      memoizedQueueLeaf: providerSource.includes('const MemoizedMusicQueueRows = memo('),
      mobileAndDesktopLyricLeaves: (persistentDockSource.match(/<MemoizedMusicLyricRows/g) ?? []).length,
      mobileAndDesktopQueueLeaves: (persistentDockSource.match(/<MemoizedMusicQueueRows/g) ?? []).length,
      rawLyricMapInDock: persistentDockSource.includes('lyrics.map('),
      rawQueueMapInDock: persistentDockSource.includes('tracks.map('),
    }).toEqual({
      memoizedLyricLeaf: true,
      memoizedQueueLeaf: true,
      mobileAndDesktopLyricLeaves: 2,
      mobileAndDesktopQueueLeaves: 2,
      rawLyricMapInDock: false,
      rawQueueMapInDock: false,
    });
  });

  it('supports continuous pointer scrubbing with a 44px hit target', () => {
    expect(providerSource).toContain('onPointerDown={interactive ? handlePointerDown : undefined}');
    expect(providerSource).toContain('onPointerMove={interactive ? handlePointerMove : undefined}');
    expect(providerSource).toContain('setPointerCapture');
    expect(providerSource).toContain('min-h-11');
  });

  it('lets a read-only progress rail pass horizontal gestures through to its parent carousel', () => {
    const seekBarSource = sourceBetween(providerSource, 'export function SeekBar', 'function pickRandomIndex');

    expect(seekBarSource).toContain('interactive = true');
    expect(seekBarSource).toContain("role={interactive ? 'slider' : 'progressbar'}");
    expect(seekBarSource).toContain('tabIndex={interactive ? 0 : undefined}');
    expect(seekBarSource).toContain('onPointerDown={interactive ? handlePointerDown : undefined}');
    expect(seekBarSource).toContain("!interactive && 'pointer-events-none touch-auto cursor-default'");
  });

  it('cancels or loses pointer capture without committing a stale seek position', () => {
    const seekBarSource = sourceBetween(providerSource, 'export function SeekBar', 'function pickRandomIndex');
    const pointerFinishSource = sourceBetween(
      seekBarSource,
      'const finishPointerScrub',
      'const handleLostPointerCapture',
    );
    const lostCaptureSource = sourceBetween(
      seekBarSource,
      'const handleLostPointerCapture',
      'return (',
    );

    expect(pointerFinishSource).toContain('if (commit) seekFromClientX(event.clientX);');
    expect(pointerFinishSource).toContain('activePointerRef.current = null;');
    expect(lostCaptureSource).toContain('activePointerRef.current = null;');
    expect(lostCaptureSource).not.toContain('seekFromClientX');
    expect(seekBarSource).toContain('onPointerUp={interactive ? (event) => finishPointerScrub(event, true) : undefined}');
    expect(seekBarSource).toContain('onPointerCancel={interactive ? (event) => finishPointerScrub(event, false) : undefined}');
    expect(seekBarSource).toContain('onLostPointerCapture={interactive ? handleLostPointerCapture : undefined}');
  });

  it('does not mistake an in-surface pointerdown for an outside click during layout transitions', () => {
    const outsidePointerSource = sourceBetween(
      providerSource,
      'if (!compactOpen || expanded) return;',
      'setLyricsFollowing(true);',
    );

    expect(outsidePointerSource).toContain("event.target.closest('[data-music-compact-player]')");
    expect(outsidePointerSource).toContain('event.composedPath()');
    expect(outsidePointerSource).toContain('shouldCollapseMusicCompactFromPointer({ targetInsideSurface, pathInsideSurface })');
  });

  it('keeps the shared seek language flat, legible, and consistent across time labels', () => {
    const seekBarSource = sourceBetween(providerSource, 'export function SeekBar', 'function pickRandomIndex');
    expect(seekBarSource).not.toContain('linear-gradient');
    expect(seekBarSource).not.toContain('shadow-[0_0_');
    expect(seekBarSource).toContain('bg-[var(--aurora-1)]');
    expect(seekBarSource).toContain('bg-[var(--ink-primary)]');
    expect(seekBarSource).toContain('motion-reduce:transition-none');
    expect(providerSource).not.toContain('formatMusicClock(Math.max(0, duration - progress))');
  });

  it('keeps the immersive dialog lifecycle mobile-only while desktop stays a non-modal island', () => {
    expect(providerSource).toContain('useDialogLifecycle');
    expect(providerSource).not.toContain('if (!expanded || isMobile) return;');
    expect(providerSource).toContain('h-[100dvh]');
    expect(dialogLifecycleSource).toContain("document.documentElement.style.overflow = 'hidden'");
    expect(dialogLifecycleSource).toContain("document.body.style.position = 'fixed'");
    expect(dialogLifecycleSource).toContain('window.scrollTo(0, scrollPosition)');
    expect(providerSource).toContain("surface === 'immersive' && isMobile");
    expect(providerSource).toContain('open: expanded && isMobile');
    expect(providerSource).toContain('containerRef: mobileDialogRef');
    expect(providerSource).toContain('initialFocusRef: mobileDialogRef');
    expect(providerSource).toContain('returnFocusRef: compactIdentityTriggerRef');
    expect(providerSource).not.toContain('returnFocusRef: surfaceTriggerRef');
    expect(providerSource).not.toContain('desktopDialogRef');
    expect(providerSource).not.toContain('data-music-desktop-immersive');
    expect(providerSource).toContain('ref={surfaceTriggerRef}');
    expect(providerSource).toContain('ref={compactIdentityTriggerRef}');
    expect(providerSource).toContain('data-music-compact-focus-target');
    expect(providerSource).toContain("pendingTarget === 'compact'");
    expect(providerSource).toContain('? compactIdentityTriggerRef.current');
    expect(providerSource).toContain(': surfaceTriggerRef.current');
    expect(dialogLifecycleSource).toContain('previouslyFocused?.isConnected');
    expect(dialogLifecycleSource).toContain('latestReturnFocusRef.current?.current');
    expect(skinSource).toContain('min-[769px]:hidden');
    expect(skinSource).not.toContain('md:hidden');
  });

  it('keeps playback failure visible and recoverable', () => {
    expect(providerSource).toContain('playbackError');
    expect(providerSource).toContain('重新尝试');
    expect(providerSource).toContain('role="alert"');
    expect(providerSource).toContain("playbackError ? '重新尝试播放'");
    expect(providerSource).toContain("isBuffering ? '取消载入'");
    expect(providerSource).not.toContain('playbackError ? <RefreshCw');
  });

  it('keeps the current track in the compact player accessible name and mobile live region', () => {
    expect(providerSource).toContain('`打开沉浸播放器：${currentPresentation.title}，${compactArtistLabel}`');
    expect(providerSource).toContain('`收起播放器：${currentPresentation.title}，${compactArtistLabel}`');
    expect(providerSource).toContain('`${currentPresentation.title} · ${currentIndex + 1} / ${tracks.length}`');
  });

  it('only lets keyboard focus pause compact-player auto collapse', () => {
    expect(providerSource).toContain("const compactInputModalityRef = useRef<'keyboard' | 'pointer'>('keyboard');");
    expect(providerSource).toContain("if (surface === 'compact' && compactInputModalityRef.current === 'keyboard') setCompactFocusWithin(true);");
    expect(providerSource).toContain("compactInputModalityRef.current = 'pointer';");
    expect(providerSource).toContain('setCompactFocusWithin(false);');
  });

  it('opens actionable compact recovery only when no in-page playback surface is available', () => {
    expect(providerSource).toContain('const previousPlaybackErrorRef = useRef<string | null>(null);');
    expect(providerSource).toContain('if (playbackError && !previousPlaybackErrorRef.current && !playbackSurfaceVisible)');
    expect(providerSource).toContain('`播放失败，打开迷你播放器重试：${currentPresentation.title}`');
  });

  it('keeps desktop compact and expanded playback in the same persistent island', () => {
    expect(providerSource).not.toContain('<AnimatePresence initial={false} mode="wait"');
    expect(providerSource).toContain("const floatingDensity = surface === 'orb'");
    expect(providerSource).toContain("surface === 'immersive' && !isMobile");
    expect(providerSource).toContain('data-music-floating-density={floatingDensity}');
    expect(providerSource).not.toContain('key="music-desktop-immersive"');
    expect(providerSource).not.toContain('data-music-desktop-immersive');
  });

  it('gives the skin dialog an explicit close action and modal lifecycle', () => {
    expect(skinSource).toContain('useDialogLifecycle');
    expect(skinSource).toContain('useReducedMotion');
    expect(skinSource).toContain('aria-label="关闭音乐皮肤"');
    expect(skinSource).toContain('aria-modal={!isDesktop}');
  });

  it('keeps every mobile skin control at least 44px through the 768px breakpoint', () => {
    expect(skinSource).toContain('h-11 w-11');
    expect(skinSource).toContain('h-11 w-12');
    expect(skinSource).toContain('min-[769px]:h-9');
    expect(skinSource).not.toMatch(/\bsm:(?:h|w|min-h)-(?:8|9|10)\b/);
  });

  it('keeps the desktop skin popover inside short viewports', () => {
    expect(skinSource).toContain('popoverRef.current?.getBoundingClientRect()');
    expect(skinSource).toContain('window.innerHeight - 24');
    expect(skinSource).toContain('maxHeight: availableHeight');
    expect(skinSource).toContain('min-[769px]:max-h-[calc(100dvh-1.5rem)]');
  });

  it('uses a labeled ambient orb before progressively disclosing the compact player', () => {
    expect(providerSource).toContain('data-music-playback-orb');
    expect(providerSource).toContain('data-music-compact-player');
    expect(providerSource).toContain('打开迷你播放器');
    expect(providerSource).toContain('进入音乐大厅');
    expect(providerSource).toContain('打开沉浸播放器');
  });

  it('uses a persistent three-density public island with the admin player motion contract', () => {
    const floatingSource = sourceBetween(
      providerSource,
      '<AnimatePresence initial={false} onExitComplete={focusPendingSurface}>',
      '<AnimatePresence initial={false}>\n      {surface === \'immersive\' && isMobile',
    );
    const islandRootCss = sourceBetween(
      globalsSource,
      '.music-floating-player-root {',
      '.music-floating-player-surface {',
    );
    const islandCoverCss = sourceBetween(
      globalsSource,
      '.music-island-cover {',
      '.music-island-cover-ring {',
    );
    const islandClipCss = sourceBetween(
      globalsSource,
      '.music-island-cover-image {',
      '.music-island-cover-pixels {',
    );
    const islandPixelsCss = sourceBetween(
      globalsSource,
      '.music-island-cover-pixels {',
      '.music-island-identity {',
    );

    expect(providerSource).toContain('data-music-floating-shell');
    expect(providerSource).toContain('data-music-floating-root');
    expect(providerSource).toContain('data-music-floating-density={floatingDensity}');
    expect(floatingSource).toContain("surface === 'orb' || surface === 'compact' || (surface === 'immersive' && !isMobile)");
    expect(floatingSource).toContain('music-floating-player-root pointer-events-none fixed');
    expect(floatingSource).toContain('data-music-island-cover');
    expect(floatingSource).toContain('data-music-island-cover-pixels');
    expect(floatingSource).toContain('data-music-island-identity');
    expect(floatingSource).toContain('data-music-island-transport');
    expect(floatingSource).toContain('data-music-island-progress');
    expect(floatingSource).toContain('data-music-island-actions');
    expect(floatingSource).toContain('data-music-island-expanded-detail');
    expect(floatingSource.match(/data-music-island-cover/g)).toHaveLength(2);
    expect(floatingSource.match(/data-music-island-identity/g)).toHaveLength(1);
    expect(floatingSource.match(/data-music-island-transport/g)).toHaveLength(1);
    expect(floatingSource.match(/data-music-island-progress/g)).toHaveLength(1);
    expect(floatingSource).not.toContain('mode="popLayout"');
    expect(floatingSource).not.toContain('key="compact-content"');
    expect(floatingSource).not.toContain('layoutId=');
    expect(floatingSource).not.toContain('layoutDependency={surface}');
    expect(floatingSource).not.toContain('layout\n');
    expect(floatingSource).not.toContain('h-[16.5rem]');
    expect(providerSource).not.toContain('const FLOATING_ORB_RADIUS');
    expect(providerSource).not.toContain('const FLOATING_COMPACT_RADIUS');
    expect(providerSource).not.toContain('const floatingShellRadius');
    expect(islandRootCss).toContain('width var(--dur-flow) var(--ease-out)');
    expect(islandRootCss).toContain('height var(--dur-flow) var(--ease-out)');
    expect(globalsSource).toContain("[data-music-floating-density='minimized']");
    expect(globalsSource).toContain("[data-music-floating-density='compact']");
    expect(globalsSource).toContain("[data-music-floating-density='expanded']");
    expect(globalsSource).toContain('width: 22.5rem;');
    expect(globalsSource).toContain('width: min(32.5rem, calc(100vw - 4rem));');
    expect(globalsSource).toContain('height: 8.5rem;');
    expect(globalsSource).toContain('height: 23.75rem;');
    expect(islandCoverCss).toContain('overflow: visible;');
    expect(islandClipCss).toContain('overflow: clip;');
    expect(islandClipCss).not.toContain('contain: paint;');
    expect(islandClipCss).not.toContain('transform: translateZ(0);');
    expect(islandPixelsCss).toContain('width: 7.5rem;');
    expect(islandPixelsCss).toContain('height: 7.5rem;');
    expect(islandPixelsCss).toContain('transition: transform var(--dur-flow) var(--ease-out);');
    expect(islandPixelsCss).toContain('will-change: transform;');
    expect(providerSource).toContain('data-music-density-toggle');
    expect(providerSource).toContain('h-11 w-11');
    expect(providerSource).not.toContain('data-music-compact-drag-handle');
    expect(providerSource).not.toContain('data-music-player-grabber');
    expect(providerSource).not.toContain('<span className="h-1 w-9 rounded-full');
    expect(floatingSource).not.toMatch(/className="[^"]*\bh-1\b[^"]*\bw-(?:8|9|10|12)\b[^"]*rounded-full/);
  });

  it('keeps the browser motion gate reproducible from a clean checkout', () => {
    expect(rootPackage.devDependencies?.playwright).toBeTruthy();
    expect(motionVerifierSource).toContain(
      "const FIXTURE_COVER_PATH = path.join(REPO_ROOT, '.agent/rules/assets/dark-theme-preview.png');",
    );
    expect(motionVerifierSource).toContain("requestPath.endsWith('/__music-player-fixture__/cover.png')");
    expect(motionVerifierSource).toContain('body: await readFile(FIXTURE_COVER_PATH)');
    expect(motionVerifierSource).not.toContain('/api/uploads/thumbnails/audio/');
    expect(motionVerifierSource).toContain("const rootSelector = '[data-music-floating-root]';");
    expect(motionVerifierSource).toContain(
      "density: root?.getAttribute('data-music-floating-density') || ''",
    );
  });

  it('keeps persistent players out of full-screen routes without reserving document space', () => {
    expect(providerSource).toContain("pathname.startsWith('/reader/')");
    expect(providerSource).toContain('if (routeBlocksPlayerSurface && expanded) setExpanded(false)');
    expect(providerSource).not.toContain('data-music-mini-player-spacer');
    expect(providerSource).not.toContain('data-music-desktop-dock');
  });

  it('keeps mobile failure announcements available from the MiniPlayer', () => {
    expect(providerSource).toContain('音乐播放失败，请打开播放器重试。');
    expect(providerSource).toContain('<span role="alert" className="sr-only">');
  });

  it('gives mobile Now Playing space to artwork and standard transport controls, not an empty stage', () => {
    expect(providerSource).toContain('data-now-playing-artwork');
    expect(providerSource).toContain('music-mobile-player-transport');
    expect(providerSource).toContain('music-mobile-player-volume');
    expect(providerSource).toContain('music-mobile-player-tools');
    expect(providerSource).not.toContain('music-mobile-player-stage');
    expect(providerSource).not.toContain('>Now Playing<');
    expect(providerSource).not.toContain('音乐大厅\n              </Link>');
  });

  it('sizes mobile hero artwork from its pane instead of the viewport', () => {
    const artworkSource = sourceBetween(
      providerSource,
      'data-now-playing-artwork',
      'data-now-playing-track-info',
    );
    const artworkClassSource = sourceBetween(
      artworkSource,
      'className={cn(',
      'sizes=',
    );

    expect(artworkClassSource).toContain("'flex justify-center'");
    expect(artworkClassSource).toContain(
      "currentCover\n                    ? 'music-mobile-player-artwork-frame",
    );
    expect(artworkClassSource).toContain(
      "music-mobile-player-artwork w-[min(100cqw,100cqh,40dvh,23rem)]",
    );
    expect(artworkClassSource).toContain("w-[min(42%,10rem)]");
    expect(artworkClassSource).not.toMatch(/\b[\d.]+(?:d|s|l)?vw\b/);
    expect(globalsSource).toMatch(
      /\.music-mobile-player-artwork-frame\s*\{[\s\S]*?container-type:\s*size;/,
    );
  });

  it('compacts non-essential mobile player chrome on very short screens', () => {
    const shortMobileSource = sourceBetween(
      globalsSource,
      '@media (max-width: 768px) and (max-height: 640px)',
      '.music-floating-player-root',
    );

    expect(providerSource).toContain('data-mobile-player-density-toggle');
    expect(providerSource).not.toContain('data-mobile-player-drag-handle');
    expect(shortMobileSource).toMatch(
      /\[data-mobile-player-header\][\s\S]*?min-height:\s*2\.75rem;/,
    );
    expect(shortMobileSource).toMatch(
      /\.music-mobile-player-artwork-frame[\s\S]*?flex:\s*0 0 10rem;[\s\S]*?min-height:\s*10rem;/,
    );
    expect(shortMobileSource).toMatch(
      /\[data-now-playing-active-line\][\s\S]*?display:\s*none;/,
    );
    expect(shortMobileSource).toMatch(
      /\.music-mobile-player-seek[\s\S]*?margin-top:\s*0\.75rem;/,
    );
    expect(shortMobileSource).toMatch(
      /\.music-mobile-player-transport,[\s\S]*?\.music-mobile-player-volume[\s\S]*?margin-top:\s*0\.25rem;/,
    );
    expect(shortMobileSource).toMatch(
      /\.music-mobile-player-tools[\s\S]*?margin-top:\s*0\.25rem;[\s\S]*?padding-top:\s*0\.25rem;/,
    );
  });

  it('keeps the mobile cover wash pinned behind the full sheet', () => {
    expect(providerSource).toContain(
      'music-mobile-player-backdrop pointer-events-none absolute inset-0 overflow-hidden',
    );
    expect(globalsSource).toMatch(
      /\.music-mobile-player-sheet > :not\(\.music-mobile-player-backdrop\)\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*1;/,
    );
    expect(globalsSource).toMatch(
      /\.music-mobile-player-sheet > \.music-mobile-player-backdrop\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?z-index:\s*0;/,
    );
  });

  it('lets long mobile queue names shrink and truncate before the count', () => {
    const queueHeaderSource = sourceBetween(
      providerSource,
      'data-mobile-queue-pane',
      '<MemoizedMusicQueueRows',
    );

    expect(queueHeaderSource).toContain('<div className="min-w-0">');
    expect(queueHeaderSource).toContain('className="mt-1 truncate text-xl');
    expect(queueHeaderSource).toContain('title={playlistName}');
    expect(queueHeaderSource).toContain('className="shrink-0 text-xs');
  });

  it('uses one restrained music control language instead of glow, lift, and hard press scaling', () => {
    expect(globalsSource).toContain('.music-pill-button');
    expect(globalsSource).toContain('.music-icon-button');
    expect(globalsSource).toContain('.music-transport-button');
    expect(globalsSource).not.toContain('.music-control-button::after');
    expect(globalsSource).not.toContain('scale(0.91)');
    expect(globalsSource).not.toContain('translate3d(0, -1px, 0)');
  });

  it('uses a restrained progress-aware orb without reviving the retired liquid blob system', () => {
    for (const retiredStyle of [
      '.music-eq-bar',
      'music-floating-remove',
      'music-liquid-orb',
      'music-liquid-core',
      'music-liquid-flow',
      'music-liquid-lobe',
      'music-liquid-play-icon',
      '@keyframes music-remove-zone-enter',
    ]) {
      expect(globalsSource).not.toContain(retiredStyle);
    }
    expect(globalsSource).toContain('.music-playback-orb');
    expect(globalsSource).toContain('.music-playback-orb__progress');
    expect(globalsSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globalsSource).toContain('@keyframes music-eq-pulse');
    expect(globalsSource).toContain('.music-wave-mark > span');
    expect(providerSource).toContain('dragControls={immersiveDragControls}');
    expect(providerSource).toContain('style={{ y: immersiveDragY }}');
    expect(providerSource).toContain('style={{ opacity: mobileBackdropOpacity }}');
    expect(providerSource).toContain('onClick={closeExpandedPlayer}');
    expect(globalsSource).toContain('.music-mobile-player-sheet');
    expect(globalsSource).toContain('[data-music-skin] .animate-spin');
  });

  it('centralizes artwork, control, and panel curvature instead of mixing local radius guesses', () => {
    expect(musicSkinSource).toContain('--music-radius-artwork-sm: var(--radius-sm, 0.5rem)');
    expect(musicSkinSource).toContain('--music-radius-artwork-lg: var(--radius-md, 0.75rem)');
    expect(musicSkinSource).toContain('--music-radius-control: var(--radius-md, 0.75rem)');
    expect(musicSkinSource).toContain('--music-radius-panel: var(--radius-lg, 1rem)');
    expect(globalsSource).toContain('.music-artwork[data-size="hero"]');
    expect(providerSource).toContain('size="hero"');
    expect(providerSource).not.toContain('rounded-[1.6rem]');
    expect(providerSource).not.toContain('rounded-[1.35rem]');
  });

  it('keeps Now Playing transport visually bare while preserving large hit targets', () => {
    expect(providerSource).toContain('data-now-playing-transport');
    expect(providerSource).toContain('music-transport-button');
    expect(providerSource).toContain('music-transport-button--primary');
    expect(providerSource).toContain('<span className="sr-only">随机播放</span>');
    expect(providerSource).toContain('<span className="sr-only">歌词</span>');
    expect(providerSource).toContain('<span className="sr-only">播放队列</span>');
    expect(providerSource).toContain('music-volume-range h-11');
    expect(globalsSource).toContain('.music-volume-range::-webkit-slider-runnable-track');
  });

  it('uses a system-rounded floating surface and safe narrow-screen insets', () => {
    expect(providerSource).toContain(
      'max-[360px]:left-[max(0.75rem,env(safe-area-inset-left))]',
    );
    expect(providerSource).toContain(
      'max-[360px]:right-[max(0.75rem,env(safe-area-inset-right))]',
    );
    expect(providerSource).toContain('music-floating-player-surface');
    expect(providerSource).toContain('music-island-cover-image');
    expect(providerSource).not.toContain('music-desktop-player-artwork-frame');
    expect(globalsSource).toMatch(/\.music-floating-player-surface\s*\{[\s\S]*?border-radius:\s*var\(--music-radius-floating\);/);
    expect(globalsSource).toMatch(/\.music-pill-button\s*\{[\s\S]*?border-radius:\s*var\(--music-radius-control\);/);
  });

  it('keeps island transport symmetric instead of stretching a dock across the page', () => {
    expect(providerSource).toContain('data-music-island-transport');
    expect(providerSource).toContain('grid-cols-[44px_48px_44px]');
    expect(providerSource).not.toContain('data-music-desktop-dock');
    expect(providerSource).not.toContain('fixed inset-x-0 bottom-0');
  });

  it('makes lyrics and queue real in-player panes instead of dead anchor links', () => {
    expect(providerSource).toContain("setMobilePane('lyrics')");
    expect(providerSource).toContain("setMobilePane('queue')");
    expect(providerSource).toContain('data-mobile-lyrics-pane');
    expect(providerSource).toContain('data-mobile-queue-pane');
    expect(providerSource).toContain('mobilePaneHeadingRef.current?.focus({ preventScroll: true })');
    expect(providerSource).not.toContain('href="/music#lyrics"');
  });

  it('respects reduced motion for lyric following and active-line transitions', () => {
    expect(providerSource.match(/behavior: prefersReducedMotion \? 'auto' : 'smooth'/g)).toHaveLength(2);
    expect(providerSource).not.toContain('scroll-smooth');
    expect(providerSource.match(/motion-reduce:translate-x-0 motion-reduce:transition-none/g)).toHaveLength(1);
    expect(providerSource.match(/<MemoizedMusicLyricRows/g)).toHaveLength(2);
    expect(adminPlayerSource).toContain("behavior: prefersReducedMotion ? 'auto' : 'smooth'");
  });

  it('makes current queue rows pause or retry instead of restarting the track', () => {
    expect(providerSource.match(/const active = hasPlaybackSession && currentIndex === index;/g)).toHaveLength(1);
    expect(providerSource.match(/<MemoizedMusicQueueRows/g)).toHaveLength(2);
    expect(providerSource).not.toContain('onClick={() => value.playIndex(index)}');
    expect(providerSource.match(/else if \(playbackError\) \{/g)).toHaveLength(1);
    expect(providerSource).toContain('`取消载入 ${presentation.title}`');
    expect(providerSource).toContain('`暂停 ${presentation.title}`');
  });

  it('uses one tabbed desktop detail panel instead of stacking lyrics and queue cards', () => {
    expect(providerSource).toContain("const [desktopPane, setDesktopPane] = useState<'lyrics' | 'queue'>('lyrics')");
    expect(providerSource).toContain('role="tablist" aria-label="播放详情"');
    expect(providerSource).toContain('role="tabpanel" aria-labelledby="desktop-lyrics-tab"');
    expect(providerSource).toContain('role="tabpanel" aria-labelledby="desktop-queue-tab"');
    expect(providerSource).toContain("tabIndex={desktopPane === 'lyrics' ? 0 : -1}");
    expect(providerSource).toContain("tabIndex={desktopPane === 'queue' ? 0 : -1}");
    expect(providerSource).toContain("event.key === 'ArrowRight'");
    expect(providerSource).toContain("event.key === 'Home'");
  });

  it('starts explicit Play and Shuffle modes atomically and keeps tablet artwork proportional', () => {
    expect(providerSource).toContain('setShuffleState(false);');
    expect(providerSource).toContain('const playShuffled = useCallback');
    expect(providerSource).toContain('resolveMusicStartIndex');
    expect(providerSource).toContain('data-size={size}');
    expect(providerSource).toContain('size="hero"');
  });

  it('keeps desktop expansion bounded to a floating card in short viewports', () => {
    expect(providerSource).not.toContain('music-desktop-player-dialog');
    expect(providerSource).not.toContain('music-desktop-player-layout');
    expect(globalsSource).toContain('@media (min-width: 769px) and (max-height: 540px)');
    expect(globalsSource).toMatch(
      /\[data-music-floating-density='expanded'\]\.music-floating-player-root[\s\S]*?height:\s*min\(23\.75rem, calc\(100dvh - 2rem\)\);/,
    );
  });

  it('reduces the expanded detail pane before sacrificing transport in short landscape viewports', () => {
    const landscapeSource = sourceBetween(
      globalsSource,
      '@media (min-width: 769px) and (max-height: 540px)',
      '.profile-card-stack-frame',
    );

    expect(landscapeSource).toMatch(
      /\.music-island-expanded-detail[\s\S]*?top:\s*7\.25rem;[\s\S]*?bottom:\s*5\.75rem;/,
    );
    expect(landscapeSource).toContain('.music-island-transport');
    expect(landscapeSource).toContain('.music-island-progress');
    expect(providerSource).toContain('data-music-island-expanded-detail');
  });

  it('keeps admin playback controls in the same neutral, stable transport language', () => {
    expect(adminMusicPageSource).toContain('<SkipBack className="h-5 w-5 fill-current"');
    expect(adminMusicPageSource).toContain('<SkipForward className="h-5 w-5 fill-current"');
    expect(adminPlayerSource).toContain("playerDensity === 'compact' ? 'h-[18px] w-[18px]' : 'h-5 w-5'");
    expect(adminPlayerSource.match(/className=\{cn\('fill-current'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(adminMusicPageSource).not.toContain('stageIsCurrent && playbackError ? <RefreshCw');
    expect(adminPlayerSource).not.toContain('playbackError ? <RefreshCw');
    expect(adminMusicPageSource).not.toContain('active:scale-[0.97]');
    expect(adminMusicPageSource).not.toContain('active:scale-[0.98]');
    expect(adminMusicPageSource).not.toContain('hover:scale-[1.03]');
    expect(adminPlayerSource).not.toContain('hover:scale-[1.03]');
    expect(adminMusicPageSource).toContain('bg-[var(--ink-primary)] text-[var(--bg-void)]');
    expect(adminPlayerSource).toContain('bg-[var(--ink-primary)] text-[var(--bg-void)]');
    expect(adminPlayerSource).toContain("bg-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]");
    expect(adminMusicPageSource).toContain('<ArrowUp className="h-4 w-4"');
    expect(adminMusicPageSource).toContain('<ArrowDown className="h-4 w-4"');
  });

  it('keeps the large admin audition stage scoped to display settings and semantically honest', () => {
    expect(adminMusicPageSource).toContain("setDockSuppressed(activeTab === 'display')");
    expect(adminMusicPageSource).toContain("{activeTab === 'display' && (");
    expect(adminMusicPageSource).toContain('id="admin-module-panel-display"');
    expect(adminMusicPageSource).toContain('<AdminMusicTimelineSlot>');
    expect(adminMusicPageSource).toContain('{(timeline) => renderHallStage(timeline)}');
    expect(adminMusicPageSource).toContain("role={stageIsCurrent ? 'slider' : undefined}");
    expect(adminMusicPageSource).toContain('disabled={!stageTrack || !stageIsCurrent}');
    expect(adminMusicPageSource).toContain('if (!stageIsCurrent) return;');
    expect(adminMusicPageSource).toContain("aria-label={stageIsCurrent ? '调整试听进度' : '播放后可调整进度'}");
    expect(adminMusicPageSource).not.toContain("'开始试听'");
    expect(adminMusicPageSource).toContain('rounded-[var(--music-radius-artwork-lg)]');
    expect(adminMusicPageSource).toContain('relative isolate overflow-hidden rounded-[var(--music-radius-detail)]');
    expect(adminMusicPageSource).not.toContain('animate-ping');
    expect(adminMusicPageSource).not.toContain("stagePlaying && 'animate-spin");
  });

  it('keeps mobile playlist rows readable by moving secondary actions behind one menu', () => {
    expect(adminMusicPageSource).toContain('function PlaylistTrackActionMenu');
    expect(adminMusicPageSource).toContain('aria-haspopup="menu"');
    expect(adminMusicPageSource).toContain('role="menu"');
    expect(adminMusicPageSource).toContain('min-[769px]:hidden');
    expect(adminMusicPageSource).toContain('hidden items-center gap-2 min-[769px]:flex');
    expect(adminMusicPageSource).toContain("'[role=\"menuitem\"]:not(:disabled)'");
    expect(adminMusicPageSource).toContain("event.key === 'ArrowDown'");
    expect(adminMusicPageSource).toContain("event.key === 'ArrowUp'");
    expect(adminMusicPageSource).toContain("event.key === 'Home'");
    expect(adminMusicPageSource).toContain("event.key === 'End'");
    expect(adminMusicPageSource).toContain("event.key === 'Tab'");
    expect(adminMusicPageSource).toContain("document.addEventListener('pointerdown', onPointerDown)");
    expect(adminMusicPageSource).not.toContain("document.addEventListener('mousedown', onPointerDown)");
  });

  it('keeps the admin floating player compact, tokenized, and synchronized with its selected skin', () => {
    const adminSurfaceSource = sourceBetween(
      adminPlayerSource,
      'data-admin-player-surface',
      'data-admin-player-morph-content',
    );

    expect(adminPlayerSource).toContain('const ADMIN_PLAYER_MINIMIZED_RADIUS = 30;');
    expect(adminPlayerSource).toContain('const ADMIN_PLAYER_MOBILE_MINIMIZED_RADIUS = 26;');
    expect(adminPlayerSource).toContain('const ADMIN_PLAYER_PANEL_RADIUS = 24;');
    expect(adminSurfaceSource).toContain('initial={{ borderRadius: playerSurfaceRadius }}');
    expect(adminSurfaceSource).toContain('animate={{ borderRadius: playerSurfaceRadius }}');
    expect(adminSurfaceSource).toContain('borderRadius: spring.soft');
    expect(adminSurfaceSource).not.toContain('rounded-full');
    expect(adminSurfaceSource).not.toContain('rounded-[var(--music-radius-floating)]');
    expect(adminSurfaceSource).not.toContain('rounded-[var(--music-radius-capsule)]');
    expect(adminPlayerSource).toContain('className="admin-player-core-cover"');
    expect(adminPlayerSource).toContain('data-music-skin={musicSkin.value}');
    expect(adminPlayerSource).toContain('data-admin-player-density-toggle');
    expect(adminPlayerSource).toContain('data-admin-player-minimized');
    expect(adminPlayerSource).toContain('data-admin-player-desktop-mini-card');
    expect(adminPlayerSource).toContain('data-admin-player-mobile-orb');
    expect(adminPlayerSource).toContain('data-admin-player-drag-zone');
    expect(adminPlayerSource).not.toContain('data-admin-player-drag-handle');
    expect(adminPlayerSource).not.toContain('data-admin-player-grabber');
    expect(adminPlayerSource).toContain('z-30');
    expect(adminPlayerSource).not.toContain('-top-8');
    expect(adminPlayerSource).toContain('data-admin-player-compact-layout');
    expect(adminPlayerSource).toContain('data-admin-player-expanded-layout');
    expect(adminPlayerSource).toContain('data-admin-player-density={playerDensity}');
    expect(adminPlayerSource).toContain('data-admin-player-morph-content');
    expect(adminPlayerSource.match(/data-admin-player-core-cover/g)).toHaveLength(1);
    expect(adminPlayerSource.match(/data-admin-player-core-identity/g)).toHaveLength(1);
    expect(adminPlayerSource.match(/data-admin-player-core-transport/g)).toHaveLength(1);
    expect(adminPlayerSource.match(/data-admin-player-core-play/g)).toHaveLength(1);
    expect(adminPlayerSource.match(/data-admin-player-core-progress/g)).toHaveLength(1);
    expect(adminPlayerSource).not.toContain('key="minimized"');
    expect(adminPlayerSource).not.toContain('key="compact"');
    expect(adminPlayerSource).not.toContain('key="expanded"');
    expect(adminPlayerSource).toContain('const secondaryMorphTransition = (visible: boolean, enterDelay = 0)');
    expect(adminPlayerSource).toContain('duration: motionDuration.instant / 2');
    expect(adminPlayerSource).toContain('ADMIN_PLAYER_COMPACT_MINIMIZED_ACTION_ENTER_DELAY');
    expect(adminPlayerSource).toContain('ADMIN_PLAYER_EXPANDED_MINIMIZED_ACTION_ENTER_DELAY');
    expect(adminPlayerSource).toContain("const minimizeSourceDensityRef = useRef<AdminPlayerDensity>('compact')");
    expect(adminPlayerSource).toContain("minimizeSourceDensityRef.current === 'expanded'");
    expect(adminPlayerSource).toContain('enterMinimizedDensity(playerDensity)');
    expect(adminPlayerSource).toContain('? { ...transition.quick, delay: enterDelay }');
    expect(adminPlayerSource).toContain(': ADMIN_PLAYER_SECONDARY_EXIT_TRANSITION');
    expect(adminPlayerSource).toContain('const topActionControlClass =');
    expect(adminPlayerSource).not.toMatch(/const topActionControlClass = '[^']*hover:bg/);
    expect(adminIndexSource).toMatch(
      /data-admin-player-density='expanded'] \.admin-player-action-close\s*{\s*right: 5\.5rem;/,
    );
    expect(adminPlayerSource).toContain('<X className="h-[18px] w-[18px]"');
    expect(adminPlayerSource).not.toContain('<ArrowLeft className="h-[18px] w-[18px]"');
    expect(motionVerifierSource).toContain('没有在外壳收拢前及时退场');
    expect(motionVerifierSource).toContain('淡出后再次闪现');
    expect(motionVerifierSource).toContain('与退场控件发生交叉叠加');
    expect(motionVerifierSource).toContain("first.density === 'expanded'");
    expect(adminIndexSource).toContain('grid-template-columns: 2.75rem 3.5rem 2.75rem;');
    expect(adminPlayerSource).toContain('dragConstraints={dockBoundsRef}');
    expect(adminPlayerSource).toContain('originX: 0.5');
    expect(adminPlayerSource).toContain('originY: 1');
    expect(adminPlayerSource).not.toContain('bottom-[max(1rem,env(safe-area-inset-bottom))] z-50');
    expect(adminPlayerSource).not.toContain('data-music-skin="crimson"');
    expect(adminPlayerSource).not.toContain("isPlaying && 'animate-spin");
  });

  it('keeps the persistent admin cover paint layer stable while a larger density shrinks', () => {
    const rootMotionSource = sourceBetween(
      adminPlayerSource,
      'data-admin-music-player-root',
      'data-admin-player-surface',
    );
    const surfaceMotionSource = sourceBetween(
      adminPlayerSource,
      'data-admin-player-surface',
      'data-admin-player-morph-content',
    );
    const coverMotionSource = sourceBetween(
      adminPlayerSource,
      'data-admin-player-core-cover',
      'className="admin-player-core-cover-ring"',
    );
    const rootGeometryCss = sourceBetween(
      adminIndexSource,
      '.admin-music-player-root {',
      ".admin-music-player-root[data-admin-player-density='minimized'] {",
    );
    const coverGeometryCss = sourceBetween(
      adminIndexSource,
      '.admin-player-core-cover {',
      '.admin-player-core-cover-ring {',
    );
    const coverClipCss = sourceBetween(
      adminIndexSource,
      '.admin-player-core-cover-image {',
      '.admin-player-core-cover-pixels {',
    );
    const coverPixelsCss = sourceBetween(
      adminIndexSource,
      '.admin-player-core-cover-pixels {',
      '@media (prefers-reduced-motion: reduce)',
    );
    const coverRingCss = sourceBetween(
      adminIndexSource,
      '.admin-player-core-cover-ring {',
      '.admin-player-core-cover-image {',
    );

    // Density changes must not FLIP-scale the shell and artwork at the same
    // time. The shell may translate, while cover position, geometry, radius and
    // the single raster scale all interpolate on the same CSS clock.
    expect(rootMotionSource).toContain('layout="position"');
    expect(surfaceMotionSource).not.toContain('layoutDependency={playerDensity}');
    expect(coverMotionSource).not.toContain('layout="position"');
    expect(coverMotionSource).not.toContain('layout="preserve-aspect"');
    expect(coverMotionSource).not.toContain('layoutDependency={playerDensity}');
    expect(coverMotionSource).not.toContain('borderRadius:');
    expect(coverMotionSource).not.toContain('borderRadius: spring.soft');
    expect(rootGeometryCss).toContain('width var(--dur-flow) var(--ease-out)');
    expect(rootGeometryCss).toContain('height var(--dur-flow) var(--ease-out)');
    expect(rootGeometryCss).toContain('min-height: 0;');
    expect(rootGeometryCss).toContain('min-height var(--dur-flow) var(--ease-out)');
    expect(rootGeometryCss).toContain('padding var(--dur-flow) var(--ease-out)');
    expect(rootGeometryCss).toContain('--admin-player-cover-radius: 0.875rem;');
    expect(rootGeometryCss).toContain('--admin-player-cover-clip-radius: 0.875rem;');
    expect(coverGeometryCss).toContain('overflow: visible;');
    expect(coverGeometryCss).toContain('border-radius: var(--admin-player-cover-radius);');
    expect(coverGeometryCss).toContain('top var(--dur-flow) var(--ease-out)');
    expect(coverGeometryCss).toContain('left var(--dur-flow) var(--ease-out)');
    expect(coverGeometryCss).toContain('width var(--dur-flow) var(--ease-out)');
    expect(coverGeometryCss).toContain('height var(--dur-flow) var(--ease-out)');
    expect(coverGeometryCss).toContain('border-radius var(--dur-flow) var(--ease-out)');
    expect(coverGeometryCss).not.toContain('will-change: width, height, transform, border-radius;');
    expect(coverRingCss).toContain('border-radius: inherit;');
    expect(coverClipCss).toContain('overflow: clip;');
    expect(coverClipCss).toContain('border-radius: var(--admin-player-cover-clip-radius);');
    expect(coverClipCss).toContain('inset var(--dur-flow) var(--ease-out)');
    expect(coverClipCss).toContain('border-radius var(--dur-flow) var(--ease-out)');
    expect(coverPixelsCss).toContain('transition: transform var(--dur-flow) var(--ease-out);');
    expect(adminIndexSource).toContain(
      '.admin-music-player-root,\n  .admin-player-core-cover,\n  .admin-player-core-cover-image,\n  .admin-player-core-cover-pixels',
    );
    expect(coverClipCss).not.toContain('contain: paint;');
    expect(coverClipCss).not.toContain('transform: translateZ(0);');
    expect(coverClipCss).not.toContain('will-change: transform;');
    expect(coverClipCss).not.toContain('backface-visibility: hidden;');
    expect(coverClipCss).not.toContain('-webkit-backface-visibility: hidden;');
    expect(adminPlayerSource).toContain('data-admin-player-cover-pixels');
    expect(adminPlayerSource).not.toContain('className="h-full w-full select-none object-cover"');
    expect(adminIndexSource).toContain('--admin-player-cover-raster-size: 6rem;');
    expect(adminIndexSource).toContain('--admin-player-cover-raster-scale: 0.5;');
    expect(coverPixelsCss).toContain('width: var(--admin-player-cover-raster-size);');
    expect(coverPixelsCss).toContain('height: var(--admin-player-cover-raster-size);');
    expect(coverPixelsCss).toContain(
      'transform: translateZ(0) scale(var(--admin-player-cover-raster-scale));',
    );
    expect(adminIndexSource).toContain('--admin-player-cover-raster-size: 7.5rem;');
    expect(adminIndexSource).toContain('--admin-player-cover-raster-scale: 0.4333333333;');
    expect(adminIndexSource).toContain('--admin-player-cover-raster-scale: 0.3666666667;');
    expect(adminIndexSource).toContain('--admin-player-cover-radius: 1.125rem;');
    expect(adminIndexSource).toContain('--admin-player-cover-radius: 1.625rem;');
    expect(adminIndexSource).toContain('--admin-player-cover-radius: 1.375rem;');
    expect(adminIndexSource).toContain('--admin-player-cover-clip-radius: 1.125rem;');
    expect(adminIndexSource).toContain('--admin-player-cover-clip-radius: 1.5rem;');
    expect(adminIndexSource).toContain('--admin-player-cover-clip-radius: 1.375rem;');
    expect(motionVerifierSource).toContain('layoutWidth: element.offsetWidth');
    expect(motionVerifierSource).toContain('expectedCoverRasterSize');
    expect(motionVerifierSource).toContain('外壳发生了投影缩放');
    expect(motionVerifierSource).toContain('封面容器发生了二次投影缩放');
    expect(motionVerifierSource).toContain('封面存在重复圆角裁剪层');
    expect(motionVerifierSource).toContain('封面裁剪层被提升为可重分配纹理');
  });

  it('keeps admin player spacing symmetric without reintroducing a top handle', () => {
    expect(adminPlayerSource).toContain('data-admin-player-compact-transport');
    expect(adminPlayerSource).toContain('data-admin-player-compact-actions');
    expect(adminIndexSource).toContain(".admin-music-player-root[data-admin-player-density='compact'] .admin-player-core-cover");
    expect(adminIndexSource).toContain(".admin-music-player-root[data-admin-player-density='compact'] .admin-player-core-progress");
    expect(adminIndexSource).toContain(".admin-music-player-root[data-admin-player-density='expanded'] .admin-player-core-cover");
    expect(adminIndexSource).toContain(".admin-music-player-root[data-admin-player-density='expanded'] .admin-player-expanded-detail");
    expect(adminIndexSource).toContain('width: 22.5rem;');
    expect(adminIndexSource).toContain('padding: 0.125rem 0.25rem;');
    expect(adminPlayerSource).toContain('data-admin-player-surface');
    expect(adminPlayerSource).toContain('data-admin-player-mini-cover');
    expect(adminPlayerSource).toContain('data-admin-player-mini-title');
    expect(adminPlayerSource).toContain('data-admin-player-mini-play');
    expect(adminPlayerSource).toContain('data-admin-player-compact-identity');
    expect(adminPlayerSource).not.toContain('layout="size"');
    expect(adminPlayerSource).not.toContain('<span className="h-1 w-9 rounded-full');
  });

  it('contains the admin minimized artwork inside a symmetric capsule', () => {
    const adminSurfaceSource = sourceBetween(
      adminPlayerSource,
      'data-admin-player-surface',
      'data-admin-player-morph-content',
    );

    expect(adminIndexSource).toContain('padding: 0.125rem 0.25rem;');
    expect(adminSurfaceSource).toContain(
      'surface-raised relative h-full w-full overflow-hidden text-[var(--ink-primary)]',
    );
    expect(adminIndexSource).toContain('top: 0.375rem;');
    expect(adminIndexSource).toContain('left: 0.5rem;');
    expect(adminIndexSource).toContain('width: 2.75rem;');
    expect(adminIndexSource).toContain('height: 2.75rem;');
    expect(adminIndexSource).not.toContain('left: -0.');
  });

  it('makes shared admin header tabs semantic and touchable on mobile', () => {
    expect(adminHeaderSource).toContain("role={hasSemanticTabPanels ? 'tablist' : undefined}");
    expect(adminHeaderSource).toContain("role={hasSemanticTabPanels ? 'tab' : undefined}");
    expect(adminHeaderSource).toContain('aria-selected={hasSemanticTabPanels ? active : undefined}');
    expect(adminHeaderSource).toContain('tabIndex={hasSemanticTabPanels ? (active ? 0 : -1) : undefined}');
    expect(adminHeaderSource).toContain('aria-controls={hasSemanticTabPanels ? `${tabPanelIdPrefix}-panel-${item.key}` : undefined}');
    expect(adminIndexSource).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.admin-module-tab-button \{[\s\S]*?height: 2\.75rem;/);
    expect(adminIndexSource).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.admin-module-action-button \{[\s\S]*?min-height: 2\.75rem;/);
    expect(adminIndexSource).toContain('@media (min-width: 640px) and (max-width: 768px)');
    expect(adminIndexSource).toContain('.admin-module-action-button:disabled');
    const legacyCompactRule = adminIndexSource.indexOf('.compact-tabs-module-header .admin-module-tab-button');
    const finalTouchFloor = adminIndexSource.lastIndexOf('/* Shared AdminModuleHeader touch floor.');
    expect(finalTouchFloor).toBeGreaterThan(legacyCompactRule);
    const touchFloorSource = adminIndexSource.slice(finalTouchFloor);
    expect(touchFloorSource).toMatch(/\.compact-tabs-module-header \.admin-module-tab-button \{[\s\S]*height: 2\.75rem;[\s\S]*max-height: 2\.75rem;/);
    expect(touchFloorSource).toMatch(/\.compact-actions-module-header \.admin-module-action-button \{[\s\S]*min-height: 2\.75rem;/);
    expect(touchFloorSource).toMatch(/\.taxonomy-module-header[\s\S]*\.taxonomy-header-create-action \{[\s\S]*min-height: 2\.75rem;/);
    expect(adminMusicPageSource).toContain('id="admin-module-panel-library"');
    expect(adminMusicPageSource).toContain('aria-labelledby="admin-module-tab-library"');
    expect(adminMusicPageSource).toContain('showCurrentLabel={false}');
    expect(adminMusicPageSource).toContain('overflow-x-clip');
    expect(adminMusicPageSource).toContain('tabPanelIdPrefix="admin-module"');
    expect(adminMusicPageSource).toContain('className="music-module-header"');
    expect(adminIndexSource).toContain('.music-module-header .admin-module-action-button');
    expect(adminIndexSource).toContain('.music-module-header .admin-module-tab-indicator');
    expect(adminIndexSource).toMatch(/\.music-module-header \.admin-module-tab-indicator \{[\s\S]*?box-shadow: none;/);
  });

  it('keeps destructive playlist confirmations modal, focus-managed, and visually restrained', () => {
    expect(confirmDialogSource).toContain('role="dialog"');
    expect(confirmDialogSource).toContain('aria-modal="true"');
    expect(confirmDialogSource).toContain("event.key === 'Escape'");
    expect(confirmDialogSource).toContain("event.key !== 'Tab'");
    expect(confirmDialogSource).toContain('previouslyFocusedRef.current?.focus');
    expect(confirmDialogSource).not.toContain('whileHover');
    expect(confirmDialogSource).not.toContain('whileTap');
    expect(confirmDialogSource).not.toContain('iconGlow');
  });
});
