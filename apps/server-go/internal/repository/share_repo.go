package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// ShareRepo provides data access for the media_shares table.
type ShareRepo struct{ db *sqlx.DB }

// NewShareRepo creates a ShareRepo backed by the given database connection.
func NewShareRepo(db *sqlx.DB) *ShareRepo { return &ShareRepo{db: db} }

// FindByID returns a share record by primary key, or nil if not found.
func (r *ShareRepo) FindByID(ctx context.Context, id int64) (*model.MediaShare, error) {
	var s model.MediaShare
	err := r.db.GetContext(ctx, &s, `SELECT * FROM media_shares WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

// FindByFileID returns all share records for a media file, ordered by created_at descending.
func (r *ShareRepo) FindByFileID(ctx context.Context, fileID int64) ([]model.MediaShare, error) {
	var shares []model.MediaShare
	err := r.db.SelectContext(ctx, &shares, `SELECT * FROM media_shares WHERE media_file_id=$1 ORDER BY created_at DESC`, fileID)
	return shares, err
}

// Create inserts a new share record and back-fills the generated ID and CreatedAt.
func (r *ShareRepo) Create(ctx context.Context, s *model.MediaShare) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO media_shares (share_token, media_file_id, folder_id, share_type, access_type, created_by, expires_at, max_access_count, password_hash)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
		s.ShareToken, s.MediaFileID, s.FolderID, s.ShareType, s.AccessType,
		s.CreatedBy, s.ExpiresAt, s.MaxAccessCount, s.PasswordHash,
	).Scan(&s.ID, &s.CreatedAt)
}

// Update modifies access settings of an existing share (access type, expiry, access limit, password).
func (r *ShareRepo) Update(ctx context.Context, id int64, accessType string, expiresAt *string, maxAccessCount *int, passwordHash *string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE media_shares SET access_type=$1, expires_at=$2, max_access_count=$3, password_hash=$4 WHERE id=$5`,
		accessType, expiresAt, maxAccessCount, passwordHash, id)
	return err
}

// Delete permanently removes a share record by primary key.
func (r *ShareRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_shares WHERE id=$1`, id)
	return err
}
