import { describe, expect, it } from 'vitest';
import type { MusicTrack } from '@aetherblog/types';
import {
  createAdminMusicQueueState,
  hasSameAdminMusicQueueTrackIds,
  isSameAdminMusicQueueSource,
  reconcileAdminMusicQueue,
  removeAdminMusicQueueTrack,
  replaceAdminMusicQueueTrack,
  type AdminMusicQueueSource,
} from './adminMusicQueueState';

function track(id: number, title = `Track ${id}`): MusicTrack {
  return {
    id,
    mediaFileId: id,
    title,
    artist: 'Artist',
    album: 'Album',
    source: 'MEDIA_LIBRARY',
    status: 'ACTIVE',
    sortOrder: id,
    isFeatured: false,
    playCount: 0,
    media: {
      id,
      originalName: `${id}.mp3`,
      fileUrl: `/uploads/${id}.mp3`,
      fileSize: 1024,
      fileType: 'AUDIO',
      deleted: false,
    },
  };
}

const librarySource: AdminMusicQueueSource = { type: 'library' };
const playlistSource: AdminMusicQueueSource = { type: 'playlist', playlistId: 12 };

describe('admin music queue state', () => {
  it('models library and playlist origins as distinct queue sources', () => {
    expect(isSameAdminMusicQueueSource(librarySource, { type: 'library' })).toBe(true);
    expect(isSameAdminMusicQueueSource(librarySource, playlistSource)).toBe(false);
    expect(isSameAdminMusicQueueSource(playlistSource, { type: 'playlist', playlistId: 12 })).toBe(true);
    expect(isSameAdminMusicQueueSource(playlistSource, { type: 'playlist', playlistId: 13 })).toBe(false);
  });

  it('treats library queue order as part of the playback context', () => {
    expect(hasSameAdminMusicQueueTrackIds(
      [track(1), track(2)],
      [track(1), track(2)]
    )).toBe(true);
    expect(hasSameAdminMusicQueueTrackIds(
      [track(1), track(2)],
      [track(2), track(1)]
    )).toBe(false);
    expect(hasSameAdminMusicQueueTrackIds(
      [track(1)],
      [track(1), track(2)]
    )).toBe(false);
  });

  it('normalizes the selected index and always derives the current track from the queue', () => {
    const tracks = [track(1), track(2)];

    const belowRange = createAdminMusicQueueState(tracks, -4, librarySource);
    const aboveRange = createAdminMusicQueueState(tracks, 20, librarySource);

    expect(belowRange.currentIndex).toBe(0);
    expect(belowRange.currentTrack?.id).toBe(1);
    expect(aboveRange.currentIndex).toBe(1);
    expect(aboveRange.currentTrack?.id).toBe(2);
    expect(aboveRange.queue).not.toBe(tracks);
  });

  it('uses an empty-safe index while retaining the source for later reconciliation', () => {
    const state = createAdminMusicQueueState([], 8, playlistSource);

    expect(state.queue).toEqual([]);
    expect(state.currentIndex).toBe(0);
    expect(state.currentTrack).toBeUndefined();
    expect(state.source).toEqual(playlistSource);
  });

  it('replaces an edited track in place and refreshes the current-track reference', () => {
    const original = createAdminMusicQueueState([track(1), track(2)], 1, librarySource);
    const updated = track(2, 'Updated title');

    const next = replaceAdminMusicQueueTrack(original, updated);

    expect(next.currentIndex).toBe(1);
    expect(next.currentTrack).toBe(updated);
    expect(next.queue.map((item) => item.title)).toEqual(['Track 1', 'Updated title']);
    expect(original.currentTrack?.title).toBe('Track 2');
  });

  it('returns the same state when an edited track is not present', () => {
    const state = createAdminMusicQueueState([track(1)], 0, librarySource);

    expect(replaceAdminMusicQueueTrack(state, track(99))).toBe(state);
  });

  it('removes a track before the current one without changing what is playing', () => {
    const state = createAdminMusicQueueState([track(1), track(2), track(3)], 2, librarySource);

    const next = removeAdminMusicQueueTrack(state, 1);

    expect(next.queue.map((item) => item.id)).toEqual([2, 3]);
    expect(next.currentIndex).toBe(1);
    expect(next.currentTrack?.id).toBe(3);
  });

  it('selects the logical successor when the current track is removed', () => {
    const state = createAdminMusicQueueState([track(1), track(2), track(3)], 1, playlistSource);

    const next = removeAdminMusicQueueTrack(state, 2, playlistSource);

    expect(next.queue.map((item) => item.id)).toEqual([1, 3]);
    expect(next.currentIndex).toBe(1);
    expect(next.currentTrack?.id).toBe(3);
  });

  it('falls back to the previous item when removing the current tail', () => {
    const state = createAdminMusicQueueState([track(1), track(2), track(3)], 2, playlistSource);

    const next = removeAdminMusicQueueTrack(state, 3, playlistSource);

    expect(next.currentIndex).toBe(1);
    expect(next.currentTrack?.id).toBe(2);
  });

  it('clears the current track safely when the sole queue item is removed', () => {
    const state = createAdminMusicQueueState([track(1)], 0, librarySource);

    const next = removeAdminMusicQueueTrack(state, 1);

    expect(next.queue).toEqual([]);
    expect(next.currentIndex).toBe(0);
    expect(next.currentTrack).toBeUndefined();
  });

  it('ignores scoped removals from a different queue source', () => {
    const state = createAdminMusicQueueState([track(1), track(2)], 0, librarySource);

    expect(removeAdminMusicQueueTrack(state, 1, playlistSource)).toBe(state);
    expect(removeAdminMusicQueueTrack(state, 99)).toBe(state);
  });

  it('reconciles a reordered source while preserving the current track by id', () => {
    const state = createAdminMusicQueueState([track(1), track(2), track(3)], 1, playlistSource);

    const next = reconcileAdminMusicQueue(
      state,
      [track(3), track(1), track(2, 'Refreshed current')],
      playlistSource
    );

    expect(next.queue.map((item) => item.id)).toEqual([3, 1, 2]);
    expect(next.currentIndex).toBe(2);
    expect(next.currentTrack?.title).toBe('Refreshed current');
  });

  it('uses the previous numeric slot when reconciliation removes the current track', () => {
    const state = createAdminMusicQueueState([track(1), track(2), track(3)], 1, playlistSource);

    const next = reconcileAdminMusicQueue(state, [track(3), track(1)], playlistSource);

    expect(next.currentIndex).toBe(1);
    expect(next.currentTrack?.id).toBe(1);
  });

  it('reconciles to an empty queue without leaving a stale current track', () => {
    const state = createAdminMusicQueueState([track(1)], 0, playlistSource);

    const next = reconcileAdminMusicQueue(state, [], playlistSource);

    expect(next.queue).toEqual([]);
    expect(next.currentIndex).toBe(0);
    expect(next.currentTrack).toBeUndefined();
    expect(next.source).toEqual(playlistSource);
  });

  it('does not let a playlist refresh rewrite a library or another playlist queue', () => {
    const library = createAdminMusicQueueState([track(1)], 0, librarySource);
    const playlist = createAdminMusicQueueState([track(1)], 0, playlistSource);

    expect(reconcileAdminMusicQueue(library, [track(2)], playlistSource)).toBe(library);
    expect(reconcileAdminMusicQueue(
      playlist,
      [track(2)],
      { type: 'playlist', playlistId: 99 }
    )).toBe(playlist);
  });
});
