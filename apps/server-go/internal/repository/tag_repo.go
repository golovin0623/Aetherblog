package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// TagRepo provides data access for the tags table.
type TagRepo struct{ db *sqlx.DB }

// NewTagRepo creates a TagRepo backed by the given database connection.
func NewTagRepo(db *sqlx.DB) *TagRepo { return &TagRepo{db: db} }

// FindAll returns all tags ordered by post_count descending, then id ascending.
func (r *TagRepo) FindAll(ctx context.Context) ([]model.Tag, error) {
	var tags []model.Tag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM tags ORDER BY post_count DESC, id ASC`)
	return tags, err
}

// FindByID returns a tag by primary key, or nil if not found.
func (r *TagRepo) FindByID(ctx context.Context, id int64) (*model.Tag, error) {
	var t model.Tag
	err := r.db.GetContext(ctx, &t, `SELECT * FROM tags WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

// FindBySlug returns a tag by its URL slug, or nil if not found.
func (r *TagRepo) FindBySlug(ctx context.Context, slug string) (*model.Tag, error) {
	var t model.Tag
	err := r.db.GetContext(ctx, &t, `SELECT * FROM tags WHERE slug = $1`, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

// FindByName returns a tag by exact name match, or nil if not found.
func (r *TagRepo) FindByName(ctx context.Context, name string) (*model.Tag, error) {
	var t model.Tag
	err := r.db.GetContext(ctx, &t, `SELECT * FROM tags WHERE name = $1`, name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

// Create inserts a new tag with post_count initialised to 0, returning the created row.
func (r *TagRepo) Create(ctx context.Context, t *model.Tag) (*model.Tag, error) {
	var out model.Tag
	err := r.db.QueryRowxContext(ctx,
		`INSERT INTO tags (name, slug, description, color, post_count, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,0,NOW(),NOW()) RETURNING *`,
		t.Name, t.Slug, t.Description, t.Color,
	).StructScan(&out)
	return &out, err
}

// Update modifies an existing tag's mutable fields, returning the updated row.
func (r *TagRepo) Update(ctx context.Context, id int64, t *model.Tag) (*model.Tag, error) {
	var out model.Tag
	err := r.db.QueryRowxContext(ctx,
		`UPDATE tags SET name=$1, slug=$2, description=$3, color=$4, updated_at=NOW()
		 WHERE id=$5 RETURNING *`,
		t.Name, t.Slug, t.Description, t.Color, id,
	).StructScan(&out)
	return &out, err
}

// Delete permanently removes a tag by primary key.
// Associated post_tags rows are removed via ON DELETE CASCADE.
func (r *TagRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM tags WHERE id = $1`, id)
	return err
}
