package model

import "time"

// Note 对应后台私有 `notes` 表。它是独立内容域, 不进入博客文章发布体系。
type Note struct {
	ID                   int64      `db:"id"`
	Title                string     `db:"title"`
	ContentMarkdown      string     `db:"content_markdown"`
	Summary              *string    `db:"summary"`
	FolderID             *int64     `db:"folder_id"`
	AuthorID             *int64     `db:"author_id"`
	SourceType           string     `db:"source_type"`
	SourceURL            *string    `db:"source_url"`
	SourceTitle          *string    `db:"source_title"`
	SourceMeta           []byte     `db:"source_meta"`
	IsPinned             bool       `db:"is_pinned"`
	IsFavorite           bool       `db:"is_favorite"`
	Archived             bool       `db:"archived"`
	Deleted              bool       `db:"deleted"`
	WordCount            int        `db:"word_count"`
	EmbeddingStatus      string     `db:"embedding_status"`
	EmbeddingFingerprint *string    `db:"embedding_fingerprint"`
	EmbeddingProfileID   *int64     `db:"embedding_profile_id"`
	EmbeddingIndexedAt   *time.Time `db:"embedding_indexed_at"`
	EmbeddingError       *string    `db:"embedding_error"`
	EmbeddingAttemptID   *string    `db:"embedding_attempt_id"`
	LastOpenedAt         *time.Time `db:"last_opened_at"`
	CreatedAt            time.Time  `db:"created_at"`
	UpdatedAt            time.Time  `db:"updated_at"`
}

// NoteFolder 对应 `note_folders` 表。
type NoteFolder struct {
	ID        int64     `db:"id"`
	Name      string    `db:"name"`
	ParentID  *int64    `db:"parent_id"`
	SortOrder int       `db:"sort_order"`
	Deleted   bool      `db:"deleted"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

// NoteTag 对应 `note_tags` 表。
type NoteTag struct {
	ID        int64     `db:"id"`
	Name      string    `db:"name"`
	Color     string    `db:"color"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}
