package model

import "time"

// FolderPermission 对应数据库 `folder_permissions` 表，记录用户对媒体文件夹的访问权限。
// 每条记录授予指定用户对特定文件夹的某一级别权限，可设置有效期。
type FolderPermission struct {
	ID              int64      `db:"id"`               // 权限记录主键 ID
	FolderID        int64      `db:"folder_id"`        // 目标文件夹 ID（外键，关联 media_folders）
	UserID          int64      `db:"user_id"`          // 被授权用户 ID（外键，关联 users）
	PermissionLevel string     `db:"permission_level"` // 权限级别（如 "read"、"write"、"admin"）
	GrantedBy       *int64     `db:"granted_by"`       // 授权操作执行者的用户 ID，可为空
	GrantedAt       *time.Time `db:"granted_at"`       // 权限授予时间，可为空
	ExpiresAt       *time.Time `db:"expires_at"`       // 权限到期时间；nil 表示永久有效
}
