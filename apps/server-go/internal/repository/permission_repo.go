package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// PermissionRepo 提供对 folder_permissions 表的数据访问能力。
type PermissionRepo struct{ db *sqlx.DB }

// NewPermissionRepo 创建一个由指定数据库连接支撑的 PermissionRepo 实例。
func NewPermissionRepo(db *sqlx.DB) *PermissionRepo { return &PermissionRepo{db: db} }

// FindByFolderID 查询指定文件夹的所有权限记录，按 granted_at 倒序排列。
// 操作表：folder_permissions；参数 folderID 为目标文件夹主键。
func (r *PermissionRepo) FindByFolderID(ctx context.Context, folderID int64) ([]model.FolderPermission, error) {
	var perms []model.FolderPermission
	err := r.db.SelectContext(ctx, &perms, `SELECT * FROM folder_permissions WHERE folder_id=$1 ORDER BY granted_at DESC`, folderID)
	return perms, err
}

// FindByID 根据主键查询单条权限记录，不存在时返回 nil。
// 操作表：folder_permissions；参数 id 为权限记录主键。
func (r *PermissionRepo) FindByID(ctx context.Context, id int64) (*model.FolderPermission, error) {
	var p model.FolderPermission
	err := r.db.GetContext(ctx, &p, `SELECT * FROM folder_permissions WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 记录不存在，返回 nil 而非错误
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// Create 向 folder_permissions 表插入一条新的权限授权记录，
// 并将数据库生成的 id 和 granted_at 回填到传入的结构体中。
func (r *PermissionRepo) Create(ctx context.Context, p *model.FolderPermission) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO folder_permissions (folder_id, user_id, permission_level, granted_by, expires_at)
		VALUES ($1,$2,$3,$4,$5) RETURNING id, granted_at`,
		p.FolderID, p.UserID, p.PermissionLevel, p.GrantedBy, p.ExpiresAt,
	).Scan(&p.ID, &p.GrantedAt)
}

// Update 修改指定权限记录的 permission_level 和有效期（expires_at）。
// 若 expiresAt 为 nil，则将数据库中的 expires_at 设为 NULL，表示永久有效。
func (r *PermissionRepo) Update(ctx context.Context, id int64, permissionLevel string, expiresAt *string) error {
	if expiresAt != nil {
		// 有截止时间：更新权限等级和过期时间
		_, err := r.db.ExecContext(ctx, `UPDATE folder_permissions SET permission_level=$1, expires_at=$2 WHERE id=$3`, permissionLevel, *expiresAt, id)
		return err
	}
	// 无截止时间：清空过期时间字段，授权永不过期
	_, err := r.db.ExecContext(ctx, `UPDATE folder_permissions SET permission_level=$1, expires_at=NULL WHERE id=$2`, permissionLevel, id)
	return err
}

// Delete 根据主键永久删除一条文件夹权限授权记录。
// 操作表：folder_permissions；参数 id 为权限记录主键。
func (r *PermissionRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM folder_permissions WHERE id=$1`, id)
	return err
}
