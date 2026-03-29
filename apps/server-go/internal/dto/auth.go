package dto

// LoginRequest is the body for POST /api/v1/auth/login.
type LoginRequest struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

// RegisterRequest is the body for POST /api/v1/auth/register.
type RegisterRequest struct {
	Username string `json:"username" validate:"required,min=3,max=50"`
	Email    string `json:"email"    validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
	Nickname string `json:"nickname" validate:"max=50"`
}

// ChangePasswordRequest is the body for POST /api/v1/auth/change-password.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword" validate:"required"`
	NewPassword     string `json:"newPassword"     validate:"required,min=8"`
}

// UpdateProfileRequest is the body for PUT /api/v1/auth/profile.
type UpdateProfileRequest struct {
	Nickname string `json:"nickname" validate:"max=50"`
	Email    string `json:"email"    validate:"required,email"`
}

// UpdateAvatarRequest is the body for PUT /api/v1/auth/avatar.
type UpdateAvatarRequest struct {
	AvatarURL string `json:"avatarUrl" validate:"required,url"`
}

// UserInfoVO is the embedded user object in auth responses.
type UserInfoVO struct {
	ID       int64   `json:"id"`
	Username string  `json:"username"`
	Email    string  `json:"email"`
	Nickname *string `json:"nickname"`
	Avatar   *string `json:"avatar"`
	Role     string  `json:"role"`
}

// LoginResponse is the data field for login/refresh responses.
type LoginResponse struct {
	AccessToken        string     `json:"accessToken"`
	TokenType          string     `json:"tokenType"`
	ExpiresIn          int64      `json:"expiresIn"`
	MustChangePassword bool       `json:"mustChangePassword"`
	UserInfo           UserInfoVO `json:"userInfo"`
}
