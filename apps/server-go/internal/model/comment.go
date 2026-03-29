package model

import "time"

type Comment struct {
	ID        int64      `db:"id"`
	PostID    int64      `db:"post_id"`
	ParentID  *int64     `db:"parent_id"`
	Nickname  string     `db:"nickname"`
	Email     *string    `db:"email"`
	Website   *string    `db:"website"`
	Avatar    *string    `db:"avatar"`
	Content   string     `db:"content"`
	Status    string     `db:"status"`
	IP        *string    `db:"ip"`
	UserAgent *string    `db:"user_agent"`
	IsAdmin   bool       `db:"is_admin"`
	LikeCount int        `db:"like_count"`
	CreatedAt *time.Time `db:"created_at"`
	UpdatedAt *time.Time `db:"updated_at"`
}
