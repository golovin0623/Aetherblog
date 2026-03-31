package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// MediaTagRepo 负责对 media_tags 表及 media_file_tags 关联表进行数据访问操作。
type MediaTagRepo struct{ db *sqlx.DB }

// NewMediaTagRepo 创建一个使用给定数据库连接的 MediaTagRepo 实例。
func NewMediaTagRepo(db *sqlx.DB) *MediaTagRepo { return &MediaTagRepo{db: db} }

// FindAll 从 media_tags 表返回所有媒体标签，按 usage_count 降序、name 升序排列。
func (r *MediaTagRepo) FindAll(ctx context.Context) ([]model.MediaTag, error) {
	var tags []model.MediaTag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM media_tags ORDER BY usage_count DESC, name ASC`)
	return tags, err
}

// FindPopular 从 media_tags 表按 usage_count 降序返回使用频率最高的前 N 个标签。
// limit 指定返回数量上限。
func (r *MediaTagRepo) FindPopular(ctx context.Context, limit int) ([]model.MediaTag, error) {
	var tags []model.MediaTag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM media_tags ORDER BY usage_count DESC LIMIT $1`, limit)
	return tags, err
}

// Search 从 media_tags 表按关键字模糊搜索标签名称或 slug（不区分大小写），按 usage_count 降序返回。
// keyword 支持部分匹配。
func (r *MediaTagRepo) Search(ctx context.Context, keyword string) ([]model.MediaTag, error) {
	var tags []model.MediaTag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM media_tags WHERE name ILIKE $1 OR slug ILIKE $1 ORDER BY usage_count DESC`, "%"+keyword+"%")
	return tags, err
}

// FindByID 从 media_tags 表按主键查询单个标签，若不存在则返回 nil。
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

// Create 向 media_tags 表插入新标签，通过 RETURNING 回填数据库生成的 id、created_at 和 updated_at。
func (r *MediaTagRepo) Create(ctx context.Context, t *model.MediaTag) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO media_tags (name, slug, description, color, category)
		VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at, updated_at`,
		t.Name, t.Slug, t.Description, t.Color, t.Category,
	).Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt)
}

// Delete 从 media_tags 表中永久删除指定标签（物理删除）。
func (r *MediaTagRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_tags WHERE id=$1`, id)
	return err
}

// FindTagsByFileID 通过 media_file_tags 关联表查询指定媒体文件的所有标签，按标签名称升序返回。
// 使用 INNER JOIN 连接 media_tags 和 media_file_tags，以 media_file_id 为过滤条件。
func (r *MediaTagRepo) FindTagsByFileID(ctx context.Context, fileID int64) ([]model.MediaTag, error) {
	var tags []model.MediaTag
	err := r.db.SelectContext(ctx, &tags, `
		SELECT t.* FROM media_tags t
		INNER JOIN media_file_tags ft ON ft.tag_id = t.id
		WHERE ft.media_file_id = $1
		ORDER BY t.name ASC`, fileID)
	return tags, err
}

// TagFile 在 media_file_tags 关联表中为媒体文件打上标签，来源标记为 MANUAL（手动打标）。
// 使用 ON CONFLICT DO NOTHING 静默忽略重复关联，保证幂等性。
// taggedBy 为执行操作的用户 ID，nil 表示系统操作。
func (r *MediaTagRepo) TagFile(ctx context.Context, fileID int64, tagID int64, taggedBy *int64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO media_file_tags (media_file_id, tag_id, tagged_by, source)
		VALUES ($1,$2,$3,'MANUAL')
		ON CONFLICT (media_file_id, tag_id) DO NOTHING`, fileID, tagID, taggedBy)
	return err
}

// UntagFile 从 media_file_tags 关联表中移除媒体文件与指定标签的关联关系。
func (r *MediaTagRepo) UntagFile(ctx context.Context, fileID int64, tagID int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_file_tags WHERE media_file_id=$1 AND tag_id=$2`, fileID, tagID)
	return err
}

// IncrementUsageCount 对 media_tags 表中指定标签的 usage_count 字段进行原子性增减操作。
// delta 为正数时增加计数，为负数时减少计数。
func (r *MediaTagRepo) IncrementUsageCount(ctx context.Context, tagID int64, delta int) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_tags SET usage_count = usage_count + $1 WHERE id=$2`, delta, tagID)
	return err
}

// CountFileTag 查询 media_file_tags 关联表中指定文件与标签的关联是否存在。
// 返回 1 表示关联存在，返回 0 表示不存在。
func (r *MediaTagRepo) CountFileTag(ctx context.Context, fileID int64, tagID int64) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM media_file_tags WHERE media_file_id=$1 AND tag_id=$2`, fileID, tagID).Scan(&n)
	return n, err
}
