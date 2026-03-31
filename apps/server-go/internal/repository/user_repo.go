// Package repository 为 AetherBlog 提供数据库访问对象（DAO）层。
// 每个 Repo 结构体封装一个 *sqlx.DB 实例，并对外暴露聚焦的查询方法。
// 所有方法均接受 context.Context 参数并返回 (value, error)；
// 当行不存在时返回 nil（而非 sql.ErrNoRows 错误）。
package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// UserRepo 提供对 users 表的数据访问能力。
type UserRepo struct {
	db *sqlx.DB
}

// NewUserRepo 创建一个由指定数据库连接支撑的 UserRepo 实例。
func NewUserRepo(db *sqlx.DB) *UserRepo {
	return &UserRepo{db: db}
}

// FindByUsername 根据用户名精确查询用户，不存在时返回 nil。
// 操作表：users；参数 username 须与数据库记录完全匹配。
func (r *UserRepo) FindByUsername(ctx context.Context, username string) (*model.User, error) {
	var u model.User
	err := r.db.GetContext(ctx, &u, `SELECT * FROM users WHERE username = $1 LIMIT 1`, username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

// FindByEmail 根据邮箱地址精确查询用户，不存在时返回 nil。
// 操作表：users；参数 email 须与数据库记录完全匹配。
func (r *UserRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	var u model.User
	err := r.db.GetContext(ctx, &u, `SELECT * FROM users WHERE email = $1 LIMIT 1`, email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

// FindByUsernameOrEmail 根据 identifier 匹配用户名或邮箱字段查询用户，不存在时返回 nil。
// 用于登录接口，允许用户使用用户名或邮箱任一方式登录。
func (r *UserRepo) FindByUsernameOrEmail(ctx context.Context, identifier string) (*model.User, error) {
	var u model.User
	err := r.db.GetContext(ctx, &u,
		`SELECT * FROM users WHERE username = $1 OR email = $1 LIMIT 1`, identifier)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

// FindByID 根据主键查询用户，不存在时返回 nil。
// 操作表：users；参数 id 为用户主键。
func (r *UserRepo) FindByID(ctx context.Context, id int64) (*model.User, error) {
	var u model.User
	err := r.db.GetContext(ctx, &u, `SELECT * FROM users WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

// Create 向 users 表插入一条新用户记录，角色默认为 USER，状态默认为 ACTIVE，
// must_change_password 初始化为 false，并返回完整的创建后记录。
func (r *UserRepo) Create(ctx context.Context, username, email, passwordHash, nickname string) (*model.User, error) {
	var u model.User
	err := r.db.QueryRowxContext(ctx,
		`INSERT INTO users (username, email, password_hash, nickname, role, status, must_change_password, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, 'USER', 'ACTIVE', false, NOW(), NOW())
		 RETURNING *`,
		username, email, passwordHash, nickname,
	).StructScan(&u)
	return &u, err
}

// UpdateLoginInfo 记录用户最近一次登录成功的时间戳和客户端 IP 地址。
// 操作表：users；同时更新 updated_at 时间戳。
func (r *UserRepo) UpdateLoginInfo(ctx context.Context, id int64, ip string) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET last_login_at = $1, last_login_ip = $2, updated_at = NOW() WHERE id = $3`,
		now, ip, id)
	return err
}

// UpdatePassword 更新用户的 bcrypt 密码哈希，并同时将 must_change_password 标志重置为 false。
// 操作表：users；参数 passwordHash 为新的 bcrypt 哈希值。
func (r *UserRepo) UpdatePassword(ctx context.Context, id int64, passwordHash string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2`,
		passwordHash, id)
	return err
}

// UpdateProfile 更新用户的昵称和邮箱，并返回更新后的完整用户记录。
// 操作表：users；自动更新 updated_at 时间戳。
func (r *UserRepo) UpdateProfile(ctx context.Context, id int64, nickname, email string) (*model.User, error) {
	var u model.User
	err := r.db.QueryRowxContext(ctx,
		`UPDATE users SET nickname = $1, email = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
		nickname, email, id,
	).StructScan(&u)
	return &u, err
}

// UpdateAvatar 更新用户的头像 URL。
// 操作表：users；参数 avatarURL 为新的头像地址字符串。
func (r *UserRepo) UpdateAvatar(ctx context.Context, id int64, avatarURL string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2`,
		avatarURL, id)
	return err
}
