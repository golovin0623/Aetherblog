export const PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE = 100;
export const PLAYLIST_MEMBER_TRACK_PAGE_SIZE = 100;

export interface PlaylistTrackOptionSource {
  id: number;
  title: string;
  artist?: string;
  media?: {
    originalName?: string;
  };
}

// 候选歌曲不再折叠成 Select options —— AddTracksPanel 直接渲染曲目行,
// 已加入的曲目保持可见并标记 ✓,故 buildPlaylistTrackOptions 已随旧下拉一并移除。
export function buildPlaylistTrackIdSet(tracks: PlaylistTrackOptionSource[]): Set<number> {
  return new Set(tracks.map((track) => track.id));
}

export function getMissingPlaylistMemberPageNumbers(
  total: number | undefined,
  loadedCount: number,
  pageSize = PLAYLIST_MEMBER_TRACK_PAGE_SIZE
): number[] {
  if (!total || total <= loadedCount || pageSize < 1) return [];
  const pageCount = Math.ceil(total / pageSize);
  const firstMissingPage = Math.floor(loadedCount / pageSize) + 1;
  return Array.from({ length: Math.max(0, pageCount - firstMissingPage + 1) }, (_, index) => firstMissingPage + index);
}
