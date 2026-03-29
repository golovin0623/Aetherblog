package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

type CategoryRepo struct{ db *sqlx.DB }

func NewCategoryRepo(db *sqlx.DB) *CategoryRepo { return &CategoryRepo{db: db} }

func (r *CategoryRepo) FindAll(ctx context.Context) ([]model.Category, error) {
	var cats []model.Category
	err := r.db.SelectContext(ctx, &cats, `SELECT * FROM categories ORDER BY sort_order ASC, id ASC`)
	return cats, err
}

func (r *CategoryRepo) FindByID(ctx context.Context, id int64) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

func (r *CategoryRepo) FindBySlug(ctx context.Context, slug string) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE slug = $1`, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

func (r *CategoryRepo) FindByName(ctx context.Context, name string) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE name = $1`, name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

func (r *CategoryRepo) ExistsPostsInCategory(ctx context.Context, id int64) (bool, error) {
	var count int
	err := r.db.GetContext(ctx, &count,
		`SELECT COUNT(*) FROM posts WHERE category_id = $1 AND deleted = false`, id)
	return count > 0, err
}

func (r *CategoryRepo) Create(ctx context.Context, c *model.Category) (*model.Category, error) {
	var out model.Category
	err := r.db.QueryRowxContext(ctx,
		`INSERT INTO categories (name, slug, description, cover_image, icon, parent_id, sort_order, post_count, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,0,NOW(),NOW()) RETURNING *`,
		c.Name, c.Slug, c.Description, c.CoverImage, c.Icon, c.ParentID, c.SortOrder,
	).StructScan(&out)
	return &out, err
}

func (r *CategoryRepo) Update(ctx context.Context, id int64, c *model.Category) (*model.Category, error) {
	var out model.Category
	err := r.db.QueryRowxContext(ctx,
		`UPDATE categories SET name=$1, slug=$2, description=$3, cover_image=$4, icon=$5, parent_id=$6, sort_order=$7, updated_at=NOW()
		 WHERE id=$8 RETURNING *`,
		c.Name, c.Slug, c.Description, c.CoverImage, c.Icon, c.ParentID, c.SortOrder, id,
	).StructScan(&out)
	return &out, err
}

func (r *CategoryRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM categories WHERE id = $1`, id)
	return err
}
