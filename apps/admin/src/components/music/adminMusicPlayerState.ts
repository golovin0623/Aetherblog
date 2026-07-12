import type { MusicTrack } from '@aetherblog/types';

export function resolveAdminAudioUrl(track: MusicTrack | undefined): string {
  if (!track) return '';
  const raw = track.media?.publicUrl || track.media?.fileUrl || '';
  if (!raw) return '';
  return raw.startsWith('uploads/') ? `/${raw}` : raw;
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
