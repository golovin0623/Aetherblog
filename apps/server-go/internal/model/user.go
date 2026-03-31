package model

import "time"

// User 对应数据库 `users` 表，表示系统中的一个注册用户账户。
type User struct {
	ID                 int64      `db:"id"`
	Username           string     `db:"username"`             // 登录用户名，全局唯一
	Email              string     `db:"email"`                // 用户邮箱，全局唯一
	PasswordHash       string     `db:"password_hash"`        // bcrypt 密码哈希；绝不在 API 响应中暴露
	Nickname           *string    `db:"nickname"`             // 显示昵称；nil 时回退使用 Username
	Avatar             *string    `db:"avatar"`               // 头像图片 URL；nil 时使用默认头像
	Bio                *string    `db:"bio"`                  // 用户个人简介，可为空
	Role               string     `db:"role"`                 // 权限角色：ADMIN（管理员）| AUTHOR（作者）| USER（普通用户）
	Status             string     `db:"status"`               // 账户状态：ACTIVE（正常）| INACTIVE（未激活）| BANNED（已封禁）
	LastLoginAt        *time.Time `db:"last_login_at"`        // 最近一次成功登录的时间戳，可为空
	LastLoginIP        *string    `db:"last_login_ip"`        // 最近一次成功登录时的 IP 地址，可为空
	MustChangePassword bool       `db:"must_change_password"` // 为 true 时客户端须在下次登录时强制提示修改密码
	CreatedAt          time.Time  `db:"created_at"`           // 账户创建时间
	UpdatedAt          time.Time  `db:"updated_at"`           // 账户最后更新时间
}
