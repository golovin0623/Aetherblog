package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

type UserRepo struct {
	db *sqlx.DB
}

func NewUserRepo(db *sqlx.DB) *UserRepo {
	return &UserRepo{db: db}
}

func (r *UserRepo) FindByUsername(ctx context.Context, username string) (*model.User, error) {
	var u model.User
	err := r.db.GetContext(ctx, &u, `SELECT * FROM users WHERE username = $1 LIMIT 1`, username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

func (r *UserRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	var u model.User
	err := r.db.GetContext(ctx, &u, `SELECT * FROM users WHERE email = $1 LIMIT 1`, email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

func (r *UserRepo) FindByUsernameOrEmail(ctx context.Context, identifier string) (*model.User, error) {
	var u model.User
	err := r.db.GetContext(ctx, &u,
		`SELECT * FROM users WHERE username = $1 OR email = $1 LIMIT 1`, identifier)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

func (r *UserRepo) FindByID(ctx context.Context, id int64) (*model.User, error) {
	var u model.User
	err := r.db.GetContext(ctx, &u, `SELECT * FROM users WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &u, err
}

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

func (r *UserRepo) UpdateLoginInfo(ctx context.Context, id int64, ip string) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET last_login_at = $1, last_login_ip = $2, updated_at = NOW() WHERE id = $3`,
		now, ip, id)
	return err
}

func (r *UserRepo) UpdatePassword(ctx context.Context, id int64, passwordHash string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2`,
		passwordHash, id)
	return err
}

func (r *UserRepo) UpdateProfile(ctx context.Context, id int64, nickname, email string) (*model.User, error) {
	var u model.User
	err := r.db.QueryRowxContext(ctx,
		`UPDATE users SET nickname = $1, email = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
		nickname, email, id,
	).StructScan(&u)
	return &u, err
}

func (r *UserRepo) UpdateAvatar(ctx context.Context, id int64, avatarURL string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2`,
		avatarURL, id)
	return err
}
