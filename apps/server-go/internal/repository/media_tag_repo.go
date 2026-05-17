package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
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
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM media_tags WHERE name ILIKE $1 OR slug ILIKE $1 ORDER BY usage_count DESC`, "%"+dbutil.EscapeLike(keyword)+"%")
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

// TagFileWithUsage 批量为单个媒体文件绑定多个标签，并在同一事务中同步 usage_count。
// 已存在的关联会被跳过，只对本次真正新增的关联递增计数。
func (r *MediaTagRepo) TagFileWithUsage(ctx context.Context, fileID int64, tagIDs []int64, taggedBy *int64) error {
	tagIDs = uniqueInt64s(tagIDs)
	if len(tagIDs) == 0 {
		return nil
	}

	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		WITH inserted AS (
			INSERT INTO media_file_tags (media_file_id, tag_id, tagged_by, source)
			SELECT $1, tag_id, $3, 'MANUAL'
			FROM unnest($2::bigint[]) AS tag_id
			ON CONFLICT (media_file_id, tag_id) DO NOTHING
			RETURNING tag_id
		)
		UPDATE media_tags AS t
		SET usage_count = usage_count + 1
		FROM inserted
		WHERE t.id = inserted.tag_id`, fileID, pq.Array(tagIDs), taggedBy)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// UntagFile 从 media_file_tags 关联表中移除媒体文件与指定标签的关联关系。
func (r *MediaTagRepo) UntagFile(ctx context.Context, fileID int64, tagID int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_file_tags WHERE media_file_id=$1 AND tag_id=$2`, fileID, tagID)
	return err
}

// UntagFileWithUsage 移除单个文件标签关联，并在同一事务中递减 usage_count。
// 关联不存在时保持幂等，不修改计数。
func (r *MediaTagRepo) UntagFileWithUsage(ctx context.Context, fileID int64, tagID int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		WITH deleted AS (
			DELETE FROM media_file_tags
			WHERE media_file_id=$1 AND tag_id=$2
			RETURNING tag_id
		)
		UPDATE media_tags AS t
		SET usage_count = GREATEST(usage_count - 1, 0)
		FROM deleted
		WHERE t.id = deleted.tag_id`, fileID, tagID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// IncrementUsageCount 对 media_tags 表中指定标签的 usage_count 字段进行原子性增减操作。
// delta 为正数时增加计数，为负数时减少计数。
func (r *MediaTagRepo) IncrementUsageCount(ctx context.Context, tagID int64, delta int) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_tags SET usage_count = usage_count + $1 WHERE id=$2`, delta, tagID)
	return err
}

// BatchTagWithUsage 批量为多个媒体文件绑定同一个标签，并按新增关联数量同步 usage_count。
func (r *MediaTagRepo) BatchTagWithUsage(ctx context.Context, fileIDs []int64, tagID int64, taggedBy *int64) error {
	fileIDs = uniqueInt64s(fileIDs)
	if len(fileIDs) == 0 {
		return nil
	}

	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		WITH inserted AS (
			INSERT INTO media_file_tags (media_file_id, tag_id, tagged_by, source)
			SELECT file_id, $2, $3, 'MANUAL'
			FROM unnest($1::bigint[]) AS file_id
			ON CONFLICT (media_file_id, tag_id) DO NOTHING
			RETURNING 1
		),
		inserted_count AS (
			SELECT COUNT(*) AS count FROM inserted
		)
		UPDATE media_tags AS t
		SET usage_count = usage_count + inserted_count.count::int
		FROM inserted_count
		WHERE t.id = $2 AND inserted_count.count > 0`, pq.Array(fileIDs), tagID, taggedBy)
	if err != nil {
		return err
	}
	return tx.Commit()
}

// ExistsFileTag 查询 media_file_tags 关联表中指定文件与标签的关联是否存在。
// 返回 true 表示关联存在，返回 false 表示不存在。
func (r *MediaTagRepo) ExistsFileTag(ctx context.Context, fileID int64, tagID int64) (bool, error) {
	var exists bool
	err := r.db.GetContext(ctx, &exists, `SELECT EXISTS(SELECT 1 FROM media_file_tags WHERE media_file_id=$1 AND tag_id=$2)`, fileID, tagID)
	return exists, err
}

func uniqueInt64s(ids []int64) []int64 {
	if len(ids) < 2 {
		return ids
	}
	seen := make(map[int64]struct{}, len(ids))
	unique := make([]int64, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique
}
