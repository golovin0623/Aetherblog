package dto

import "time"

type CategoryRequest struct {
	Name        string  `json:"name"        validate:"required,max=100"`
	Slug        string  `json:"slug"        validate:"required,max=100"`
	Description *string `json:"description"`
	CoverImage  *string `json:"coverImage"`
	Icon        *string `json:"icon"`
	ParentID    *int64  `json:"parentId"`
	SortOrder   int     `json:"sortOrder"`
}

type CategoryVO struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Slug        string     `json:"slug"`
	Description *string    `json:"description"`
	CoverImage  *string    `json:"coverImage"`
	Icon        *string    `json:"icon"`
	ParentID    *int64     `json:"parentId"`
	SortOrder   int        `json:"sortOrder"`
	PostCount   int        `json:"postCount"`
	Children    []CategoryVO `json:"children,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}
