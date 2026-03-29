package dto

import "time"

type FriendLinkRequest struct {
	Name        string  `json:"name"        validate:"required,max=100"`
	URL         string  `json:"url"         validate:"required,max=500"`
	Logo        *string `json:"logo"`
	Description *string `json:"description"`
	Email       *string `json:"email"`
	RSSUrl      *string `json:"rssUrl"`
	ThemeColor  *string `json:"themeColor"`
	IsOnline    *bool   `json:"isOnline"`
	SortOrder   int     `json:"sortOrder"`
	Visible     *bool   `json:"visible"`
}

type FriendLinkVO struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	URL         string     `json:"url"`
	Logo        *string    `json:"logo"`
	Description *string    `json:"description"`
	Email       *string    `json:"email"`
	RSSUrl      *string    `json:"rssUrl"`
	ThemeColor  *string    `json:"themeColor"`
	IsOnline    *bool      `json:"isOnline"`
	LastCheckAt *time.Time `json:"lastCheckAt"`
	SortOrder   int        `json:"sortOrder"`
	Visible     bool       `json:"visible"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type BatchDeleteRequest struct {
	IDs []int64 `json:"ids" validate:"required,min=1"`
}

type ReorderRequest struct {
	IDs []int64 `json:"ids" validate:"required"`
}
