package dto

import "time"

// Request DTOs

type CreateCommentRequest struct {
	Nickname string `json:"nickname" validate:"required,max=50"`
	Email    string `json:"email"    validate:"omitempty,email,max=100"`
	Website  string `json:"website"  validate:"omitempty,url,max=200"`
	Content  string `json:"content"  validate:"required,min=1,max=5000"`
	ParentID *int64 `json:"parentId"`
}

type BatchCommentRequest struct {
	IDs []int64 `json:"ids" validate:"required,min=1"`
}

// Response DTOs

type CommentVO struct {
	ID        int64             `json:"id"`
	PostID    int64             `json:"postId"`
	ParentID  *int64            `json:"parentId"`
	Nickname  string            `json:"nickname"`
	Email     *string           `json:"email,omitempty"`
	Website   *string           `json:"website,omitempty"`
	Avatar    *string           `json:"avatar,omitempty"`
	Content   string            `json:"content"`
	Status    string            `json:"status"`
	IP        *string           `json:"ip,omitempty"`
	IsAdmin   bool              `json:"isAdmin"`
	LikeCount int               `json:"likeCount"`
	CreatedAt *time.Time        `json:"createdAt"`
	Children  []CommentVO       `json:"children,omitempty"`
	Post      *CommentPostRef   `json:"post,omitempty"`
	Parent    *CommentParentRef `json:"parent,omitempty"`
}

type CommentPostRef struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
	Slug  string `json:"slug"`
}

type CommentParentRef struct {
	ID       int64  `json:"id"`
	Nickname string `json:"nickname"`
}

type CommentFilter struct {
	Status   string
	PostID   *int64
	Keyword  string
	PageNum  int
	PageSize int
}
