import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createShuffleHistory,
  parseStoredMusicPlayback,
  recordShuffleSelection,
  resolveIdleMusicSeekPreviewPosition,
  resolveRestoredMusicPosition,
  resolveShuffleNavigation,
} from '../apps/blog/app/components/musicPlayerState';

const providerSource = readFileSync(
  path.resolve(__dirname, '../apps/blog/app/components/MusicPlayerProvider.tsx'),
  'utf8'
);

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('music shuffle navigation history', () => {
  it('walks backward and forward through the exact played order', () => {
    let state = createShuffleHistory(2);
    state = recordShuffleSelection(state, 4);
    state = recordShuffleSelection(state, 1);

    const backward = resolveShuffleNavigation({
      state,
      currentIndex: 1,
      direction: -1,
      trackCount: 6,
      randomValue: 0,
    });
    expect(backward).toMatchObject({ nextIndex: 4, restartCurrent: false });

    const forward = resolveShuffleNavigation({
      state: backward.state,
      currentIndex: 4,
      direction: 1,
      trackCount: 6,
      randomValue: 0.99,
    });
    expect(forward).toMatchObject({ nextIndex: 1, restartCurrent: false });
    expect(forward.state.history).toEqual([2, 4, 1]);
  });

  it('does not repeat a track until the current shuffle cycle is exhausted', () => {
    let state = createShuffleHistory(0);
    const first = resolveShuffleNavigation({
      state,
      currentIndex: 0,
      direction: 1,
      trackCount: 4,
      randomValue: 0,
    });
    expect(first.nextIndex).toBe(1);

    state = first.state;
    const second = resolveShuffleNavigation({
      state,
      currentIndex: first.nextIndex,
      direction: 1,
      trackCount: 4,
      randomValue: 0,
    });
    expect(second.nextIndex).toBe(2);
  });

  it('starts a fresh no-repeat cycle while retaining navigation history', () => {
    let state = createShuffleHistory(0);
    for (const expected of [1, 2, 3, 0, 1, 2]) {
      const result = resolveShuffleNavigation({
        state,
        currentIndex: state.history[state.cursor],
        direction: 1,
        trackCount: 4,
        randomValue: 0,
      });
      expect(result.nextIndex).toBe(expected);
      state = result.state;
    }
    expect(state.history).toEqual([0, 1, 2, 3, 0, 1, 2]);

    const previous = resolveShuffleNavigation({
      state,
      currentIndex: 2,
      direction: -1,
      trackCount: 4,
      randomValue: 0,
    });
    expect(previous.nextIndex).toBe(1);
  });

  it('restarts the current track when there is no older shuffle history', () => {
    expect(resolveShuffleNavigation({
      state: createShuffleHistory(3),
      currentIndex: 3,
      direction: -1,
      trackCount: 5,
      randomValue: 0.5,
    })).toMatchObject({ nextIndex: 3, restartCurrent: true });
  });
});

describe('music playback persistence', () => {
  it('never dereferences an absent idle seek preview when no track is available', () => {
    expect(resolveIdleMusicSeekPreviewPosition(null, null)).toBe(0);
    expect(resolveIdleMusicSeekPreviewPosition({ trackId: 9, position: 42 }, null)).toBe(0);
    expect(resolveIdleMusicSeekPreviewPosition(null, 9)).toBe(0);
    expect(resolveIdleMusicSeekPreviewPosition({ trackId: 9, position: 42 }, 8)).toBe(0);
    expect(resolveIdleMusicSeekPreviewPosition({ trackId: 9, position: 42 }, 9)).toBe(42);
  });

  it('accepts only bounded, finite snapshots', () => {
    expect(parseStoredMusicPlayback('{"trackId":9,"position":42.5,"volume":0.65}')).toEqual({
      trackId: 9,
      position: 42.5,
      volume: 0.65,
    });
    expect(parseStoredMusicPlayback('{"trackId":9,"position":-3,"volume":4}')).toEqual({
      trackId: 9,
      position: 0,
      volume: 1,
    });
    expect(parseStoredMusicPlayback('{"trackId":"9","position":3,"volume":0.5}')).toBeNull();
    expect(parseStoredMusicPlayback('not-json')).toBeNull();
  });

  it('does not restore a nearly-finished track as if it were mid-song', () => {
    expect(resolveRestoredMusicPosition({ position: 41, duration: 180 })).toBe(41);
    expect(resolveRestoredMusicPosition({ position: 179.5, duration: 180 })).toBe(0);
    expect(resolveRestoredMusicPosition({ position: 22, duration: 0 })).toBe(22);
  });
});

