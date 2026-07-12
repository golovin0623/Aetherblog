import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MusicPlaylist, MusicSettings, MusicTrack } from '@aetherblog/types';
import {
  buildMusicPlaylistUpdate,
  buildMusicSettingsUpdate,
  buildMusicTrackUpdate,
  canSavePlaylistDraft,
  movePlaylistTrack,
  playlistToDraft,
  shouldApplyPlaylistSaveResult,
  shouldApplyTrackSaveResult,
  shouldConfirmPlaylistSwitch,
  shouldConfirmTrackDraftDiscard,
} from './musicDrafts';

const musicPageSource = readFileSync(path.resolve(__dirname, '../MusicPage.tsx'), 'utf8');

describe('music editing payloads', () => {
  it('preserves duration and cover when saving unrelated track metadata', () => {
    const track = {
      id: 42,
      title: 'Original title',
      artist: 'Singer',
      album: 'Album',
      durationSeconds: 245,
      coverMediaFileId: 91,
      status: 'ACTIVE',
      sortOrder: 3,
      isFeatured: true,
    } as MusicTrack;

    expect(buildMusicTrackUpdate(track, { title: 'Renamed title' })).toMatchObject({
      title: 'Renamed title',
      durationSeconds: 245,
      coverMediaFileId: 91,
      status: 'ACTIVE',
      sortOrder: 3,
      isFeatured: true,
    });
  });

  it('round-trips the playlist cover through draft editing', () => {
    const playlist = {
      id: 7,
      name: 'Night drive',
      description: 'After dark',
      coverMediaFileId: 108,
      visibility: 'PUBLIC',
      status: 'ACTIVE',
      displayOnHome: false,
      displayOnProfile: true,
      carouselEnabled: false,
      randomEnabled: true,
      sortOrder: 4,
    } as MusicPlaylist;

    const draft = playlistToDraft(playlist);

    expect(draft.coverMediaFileId).toBe(108);
    expect(buildMusicPlaylistUpdate(draft, playlist.name)).toMatchObject({
      name: 'Night drive',
      coverMediaFileId: 108,
      sortOrder: 4,
    });
  });

  it('blocks saving while the visible draft belongs to another playlist', () => {
    expect(canSavePlaylistDraft({
      selectedPlaylistId: 8,
      loadedPlaylistId: 7,
      isFetching: false,
      isSaving: false,
    })).toBe(false);

    expect(canSavePlaylistDraft({
      selectedPlaylistId: 8,
      loadedPlaylistId: 8,
      isFetching: false,
      isSaving: false,
    })).toBe(true);
  });
});

describe('music settings write safety', () => {
  it('builds a full settings PUT from the latest server snapshot and permits explicit clearing', () => {
    const latest = {
      enabled: true,
      showOnHomePage: true,
      showOnProfileCard: true,
      featuredPlaylistId: 8,
      mediaFolderId: 21,
      playbackMode: 'SHUFFLE',
      carouselEnabled: true,
      carouselIntervalSeconds: 12,
      randomEnabled: true,
      skinMode: 'custom',
      skinColorLight: '#112233',
      skinColorDark: '#ddeeff',
    } as MusicSettings;

    expect(buildMusicSettingsUpdate(latest, {
      featuredPlaylistId: undefined,
      mediaFolderId: 99,
    })).toEqual({
      enabled: true,
      showOnHomePage: true,
      showOnProfileCard: true,
      featuredPlaylistId: undefined,
      mediaFolderId: 99,
      playbackMode: 'SHUFFLE',
      carouselEnabled: true,
      carouselIntervalSeconds: 12,
      randomEnabled: true,
      skinMode: 'custom',
      skinPreset: undefined,
      skinColorLight: '#112233',
      skinColorDark: '#ddeeff',
    });
  });

  it('serializes full-row settings writes and never saves from loading defaults', () => {
    expect(musicPageSource).toContain('settingsWriteLockRef');
    expect(musicPageSource).toContain('if (!settingsQuery.data || settingsWriteLockRef.current) return;');
    expect(musicPageSource).toContain("queryClient.getQueryData<MusicSettings>(MUSIC_SETTINGS_QUERY_KEY)");
    expect(musicPageSource).not.toContain('settingsMutation.mutateAsync({ ...settings, mediaFolderId: folderId });');
    expect(musicPageSource).not.toContain('musicService.updateSettings({ ...settings, featuredPlaylistId: playlistId, enabled: true });');
  });

  it('refreshes server truth after partial or ambiguous two-stage failures', () => {
    expect(musicPageSource).toContain("queryClient.invalidateQueries({ queryKey: ['media-folders-tree'] })");
    expect(musicPageSource).toContain("queryClient.invalidateQueries({ queryKey: ['music-playlist-detail', playlistId] })");
    expect(musicPageSource).toContain('await queryClient.invalidateQueries({ queryKey: MUSIC_SETTINGS_QUERY_KEY })');
  });

  it('commits carousel interval on blur instead of every keystroke', () => {
    expect(musicPageSource).toContain('carouselIntervalDraft');
    expect(musicPageSource).toContain('onBlur={commitCarouselInterval}');
    expect(musicPageSource).not.toContain('onChange={(event) => saveSettingsPatch({ carouselIntervalSeconds:');
  });

  it('does not present the removed homepage surface as a working control', () => {
    expect(musicPageSource).not.toContain('label="首页展示"');
    expect(musicPageSource).not.toContain('label="首页"');
    expect(musicPageSource).not.toContain('前台首页和个人卡片');
  });
});

