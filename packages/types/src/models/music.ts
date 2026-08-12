import type { TagCategory } from './media';

export type MusicTrackStatus = 'ACTIVE' | 'HIDDEN';
export type MusicTrackSource = 'MEDIA_LIBRARY' | 'UPLOAD' | 'MANUAL';
export type MusicPlaylistVisibility = 'PRIVATE' | 'PUBLIC';
export type MusicPlaybackMode = 'SEQUENTIAL' | 'SHUFFLE' | 'LOOP' | 'CAROUSEL';
export type MusicHallSkinMode = 'preset' | 'custom';
export type MusicLyricFormat = 'LRC' | 'PLAIN';
export type MusicLyricStatus = 'DRAFT' | 'READY' | 'NEEDS_REVIEW';

export interface MusicMedia {
  id: number;
  originalName: string;
  fileUrl: string;
  publicUrl?: string;
  thumbnailUrl?: string;
  fileSize: number;
  mimeType?: string;
  fileType: 'AUDIO' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER';
  folderId?: number;
  deleted: boolean;
}

/**
 * Embedded canonical media-tag projection returned with a music track.
 *
 * Detailed tag timestamps and descriptions remain available from the media-tag
 * endpoints; the music library only needs the stable fields used for filtering,
 * display, and tag editing.
 */
export interface MusicTagSummary {
  id: number;
  name: string;
  slug: string;
  color: string;
  category: TagCategory;
  usageCount: number;
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
  isFavorite?: boolean;
  playCount: number;
  playlistCount?: number;
  tags?: MusicTagSummary[];
  lyricAsset?: MusicLyricSummary;
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
  isFavorite?: boolean;
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
  /** 音乐大厅皮肤模式:preset(预设)| custom(自定义取色) */
  skinMode?: MusicHallSkinMode;
  /** 预设皮肤 id(skinMode=preset 时生效),见 MUSIC_SKIN_PRESETS */
  skinPreset?: string;
  /** 自定义亮主题光源种子(skinMode=custom 时生效) */
  skinColorLight?: string;
  /** 自定义暗主题光源种子(skinMode=custom 时生效) */
  skinColorDark?: string;
  featuredPlaylist?: MusicPlaylist;
}

export interface MusicLibrarySummary {
  trackCount: number;
  activeTrackCount: number;
  playlistCount: number;
  mappedMediaCount: number;
  availableAudioCount: number;
  favoriteTrackCount?: number;
  favoritePlaylistCount?: number;
  lyricCount?: number;
  readyLyricCount?: number;
  missingLyricCount?: number;
  missingCoverCount?: number;
  taggedTrackCount?: number;
  settings: MusicSettings;
}

export interface MusicLyricSummary {
  id: number;
  name: string;
  format: MusicLyricFormat;
  language: string;
  sourceFileName?: string;
  timingOffsetMs: number;
  status: MusicLyricStatus;
}

export interface MusicLyric extends MusicLyricSummary {
  content: string;
  boundTrackId?: number;
  boundTrackTitle?: string;
  boundTrackArtist?: string;
  createdAt?: string;
  updatedAt?: string;
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
  /** 站点默认音乐皮肤模式 */
  skinMode?: MusicHallSkinMode;
  /** 站点默认预设皮肤 id */
  skinPreset?: string;
  /** 站点默认自定义亮主题种子 */
  skinColorLight?: string;
  /** 站点默认自定义暗主题种子 */
  skinColorDark?: string;
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
  skinMode?: MusicHallSkinMode;
  skinPreset?: string;
  skinColorLight?: string;
  skinColorDark?: string;
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
  isFavorite?: boolean;
}

export interface MusicLyricRequest {
  name?: string;
  content: string;
  format?: MusicLyricFormat;
  language?: string;
  sourceFileName?: string;
  timingOffsetMs?: number;
  status?: MusicLyricStatus;
}

export interface MusicLyricBindingRequest {
  trackId?: number;
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
  isFavorite?: boolean;
  sortOrder?: number;
}
