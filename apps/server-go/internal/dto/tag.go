package dto

import "time"

type TagRequest struct {
	Name        string  `json:"name"        validate:"required,max=50"`
	Slug        string  `json:"slug"        validate:"omitempty,max=50"`
	Description *string `json:"description"`
	Color       string  `json:"color"`
}

type TagVO struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Description *string   `json:"description"`
	Color       string    `json:"color"`
	PostCount   int       `json:"postCount"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
