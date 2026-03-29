package model

import "time"

// Category maps the `categories` table.
type Category struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`
	Slug        string     `db:"slug"`
	Description *string    `db:"description"`
	CoverImage  *string    `db:"cover_image"`
	Icon        *string    `db:"icon"`
	ParentID    *int64     `db:"parent_id"`
	SortOrder   int        `db:"sort_order"`
	PostCount   int        `db:"post_count"`
	CreatedAt   time.Time  `db:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at"`
}
