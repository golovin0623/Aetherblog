package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// VersionRepo provides data access for the media_versions table.
type VersionRepo struct{ db *sqlx.DB }

// NewVersionRepo creates a VersionRepo backed by the given database connection.
func NewVersionRepo(db *sqlx.DB) *VersionRepo { return &VersionRepo{db: db} }

// FindByFileID returns all versions for a media file, ordered by version_number descending.
func (r *VersionRepo) FindByFileID(ctx context.Context, fileID int64) ([]model.MediaVersion, error) {
	var versions []model.MediaVersion
	err := r.db.SelectContext(ctx, &versions, `SELECT * FROM media_versions WHERE media_file_id=$1 ORDER BY version_number DESC`, fileID)
	return versions, err
}

// FindByID returns a version record by primary key, or nil if not found.
func (r *VersionRepo) FindByID(ctx context.Context, id int64) (*model.MediaVersion, error) {
	var v model.MediaVersion
	err := r.db.GetContext(ctx, &v, `SELECT * FROM media_versions WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &v, nil
}

// FindByFileAndVersion returns a specific version of a media file by file ID and version number, or nil if not found.
func (r *VersionRepo) FindByFileAndVersion(ctx context.Context, fileID int64, versionNumber int) (*model.MediaVersion, error) {
	var v model.MediaVersion
	err := r.db.GetContext(ctx, &v, `SELECT * FROM media_versions WHERE media_file_id=$1 AND version_number=$2`, fileID, versionNumber)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &v, nil
}

// Create inserts a new version record and back-fills the generated ID and CreatedAt.
func (r *VersionRepo) Create(ctx context.Context, v *model.MediaVersion) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO media_versions (media_file_id, version_number, file_path, file_url, file_size, change_description, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
		v.MediaFileID, v.VersionNumber, v.FilePath, v.FileURL, v.FileSize, v.ChangeDescription, v.CreatedBy,
	).Scan(&v.ID, &v.CreatedAt)
}

// Delete permanently removes a version record by primary key.
func (r *VersionRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_versions WHERE id=$1`, id)
	return err
}

// GetMaxVersionNumber returns the highest version_number for a file, or 0 if no versions exist.
func (r *VersionRepo) GetMaxVersionNumber(ctx context.Context, fileID int64) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_number), 0) FROM media_versions WHERE media_file_id=$1`, fileID).Scan(&n)
	return n, err
}
