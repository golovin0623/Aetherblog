package model

import "time"

// Post maps the `posts` table.
type Post struct {
	ID                 int64      `db:"id"`
	Title              string     `db:"title"`
	Slug               string     `db:"slug"`
	ContentMarkdown    *string    `db:"content_markdown"`
	ContentHTML        *string    `db:"content_html"`
	Summary            *string    `db:"summary"`
	CoverImage         *string    `db:"cover_image"`
	Status             string     `db:"status"` // DRAFT | PUBLISHED | ARCHIVED | SCHEDULED
	CategoryID         *int64     `db:"category_id"`
	AuthorID           *int64     `db:"author_id"`
	ViewCount          int64      `db:"view_count"`
	CommentCount       int64      `db:"comment_count"`
	LikeCount          int64      `db:"like_count"`
	WordCount          int        `db:"word_count"`
	ReadingTime        int        `db:"reading_time"`
	IsPinned           bool       `db:"is_pinned"`
	PinPriority        int        `db:"pin_priority"`
	IsFeatured         bool       `db:"is_featured"`
	IsHidden           bool       `db:"is_hidden"`
	AllowComment       bool       `db:"allow_comment"`
	Password           *string    `db:"password"`
	SEOTitle           *string    `db:"seo_title"`
	SEODescription     *string    `db:"seo_description"`
	SEOKeywords        *string    `db:"seo_keywords"`
	EmbeddingStatus    string     `db:"embedding_status"` // PENDING | INDEXED | FAILED
	Deleted            bool       `db:"deleted"`
	ScheduledAt        *time.Time `db:"scheduled_at"`
	PublishedAt        *time.Time `db:"published_at"`
	SourceKey          *string    `db:"source_key"`
	LegacyAuthorName   *string    `db:"legacy_author_name"`
	LegacyVisitedCount int64      `db:"legacy_visited_count"`
	LegacyCopyright    *string    `db:"legacy_copyright"`
	CreatedAt          time.Time  `db:"created_at"`
	UpdatedAt          time.Time  `db:"updated_at"`
}
