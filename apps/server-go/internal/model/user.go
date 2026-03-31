package model

import "time"

// User maps the `users` table.
type User struct {
	ID                 int64      `db:"id"`
	Username           string     `db:"username"`
	Email              string     `db:"email"`
	PasswordHash       string     `db:"password_hash"`       // bcrypt hash; never exposed in API responses
	Nickname           *string    `db:"nickname"`            // Display name; falls back to Username when nil
	Avatar             *string    `db:"avatar"`              // Avatar image URL; nil = default avatar
	Bio                *string    `db:"bio"`                 // Short user biography
	Role               string     `db:"role"`                // Permission role: ADMIN | AUTHOR | USER
	Status             string     `db:"status"`              // Account state: ACTIVE | INACTIVE | BANNED
	LastLoginAt        *time.Time `db:"last_login_at"`       // Timestamp of the most recent successful login
	LastLoginIP        *string    `db:"last_login_ip"`       // IP address from the most recent successful login
	MustChangePassword bool       `db:"must_change_password"` // When true the client must prompt for a password change on next login
	CreatedAt          time.Time  `db:"created_at"`
	UpdatedAt          time.Time  `db:"updated_at"`
}
