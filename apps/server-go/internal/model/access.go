package model

import "time"

// Permission 对应 permissions 表，表示一个可被角色授予的原子权限。
type Permission struct {
	ID          int64     `db:"id"`
	Code        string    `db:"code"`
	Module      string    `db:"module"`
	Action      string    `db:"action"`
	Name        string    `db:"name"`
	Description *string   `db:"description"`
	CreatedAt   time.Time `db:"created_at"`
}

// Role 对应 roles 表，表示一组权限集合。
type Role struct {
	ID          int64     `db:"id"`
	Code        string    `db:"code"`
	Name        string    `db:"name"`
	Description *string   `db:"description"`
	IsSystem    bool      `db:"is_system"`
	SortOrder   int       `db:"sort_order"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`
}

// Team 对应 teams 表，表示协作团队。
type Team struct {
	ID          int64     `db:"id"`
	Name        string    `db:"name"`
	Slug        string    `db:"slug"`
	Description *string   `db:"description"`
	OwnerID     *int64    `db:"owner_id"`
	Visibility  string    `db:"visibility"`
	CreatedBy   *int64    `db:"created_by"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`
}

// TeamMember 对应 team_members 表，表示团队成员关系。
type TeamMember struct {
	TeamID     int64     `db:"team_id"`
	UserID     int64     `db:"user_id"`
	MemberRole string    `db:"member_role"`
	Status     string    `db:"status"`
	AddedBy    *int64    `db:"added_by"`
	JoinedAt   time.Time `db:"joined_at"`
}

// ContentShare 对应 content_shares 表，表示对文章/媒体资源的共享授权。
type ContentShare struct {
	ID              int64      `db:"id"`
	ResourceType    string     `db:"resource_type"`
	ResourceID      int64      `db:"resource_id"`
	PrincipalType   string     `db:"principal_type"`
	PrincipalID     int64      `db:"principal_id"`
	PermissionLevel string     `db:"permission_level"`
	GrantedBy       *int64     `db:"granted_by"`
	ExpiresAt       *time.Time `db:"expires_at"`
	CreatedAt       time.Time  `db:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at"`
}
