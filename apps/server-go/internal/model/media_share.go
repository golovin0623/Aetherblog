package model

import "time"

// MediaShare 对应数据库 `media_shares` 表，表示一个媒体文件或文件夹的分享链接。
// 通过唯一令牌（ShareToken）提供外部访问，支持访问次数限制、密码保护和过期时间。
type MediaShare struct {
	ID             int64      `db:"id"`
	ShareToken     string     `db:"share_token"`      // 分享链接的唯一访问令牌
	MediaFileID    *int64     `db:"media_file_id"`    // 被分享的媒体文件 ID；nil 表示分享的是文件夹
	FolderID       *int64     `db:"folder_id"`        // 被分享的文件夹 ID；nil 表示分享的是单个文件
	ShareType      string     `db:"share_type"`       // 分享对象类型：file（文件）| folder（文件夹）
	AccessType     string     `db:"access_type"`      // 访问控制类型：public（公开）| password（密码保护）
	CreatedBy      *int64     `db:"created_by"`       // 创建分享的用户 ID，可为空
	CreatedAt      *time.Time `db:"created_at"`       // 分享创建时间
	ExpiresAt      *time.Time `db:"expires_at"`       // 分享过期时间；nil 表示永不过期
	AccessCount    int        `db:"access_count"`     // 已访问次数
	MaxAccessCount *int       `db:"max_access_count"` // 最大允许访问次数；nil 表示不限次数
	PasswordHash   *string    `db:"password_hash"`    // 访问密码的哈希值；nil 表示无密码保护
}
