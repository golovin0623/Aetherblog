import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getMusicPlaybackModeLabel,
  resolveAdjacentTrack,
  resolveMusicTrackPresentation,
  resolveMusicStartIndex,
  shouldRotateMusicPresentation,
} from '../apps/blog/app/components/musicPlayerState';

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

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('music playback policy', () => {
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
  it('supports continuous pointer scrubbing with a 44px hit target', () => {
    expect(providerSource).toContain('onPointerDown={handlePointerDown}');
    expect(providerSource).toContain('onPointerMove={handlePointerMove}');
    expect(providerSource).toContain('setPointerCapture');
    expect(providerSource).toContain('min-h-11');
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

  it('applies the dialog lifecycle to mobile and desktop player surfaces', () => {
    expect(providerSource).toContain('useDialogLifecycle');
    expect(providerSource).not.toContain('if (!expanded || isMobile) return;');
    expect(providerSource).toContain('h-[100dvh]');
    expect(providerSource).toContain('h-[calc(100dvh-2rem)]');
    expect(dialogLifecycleSource).toContain("document.documentElement.style.overflow = 'hidden'");
    expect(dialogLifecycleSource).toContain("document.body.style.position = 'fixed'");
    expect(dialogLifecycleSource).toContain('window.scrollTo(0, scrollPosition)');
    expect(providerSource).toContain('min-[769px]:hidden');
    expect(providerSource).toContain('min-[769px]:block');
    expect(providerSource).toContain('min-[769px]:overflow-hidden');
    expect(providerSource).not.toContain('md:hidden');
    expect(providerSource).toContain('initialFocusRef: isMobile ? mobileDialogRef : desktopDialogRef');
    expect(providerSource).toContain('returnFocusRef: isMobile ? mobilePlayerTriggerRef : desktopPlayerTriggerRef');
    expect(providerSource).toContain('ref={mobilePlayerTriggerRef}');
    expect(providerSource).toContain('ref={desktopPlayerTriggerRef}');
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

  it('uses an informative MiniPlayer instead of an unexplained floating orb', () => {
    expect(providerSource).toContain('data-music-mini-player');
    expect(providerSource).toContain('打开音乐播放器');
    expect(providerSource).not.toContain('music-floating-orb-button');
    expect(providerSource).not.toContain('LiquidMusicOrb');
  });

  it('keeps persistent players out of full-screen routes and reserves page-end space elsewhere', () => {
    expect(providerSource).toContain("pathname.startsWith('/reader/')");
    expect(providerSource).not.toContain('(!expanded && routeBlocksPlayerSurface)');
    expect(providerSource).toContain('if (routeBlocksPlayerSurface && expanded) setExpanded(false)');
    expect(providerSource).toContain('data-music-mini-player-spacer');
    expect(providerSource).toContain('h-[calc(5.5rem+env(safe-area-inset-bottom))]');
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

  it('uses one restrained music control language instead of glow, lift, and hard press scaling', () => {
    expect(globalsSource).toContain('.music-pill-button');
    expect(globalsSource).toContain('.music-icon-button');
    expect(globalsSource).toContain('.music-transport-button');
    expect(globalsSource).not.toContain('.music-control-button::after');
    expect(globalsSource).not.toContain('scale(0.91)');
    expect(globalsSource).not.toContain('translate3d(0, -1px, 0)');
  });

  it('removes the retired floating liquid-orb visual system from global CSS', () => {
    for (const retiredStyle of [
      '.music-eq-bar',
      'music-floating-orb',
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
    expect(globalsSource).toContain('@keyframes music-eq-pulse');
    expect(globalsSource).toContain('.music-wave-mark > span');
    expect(globalsSource).toContain('@keyframes music-sheet-rise');
    expect(globalsSource).toContain('.music-mobile-player-sheet');
    expect(globalsSource).toContain('[data-music-skin] .animate-spin');
  });

  it('centralizes artwork, control, and panel curvature instead of mixing local radius guesses', () => {
    expect(musicSkinSource).toContain('--music-radius-artwork-sm: 0.5rem');
    expect(musicSkinSource).toContain('--music-radius-artwork-lg: 0.75rem');
    expect(musicSkinSource).toContain('--music-radius-control: 0.75rem');
    expect(musicSkinSource).toContain('--music-radius-panel: 1.5rem');
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

  it('uses a true compact MiniPlayer capsule and a bounded desktop artwork row', () => {
    expect(providerSource).toContain('inset-x-5');
    expect(providerSource).toContain('music-mini-player');
    expect(providerSource).toContain('grid-rows-[auto_minmax(0,1fr)_auto]');
    expect(providerSource).toContain('music-desktop-player-artwork-frame');
  });

  it('keeps the desktop dock compact enough for its reserved page-end space', () => {
    expect(providerSource).toContain('data-music-desktop-dock');
    expect(providerSource).toContain('data-music-desktop-dock-progress');
    expect(providerSource).toContain('grid-cols-[48px_minmax(0,1fr)_auto]');
    expect(providerSource).not.toContain('onSeek={seekToPercent} size="sm" className="mt-2"');
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
    expect(providerSource.match(/motion-reduce:translate-x-0 motion-reduce:transition-none/g)).toHaveLength(2);
    expect(adminPlayerSource).toContain("behavior: prefersReducedMotion ? 'auto' : 'smooth'");
  });

  it('makes current queue rows pause or retry instead of restarting the track', () => {
    expect(providerSource.match(/const active = hasPlaybackSession && currentIndex === index;/g)).toHaveLength(2);
    expect(providerSource).not.toContain('onClick={() => value.playIndex(index)}');
    expect(providerSource.match(/else if \(playbackError\) \{/g)).toHaveLength(2);
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

  it('lets short desktop viewports scroll instead of clipping artwork and transport controls', () => {
    expect(providerSource).toContain('music-desktop-player-dialog');
    expect(providerSource).toContain('music-desktop-player-layout');
    expect(globalsSource).toContain('@media (min-width: 769px) and (max-height: 700px)');
    expect(globalsSource).toContain('.music-desktop-player-dialog');
    expect(globalsSource).toContain('min-height: 43rem');
  });

  it('keeps admin playback controls in the same neutral, stable transport language', () => {
    expect(adminMusicPageSource).toContain('<SkipBack className="h-5 w-5 fill-current"');
    expect(adminMusicPageSource).toContain('<SkipForward className="h-5 w-5 fill-current"');
    expect(adminPlayerSource).toContain('<SkipBack className="h-5 w-5 fill-current"');
    expect(adminPlayerSource).toContain('<SkipForward className="h-5 w-5 fill-current"');
    expect(adminMusicPageSource).not.toContain('stageIsCurrent && playbackError ? <RefreshCw');
    expect(adminPlayerSource).not.toContain('playbackError ? <RefreshCw');
    expect(adminMusicPageSource).not.toContain('active:scale-[0.97]');
    expect(adminMusicPageSource).not.toContain('active:scale-[0.98]');
    expect(adminMusicPageSource).not.toContain('hover:scale-[1.03]');
    expect(adminPlayerSource).not.toContain('hover:scale-[1.03]');
    expect(adminMusicPageSource).toContain('bg-[var(--ink-primary)] text-[var(--bg-void)]');
    expect(adminPlayerSource).toContain('bg-[var(--ink-primary)] text-[var(--bg-void)]');
    expect(adminMusicPageSource).toContain('<ArrowUp className="h-4 w-4"');
    expect(adminMusicPageSource).toContain('<ArrowDown className="h-4 w-4"');
  });

  it('keeps the large admin audition stage scoped to display settings and semantically honest', () => {
    expect(adminMusicPageSource).toContain("setDockSuppressed(activeTab === 'display')");
    expect(adminMusicPageSource).toContain("{activeTab === 'display' && (");
    expect(adminMusicPageSource).toContain('id="admin-module-panel-display"');
    expect(adminMusicPageSource).toContain('{renderHallStage()}');
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
    expect(adminPlayerSource).toContain('rounded-[var(--music-radius-panel)]');
    expect(adminPlayerSource).toContain('rounded-[var(--music-radius-artwork-lg)]');
    expect(adminPlayerSource).toContain('data-music-skin={musicSkin.value}');
    expect(adminPlayerSource).toContain('data-admin-player-drag-handle');
    expect(adminPlayerSource).toContain('z-30');
    expect(adminPlayerSource).toContain('-top-8');
    expect(adminPlayerSource).toContain('max-[360px]:grid-cols-[44px_minmax(0,1fr)]');
    expect(adminPlayerSource).toContain('max-[360px]:col-span-2');
    expect(adminPlayerSource).toContain('max-[360px]:grid-cols-[80px_minmax(0,1fr)]');
    expect(adminPlayerSource).not.toContain('bottom-[max(1rem,env(safe-area-inset-bottom))] z-50');
    expect(adminPlayerSource).not.toContain('data-music-skin="crimson"');
    expect(adminPlayerSource).not.toContain("isPlaying && 'animate-spin");
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
