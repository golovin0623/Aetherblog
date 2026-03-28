package model

import "time"

// User maps the `users` table.
type User struct {
	ID                 int64      `db:"id"`
	Username           string     `db:"username"`
	Email              string     `db:"email"`
	PasswordHash       string     `db:"password_hash"`
	Nickname           *string    `db:"nickname"`
	Avatar             *string    `db:"avatar"`
	Bio                *string    `db:"bio"`
	Role               string     `db:"role"`   // ADMIN | AUTHOR | USER
	Status             string     `db:"status"` // ACTIVE | INACTIVE | BANNED
	LastLoginAt        *time.Time `db:"last_login_at"`
	LastLoginIP        *string    `db:"last_login_ip"`
	MustChangePassword bool       `db:"must_change_password"`
	CreatedAt          time.Time  `db:"created_at"`
	UpdatedAt          time.Time  `db:"updated_at"`
}