describe('playlist ordering safety', () => {
  const tracks = [
    { id: 1, title: 'One' },
    { id: 2, title: 'Two' },
    { id: 3, title: 'Three' },
  ] as MusicTrack[];

  it('moves from the latest optimistic order without mutating the previous query value', () => {
    const firstMove = movePlaylistTrack(tracks, 0, 1);
    const secondMove = movePlaylistTrack(firstMove, 1, 1);

    expect(tracks.map((track) => track.id)).toEqual([1, 2, 3]);
    expect(firstMove.map((track) => track.id)).toEqual([2, 1, 3]);
    expect(secondMove.map((track) => track.id)).toEqual([2, 3, 1]);
  });

  it('optimistically scopes reorder cache updates to the mutated playlist', () => {
    expect(musicPageSource).toContain('onMutate: async ({ playlistId, tracks }) =>');
    expect(musicPageSource).toContain("['music-playlist-member-tracks', playlistId]");
    expect(musicPageSource).toContain('reorderPlaylistMutation.isPending');
  });
});

describe('playlist selection safety', () => {
  it('does not let a stale save response overwrite a switched or newly edited draft', () => {
    expect(shouldApplyPlaylistSaveResult({
      savedPlaylistId: 7,
      selectedPlaylistId: 8,
      savedRevision: 3,
      currentRevision: 3,
    })).toBe(false);
    expect(shouldApplyPlaylistSaveResult({
      savedPlaylistId: 7,
      selectedPlaylistId: 7,
      savedRevision: 3,
      currentRevision: 4,
    })).toBe(false);
    expect(shouldApplyPlaylistSaveResult({
      savedPlaylistId: 7,
      selectedPlaylistId: 7,
      savedRevision: 3,
      currentRevision: 3,
    })).toBe(true);
  });

  it('requires confirmation only when switching away from the selected dirty draft', () => {
    expect(shouldConfirmPlaylistSwitch({
      selectedPlaylistId: 7,
      targetPlaylistId: 8,
      loadedPlaylistId: 7,
      isDirty: true,
    })).toBe(true);
    expect(shouldConfirmPlaylistSwitch({
      selectedPlaylistId: 7,
      targetPlaylistId: 7,
      loadedPlaylistId: 7,
      isDirty: true,
    })).toBe(false);
    expect(shouldConfirmPlaylistSwitch({
      selectedPlaylistId: 7,
      targetPlaylistId: 8,
      loadedPlaylistId: 6,
      isDirty: true,
    })).toBe(false);
  });

  it('guards late entity responses and destructive writes in the page integration', () => {
    expect(musicPageSource).toContain('shouldApplyTrackSaveResult({');
    expect(musicPageSource).toContain('isPlaylistWriteBusy');
    expect(musicPageSource).toContain('deleteWriteLockRef.current');
    expect(musicPageSource).toContain('pending={deletePlaylistMutation.isPending || deleteTrackMutation.isPending}');
  });
});

describe('track draft safety', () => {
  it('does not let a stale save response replace another track or newer edits', () => {
    expect(shouldApplyTrackSaveResult({
      savedTrackId: 7,
      selectedTrackId: 8,
      savedRevision: 3,
      currentRevision: 3,
    })).toBe(false);
    expect(shouldApplyTrackSaveResult({
      savedTrackId: 7,
      selectedTrackId: 7,
      savedRevision: 3,
      currentRevision: 4,
    })).toBe(false);
    expect(shouldApplyTrackSaveResult({
      savedTrackId: 7,
      selectedTrackId: 7,
      savedRevision: 3,
      currentRevision: 3,
    })).toBe(true);
  });

  it('requires confirmation before a dirty track draft is closed, replaced, or left behind', () => {
    expect(shouldConfirmTrackDraftDiscard({
      isDirty: true,
      currentTrackId: 7,
      targetTrackId: null,
    })).toBe(true);
    expect(shouldConfirmTrackDraftDiscard({
      isDirty: true,
      currentTrackId: 7,
      targetTrackId: 8,
    })).toBe(true);
    expect(shouldConfirmTrackDraftDiscard({
      isDirty: true,
      currentTrackId: 7,
      targetTrackId: 7,
    })).toBe(false);
    expect(shouldConfirmTrackDraftDiscard({
      isDirty: false,
      currentTrackId: 7,
      targetTrackId: 8,
    })).toBe(false);
  });

  it('wires dirty-track confirmation into selection, close, and tab navigation', () => {
    expect(musicPageSource).toContain('trackDraftDirty');
    expect(musicPageSource).toContain('pendingTrackNavigation');
    expect(musicPageSource).toContain("kind: 'tab'");
    expect(musicPageSource).toContain('放弃未保存的歌曲修改？');
  });

  it('does not discard the active draft when another track is deleted', () => {
    expect(musicPageSource).toContain('onSuccess: (_response, { id }) =>');
    expect(musicPageSource).toContain('if (editingTrackIdRef.current === id) {');
  });
});
