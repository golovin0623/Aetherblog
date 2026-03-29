package model

import "time"

// FolderPermission maps to the folder_permissions table.
type FolderPermission struct {
	ID              int64      `db:"id"`
	FolderID        int64      `db:"folder_id"`
	UserID          int64      `db:"user_id"`
	PermissionLevel string     `db:"permission_level"`
	GrantedBy       *int64     `db:"granted_by"`
	GrantedAt       *time.Time `db:"granted_at"`
	ExpiresAt       *time.Time `db:"expires_at"`
}
