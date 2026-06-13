export type MusicTrackStatus = 'ACTIVE' | 'HIDDEN';
export type MusicTrackSource = 'MEDIA_LIBRARY' | 'UPLOAD' | 'MANUAL';
export type MusicPlaylistVisibility = 'PRIVATE' | 'PUBLIC';
export type MusicPlaybackMode = 'SEQUENTIAL' | 'SHUFFLE' | 'LOOP' | 'CAROUSEL';

export interface MusicMedia {
  id: number;
  originalName: string;
  fileUrl: string;
  publicUrl?: string;
  fileSize: number;
  mimeType?: string;
  fileType: 'AUDIO' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER';
  folderId?: number;
  deleted: boolean;
}

export interface MusicTrack {
  id: number;
  mediaFileId: number;
  title: string;
  artist: string;
  album: string;
  durationSeconds?: number;
  coverMediaFileId?: number;
  coverUrl?: string;
  lyric?: string;
  source: MusicTrackSource;
  status: MusicTrackStatus;
  sortOrder: number;
  isFeatured: boolean;
  playCount: number;
  media: MusicMedia;
  createdAt?: string;
  updatedAt?: string;
}

export interface MusicPlaylist {
  id: number;
  name: string;
  slug: string;
  description?: string;
  coverMediaFileId?: number;
  coverUrl?: string;
  visibility: MusicPlaylistVisibility;
  status: MusicTrackStatus;
  displayOnHome: boolean;
  displayOnProfile: boolean;
  carouselEnabled: boolean;
  randomEnabled: boolean;
  sortOrder: number;
  trackCount: number;
  tracks?: MusicTrack[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MusicSettings {
  enabled: boolean;
  showOnHomePage: boolean;
  showOnProfileCard: boolean;
  featuredPlaylistId?: number;
  mediaFolderId?: number;
  playbackMode: MusicPlaybackMode;
  carouselEnabled: boolean;
  carouselIntervalSeconds: number;
  randomEnabled: boolean;
  featuredPlaylist?: MusicPlaylist;
}

export interface MusicLibrarySummary {
  trackCount: number;
  activeTrackCount: number;
  playlistCount: number;
  mappedMediaCount: number;
  availableAudioCount: number;
  settings: MusicSettings;
}

export interface MusicAudioCandidate extends MusicMedia {
  mappedTrackId?: number;
  mappedTitle?: string;
}

export interface MusicPlayer {
  enabled: boolean;
  showOnHomePage: boolean;
  showOnProfileCard: boolean;
  playbackMode: MusicPlaybackMode;
  carouselEnabled: boolean;
  carouselIntervalSeconds: number;
  randomEnabled: boolean;
  playlist?: MusicPlaylist;
  tracks: MusicTrack[];
}

export interface MusicSettingsRequest {
  enabled: boolean;
  showOnHomePage: boolean;
  showOnProfileCard: boolean;
  featuredPlaylistId?: number;
  mediaFolderId?: number;
  playbackMode: MusicPlaybackMode;
  carouselEnabled: boolean;
  carouselIntervalSeconds: number;
  randomEnabled: boolean;
}

export interface MusicImportMediaRequest {
  mediaFileId: number;
  title?: string;
  artist?: string;
  album?: string;
}

export interface MusicTrackRequest {
  title: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
  coverMediaFileId?: number;
  lyric?: string;
  status?: MusicTrackStatus;
  sortOrder?: number;
  isFeatured?: boolean;
}

export interface MusicPlaylistRequest {
  name: string;
  description?: string;
  coverMediaFileId?: number;
  visibility?: MusicPlaylistVisibility;
  status?: MusicTrackStatus;
  displayOnHome: boolean;
  displayOnProfile: boolean;
  carouselEnabled: boolean;
  randomEnabled: boolean;
  sortOrder?: number;
}
