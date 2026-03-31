package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// FolderRepo provides data access for the media_folders table.
type FolderRepo struct{ db *sqlx.DB }

// NewFolderRepo creates a FolderRepo backed by the given database connection.
func NewFolderRepo(db *sqlx.DB) *FolderRepo { return &FolderRepo{db: db} }

// FindByID returns a folder by primary key, or nil if not found.
func (r *FolderRepo) FindByID(ctx context.Context, id int64) (*model.MediaFolder, error) {
	var f model.MediaFolder
	err := r.db.GetContext(ctx, &f, `SELECT * FROM media_folders WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

// FindAll returns all folders ordered by depth then sort_order then name.
func (r *FolderRepo) FindAll(ctx context.Context) ([]model.MediaFolder, error) {
	var fs []model.MediaFolder
	err := r.db.SelectContext(ctx, &fs, `SELECT * FROM media_folders ORDER BY depth ASC, sort_order ASC, name ASC`)
	return fs, err
}

// FindChildren returns all direct children of the given parent folder.
func (r *FolderRepo) FindChildren(ctx context.Context, parentID int64) ([]model.MediaFolder, error) {
	var fs []model.MediaFolder
	err := r.db.SelectContext(ctx, &fs, `SELECT * FROM media_folders WHERE parent_id=$1 ORDER BY sort_order ASC, name ASC`, parentID)
	return fs, err
}

// FolderRequest holds the mutable fields for creating or updating a media folder.
type FolderRequest struct {
	Name        string
	Description *string
	ParentID    *int64
	Color       *string
	Icon        *string
	Visibility  string
	OwnerID     *int64
}

// Create inserts a new folder and auto-computes path and depth from the parent.
func (r *FolderRepo) Create(ctx context.Context, req FolderRequest) (*model.MediaFolder, error) {
	slug := slugifySimple(req.Name)
	path, depth := r.computePathDepth(ctx, req.ParentID, slug)

	var f model.MediaFolder
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO media_folders (name, slug, description, parent_id, path, depth, color, icon, visibility, owner_id, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING *`,
		req.Name, slug, req.Description, req.ParentID, path, depth,
		req.Color, req.Icon, req.Visibility, req.OwnerID, req.OwnerID,
	).Scan(
		&f.ID, &f.Name, &f.Slug, &f.Description, &f.ParentID, &f.Path, &f.Depth, &f.SortOrder,
		&f.Color, &f.Icon, &f.CoverImage, &f.OwnerID, &f.Visibility, &f.FileCount, &f.TotalSize,
		&f.CreatedBy, &f.UpdatedBy, &f.CreatedAt, &f.UpdatedAt,
	)
	return &f, err
}

// Update modifies a folder's display properties (name, description, color, icon, visibility).
func (r *FolderRepo) Update(ctx context.Context, id int64, req FolderRequest) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE media_folders SET name=$1, description=$2, color=$3, icon=$4, visibility=$5, updated_by=$6 WHERE id=$7`,
		req.Name, req.Description, req.Color, req.Icon, req.Visibility, req.OwnerID, id)
	return err
}

// Delete permanently removes a folder by primary key.
func (r *FolderRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_folders WHERE id=$1`, id)
	return err
}

// Move re-parents a folder and recalculates its path and depth accordingly.
func (r *FolderRepo) Move(ctx context.Context, id int64, newParentID *int64, updatedBy *int64) error {
	slug := ""
	if err := r.db.QueryRowContext(ctx, `SELECT slug FROM media_folders WHERE id=$1`, id).Scan(&slug); err != nil {
		return err
	}
	path, depth := r.computePathDepth(ctx, newParentID, slug)
	_, err := r.db.ExecContext(ctx, `UPDATE media_folders SET parent_id=$1, path=$2, depth=$3, updated_by=$4 WHERE id=$5`,
		newParentID, path, depth, updatedBy, id)
	return err
}

// computePathDepth returns the path and depth for a folder given its parent.
func (r *FolderRepo) computePathDepth(ctx context.Context, parentID *int64, slug string) (string, int) {
	if parentID == nil {
		return slug, 0
	}
	var parentPath string
	var parentDepth int
	if err := r.db.QueryRowContext(ctx, `SELECT path, depth FROM media_folders WHERE id=$1`, *parentID).
		Scan(&parentPath, &parentDepth); err != nil {
		return slug, 0
	}
	return parentPath + "/" + slug, parentDepth + 1
}

func slugifySimple(s string) string {
	s = strings.ToLower(s)
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			sb.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '_' {
			sb.WriteRune('-')
		}
	}
	result := strings.Trim(sb.String(), "-")
	if result == "" {
		result = fmt.Sprintf("folder-%d", len(s))
	}
	return result
}
