import api from './api';
import type {
  MusicAudioCandidate,
  MusicImportMediaRequest,
  MusicLibrarySummary,
  MusicLyric,
  MusicLyricBindingRequest,
  MusicLyricRequest,
  MusicLyricStatus,
  MusicPlaylist,
  MusicPlaylistRequest,
  MusicPlayer,
  MusicSettings,
  MusicSettingsRequest,
  MusicTrack,
  MusicTrackRequest,
} from '@aetherblog/types';
import type { PageResult, R } from '@/types';

export interface MusicListParams {
  keyword?: string;
  status?: 'ACTIVE' | 'HIDDEN';
  playlistId?: number;
  tagId?: number;
  tagState?: 'WITH_TAGS' | 'WITHOUT_TAGS';
  favorite?: boolean;
  lyricState?: 'WITH_LYRIC' | 'WITHOUT_LYRIC' | 'NEEDS_REVIEW';
  coverState?: 'WITH_COVER' | 'WITHOUT_COVER';
  pageNum?: number;
  pageSize?: number;
}

export interface MusicScanParams {
  folderId?: number;
  keyword?: string;
  includeMapped?: boolean;
  pageNum?: number;
  pageSize?: number;
}

export interface MusicPlaylistListParams {
  status?: 'ACTIVE' | 'HIDDEN';
  visibility?: 'PRIVATE' | 'PUBLIC';
  favorite?: boolean;
  pageNum?: number;
  pageSize?: number;
}

export interface MusicLyricListParams {
  keyword?: string;
  status?: MusicLyricStatus;
  bound?: boolean;
  trackId?: number;
  pageNum?: number;
  pageSize?: number;
}

export const musicService = {
  getSummary: (): Promise<R<MusicLibrarySummary>> =>
    api.get('/v1/admin/music/summary'),

  getSettings: (): Promise<R<MusicSettings>> =>
    api.get('/v1/admin/music/settings'),

  updateSettings: (data: MusicSettingsRequest): Promise<R<MusicSettings>> =>
    api.put('/v1/admin/music/settings', data),

  getTracks: (params: MusicListParams = {}): Promise<R<PageResult<MusicTrack>>> =>
    api.get('/v1/admin/music/tracks', { params }),

  scanAudio: (params: MusicScanParams): Promise<R<PageResult<MusicAudioCandidate>>> =>
    api.post('/v1/admin/music/tracks/scan', params),

  importMedia: (data: MusicImportMediaRequest): Promise<R<MusicTrack>> =>
    api.post('/v1/admin/music/tracks/import', data),

  batchImportMedia: (mediaFileIds: number[]): Promise<R<MusicTrack[]>> =>
    api.post('/v1/admin/music/tracks/batch-import', { mediaFileIds }),

  updateTrack: (id: number, data: MusicTrackRequest): Promise<R<MusicTrack>> =>
    api.put(`/v1/admin/music/tracks/${id}`, data),

  deleteTrack: (id: number, options?: { deleteMedia?: boolean }): Promise<R<void>> =>
    api.delete(`/v1/admin/music/tracks/${id}`, {
      params: options?.deleteMedia ? { deleteMedia: 'true' } : undefined,
    }),

  getLyrics: (params: MusicLyricListParams = {}): Promise<R<PageResult<MusicLyric>>> =>
    api.get('/v1/admin/music/lyrics', { params }),

  getLyric: (id: number): Promise<R<MusicLyric>> =>
    api.get(`/v1/admin/music/lyrics/${id}`),

  createLyric: (data: MusicLyricRequest): Promise<R<MusicLyric>> =>
    api.post('/v1/admin/music/lyrics', data),

  updateLyric: (id: number, data: MusicLyricRequest): Promise<R<MusicLyric>> =>
    api.put(`/v1/admin/music/lyrics/${id}`, data),

  bindLyric: (id: number, data: MusicLyricBindingRequest): Promise<R<MusicLyric>> =>
    api.put(`/v1/admin/music/lyrics/${id}/binding`, data),

  deleteLyric: (id: number): Promise<R<void>> =>
    api.delete(`/v1/admin/music/lyrics/${id}`),

  getPlaylists: (params: MusicPlaylistListParams = {}): Promise<R<PageResult<MusicPlaylist>>> =>
    api.get('/v1/admin/music/playlists', { params }),

  getPlaylist: (id: number, options?: { includeTracks?: boolean }): Promise<R<MusicPlaylist>> =>
    api.get(`/v1/admin/music/playlists/${id}`, {
      params: options?.includeTracks ? { includeTracks: 'true' } : undefined,
    }),

  createPlaylist: (data: MusicPlaylistRequest): Promise<R<MusicPlaylist>> =>
    api.post('/v1/admin/music/playlists', data),

  updatePlaylist: (id: number, data: MusicPlaylistRequest): Promise<R<MusicPlaylist>> =>
    api.put(`/v1/admin/music/playlists/${id}`, data),

  deletePlaylist: (id: number): Promise<R<void>> =>
    api.delete(`/v1/admin/music/playlists/${id}`),

  addTrackToPlaylist: (playlistId: number, trackId: number): Promise<R<void>> =>
    api.post(`/v1/admin/music/playlists/${playlistId}/tracks`, { trackId }),

  removeTrackFromPlaylist: (playlistId: number, trackId: number): Promise<R<void>> =>
    api.delete(`/v1/admin/music/playlists/${playlistId}/tracks/${trackId}`),

  reorderPlaylist: (
    playlistId: number,
    tracks: Array<{ trackId: number; sortOrder: number }>
  ): Promise<R<void>> =>
    api.put(`/v1/admin/music/playlists/${playlistId}/tracks/reorder`, { tracks }),

  getPublicPlayer: (): Promise<R<MusicPlayer>> =>
    api.get('/v1/public/music/player'),
};
