package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// TagRepo 提供对 tags 表的数据访问能力。
type TagRepo struct{ db *sqlx.DB }

// NewTagRepo 创建一个由指定数据库连接支撑的 TagRepo 实例。
func NewTagRepo(db *sqlx.DB) *TagRepo { return &TagRepo{db: db} }

// FindAll 返回所有标签，按 post_count 降序后按 id 升序排列。
// 操作表：tags；热门标签（文章数多）排在前面。
func (r *TagRepo) FindAll(ctx context.Context) ([]model.Tag, error) {
	var tags []model.Tag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM tags ORDER BY post_count DESC, id ASC`)
	return tags, err
}

// FindByID 根据主键查询单个标签，不存在时返回 nil。
// 操作表：tags；参数 id 为标签主键。
func (r *TagRepo) FindByID(ctx context.Context, id int64) (*model.Tag, error) {
	var t model.Tag
	err := r.db.GetContext(ctx, &t, `SELECT * FROM tags WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

// FindBySlug 根据 URL slug 查询单个标签，不存在时返回 nil。
// 操作表：tags；参数 slug 为标签的 URL 友好标识符。
func (r *TagRepo) FindBySlug(ctx context.Context, slug string) (*model.Tag, error) {
	var t model.Tag
	err := r.db.GetContext(ctx, &t, `SELECT * FROM tags WHERE slug = $1`, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

// FindByName 根据精确名称查询单个标签，不存在时返回 nil。
// 操作表：tags；参数 name 为标签显示名称，区分大小写。
func (r *TagRepo) FindByName(ctx context.Context, name string) (*model.Tag, error) {
	var t model.Tag
	err := r.db.GetContext(ctx, &t, `SELECT * FROM tags WHERE name = $1`, name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

// Create 向 tags 表插入一条新标签记录，post_count 初始化为 0，并返回完整的创建后记录。
// 操作表：tags；使用 RETURNING * 获取数据库生成的 id 和时间戳。
func (r *TagRepo) Create(ctx context.Context, t *model.Tag) (*model.Tag, error) {
	var out model.Tag
	err := r.db.QueryRowxContext(ctx,
		`INSERT INTO tags (name, slug, description, color, post_count, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,0,NOW(),NOW()) RETURNING *`,
		t.Name, t.Slug, t.Description, t.Color,
	).StructScan(&out)
	return &out, err
}

// Update 修改指定标签的可变字段（name、slug、description、color），并返回更新后的完整记录。
// 操作表：tags；自动更新 updated_at 时间戳；参数 id 为标签主键。
func (r *TagRepo) Update(ctx context.Context, id int64, t *model.Tag) (*model.Tag, error) {
	var out model.Tag
	err := r.db.QueryRowxContext(ctx,
		`UPDATE tags SET name=$1, slug=$2, description=$3, color=$4, updated_at=NOW()
		 WHERE id=$5 RETURNING *`,
		t.Name, t.Slug, t.Description, t.Color, id,
	).StructScan(&out)
	return &out, err
}

// Delete 根据主键永久删除一个标签。
// 操作表：tags；关联的 post_tags 记录通过数据库 ON DELETE CASCADE 自动清除。
func (r *TagRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM tags WHERE id = $1`, id)
	return err
}
