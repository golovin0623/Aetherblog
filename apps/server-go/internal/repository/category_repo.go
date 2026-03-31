package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// CategoryRepo 负责对 categories 表进行数据访问操作。
type CategoryRepo struct{ db *sqlx.DB }

// NewCategoryRepo 创建一个使用给定数据库连接的 CategoryRepo 实例。
func NewCategoryRepo(db *sqlx.DB) *CategoryRepo { return &CategoryRepo{db: db} }

// FindAll 从 categories 表返回所有分类，按 sort_order 升序、id 升序排列。
// 通常被 CategoryService.ListTree 调用以构建分类树结构。
func (r *CategoryRepo) FindAll(ctx context.Context) ([]model.Category, error) {
	var cats []model.Category
	err := r.db.SelectContext(ctx, &cats, `SELECT * FROM categories ORDER BY sort_order ASC, id ASC`)
	return cats, err
}

// FindByID 从 categories 表按主键查询单个分类，若不存在则返回 nil。
func (r *CategoryRepo) FindByID(ctx context.Context, id int64) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// FindBySlug 从 categories 表按 URL slug 查询单个分类，若不存在则返回 nil。
func (r *CategoryRepo) FindBySlug(ctx context.Context, slug string) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE slug = $1`, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// FindByName 从 categories 表按名称精确匹配查询单个分类，若不存在则返回 nil。
func (r *CategoryRepo) FindByName(ctx context.Context, name string) (*model.Category, error) {
	var c model.Category
	err := r.db.GetContext(ctx, &c, `SELECT * FROM categories WHERE name = $1`, name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// ExistsPostsInCategory 检查指定分类下是否存在未删除的文章。
// 返回 true 表示该分类仍有文章，调用方应阻止删除该分类。
func (r *CategoryRepo) ExistsPostsInCategory(ctx context.Context, id int64) (bool, error) {
	var count int
	err := r.db.GetContext(ctx, &count,
		`SELECT COUNT(*) FROM posts WHERE category_id = $1 AND deleted = false`, id)
	return count > 0, err
}

// Create 向 categories 表插入新分类，post_count 初始化为 0，created_at/updated_at 由数据库自动填充，
// 使用 RETURNING * 回填完整的创建后行数据。
func (r *CategoryRepo) Create(ctx context.Context, c *model.Category) (*model.Category, error) {
	var out model.Category
	err := r.db.QueryRowxContext(ctx,
		`INSERT INTO categories (name, slug, description, cover_image, icon, parent_id, sort_order, post_count, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,0,NOW(),NOW()) RETURNING *`,
		c.Name, c.Slug, c.Description, c.CoverImage, c.Icon, c.ParentID, c.SortOrder,
	).StructScan(&out)
	return &out, err
}

// Update 修改 categories 表中指定分类的可变字段，updated_at 由数据库自动更新，
// 使用 RETURNING * 返回更新后的完整行数据。
func (r *CategoryRepo) Update(ctx context.Context, id int64, c *model.Category) (*model.Category, error) {
	var out model.Category
	err := r.db.QueryRowxContext(ctx,
		`UPDATE categories SET name=$1, slug=$2, description=$3, cover_image=$4, icon=$5, parent_id=$6, sort_order=$7, updated_at=NOW()
		 WHERE id=$8 RETURNING *`,
		c.Name, c.Slug, c.Description, c.CoverImage, c.Icon, c.ParentID, c.SortOrder, id,
	).StructScan(&out)
	return &out, err
}

// Delete 从 categories 表中永久删除指定分类（物理删除）。
// 调用方需事先通过 ExistsPostsInCategory 确认该分类下没有文章。
func (r *CategoryRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM categories WHERE id = $1`, id)
	return err
}
