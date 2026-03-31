package model

import "time"

// Comment maps the `comments` table. Comments are submitted by visitors on published posts.
type Comment struct {
	ID        int64      `db:"id"`
	PostID    int64      `db:"post_id"`   // Foreign key to posts; required
	ParentID  *int64     `db:"parent_id"` // Parent comment ID for nested replies; nil = top-level comment
	Nickname  string     `db:"nickname"`  // Commenter's display name
	Email     *string    `db:"email"`     // Commenter's email (optional; used for Gravatar)
	Website   *string    `db:"website"`   // Commenter's website URL (optional)
	Avatar    *string    `db:"avatar"`    // Avatar image URL; nil = derived from email via Gravatar
	Content   string     `db:"content"`   // Comment body (plain text or limited Markdown)
	Status    string     `db:"status"`    // Moderation state: PENDING | APPROVED | REJECTED | SPAM
	IP        *string    `db:"ip"`        // Submitter's IP address (stored for anti-spam)
	UserAgent *string    `db:"user_agent"` // Submitter's User-Agent string (stored for anti-spam)
	IsAdmin   bool       `db:"is_admin"`  // True when the comment was posted by the blog admin
	LikeCount int        `db:"like_count"`
	CreatedAt *time.Time `db:"created_at"`
	UpdatedAt *time.Time `db:"updated_at"`
}
