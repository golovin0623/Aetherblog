package model

import "time"

// FriendLink maps the `friend_links` table. A friend link is an external site
// displayed in the blog's blogroll / links page.
type FriendLink struct {
	ID          int64      `db:"id"`
	Name        string     `db:"name"`           // Site name shown in the UI
	URL         string     `db:"url"`            // Homepage URL of the linked site
	Logo        *string    `db:"logo"`           // Logo image URL; nil = no logo
	Description *string    `db:"description"`    // Short description of the linked site
	Email       *string    `db:"email"`          // Contact email of the site owner (not displayed publicly)
	RSSUrl      *string    `db:"rss_url"`        // RSS/Atom feed URL for health checking
	ThemeColor  *string    `db:"theme_color"`    // Brand hex colour for card styling
	IsOnline    *bool      `db:"is_online"`      // Result of the last availability check; nil = not yet checked
	LastCheckAt *time.Time `db:"last_check_at"`  // Timestamp of the last availability check
	SortOrder   int        `db:"sort_order"`     // Display order; lower value = shown first
	Visible     bool       `db:"visible"`        // When false the link is hidden from the public page
	CreatedAt   time.Time  `db:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at"`
}
