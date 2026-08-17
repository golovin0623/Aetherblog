import { describe, expect, it } from 'vitest';
import {
  PLAYLIST_MEMBER_TRACK_PAGE_SIZE,
  PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE,
  buildPlaylistTrackIdSet,
  getMissingPlaylistMemberPageNumbers,
  type PlaylistTrackOptionSource,
} from './playlistTrackOptions';

describe('playlist track candidate options', () => {
  it('loads more than the default visible library page', () => {
    expect(PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE).toBeGreaterThan(10);
  });

  // 候选歌曲改为整表渲染(AddTracksPanel):不再过滤掉已加入的曲目,
  // 而是让它们保持可见并标记「已加入」—— 去重依据就是这个 id 集合。
  it('marks every track already in the playlist so the panel can disable re-adding', () => {
    const members: PlaylistTrackOptionSource[] = [
      { id: 1, title: 'Already Added', media: { originalName: 'a.mp3' } },
      { id: 2, title: 'Also Added', artist: 'Singer', media: { originalName: 'b.mp3' } },
    ];
    const existing = buildPlaylistTrackIdSet(members);

    expect(existing.has(1)).toBe(true);
    expect(existing.has(2)).toBe(true);
    expect(existing.has(3)).toBe(false);
  });

  it('covers playlist members beyond the first detail page so late pages still dedupe', () => {
    const existing = buildPlaylistTrackIdSet(
      Array.from({ length: 101 }, (_, index) => ({
        id: index + 1,
        title: `Existing ${index + 1}`,
      }))
    );

    expect(existing.size).toBe(101);
    // 第 101 首落在第二页,只有聚合全部分页后才会被判为「已加入」
    expect(existing.has(101)).toBe(true);
    expect(existing.has(102)).toBe(false);
  });

  it('requests the remaining playlist member pages when a playlist has more than one page', () => {
    expect(PLAYLIST_MEMBER_TRACK_PAGE_SIZE).toBe(100);
    expect(getMissingPlaylistMemberPageNumbers(250, 100)).toEqual([2, 3]);
    expect(getMissingPlaylistMemberPageNumbers(100, 100)).toEqual([]);
  });
});
