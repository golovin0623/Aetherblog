package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// MediaTagRepo provides data access for media_tags and the media_file_tags join table.
type MediaTagRepo struct{ db *sqlx.DB }

// NewMediaTagRepo creates a MediaTagRepo backed by the given database connection.
func NewMediaTagRepo(db *sqlx.DB) *MediaTagRepo { return &MediaTagRepo{db: db} }

// FindAll returns all media tags ordered by usage_count descending, then name.
func (r *MediaTagRepo) FindAll(ctx context.Context) ([]model.MediaTag, error) {
	var tags []model.MediaTag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM media_tags ORDER BY usage_count DESC, name ASC`)
	return tags, err
}

// FindPopular returns the top N tags by usage_count.
func (r *MediaTagRepo) FindPopular(ctx context.Context, limit int) ([]model.MediaTag, error) {
	var tags []model.MediaTag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM media_tags ORDER BY usage_count DESC LIMIT $1`, limit)
	return tags, err
}

// Search returns tags whose name or slug contains keyword (case-insensitive).
func (r *MediaTagRepo) Search(ctx context.Context, keyword string) ([]model.MediaTag, error) {
	var tags []model.MediaTag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM media_tags WHERE name ILIKE $1 OR slug ILIKE $1 ORDER BY usage_count DESC`, "%"+keyword+"%")
	return tags, err
}

// FindByID returns a media tag by primary key, or nil if not found.
func (r *MediaTagRepo) FindByID(ctx context.Context, id int64) (*model.MediaTag, error) {
	var t model.MediaTag
	err := r.db.GetContext(ctx, &t, `SELECT * FROM media_tags WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

// Create inserts a new media tag and back-fills the generated ID and timestamps.
func (r *MediaTagRepo) Create(ctx context.Context, t *model.MediaTag) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO media_tags (name, slug, description, color, category)
		VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at, updated_at`,
		t.Name, t.Slug, t.Description, t.Color, t.Category,
	).Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt)
}

// Delete permanently removes a media tag by primary key.
func (r *MediaTagRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_tags WHERE id=$1`, id)
	return err
}

// FindTagsByFileID returns all tags assigned to a media file via the join table.
func (r *MediaTagRepo) FindTagsByFileID(ctx context.Context, fileID int64) ([]model.MediaTag, error) {
	var tags []model.MediaTag
	err := r.db.SelectContext(ctx, &tags, `
		SELECT t.* FROM media_tags t
		INNER JOIN media_file_tags ft ON ft.tag_id = t.id
		WHERE ft.media_file_id = $1
		ORDER BY t.name ASC`, fileID)
	return tags, err
}

// TagFile associates a tag with a media file (MANUAL source). Silently ignores duplicates.
func (r *MediaTagRepo) TagFile(ctx context.Context, fileID int64, tagID int64, taggedBy *int64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO media_file_tags (media_file_id, tag_id, tagged_by, source)
		VALUES ($1,$2,$3,'MANUAL')
		ON CONFLICT (media_file_id, tag_id) DO NOTHING`, fileID, tagID, taggedBy)
	return err
}

// UntagFile removes the association between a tag and a media file.
func (r *MediaTagRepo) UntagFile(ctx context.Context, fileID int64, tagID int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_file_tags WHERE media_file_id=$1 AND tag_id=$2`, fileID, tagID)
	return err
}

// IncrementUsageCount adjusts a tag's usage_count by delta (positive to increment, negative to decrement).
func (r *MediaTagRepo) IncrementUsageCount(ctx context.Context, tagID int64, delta int) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_tags SET usage_count = usage_count + $1 WHERE id=$2`, delta, tagID)
	return err
}

// CountFileTag returns 1 if the file-tag association exists, 0 otherwise.
func (r *MediaTagRepo) CountFileTag(ctx context.Context, fileID int64, tagID int64) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM media_file_tags WHERE media_file_id=$1 AND tag_id=$2`, fileID, tagID).Scan(&n)
	return n, err
}
