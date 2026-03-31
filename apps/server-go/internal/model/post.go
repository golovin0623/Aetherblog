// Package model defines the database model structs that map 1-to-1 to
// PostgreSQL tables. Fields use sqlx `db` tags to match column names.
// Nullable columns are represented as pointer types.
package model

import "time"

// Post maps the `posts` table. A post is the primary content unit of the blog.
type Post struct {
	ID                 int64      `db:"id"`
	Title              string     `db:"title"`
	Slug               string     `db:"slug"`               // URL-friendly identifier; unique and non-nullable
	ContentMarkdown    *string    `db:"content_markdown"`   // Raw Markdown source; nil for imported posts without source
	ContentHTML        *string    `db:"content_html"`       // Pre-rendered HTML; may be nil when not yet rendered
	Summary            *string    `db:"summary"`            // Short excerpt; nil means auto-generated on the fly
	CoverImage         *string    `db:"cover_image"`        // Cover image URL; nil when no cover is set
	Status             string     `db:"status"`             // DRAFT | PUBLISHED | ARCHIVED | SCHEDULED
	CategoryID         *int64     `db:"category_id"`        // Foreign key to categories; nil = uncategorised
	AuthorID           *int64     `db:"author_id"`          // Foreign key to users; nil for imported legacy posts
	ViewCount          int64      `db:"view_count"`
	CommentCount       int64      `db:"comment_count"`
	LikeCount          int64      `db:"like_count"`
	WordCount          int        `db:"word_count"`         // Rune count of Markdown content; computed on save
	ReadingTime        int        `db:"reading_time"`       // Estimated reading time in minutes (words / 300)
	IsPinned           bool       `db:"is_pinned"`          // Pinned posts appear first in lists
	PinPriority        int        `db:"pin_priority"`       // Higher value = earlier in pinned ordering
	IsFeatured         bool       `db:"is_featured"`
	IsHidden           bool       `db:"is_hidden"`          // Hidden posts are excluded from public listings
	AllowComment       bool       `db:"allow_comment"`
	Password           *string    `db:"password"`           // bcrypt hash of access password; nil = public post
	SEOTitle           *string    `db:"seo_title"`
	SEODescription     *string    `db:"seo_description"`
	SEOKeywords        *string    `db:"seo_keywords"`
	EmbeddingStatus    string     `db:"embedding_status"`   // Vector embedding state: PENDING | INDEXED | FAILED
	Deleted            bool       `db:"deleted"`            // Soft-delete flag; deleted posts are excluded from all queries
	ScheduledAt        *time.Time `db:"scheduled_at"`       // Future publish time for SCHEDULED posts
	PublishedAt        *time.Time `db:"published_at"`       // Actual publish timestamp; nil for unpublished posts
	SourceKey          *string    `db:"source_key"`         // Optional external source identifier (e.g. import job ID)
	LegacyAuthorName   *string    `db:"legacy_author_name"` // Author name preserved from legacy system migration
	LegacyVisitedCount int64      `db:"legacy_visited_count"` // Visit count carried over from legacy system
	LegacyCopyright    *string    `db:"legacy_copyright"`   // Copyright text from legacy system
	CreatedAt          time.Time  `db:"created_at"`
	UpdatedAt          time.Time  `db:"updated_at"`
}
