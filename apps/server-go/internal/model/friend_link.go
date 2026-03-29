package model

import "time"

// FriendLink maps the `friend_links` table.
type FriendLink struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`
	URL         string     `db:"url"`
	Logo        *string    `db:"logo"`
	Description *string    `db:"description"`
	Email       *string    `db:"email"`
	RSSUrl      *string    `db:"rss_url"`
	ThemeColor  *string    `db:"theme_color"`
	IsOnline    *bool      `db:"is_online"`
	LastCheckAt *time.Time `db:"last_check_at"`
	SortOrder   int        `db:"sort_order"`
	Visible     bool       `db:"visible"`
	CreatedAt   time.Time  `db:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at"`
}
