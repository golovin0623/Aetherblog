import type { MusicTrack } from '@aetherblog/types';

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
