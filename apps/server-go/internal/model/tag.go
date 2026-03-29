package model

import "time"

// Tag maps the `tags` table.
type Tag struct {
	ID          int64     `db:"id"`
	Name        string    `db:"name"`
	Slug        string    `db:"slug"`
	Description *string   `db:"description"`
	Color       string    `db:"color"`
	PostCount   int       `db:"post_count"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`
}