describe('music provider semantic integration gates', () => {
  it('keeps idle carousel presentation separate from the playback source', () => {
    expect(providerSource).toContain('presentationIndex');
    expect(providerSource).toContain('setPresentationIndex');
    expect(providerSource).toContain('playbackTrack');
    expect(providerSource).toContain('resolveMusicAudioSrc(playbackTrack)');
  });

  it('keeps an idle seek as preview state until the visitor explicitly asks to play', () => {
    const seekSource = sourceBetween(
      providerSource,
      'const seekToTime = useCallback',
      'const seekToPercent = useCallback',
    );
    const idleSeekSource = sourceBetween(
      seekSource,
      'if (!hasPlaybackSession)',
      'if (targetTrack &&',
    );
    expect(seekSource).toContain('setIdleSeekPreview');
    expect(idleSeekSource).not.toContain('setHasPlaybackSession(true)');
    expect(idleSeekSource).not.toContain('selectPlaybackIndex(targetIndex)');
    expect(idleSeekSource).not.toContain('persistPlaybackSnapshot');
  });

  it('uses explicit playback intent across source load transitions', () => {
    expect(providerSource).toContain('playIntentRef');
    expect(providerSource).toContain('sourceTransitionRef');
    expect(providerSource).toContain('sourceRequestRef');
    expect(providerSource).toContain('isActiveAudioEvent');
    expect(providerSource).not.toContain('playingRef');
    expect(providerSource).toContain('audio.currentTime = 0');
    expect(providerSource).toContain('pendingRestoreRef.current = null');
    expect(providerSource).toContain('setIsBuffering(false)');
  });

  it('keeps first playback inside the activating click and never reloads that source in the follow-up effect', () => {
    expect(providerSource).toContain('void attemptPlayback({ source: targetSource });');
    expect(providerSource).toContain('await attemptPlayback({ source: targetSource });');
    expect(providerSource).toContain('if (activeAudioSrcRef.current === desiredSource)');
    expect(providerSource).toContain("error.name === 'NotAllowedError'");
    expect(providerSource).toContain('浏览器需要你确认播放，请再点一次。');
  });

  it('offers complete Media Session transport and seek actions', () => {
    for (const action of ['seekbackward', 'seekforward', 'seekto', 'stop']) {
      expect(providerSource).toContain(`'${action}'`);
    }
    expect(providerSource).toContain('setPositionState');
    expect(providerSource).toContain('playbackState');
  });

  it('uses visitor-facing empty-lyrics copy', () => {
    expect(providerSource).toContain('这首歌暂时没有歌词，先让旋律继续。');
    expect(providerSource).not.toContain('可以在后台音乐大厅的歌曲信息里维护歌词');
  });

  it('offers an explicit session close that stops audio and removes the restore snapshot', () => {
    expect(providerSource).toContain('dismissPlayer: () => void;');
    expect(providerSource).toContain('const dismissPlayer = useCallback(() => {');
    expect(providerSource).toContain("registerAction('stop', dismissPlayer)");
    expect(providerSource).toContain('localStorage.removeItem(MUSIC_PLAYBACK_STORAGE_KEY)');
    expect(providerSource).toContain("audio.removeAttribute('src')");
    expect(providerSource).toContain('pendingRestoreRef.current = null');
    expect(providerSource.match(/data-dismiss-music-player/g)).toHaveLength(3);
    expect(providerSource.match(/aria-label="停止播放并关闭播放器"/g)).toHaveLength(3);
  });
});
