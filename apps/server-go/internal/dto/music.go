package dto

import "time"

type MusicMediaVO struct {
	ID           int64   `json:"id"`
	OriginalName string  `json:"originalName"`
	FileURL      string  `json:"fileUrl"`
	PublicURL    string  `json:"publicUrl,omitempty"`
	ThumbnailURL string  `json:"thumbnailUrl,omitempty"`
	FileSize     int64   `json:"fileSize"`
	MimeType     *string `json:"mimeType,omitempty"`
	FileType     string  `json:"fileType"`
	FolderID     *int64  `json:"folderId,omitempty"`
	Deleted      bool    `json:"deleted"`
}

type MusicTrackVO struct {
	ID               int64        `json:"id"`
	MediaFileID      int64        `json:"mediaFileId"`
	Title            string       `json:"title"`
	Artist           string       `json:"artist"`
	Album            string       `json:"album"`
	DurationSeconds  *int         `json:"durationSeconds,omitempty"`
	CoverMediaFileID *int64       `json:"coverMediaFileId,omitempty"`
	CoverURL         string       `json:"coverUrl,omitempty"`
	Lyric            *string      `json:"lyric,omitempty"`
	Source           string       `json:"source"`
	Status           string       `json:"status"`
	SortOrder        int          `json:"sortOrder"`
	IsFeatured       bool         `json:"isFeatured"`
	PlayCount        int64        `json:"playCount"`
	Media            MusicMediaVO `json:"media"`
	CreatedAt        *time.Time   `json:"createdAt"`
	UpdatedAt        *time.Time   `json:"updatedAt"`
}

type MusicPlaylistVO struct {
	ID               int64          `json:"id"`
	Name             string         `json:"name"`
	Slug             string         `json:"slug"`
	Description      *string        `json:"description,omitempty"`
	CoverMediaFileID *int64         `json:"coverMediaFileId,omitempty"`
	CoverURL         string         `json:"coverUrl,omitempty"`
	Visibility       string         `json:"visibility"`
	Status           string         `json:"status"`
	DisplayOnHome    bool           `json:"displayOnHome"`
	DisplayOnProfile bool           `json:"displayOnProfile"`
	CarouselEnabled  bool           `json:"carouselEnabled"`
	RandomEnabled    bool           `json:"randomEnabled"`
	SortOrder        int            `json:"sortOrder"`
	TrackCount       int64          `json:"trackCount"`
	Tracks           []MusicTrackVO `json:"tracks,omitempty"`
	CreatedAt        *time.Time     `json:"createdAt"`
	UpdatedAt        *time.Time     `json:"updatedAt"`
}

type MusicSettingsVO struct {
	Enabled                 bool             `json:"enabled"`
	ShowOnHomePage          bool             `json:"showOnHomePage"`
	ShowOnProfileCard       bool             `json:"showOnProfileCard"`
	FeaturedPlaylistID      *int64           `json:"featuredPlaylistId,omitempty"`
	MediaFolderID           *int64           `json:"mediaFolderId,omitempty"`
	PlaybackMode            string           `json:"playbackMode"`
	CarouselEnabled         bool             `json:"carouselEnabled"`
	CarouselIntervalSeconds int              `json:"carouselIntervalSeconds"`
	RandomEnabled           bool             `json:"randomEnabled"`
	SkinMode                string           `json:"skinMode"`
	SkinPreset              string           `json:"skinPreset"`
	SkinColorLight          *string          `json:"skinColorLight,omitempty"`
	SkinColorDark           *string          `json:"skinColorDark,omitempty"`
	FeaturedPlaylist        *MusicPlaylistVO `json:"featuredPlaylist,omitempty"`
}

type MusicLibrarySummaryVO struct {
	TrackCount          int64           `json:"trackCount"`
	ActiveTrackCount    int64           `json:"activeTrackCount"`
	PlaylistCount       int64           `json:"playlistCount"`
	MappedMediaCount    int64           `json:"mappedMediaCount"`
	AvailableAudioCount int64           `json:"availableAudioCount"`
	Settings            MusicSettingsVO `json:"settings"`
}

type MusicAudioCandidateVO struct {
	MusicMediaVO
	MappedTrackID *int64  `json:"mappedTrackId,omitempty"`
	MappedTitle   *string `json:"mappedTitle,omitempty"`
}

