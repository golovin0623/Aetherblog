import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MusicTrack } from '@aetherblog/types';
import {
  ADMIN_PLAYER_AUTO_COLLAPSE_MS,
  resolveAdminAdjacentTrack,
  resolveAdminAudioUrl,
  resolveAdminPlayerAutoCollapseDelay,
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

  it('auto-collapses only an idle expanded player while audio is playing', () => {
    expect(ADMIN_PLAYER_AUTO_COLLAPSE_MS).toBe(8_000);
    expect(resolveAdminPlayerAutoCollapseDelay({
      expanded: true,
      isPlaying: true,
      pointerInside: false,
      focusWithin: false,
    })).toBe(8_000);

    for (const state of [
      { expanded: false, isPlaying: true, pointerInside: false, focusWithin: false },
      { expanded: true, isPlaying: false, pointerInside: false, focusWithin: false },
      { expanded: true, isPlaying: true, pointerInside: true, focusWithin: false },
      { expanded: true, isPlaying: true, pointerInside: false, focusWithin: true },
    ]) {
      expect(resolveAdminPlayerAutoCollapseDelay(state)).toBeNull();
    }

    expect(providerSource).toContain('resolveAdminPlayerAutoCollapseDelay({');
    expect(providerSource).toContain('window.setTimeout(() => setExpanded(false), autoCollapseDelay)');
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
    expect(providerSource).toContain('px-4 max-[360px]:px-3');
    expect(providerSource).toContain('max-w-[520px]');
    expect(providerSource).toContain('layout="size"');
    expect(providerSource).toContain('mode="popLayout"');
    expect(providerSource).toContain('scaleX(${percent / 100})');
    expect(providerSource).toContain('motion-reduce:transition-none');
    expect(providerSource).not.toContain("height: 'auto'");
    expect(providerSource).not.toContain('mode="wait"');
    expect(providerSource).not.toContain('whileDrag={prefersReducedMotion ? undefined : { scale:');
    expect(providerSource).toContain('dockDraggedRef.current = true');
    expect(providerSource).toContain('if (dockDraggedRef.current) return');
  });
});
