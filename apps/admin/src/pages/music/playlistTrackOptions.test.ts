import { describe, expect, it } from 'vitest';
import {
  PLAYLIST_TRACK_CANDIDATE_PAGE_SIZE,
  buildPlaylistTrackOptions,
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
});
