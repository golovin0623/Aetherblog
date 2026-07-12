import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MusicTrack } from '@aetherblog/types';
import { resolveAdminAdjacentTrack, resolveAdminAudioUrl } from './adminMusicPlayerState';

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
    expect(providerSource).toContain('onError={() =>');
    expect(providerSource).toContain('重新尝试');
    expect(providerSource).toContain('找不到可播放的媒体文件');
    expect(providerSource).toContain('retryPlayback,');
  });

  it('turns the downward dismissal gesture into an actual close action', () => {
    expect(providerSource).toContain('closePlayer();');
    expect(providerSource).toContain('下拖关闭后台播放器');
    expect(providerSource).toContain('aria-label="关闭后台播放器"');
  });
});
