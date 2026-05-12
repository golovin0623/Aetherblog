package dto

import "time"

// PermissionVO 是权限矩阵中的单个权限项。
type PermissionVO struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Module      string  `json:"module"`
	Action      string  `json:"action"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

// RoleVO 是角色信息及其权限集合。
type RoleVO struct {
	ID          int64          `json:"id"`
	Code        string         `json:"code"`
	Name        string         `json:"name"`
	Description *string        `json:"description,omitempty"`
	IsSystem    bool           `json:"isSystem"`
	SortOrder   int            `json:"sortOrder"`
	Permissions []PermissionVO `json:"permissions"`
}

// ManagedUserVO 是管理后台用户列表中的用户视图。
type ManagedUserVO struct {
	ID                 int64      `json:"id"`
	Username           string     `json:"username"`
	Email              string     `json:"email"`
	Nickname           *string    `json:"nickname,omitempty"`
	Avatar             *string    `json:"avatar,omitempty"`
	Bio                *string    `json:"bio,omitempty"`
	Role               string     `json:"role"`
	Roles              []string   `json:"roles"`
	Status             string     `json:"status"`
	MustChangePassword bool       `json:"mustChangePassword"`
	LastLoginAt        *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

// CreateManagedUserRequest 是管理员创建用户的请求。
type CreateManagedUserRequest struct {
	Username           string   `json:"username" validate:"required,min=3,max=50"`
	Email              string   `json:"email" validate:"required,email,max=100"`
	Password           string   `json:"password" validate:"required,min=8,max=128,password_complexity"`
	Nickname           string   `json:"nickname" validate:"max=50"`
	RoleCodes          []string `json:"roleCodes"`
	Status             string   `json:"status" validate:"omitempty,oneof=ACTIVE INACTIVE BANNED"`
	MustChangePassword bool     `json:"mustChangePassword"`
}

// UpdateManagedUserRequest 是管理员更新用户资料、状态和角色的请求。
type UpdateManagedUserRequest struct {
	Email              *string  `json:"email" validate:"omitempty,email,max=100"`
	Nickname           *string  `json:"nickname" validate:"omitempty,max=50"`
	Bio                *string  `json:"bio"`
	Status             *string  `json:"status" validate:"omitempty,oneof=ACTIVE INACTIVE BANNED"`
	RoleCodes          []string `json:"roleCodes"`
	MustChangePassword *bool    `json:"mustChangePassword"`
}

// ResetUserPasswordRequest 是管理员重置用户密码的请求。
type ResetUserPasswordRequest struct {
	Password           string `json:"password" validate:"required,min=8,max=128,password_complexity"`
	MustChangePassword bool   `json:"mustChangePassword"`
}

// AssignUserRolesRequest 是管理员分配用户角色的请求。
type AssignUserRolesRequest struct {
	RoleCodes []string `json:"roleCodes" validate:"required,min=1"`
}

// UpdateRolePermissionsRequest 是更新角色权限集合的请求。
type UpdateRolePermissionsRequest struct {
	PermissionCodes []string `json:"permissionCodes" validate:"required"`
}

// TeamVO 是团队视图。
type TeamVO struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Description *string   `json:"description,omitempty"`
	OwnerID     *int64    `json:"ownerId,omitempty"`
	Visibility  string    `json:"visibility"`
	MemberCount int       `json:"memberCount"`
	CreatedBy   *int64    `json:"createdBy,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// TeamMemberVO 是团队成员视图。
type TeamMemberVO struct {
	TeamID     int64     `json:"teamId"`
	UserID     int64     `json:"userId"`
	Username   string    `json:"username"`
	Nickname   *string   `json:"nickname,omitempty"`
	Email      string    `json:"email"`
	MemberRole string    `json:"memberRole"`
	Status     string    `json:"status"`
	AddedBy    *int64    `json:"addedBy,omitempty"`
	JoinedAt   time.Time `json:"joinedAt"`
}

// CreateTeamRequest 是创建团队请求。
type CreateTeamRequest struct {
	Name        string  `json:"name" validate:"required,max=100"`
	Slug        string  `json:"slug" validate:"required,max=120"`
	Description *string `json:"description"`
	OwnerID     *int64  `json:"ownerId"`
	Visibility  string  `json:"visibility" validate:"omitempty,oneof=PRIVATE INTERNAL PUBLIC"`
}

// UpdateTeamRequest 是更新团队请求。
type UpdateTeamRequest struct {
	Name        *string `json:"name" validate:"omitempty,max=100"`
	Slug        *string `json:"slug" validate:"omitempty,max=120"`
	Description *string `json:"description"`
	OwnerID     *int64  `json:"ownerId"`
	Visibility  *string `json:"visibility" validate:"omitempty,oneof=PRIVATE INTERNAL PUBLIC"`
}

// UpsertTeamMemberRequest 是新增或更新团队成员请求。
type UpsertTeamMemberRequest struct {
	UserID     int64  `json:"userId" validate:"required"`
	MemberRole string `json:"memberRole" validate:"required,oneof=OWNER MANAGER MEMBER VIEWER"`
	Status     string `json:"status" validate:"omitempty,oneof=ACTIVE INVITED DISABLED"`
}

// ContentShareVO 是通用内容共享授权视图。
type ContentShareVO struct {
	ID              int64      `json:"id"`
	ResourceType    string     `json:"resourceType"`
	ResourceID      int64      `json:"resourceId"`
	PrincipalType   string     `json:"principalType"`
	PrincipalID     int64      `json:"principalId"`
	PermissionLevel string     `json:"permissionLevel"`
	GrantedBy       *int64     `json:"grantedBy,omitempty"`
	ExpiresAt       *time.Time `json:"expiresAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

// CreateContentShareRequest 是创建/覆盖内容共享授权请求。
type CreateContentShareRequest struct {
	ResourceType    string  `json:"resourceType" validate:"required,oneof=POST MEDIA_FILE MEDIA_FOLDER"`
	ResourceID      int64   `json:"resourceId" validate:"required"`
	PrincipalType   string  `json:"principalType" validate:"required,oneof=USER TEAM ROLE"`
	PrincipalID     int64   `json:"principalId" validate:"required"`
	PermissionLevel string  `json:"permissionLevel" validate:"required,oneof=VIEW COMMENT EDIT MANAGE"`
	ExpiresAt       *string `json:"expiresAt"`
}
