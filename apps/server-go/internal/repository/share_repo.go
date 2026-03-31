package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// ShareRepo 提供对 media_shares 表的数据访问能力。
type ShareRepo struct{ db *sqlx.DB }

// NewShareRepo 创建一个由指定数据库连接支撑的 ShareRepo 实例。
func NewShareRepo(db *sqlx.DB) *ShareRepo { return &ShareRepo{db: db} }

// FindByID 根据主键查询单条分享记录，不存在时返回 nil。
// 操作表：media_shares；参数 id 为分享记录主键。
func (r *ShareRepo) FindByID(ctx context.Context, id int64) (*model.MediaShare, error) {
	var s model.MediaShare
	err := r.db.GetContext(ctx, &s, `SELECT * FROM media_shares WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 记录不存在，返回 nil 而非错误
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

// FindByFileID 查询指定媒体文件的所有分享记录，按 created_at 倒序排列。
// 操作表：media_shares；参数 fileID 为媒体文件主键。
func (r *ShareRepo) FindByFileID(ctx context.Context, fileID int64) ([]model.MediaShare, error) {
	var shares []model.MediaShare
	err := r.db.SelectContext(ctx, &shares, `SELECT * FROM media_shares WHERE media_file_id=$1 ORDER BY created_at DESC`, fileID)
	return shares, err
}

// Create 向 media_shares 表插入一条新的分享记录，
// 并将数据库生成的 id 和 created_at 回填到传入的结构体中。
func (r *ShareRepo) Create(ctx context.Context, s *model.MediaShare) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO media_shares (share_token, media_file_id, folder_id, share_type, access_type, created_by, expires_at, max_access_count, password_hash)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
		s.ShareToken, s.MediaFileID, s.FolderID, s.ShareType, s.AccessType,
		s.CreatedBy, s.ExpiresAt, s.MaxAccessCount, s.PasswordHash,
	).Scan(&s.ID, &s.CreatedAt)
}

// Update 修改指定分享记录的访问设置，包括访问类型、过期时间、最大访问次数和密码哈希。
// 操作表：media_shares；参数 id 为分享记录主键。
func (r *ShareRepo) Update(ctx context.Context, id int64, accessType string, expiresAt *string, maxAccessCount *int, passwordHash *string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE media_shares SET access_type=$1, expires_at=$2, max_access_count=$3, password_hash=$4 WHERE id=$5`,
		accessType, expiresAt, maxAccessCount, passwordHash, id)
	return err
}

// Delete 根据主键永久删除一条分享记录。
// 操作表：media_shares；参数 id 为分享记录主键。
func (r *ShareRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_shares WHERE id=$1`, id)
	return err
}
