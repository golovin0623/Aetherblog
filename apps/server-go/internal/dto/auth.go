package dto

// LoginRequest 是 POST /api/v1/auth/login 接口的请求体 DTO。
type LoginRequest struct {
	Username string `json:"username" validate:"required"` // 用户名（必填）
	Password string `json:"password" validate:"required"` // 密码（必填）
}

// RegisterRequest 是 POST /api/v1/auth/register 接口的请求体 DTO。
type RegisterRequest struct {
	Username string `json:"username" validate:"required,min=3,max=50"` // 用户名，长度 3~50 个字符（必填）
	Email    string `json:"email"    validate:"required,email"`         // 电子邮箱地址（必填，需符合邮箱格式）
	Password string `json:"password" validate:"required,min=8,max=128"` // 密码，长度 8~128 个字符（必填）
	Nickname string `json:"nickname" validate:"max=50"`                 // 昵称，最多 50 个字符（可选）
}

// ChangePasswordRequest 是 POST /api/v1/auth/change-password 接口的请求体 DTO。
type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword" validate:"required"`      // 当前密码（必填）
	NewPassword     string `json:"newPassword"     validate:"required,min=8,max=128"` // 新密码，长度 8~128 个字符（必填）
}

// UpdateProfileRequest 是 PUT /api/v1/auth/profile 接口的请求体 DTO。
type UpdateProfileRequest struct {
	Nickname string `json:"nickname" validate:"max=50"`         // 昵称，最多 50 个字符（可选）
	Email    string `json:"email"    validate:"required,email"` // 电子邮箱地址（必填，需符合邮箱格式）
}

// UpdateAvatarRequest 是 PUT /api/v1/auth/avatar 接口的请求体 DTO。
type UpdateAvatarRequest struct {
	AvatarURL string `json:"avatarUrl" validate:"required,url"` // 头像图片的 URL 地址（必填，需为合法 URL）
}

// UserInfoVO 是登录及鉴权相关响应中内嵌的用户信息对象。
type UserInfoVO struct {
	ID       int64   `json:"id"`       // 用户唯一 ID
	Username string  `json:"username"` // 用户名
	Email    string  `json:"email"`    // 电子邮箱
	Nickname *string `json:"nickname"` // 昵称（可为空）
	Avatar   *string `json:"avatar"`   // 头像 URL（可为空）
	Role     string  `json:"role"`     // 用户角色（如 admin/user）
}

// LoginResponse 是登录及刷新 Token 接口响应中的数据字段 DTO。
type LoginResponse struct {
	AccessToken        string     `json:"accessToken"`        // JWT 访问令牌
	TokenType          string     `json:"tokenType"`          // Token 类型，通常为 "Bearer"
	ExpiresIn          int64      `json:"expiresIn"`          // Token 有效期（秒）
	MustChangePassword bool       `json:"mustChangePassword"` // 是否强制要求修改密码（首次登录时为 true）
	UserInfo           UserInfoVO `json:"userInfo"`           // 当前登录用户的基本信息
}
