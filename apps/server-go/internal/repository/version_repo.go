package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// VersionRepo 提供对 media_versions 表的数据访问能力。
type VersionRepo struct{ db *sqlx.DB }

// NewVersionRepo 创建一个由指定数据库连接支撑的 VersionRepo 实例。
func NewVersionRepo(db *sqlx.DB) *VersionRepo { return &VersionRepo{db: db} }

// FindByFileID 查询指定媒体文件的所有版本记录，按 version_number 倒序排列（最新版本在前）。
// 操作表：media_versions；参数 fileID 为媒体文件主键。
func (r *VersionRepo) FindByFileID(ctx context.Context, fileID int64) ([]model.MediaVersion, error) {
	var versions []model.MediaVersion
	err := r.db.SelectContext(ctx, &versions, `SELECT * FROM media_versions WHERE media_file_id=$1 ORDER BY version_number DESC`, fileID)
	return versions, err
}

// FindByID 根据主键查询单条版本记录，不存在时返回 nil。
// 操作表：media_versions；参数 id 为版本记录主键。
func (r *VersionRepo) FindByID(ctx context.Context, id int64) (*model.MediaVersion, error) {
	var v model.MediaVersion
	err := r.db.GetContext(ctx, &v, `SELECT * FROM media_versions WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 版本记录不存在，返回 nil 而非错误
			return nil, nil
		}
		return nil, err
	}
	return &v, nil
}

// FindByFileAndVersion 根据文件 ID 和版本号查询特定版本记录，不存在时返回 nil。
// 操作表：media_versions；参数 fileID 为媒体文件主键，versionNumber 为目标版本号。
func (r *VersionRepo) FindByFileAndVersion(ctx context.Context, fileID int64, versionNumber int) (*model.MediaVersion, error) {
	var v model.MediaVersion
	err := r.db.GetContext(ctx, &v, `SELECT * FROM media_versions WHERE media_file_id=$1 AND version_number=$2`, fileID, versionNumber)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 指定版本不存在，返回 nil 而非错误
			return nil, nil
		}
		return nil, err
	}
	return &v, nil
}

// Create 向 media_versions 表插入一条新版本记录，
// 并将数据库生成的 id 和 created_at 回填到传入的结构体中。
func (r *VersionRepo) Create(ctx context.Context, v *model.MediaVersion) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO media_versions (media_file_id, version_number, file_path, file_url, file_size, change_description, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
		v.MediaFileID, v.VersionNumber, v.FilePath, v.FileURL, v.FileSize, v.ChangeDescription, v.CreatedBy,
	).Scan(&v.ID, &v.CreatedAt)
}

// Delete 根据主键永久删除一条版本记录。
// 操作表：media_versions；参数 id 为版本记录主键。
func (r *VersionRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_versions WHERE id=$1`, id)
	return err
}

// GetMaxVersionNumber 查询指定媒体文件当前最大的版本号。
// 操作表：media_versions；使用 COALESCE(MAX(...), 0) 保证在无任何版本时返回 0。
func (r *VersionRepo) GetMaxVersionNumber(ctx context.Context, fileID int64) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_number), 0) FROM media_versions WHERE media_file_id=$1`, fileID).Scan(&n)
	return n, err
}
