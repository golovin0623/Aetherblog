package model

import "time"

type MusicTrack struct {
	ID               int64      `db:"id"`
	MediaFileID      int64      `db:"media_file_id"`
	Title            string     `db:"title"`
	Artist           string     `db:"artist"`
	Album            string     `db:"album"`
	DurationSeconds  *int       `db:"duration_seconds"`
	CoverMediaFileID *int64     `db:"cover_media_file_id"`
	Lyric            *string    `db:"lyric"`
	Source           string     `db:"source"`
	Status           string     `db:"status"`
	SortOrder        int        `db:"sort_order"`
	IsFeatured       bool       `db:"is_featured"`
	PlayCount        int64      `db:"play_count"`
	CreatedAt        *time.Time `db:"created_at"`
	UpdatedAt        *time.Time `db:"updated_at"`
}

type MusicPlaylist struct {
	ID               int64      `db:"id"`
	Name             string     `db:"name"`
	Slug             string     `db:"slug"`
	Description      *string    `db:"description"`
	CoverMediaFileID *int64     `db:"cover_media_file_id"`
	Visibility       string     `db:"visibility"`
	Status           string     `db:"status"`
	DisplayOnHome    bool       `db:"display_on_home"`
	DisplayOnProfile bool       `db:"display_on_profile"`
	CarouselEnabled  bool       `db:"carousel_enabled"`
	RandomEnabled    bool       `db:"random_enabled"`
	SortOrder        int        `db:"sort_order"`
	CreatedAt        *time.Time `db:"created_at"`
	UpdatedAt        *time.Time `db:"updated_at"`
}

type MusicPlaylistTrack struct {
	PlaylistID int64      `db:"playlist_id"`
	TrackID    int64      `db:"track_id"`
	SortOrder  int        `db:"sort_order"`
	AddedAt    *time.Time `db:"added_at"`
}

type MusicSettings struct {
	ID                      int16      `db:"id"`
	Enabled                 bool       `db:"enabled"`
	ShowOnHomePage          bool       `db:"show_on_home_page"`
	ShowOnProfileCard       bool       `db:"show_on_profile_card"`
	FeaturedPlaylistID      *int64     `db:"featured_playlist_id"`
	MediaFolderID           *int64     `db:"media_folder_id"`
	PlaybackMode            string     `db:"playback_mode"`
	CarouselEnabled         bool       `db:"carousel_enabled"`
	CarouselIntervalSeconds int        `db:"carousel_interval_seconds"`
	RandomEnabled           bool       `db:"random_enabled"`
	CreatedAt               *time.Time `db:"created_at"`
	UpdatedAt               *time.Time `db:"updated_at"`
}
