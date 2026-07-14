import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MusicTrack } from '@aetherblog/types';
import {
  ADMIN_PLAYER_AUTO_COLLAPSE_MS,
  ADMIN_PLAYER_GESTURE_DISTANCE_PX,
  ADMIN_PLAYER_GESTURE_VELOCITY_PX_PER_SECOND,
  ADMIN_PLAYER_PAUSED_AUTO_COLLAPSE_MS,
  isAdminPlaybackRequestCurrent,
  parseAdminMusicLyric,
  resolveAdminAdjacentTrack,
  resolveAdminAudioUrl,
  resolveAdminPlayerGesture,
  resolveAdminPlayerAutoCollapseDelay,
  resolveAdminMediaErrorMessage,
  shouldCommitAdminAudioEvent,
} from './adminMusicPlayerState';

const providerSource = readFileSync(
  path.resolve(__dirname, './AdminMusicPlayerProvider.tsx'),
  'utf8'
);

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

  it('collapses on a downward gesture and reserves session termination for an explicit close action', () => {
    expect(resolveAdminPlayerGesture({
      expanded: true,
      deltaX: 0,
      deltaY: ADMIN_PLAYER_GESTURE_DISTANCE_PX,
      velocityX: 0,
      velocityY: 0,
    })).toBe('collapse');
    expect(providerSource).toContain("if (action === 'collapse') setExpanded(false)");
    expect(providerSource).toContain('下滑收起后台播放器');
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
    expect(providerSource).toContain('window.setTimeout(() => setExpanded(false), autoCollapseDelay)');
    expect(providerSource).toContain('[audioUrl, autoCollapseDelay, currentIndex, interactionVersion]');
    expect(providerSource).toMatch(/const playTracks = useCallback\([\s\S]*?setInteractionVersion\(\(version\) => version \+ 1\);/);
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

  it('uses mutually exclusive player densities with one symmetric expanded transport', () => {
    expect(providerSource).toContain('data-admin-player-compact-layout');
    expect(providerSource).toContain('data-admin-player-expanded-layout');
    expect(providerSource).toContain('data-admin-player-transport');
    expect(providerSource).toContain('grid-cols-[44px_56px_44px]');
    expect(providerSource).toContain('gap-3');
    expect(providerSource).toContain('grid w-fit grid-cols-[44px_56px_44px]');
    expect(providerSource).not.toContain('紧凑常驻行');
  });

  it('keeps mobile content away from the screen edge and animates without auto-height layout churn', () => {
    expect(providerSource).toContain('pl-[max(1rem,env(safe-area-inset-left))]');
    expect(providerSource).toContain('pr-[max(1rem,env(safe-area-inset-right))]');
    expect(providerSource).toContain('max-w-[520px]');
    expect(providerSource).toContain('layout="size"');
    expect(providerSource).toContain('mode="popLayout"');
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
    expect(providerSource).toContain('if (dockDraggedRef.current) return');
  });

  it('returns keyboard focus when the persistent player changes density or closes', () => {
    expect(providerSource).toContain('const dockHandleRef = useRef<HTMLButtonElement>(null)');
    expect(providerSource).toContain('const playerReturnFocusRef = useRef<HTMLElement | null>(null)');
    expect(providerSource).toContain('ref={dockHandleRef}');
    expect(providerSource).toContain('focusDockHandle();');
    expect(providerSource).toContain('restorePlayerReturnFocus();');
    expect(providerSource).toContain('if (target?.isConnected) target.focus({ preventScroll: true });');
    expect(providerSource).toContain('const expandedHeadingRef = useRef<HTMLHeadingElement>(null)');
    expect(providerSource).toContain("focusExpandedHeadingOnOpenRef.current = inputModalityRef.current === 'keyboard'");
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
