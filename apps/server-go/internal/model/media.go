package model

import "time"

type MediaFile struct {
	ID                int64      `db:"id"`
	Filename          string     `db:"filename"`
	OriginalName      string     `db:"original_name"`
	FilePath          string     `db:"file_path"`
	FileURL           string     `db:"file_url"`
	FileSize          int64      `db:"file_size"`
	MimeType          *string    `db:"mime_type"`
	FileType          string     `db:"file_type"`
	StorageType       string     `db:"storage_type"`
	Width             *int       `db:"width"`
	Height            *int       `db:"height"`
	AltText           *string    `db:"alt_text"`
	UploaderID        *int64     `db:"uploader_id"`
	FolderID          *int64     `db:"folder_id"`
	StorageProviderID *int64     `db:"storage_provider_id"`
	CdnURL            *string    `db:"cdn_url"`
	Blurhash          *string    `db:"blurhash"`
	CurrentVersion    int        `db:"current_version"`
	IsArchived        bool       `db:"is_archived"`
	ArchivedAt        *time.Time `db:"archived_at"`
	ArchivedBy        *int64     `db:"archived_by"`
	Deleted           bool       `db:"deleted"`
	DeletedAt         *time.Time `db:"deleted_at"`
	CreatedAt         *time.Time `db:"created_at"`
}

type MediaFolder struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`
	Slug        string     `db:"slug"`
	Description *string    `db:"description"`
	ParentID    *int64     `db:"parent_id"`
	Path        string     `db:"path"`
	Depth       int        `db:"depth"`
	SortOrder   int        `db:"sort_order"`
	Color       *string    `db:"color"`
	Icon        *string    `db:"icon"`
	CoverImage  *string    `db:"cover_image"`
	OwnerID     *int64     `db:"owner_id"`
	Visibility  string     `db:"visibility"`
	FileCount   int        `db:"file_count"`
	TotalSize   int64      `db:"total_size"`
	CreatedBy   *int64     `db:"created_by"`
	UpdatedBy   *int64     `db:"updated_by"`
	CreatedAt   *time.Time `db:"created_at"`
	UpdatedAt   *time.Time `db:"updated_at"`
}

type StorageProvider struct {
	ID           int64      `db:"id"`
	Name         string     `db:"name"`
	ProviderType string     `db:"provider_type"`
	ConfigJSON   string     `db:"config_json"`
	IsDefault    bool       `db:"is_default"`
	IsEnabled    bool       `db:"is_enabled"`
	Priority     int        `db:"priority"`
	CreatedAt    *time.Time `db:"created_at"`
	UpdatedAt    *time.Time `db:"updated_at"`
}
