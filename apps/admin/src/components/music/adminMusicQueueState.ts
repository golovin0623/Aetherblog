import type { MusicTrack } from '@aetherblog/types';

/**
 * Identifies the collection that produced the active queue. A playlist id is
 * intentionally part of the identity so a mutation in one editor cannot
 * silently rewrite playback that started from another playlist.
 */
export type AdminMusicQueueSource =
  | { readonly type: 'library' }
  | { readonly type: 'playlist'; readonly playlistId: number };

export interface AdminMusicQueueState {
  readonly queue: readonly MusicTrack[];
  readonly currentIndex: number;
  readonly currentTrack: MusicTrack | undefined;
  readonly source: AdminMusicQueueSource;
}

function normalizeIndex(index: number, trackCount: number): number {
  if (trackCount <= 0) return 0;
  const finiteIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(trackCount - 1, Math.max(0, finiteIndex));
}

function buildQueueState(
  queue: readonly MusicTrack[],
  currentIndex: number,
  source: AdminMusicQueueSource
): AdminMusicQueueState {
  const safeIndex = normalizeIndex(currentIndex, queue.length);
  return {
    queue,
    currentIndex: safeIndex,
    currentTrack: queue[safeIndex],
    source,
  };
}

export function isSameAdminMusicQueueSource(
  left: AdminMusicQueueSource,
  right: AdminMusicQueueSource
): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'library') return true;
  return right.type === 'playlist' && left.playlistId === right.playlistId;
}

/**
 * Queue identity includes order, not merely membership. Library pagination and
 * filtering can expose the same current track inside a different play context.
 */
export function hasSameAdminMusicQueueTrackIds(
  left: readonly MusicTrack[],
  right: readonly MusicTrack[]
): boolean {
  return left.length === right.length
    && left.every((track, index) => track.id === right[index]?.id);
}

/** Creates a normalized, immutable-by-contract snapshot for a newly played collection. */
export function createAdminMusicQueueState(
  queue: readonly MusicTrack[],
  currentIndex: number,
  source: AdminMusicQueueSource
): AdminMusicQueueState {
  return buildQueueState([...queue], currentIndex, source);
}

/**
 * Refreshes metadata for a track already present in the queue. Track edits are
 * global, so this operation deliberately applies regardless of queue source.
 */
export function replaceAdminMusicQueueTrack(
  state: AdminMusicQueueState,
  updatedTrack: MusicTrack
): AdminMusicQueueState {
  if (!state.queue.some((item) => item.id === updatedTrack.id)) return state;

  const nextQueue = state.queue.map((item) => (
    item.id === updatedTrack.id ? updatedTrack : item
  ));
  const currentId = state.currentTrack?.id;
  const nextIndex = currentId == null
    ? state.currentIndex
    : nextQueue.findIndex((item) => item.id === currentId);

  return buildQueueState(
    nextQueue,
    nextIndex >= 0 ? nextIndex : state.currentIndex,
    state.source
  );
}

/**
 * Removes a track while keeping the same current track whenever possible.
 * When the current item itself is removed, playback advances to the item that
 * occupied its slot, or falls back to the new tail. Pass `expectedSource` for
 * playlist-membership edits; omit it for global track deletion.
 */
export function removeAdminMusicQueueTrack(
  state: AdminMusicQueueState,
  trackId: number,
  expectedSource?: AdminMusicQueueSource
): AdminMusicQueueState {
  if (
    expectedSource
    && !isSameAdminMusicQueueSource(state.source, expectedSource)
  ) {
    return state;
  }

  const removedIndex = state.queue.findIndex((item) => item.id === trackId);
  if (removedIndex < 0) return state;

  const nextQueue = state.queue.filter((item) => item.id !== trackId);
  if (nextQueue.length === 0) {
    return buildQueueState(nextQueue, 0, state.source);
  }

  const currentId = state.currentTrack?.id;
  if (currentId !== trackId && currentId != null) {
    const preservedIndex = nextQueue.findIndex((item) => item.id === currentId);
    if (preservedIndex >= 0) {
      return buildQueueState(nextQueue, preservedIndex, state.source);
    }
  }

  return buildQueueState(
    nextQueue,
    Math.min(removedIndex, nextQueue.length - 1),
    state.source
  );
}

/**
 * Synchronizes the active source after a refresh or reorder. Reconciliation is
 * source-scoped and preserves the current track by id even when its numeric
 * position changes. If that track disappeared, the previous numeric slot is
 * clamped to the remaining queue.
 */
export function reconcileAdminMusicQueue(
  state: AdminMusicQueueState,
  queue: readonly MusicTrack[],
  source: AdminMusicQueueSource
): AdminMusicQueueState {
  if (!isSameAdminMusicQueueSource(state.source, source)) return state;

  const nextQueue = [...queue];
  const currentId = state.currentTrack?.id;
  const preservedIndex = currentId == null
    ? -1
    : nextQueue.findIndex((item) => item.id === currentId);

  return buildQueueState(
    nextQueue,
    preservedIndex >= 0 ? preservedIndex : state.currentIndex,
    state.source
  );
}