type MusicPlayerVO struct {
	Enabled                 bool             `json:"enabled"`
	ShowOnHomePage          bool             `json:"showOnHomePage"`
	ShowOnProfileCard       bool             `json:"showOnProfileCard"`
	PlaybackMode            string           `json:"playbackMode"`
	CarouselEnabled         bool             `json:"carouselEnabled"`
	CarouselIntervalSeconds int              `json:"carouselIntervalSeconds"`
	RandomEnabled           bool             `json:"randomEnabled"`
	SkinMode                string           `json:"skinMode"`
	SkinPreset              string           `json:"skinPreset"`
	SkinColorLight          *string          `json:"skinColorLight,omitempty"`
	SkinColorDark           *string          `json:"skinColorDark,omitempty"`
	Playlist                *MusicPlaylistVO `json:"playlist,omitempty"`
	Tracks                  []MusicTrackVO   `json:"tracks"`
}

type MusicTrackRequest struct {
	MediaFileID      int64   `json:"mediaFileId" validate:"omitempty,min=1"`
	Title            string  `json:"title" validate:"omitempty,max=160"`
	Artist           string  `json:"artist" validate:"omitempty,max=120"`
	Album            string  `json:"album" validate:"omitempty,max=120"`
	DurationSeconds  *int    `json:"durationSeconds" validate:"omitempty,min=1"`
	CoverMediaFileID *int64  `json:"coverMediaFileId" validate:"omitempty,min=1"`
	Lyric            *string `json:"lyric"`
	Status           string  `json:"status" validate:"omitempty,oneof=ACTIVE HIDDEN"`
	SortOrder        int     `json:"sortOrder"`
	IsFeatured       bool    `json:"isFeatured"`
}

type MusicImportMediaRequest struct {
	MediaFileID int64  `json:"mediaFileId" validate:"required,min=1"`
	Title       string `json:"title" validate:"omitempty,max=160"`
	Artist      string `json:"artist" validate:"omitempty,max=120"`
	Album       string `json:"album" validate:"omitempty,max=120"`
}

type MusicBatchImportRequest struct {
	MediaFileIDs []int64 `json:"mediaFileIds" validate:"required,min=1"`
}

type MusicScanRequest struct {
	FolderID      *int64 `json:"folderId"`
	Keyword       string `json:"keyword"`
	IncludeMapped bool   `json:"includeMapped"`
	PageNum       int    `json:"pageNum"`
	PageSize      int    `json:"pageSize"`
}

type MusicPlaylistRequest struct {
	Name             string  `json:"name" validate:"required,max=120"`
	Description      *string `json:"description"`
	CoverMediaFileID *int64  `json:"coverMediaFileId" validate:"omitempty,min=1"`
	Visibility       string  `json:"visibility" validate:"omitempty,oneof=PRIVATE PUBLIC"`
	Status           string  `json:"status" validate:"omitempty,oneof=ACTIVE HIDDEN"`
	DisplayOnHome    bool    `json:"displayOnHome"`
	DisplayOnProfile bool    `json:"displayOnProfile"`
	CarouselEnabled  bool    `json:"carouselEnabled"`
	RandomEnabled    bool    `json:"randomEnabled"`
	SortOrder        int     `json:"sortOrder"`
}

type MusicPlaylistTrackRequest struct {
	TrackID int64 `json:"trackId" validate:"required,min=1"`
}

type MusicPlaylistTrackOrder struct {
	TrackID   int64 `json:"trackId" validate:"required,min=1"`
	SortOrder int   `json:"sortOrder"`
}

type MusicPlaylistReorderRequest struct {
	Tracks []MusicPlaylistTrackOrder `json:"tracks" validate:"required,min=1"`
}

type MusicSettingsRequest struct {
	Enabled                 bool    `json:"enabled"`
	ShowOnHomePage          bool    `json:"showOnHomePage"`
	ShowOnProfileCard       bool    `json:"showOnProfileCard"`
	FeaturedPlaylistID      *int64  `json:"featuredPlaylistId" validate:"omitempty,min=1"`
	MediaFolderID           *int64  `json:"mediaFolderId" validate:"omitempty,min=1"`
	PlaybackMode            string  `json:"playbackMode" validate:"omitempty,oneof=SEQUENTIAL SHUFFLE LOOP CAROUSEL"`
	CarouselEnabled         bool    `json:"carouselEnabled"`
	CarouselIntervalSeconds int     `json:"carouselIntervalSeconds" validate:"omitempty,min=3,max=60"`
	RandomEnabled           bool    `json:"randomEnabled"`
	SkinMode                string  `json:"skinMode" validate:"omitempty,oneof=preset custom"`
	SkinPreset              string  `json:"skinPreset" validate:"omitempty,max=40"`
	SkinColorLight          *string `json:"skinColorLight" validate:"omitempty,max=32"`
	SkinColorDark           *string `json:"skinColorDark" validate:"omitempty,max=32"`
}
