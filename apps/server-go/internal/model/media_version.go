package model

import "time"

// MediaVersion maps to the media_versions table.
type MediaVersion struct {
	ID                int64      `db:"id"`
	MediaFileID       int64      `db:"media_file_id"`
	VersionNumber     int        `db:"version_number"`
	FilePath          string     `db:"file_path"`
	FileURL           string     `db:"file_url"`
	FileSize          int64      `db:"file_size"`
	ChangeDescription *string    `db:"change_description"`
	CreatedBy         *int64     `db:"created_by"`
	CreatedAt         *time.Time `db:"created_at"`
}
