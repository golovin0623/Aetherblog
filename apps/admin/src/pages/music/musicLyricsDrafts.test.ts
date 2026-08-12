import { describe, expect, it } from 'vitest';
import type { MusicLyric } from '@aetherblog/types';
import {
  buildMusicLyricRequest,
  createEmptyMusicLyricDraft,
  createImportedMusicLyricDraftState,
  hasMusicLyricDraftChanges,
  musicLyricToDraft,
  resolveMusicLyricBindingTrack,
  shouldConfirmMusicLyricSwitch,
  shouldInvalidatePendingLyricImport,
} from './musicLyricsDrafts';

describe('music lyric draft lifecycle', () => {
  it('maps an existing lyric asset into a stable editable draft', () => {
    const lyric = {
      id: 17,
      name: 'Night Flight',
      content: '[00:01.20]Hello',
      format: 'LRC',
      language: 'zh-Hans',
      sourceFileName: 'night-flight.lrc',
      timingOffsetMs: -250,
      status: 'NEEDS_REVIEW',
      boundTrackId: 42,
    } as MusicLyric;

    expect(musicLyricToDraft(lyric)).toEqual({
      id: 17,
      name: 'Night Flight',
      content: '[00:01.20]Hello',
      format: 'LRC',
      language: 'zh-Hans',
      sourceFileName: 'night-flight.lrc',
      timingOffsetMs: -250,
      status: 'NEEDS_REVIEW',
      boundTrackId: 42,
    });
  });

  it('creates a track-targeted draft without inventing content', () => {
    expect(createEmptyMusicLyricDraft({
      boundTrackId: 42,
      trackTitle: 'Night Flight',
    })).toEqual({
      name: 'Night Flight 歌词',
      content: '',
      format: 'PLAIN',
      language: 'und',
      sourceFileName: '',
      timingOffsetMs: 0,
      status: 'DRAFT',
      boundTrackId: 42,
    });
  });

  it('builds a normalized API payload while retaining the independent binding choice', () => {
    const draft = createEmptyMusicLyricDraft();
    draft.name = '  Imported lyric  ';
    draft.content = '\n[00:01.00]Hello\n';
    draft.sourceFileName = '   ';
    draft.format = 'LRC';

    expect(buildMusicLyricRequest(draft)).toEqual({
      name: 'Imported lyric',
      content: '[00:01.00]Hello',
      format: 'LRC',
      language: 'und',
      sourceFileName: undefined,
      timingOffsetMs: 0,
      status: 'DRAFT',
    });
  });

  it('keeps an imported file dirty until its new lyric asset is persisted', () => {
    const imported = {
      ...createEmptyMusicLyricDraft({ boundTrackId: 42 }),
      name: 'night-flight',
      content: '[00:01.00]Hello',
      format: 'LRC' as const,
      sourceFileName: 'night-flight.lrc',
    };

    const state = createImportedMusicLyricDraftState(imported);

    expect(state.draft).toEqual(imported);
    expect(state.baseline).toEqual(
      createEmptyMusicLyricDraft({ boundTrackId: 42 })
    );
    expect(hasMusicLyricDraftChanges(state.draft, state.baseline)).toBe(true);
  });

  it('labels a pending rebind from the new target instead of stale lyric metadata', () => {
    const selectedLyric = {
      id: 17,
      boundTrackId: 42,
      boundTrackTitle: 'Old Track',
      boundTrackArtist: 'Old Artist',
    } as MusicLyric;

    expect(resolveMusicLyricBindingTrack({
      boundTrackId: 106,
      selectedLyric,
      availableTracks: [
        { id: 106, title: 'Distant Bloom', artist: 'Nova' },
      ],
    })).toEqual({
      id: 106,
      title: 'Distant Bloom',
      artist: 'Nova',
    });
  });

  it('invalidates a delayed file read when the curator selects another draft', () => {
    expect(shouldInvalidatePendingLyricImport('select')).toBe(true);
    expect(shouldInvalidatePendingLyricImport('new')).toBe(true);
    expect(shouldInvalidatePendingLyricImport('import')).toBe(false);
  });

  it('treats binding-only changes as unsaved work', () => {
    const base = createEmptyMusicLyricDraft({ boundTrackId: 7 });
    const next = { ...base, boundTrackId: 8 };

    expect(hasMusicLyricDraftChanges(next, base)).toBe(true);
    expect(hasMusicLyricDraftChanges({ ...base }, base)).toBe(false);
  });

  it('requires confirmation only when leaving a dirty lyric entity', () => {
    expect(shouldConfirmMusicLyricSwitch({
      dirty: true,
      currentLyricId: 7,
      targetLyricId: 8,
    })).toBe(true);
    expect(shouldConfirmMusicLyricSwitch({
      dirty: true,
      currentLyricId: 7,
      targetLyricId: 7,
    })).toBe(false);
    expect(shouldConfirmMusicLyricSwitch({
      dirty: false,
      currentLyricId: 7,
      targetLyricId: undefined,
    })).toBe(false);
  });
});
