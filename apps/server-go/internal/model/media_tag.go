package model

import "time"

// MediaTag maps to the media_tags table.
type MediaTag struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`
	Slug        string     `db:"slug"`
	Description *string    `db:"description"`
	Color       string     `db:"color"`
	Category    string     `db:"category"`
	UsageCount  int        `db:"usage_count"`
	CreatedAt   *time.Time `db:"created_at"`
	UpdatedAt   *time.Time `db:"updated_at"`
}

// MediaFileTag maps to the media_file_tags table.
type MediaFileTag struct {
	MediaFileID int64      `db:"media_file_id"`
	TagID       int64      `db:"tag_id"`
	TaggedAt    *time.Time `db:"tagged_at"`
	TaggedBy    *int64     `db:"tagged_by"`
	Source      string     `db:"source"`
}
