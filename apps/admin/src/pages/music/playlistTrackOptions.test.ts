import { describe, expect, it } from 'vitest';
import {
  PLAYLIST_MEMBER_TRACK_PAGE_SIZE,
  PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE,
  buildPlaylistTrackIdSet,
  buildPlaylistTrackOptions,
  getMissingPlaylistMemberPageNumbers,
  type PlaylistTrackOptionSource,
} from './playlistTrackOptions';

describe('playlist track candidate options', () => {
  it('loads more than the default visible library page', () => {
    expect(PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE).toBeGreaterThan(10);
  });

  it('keeps every fetched candidate available instead of slicing to ten', () => {
    const tracks: PlaylistTrackOptionSource[] = Array.from({ length: 17 }, (_, index) => ({
      id: index + 1,
      title: `Song ${index + 1}`,
      artist: 'Artist',
      media: { originalName: `song-${index + 1}.mp3` },
    }));

    expect(buildPlaylistTrackOptions(tracks)).toHaveLength(17);
  });

  it('does not offer tracks already present in the selected playlist', () => {
    const options = buildPlaylistTrackOptions(
      [
        { id: 1, title: 'Already Added', media: { originalName: 'a.mp3' } },
        { id: 2, title: 'Candidate', artist: 'Singer', media: { originalName: 'b.mp3' } },
      ],
      new Set([1])
    );

    expect(options).toEqual([
      {
        value: '2',
        label: 'Candidate',
        description: 'Singer · b.mp3',
      },
    ]);
  });

  it('filters tracks already present beyond the first playlist detail page', () => {
    const candidates: PlaylistTrackOptionSource[] = [
      { id: 101, title: 'Already Added After First Page', media: { originalName: 'a.mp3' } },
      { id: 102, title: 'Candidate', artist: 'Singer', media: { originalName: 'b.mp3' } },
    ];
    const existing = buildPlaylistTrackIdSet(
      Array.from({ length: 101 }, (_, index) => ({
        id: index + 1,
        title: `Existing ${index + 1}`,
      }))
    );

    expect(buildPlaylistTrackOptions(candidates, existing)).toEqual([
      {
        value: '102',
        label: 'Candidate',
        description: 'Singer · b.mp3',
      },
    ]);
  });

  it('requests the remaining playlist member pages when a playlist has more than one page', () => {
    expect(PLAYLIST_MEMBER_TRACK_PAGE_SIZE).toBe(100);
    expect(getMissingPlaylistMemberPageNumbers(250, 100)).toEqual([2, 3]);
    expect(getMissingPlaylistMemberPageNumbers(100, 100)).toEqual([]);
  });
});
