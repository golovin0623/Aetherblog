import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MusicTrack } from '@aetherblog/types';
import {
  resolveAdminAdjacentTrack,
  resolveAdminAudioUrl,
  resolveAdminMediaErrorMessage,
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
    expect(providerSource).toContain('onError={() =>');
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

  it('turns the downward dismissal gesture into an actual close action', () => {
    expect(providerSource).toContain('closePlayer();');
    expect(providerSource).toContain('下拖关闭后台播放器');
    expect(providerSource).toContain('aria-label="关闭后台播放器"');
  });
});
