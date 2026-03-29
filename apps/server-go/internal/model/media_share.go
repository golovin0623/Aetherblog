package model

import "time"

// MediaShare maps to the media_shares table.
type MediaShare struct {
	ID             int64      `db:"id"`
	ShareToken     string     `db:"share_token"`
	MediaFileID    *int64     `db:"media_file_id"`
	FolderID       *int64     `db:"folder_id"`
	ShareType      string     `db:"share_type"`
	AccessType     string     `db:"access_type"`
	CreatedBy      *int64     `db:"created_by"`
	CreatedAt      *time.Time `db:"created_at"`
	ExpiresAt      *time.Time `db:"expires_at"`
	AccessCount    int        `db:"access_count"`
	MaxAccessCount *int       `db:"max_access_count"`
	PasswordHash   *string    `db:"password_hash"`
}
