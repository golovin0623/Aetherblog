package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// CategoryRepo provides data access for the categories table.
type CategoryRepo struct{ db *sqlx.DB }

// NewCategoryRepo creates a CategoryRepo backed by the given database connection.
func NewCategoryRepo(db *sqlx.DB) *CategoryRepo { return &CategoryRepo{db: db} }

// FindAll returns all categories ordered by sort_order then id.
// Used to build the category tree in CategoryService.ListTree.
func (r *CategoryRepo) FindAll(ctx context.Context) ([]model.Category, error) {
	var cats []model.Category
	err := r.db.SelectContext(ctx, &cats, `SELECT * FROM categories ORDER BY sort_order ASC, id ASC`)
	return cats, err
}

// FindByID returns a category by primary key, or nil if not found.
func (r *CategoryRepo) FindByID(ctx context.Context, id int64) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// FindBySlug returns a category by its URL slug, or nil if not found.
func (r *CategoryRepo) FindBySlug(ctx context.Context, slug string) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE slug = $1`, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// FindByName returns a category by exact name match, or nil if not found.
func (r *CategoryRepo) FindByName(ctx context.Context, name string) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE name = $1`, name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// ExistsPostsInCategory reports whether the category has any non-deleted posts.
// Used to guard against deleting a category that still owns posts.
func (r *CategoryRepo) ExistsPostsInCategory(ctx context.Context, id int64) (bool, error) {
	var count int
	err := r.db.GetContext(ctx, &count,
		`SELECT COUNT(*) FROM posts WHERE category_id = $1 AND deleted = false`, id)
	return count > 0, err
}

// Create inserts a new category with post_count initialised to 0, returning the created row.
func (r *CategoryRepo) Create(ctx context.Context, c *model.Category) (*model.Category, error) {
	var out model.Category
	err := r.db.QueryRowxContext(ctx,
		`INSERT INTO categories (name, slug, description, cover_image, icon, parent_id, sort_order, post_count, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,0,NOW(),NOW()) RETURNING *`,
		c.Name, c.Slug, c.Description, c.CoverImage, c.Icon, c.ParentID, c.SortOrder,
	).StructScan(&out)
	return &out, err
}

// Update modifies an existing category's mutable fields, returning the updated row.
func (r *CategoryRepo) Update(ctx context.Context, id int64, c *model.Category) (*model.Category, error) {
	var out model.Category
	err := r.db.QueryRowxContext(ctx,
		`UPDATE categories SET name=$1, slug=$2, description=$3, cover_image=$4, icon=$5, parent_id=$6, sort_order=$7, updated_at=NOW()
		 WHERE id=$8 RETURNING *`,
		c.Name, c.Slug, c.Description, c.CoverImage, c.Icon, c.ParentID, c.SortOrder, id,
	).StructScan(&out)
	return &out, err
}

// Delete permanently removes a category by primary key.
// The caller is responsible for verifying no posts exist in the category first.
func (r *CategoryRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM categories WHERE id = $1`, id)
	return err
}
