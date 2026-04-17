// Package repository 中的 jwt_secret_repo 封装 jwt_secrets 表的读写。
//
// 表由 migration 000033 创建，承载 JWT 签名密钥的定时轮换（见 SECURITY
// VULN-152 跟进）。读写在此集中实现，存量 auth 路径仍走 jwtkeys.Store 的
// 内存快照，从 DB 刷新的频率由 server.go 启动的 reloader 控制。
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

// JWTSecretStatus 枚举了 jwt_secrets.status 的合法取值。
type JWTSecretStatus string

const (
	JWTSecretCurrent  JWTSecretStatus = "current"
	JWTSecretPrevious JWTSecretStatus = "previous"
	JWTSecretRetired  JWTSecretStatus = "retired"
)

// JWTSecret 对应 jwt_secrets 表行。
type JWTSecret struct {
	ID          int64           `db:"id"`
	SecretValue string          `db:"secret_value"`
	Status      JWTSecretStatus `db:"status"`
	CreatedAt   time.Time       `db:"created_at"`
	PromotedAt  sql.NullTime    `db:"promoted_at"`
	DemotedAt   sql.NullTime    `db:"demoted_at"`
	RetiredAt   sql.NullTime    `db:"retired_at"`
	RetiresAt   sql.NullTime    `db:"retires_at"`
}

// ErrNoCurrentSecret 在期望至少存在一条 current 行的场景下，若表为空则返回此错误。
// 仅内部使用 —— 启动路径上应先调用 BootstrapIfEmpty。
var ErrNoCurrentSecret = errors.New("jwt_secrets: no current row")

// JWTSecretRepo 提供 jwt_secrets 表的 CRUD + 轮换事务。
type JWTSecretRepo struct {
	db *sqlx.DB
}

// NewJWTSecretRepo 构造一个新的 JWTSecretRepo。
func NewJWTSecretRepo(db *sqlx.DB) *JWTSecretRepo {
	return &JWTSecretRepo{db: db}
}

// ListActive 返回 current + previous 两条（若存在）。结果按 status 字典序
// 返回——调用方应按 Status 字段自行区分主键。
func (r *JWTSecretRepo) ListActive(ctx context.Context) ([]JWTSecret, error) {
	const q = `
		SELECT id, secret_value, status, created_at, promoted_at, demoted_at, retired_at, retires_at
		FROM jwt_secrets
		WHERE status IN ('current', 'previous')
		ORDER BY status
	`
	var rows []JWTSecret
	if err := r.db.SelectContext(ctx, &rows, q); err != nil {
		return nil, fmt.Errorf("list active jwt_secrets: %w", err)
	}
	return rows, nil
}

// BootstrapIfEmpty 在表完全为空时写入一条 current 行。
// 启动路径上由 Go 层调用：若运维还没手动轮换过，就用 .env 里的 JWT_SECRET 作 seed。
func (r *JWTSecretRepo) BootstrapIfEmpty(ctx context.Context, seed string) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("bootstrap begin tx: %w", err)
	}
	defer tx.Rollback()

	var count int
	if err := tx.GetContext(ctx, &count, "SELECT COUNT(*) FROM jwt_secrets"); err != nil {
		return fmt.Errorf("bootstrap count: %w", err)
	}
	if count > 0 {
		return nil
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO jwt_secrets (secret_value, status, promoted_at)
		VALUES ($1, 'current', NOW())
	`, seed)
	if err != nil {
		return fmt.Errorf("bootstrap insert: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("bootstrap commit: %w", err)
	}
	return nil
}

// Rotate 在单个事务内完成：
//  1. 若已有 previous 且未到 retires_at：不动；否则把它改成 retired（单一 previous 槽位）。
//  2. 把当前 current demote 成 previous，写入 demoted_at + retires_at=now+grace。
//  3. 插入 newSecret 作为新的 current。
//
// 返回新插入行的 id。grace 为 previous 在只验不签模式下的保留时长。
func (r *JWTSecretRepo) Rotate(ctx context.Context, newSecret string, grace time.Duration) (int64, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("rotate begin tx: %w", err)
	}
	defer tx.Rollback()

	// 1. 把旧的 previous 标为 retired —— 腾出 previous 槽位。
	if _, err := tx.ExecContext(ctx, `
		UPDATE jwt_secrets
		SET status='retired', retired_at=NOW()
		WHERE status='previous'
	`); err != nil {
		return 0, fmt.Errorf("rotate retire old previous: %w", err)
	}

	// 2. current → previous。若当前没有 current（边缘场景：首次启动后 DB
	//    被清空）则跳过 demote，直接插入新 current。
	demoted, err := tx.ExecContext(ctx, `
		UPDATE jwt_secrets
		SET status='previous', demoted_at=NOW(), retires_at=NOW() + $1::interval
		WHERE status='current'
	`, fmt.Sprintf("%d seconds", int64(grace.Seconds())))
	if err != nil {
		return 0, fmt.Errorf("rotate demote current: %w", err)
	}
	if n, _ := demoted.RowsAffected(); n > 1 {
		return 0, fmt.Errorf("rotate: invariant broken — %d rows with status=current", n)
	}

	// 3. 新 current。
	var id int64
	if err := tx.QueryRowxContext(ctx, `
		INSERT INTO jwt_secrets (secret_value, status, promoted_at)
		VALUES ($1, 'current', NOW())
		RETURNING id
	`, newSecret).Scan(&id); err != nil {
		return 0, fmt.Errorf("rotate insert new current: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("rotate commit: %w", err)
	}
	return id, nil
}

// PurgeExpiredPrevious 把已到 retires_at 的 previous 行标为 retired。
// 轮换 goroutine 每次 tick 调用一次，保证 Verifiers() 不再返回已经越界的 key。
func (r *JWTSecretRepo) PurgeExpiredPrevious(ctx context.Context) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		UPDATE jwt_secrets
		SET status='retired', retired_at=NOW()
		WHERE status='previous' AND retires_at IS NOT NULL AND retires_at <= NOW()
	`)
	if err != nil {
		return 0, fmt.Errorf("purge expired previous: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}
