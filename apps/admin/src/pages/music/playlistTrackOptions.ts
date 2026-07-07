export const PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE = 100;

export interface PlaylistTrackOptionSource {
  id: number;
  title: string;
  artist?: string;
  media?: {
    originalName?: string;
  };
}

export interface PlaylistTrackSelectOption {
  value: string;
  label: string;
  description: string;
}

export function buildPlaylistTrackOptions(
  tracks: PlaylistTrackOptionSource[],
  existingTrackIds: Set<number> = new Set()
): PlaylistTrackSelectOption[] {
  return tracks
    .filter((track) => !existingTrackIds.has(track.id))
    .map((track) => ({
      value: String(track.id),
      label: track.title,
      description: `${track.artist || '未知艺术家'} · ${track.media?.originalName || '未加载媒体文件名'}`,
    }));
}
