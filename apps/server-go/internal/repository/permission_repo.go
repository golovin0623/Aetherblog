package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// PermissionRepo provides data access for the folder_permissions table.
type PermissionRepo struct{ db *sqlx.DB }

// NewPermissionRepo creates a PermissionRepo backed by the given database connection.
func NewPermissionRepo(db *sqlx.DB) *PermissionRepo { return &PermissionRepo{db: db} }

// FindByFolderID returns all permissions granted on a folder, ordered by granted_at descending.
func (r *PermissionRepo) FindByFolderID(ctx context.Context, folderID int64) ([]model.FolderPermission, error) {
	var perms []model.FolderPermission
	err := r.db.SelectContext(ctx, &perms, `SELECT * FROM folder_permissions WHERE folder_id=$1 ORDER BY granted_at DESC`, folderID)
	return perms, err
}

// FindByID returns a folder permission entry by primary key, or nil if not found.
func (r *PermissionRepo) FindByID(ctx context.Context, id int64) (*model.FolderPermission, error) {
	var p model.FolderPermission
	err := r.db.GetContext(ctx, &p, `SELECT * FROM folder_permissions WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// Create inserts a new folder permission grant and back-fills the generated ID and granted_at.
func (r *PermissionRepo) Create(ctx context.Context, p *model.FolderPermission) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO folder_permissions (folder_id, user_id, permission_level, granted_by, expires_at)
		VALUES ($1,$2,$3,$4,$5) RETURNING id, granted_at`,
		p.FolderID, p.UserID, p.PermissionLevel, p.GrantedBy, p.ExpiresAt,
	).Scan(&p.ID, &p.GrantedAt)
}

// Update modifies the permission_level and optional expiry of an existing grant.
// Passing nil for expiresAt clears any existing expiry (grant never expires).
func (r *PermissionRepo) Update(ctx context.Context, id int64, permissionLevel string, expiresAt *string) error {
	if expiresAt != nil {
		_, err := r.db.ExecContext(ctx, `UPDATE folder_permissions SET permission_level=$1, expires_at=$2 WHERE id=$3`, permissionLevel, *expiresAt, id)
		return err
	}
	_, err := r.db.ExecContext(ctx, `UPDATE folder_permissions SET permission_level=$1, expires_at=NULL WHERE id=$2`, permissionLevel, id)
	return err
}

// Delete permanently removes a folder permission grant.
func (r *PermissionRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM folder_permissions WHERE id=$1`, id)
	return err
}
