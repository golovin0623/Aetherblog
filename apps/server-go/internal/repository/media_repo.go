package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// mediaColumns 列举 model.MediaFile 中已映射的 media_files 表字段，
// 故意排除 JSONB 类型的 exif_data 和 ai_labels 列，以避免反序列化问题。
const mediaColumns = `id, filename, original_name, file_path, file_url, file_size, mime_type, file_type,
	storage_type, width, height, alt_text, uploader_id, created_at, folder_id,
	storage_provider_id, cdn_url, blurhash, current_version, is_archived, archived_at, archived_by, deleted, deleted_at`

// MediaRepo 负责对 media_files 表进行数据访问操作。
type MediaRepo struct{ db *sqlx.DB }

// NewMediaRepo 创建一个使用给定数据库连接的 MediaRepo 实例。
func NewMediaRepo(db *sqlx.DB) *MediaRepo { return &MediaRepo{db: db} }

// FindByID 从 media_files 表按主键查询单个媒体文件，若不存在则返回 nil。
func (r *MediaRepo) FindByID(ctx context.Context, id int64) (*model.MediaFile, error) {
	var m model.MediaFile
	err := r.db.GetContext(ctx, &m, `SELECT `+mediaColumns+` FROM media_files WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// MediaFilter 持有管理端媒体文件列表的可选过滤参数。
type MediaFilter struct {
	FolderID *int64 // 按所属文件夹过滤，nil 表示不过滤
	FileType string // 按文件类型过滤（IMAGE / VIDEO / AUDIO / DOCUMENT / OTHER），为空不过滤
	Keyword  string // 关键字模糊搜索（匹配 filename 或 original_name）
	Deleted  bool   // true 表示查询回收站（已软删除）文件
	PageNum  int    // 页码（从 1 开始）
	PageSize int    // 每页大小，默认 20
}

// FindForAdmin 从 media_files 表返回经过过滤和分页的媒体文件列表及总数。
// 当 f.Deleted 为 true 时查询回收站视图，按 deleted_at 降序排列；否则按 created_at 降序排列。
func (r *MediaRepo) FindForAdmin(ctx context.Context, f MediaFilter) ([]model.MediaFile, int64, error) {
	var sb strings.Builder
	args := []any{}
	idx := 1

	// 首个过滤条件：是否查回收站
	sb.WriteString("FROM media_files WHERE deleted=$1")
	args = append(args, f.Deleted)
	idx++

	// 按所属文件夹过滤
	if f.FolderID != nil {
		sb.WriteString(fmt.Sprintf(" AND folder_id=$%d", idx))
		args = append(args, *f.FolderID)
		idx++
	}
	// 按文件类型过滤
	if f.FileType != "" {
		sb.WriteString(fmt.Sprintf(" AND file_type=$%d", idx))
		args = append(args, f.FileType)
		idx++
	}
	// 关键字同时模糊匹配存储文件名和原始文件名（不区分大小写）
	if f.Keyword != "" {
		sb.WriteString(fmt.Sprintf(" AND (filename ILIKE $%d OR original_name ILIKE $%d)", idx, idx))
		args = append(args, "%"+f.Keyword+"%")
		idx++
	}

	base := sb.String()

	// 先查符合条件的总数
	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// 页码和页大小兜底处理
	pageNum := f.PageNum
	if pageNum < 1 {
		pageNum = 1
	}
	pageSize := f.PageSize
	if pageSize < 1 {
		pageSize = 20
	}

	// 回收站视图按删除时间排序，普通视图按创建时间排序
	orderCol := "created_at"
	if f.Deleted {
		orderCol = "deleted_at"
	}
	query := fmt.Sprintf("SELECT "+mediaColumns+" %s ORDER BY %s DESC LIMIT $%d OFFSET $%d", base, orderCol, idx, idx+1)
	args = append(args, pageSize, (pageNum-1)*pageSize)

	var ms []model.MediaFile
	if err := r.db.SelectContext(ctx, &ms, query, args...); err != nil {
		return nil, 0, err
	}
	return ms, total, nil
}

// CountTrash 统计 media_files 表中已软删除（deleted=true）的媒体文件数量。
func (r *MediaRepo) CountTrash(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM media_files WHERE deleted=true`).Scan(&n)
	return n, err
}

// MediaStats 持有按文件类型细分的媒体文件聚合统计数据。
type MediaStats struct {
	TotalCount int64 `db:"total_count"` // 文件总数（不含已删除）
	TotalSize  int64 `db:"total_size"`  // 存储总大小（字节）
	ImageCount int64 `db:"image_count"` // 图片文件数
	VideoCount int64 `db:"video_count"` // 视频文件数
	AudioCount int64 `db:"audio_count"` // 音频文件数
	DocCount   int64 `db:"doc_count"`   // 文档文件数
	OtherCount int64 `db:"other_count"` // 其他类型文件数
}

// GetStats 从 media_files 表聚合统计各类媒体文件数量和总存储大小，排除软删除文件。
// 使用 FILTER (WHERE file_type=...) 在一条 SQL 中同时统计各类型数量。
func (r *MediaRepo) GetStats(ctx context.Context) (*MediaStats, error) {
	var s MediaStats
	err := r.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) AS total_count,
			COALESCE(SUM(file_size),0) AS total_size,
			COUNT(*) FILTER (WHERE file_type='IMAGE') AS image_count,
			COUNT(*) FILTER (WHERE file_type='VIDEO') AS video_count,
			COUNT(*) FILTER (WHERE file_type='AUDIO') AS audio_count,
			COUNT(*) FILTER (WHERE file_type='DOCUMENT') AS doc_count,
			COUNT(*) FILTER (WHERE file_type='OTHER') AS other_count
		FROM media_files WHERE deleted=false`).
		Scan(&s.TotalCount, &s.TotalSize, &s.ImageCount, &s.VideoCount, &s.AudioCount, &s.DocCount, &s.OtherCount)
	return &s, err
}

// Create 向 media_files 表插入新的媒体文件记录，通过 RETURNING 回填数据库生成的 id 和 created_at。
func (r *MediaRepo) Create(ctx context.Context, m *model.MediaFile) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO media_files (filename, original_name, file_path, file_url, file_size, mime_type, file_type, storage_type, width, height, uploader_id, folder_id, storage_provider_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at`,
		m.Filename, m.OriginalName, m.FilePath, m.FileURL, m.FileSize, m.MimeType, m.FileType,
		m.StorageType, m.Width, m.Height, m.UploaderID, m.FolderID, m.StorageProviderID,
	).Scan(&m.ID, &m.CreatedAt)
}

// Update 更新指定媒体文件的 alt_text（替代文本）和 folder_id（所属文件夹）字段。
func (r *MediaRepo) Update(ctx context.Context, id int64, altText *string, folderID *int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_files SET alt_text=$1, folder_id=$2 WHERE id=$3`, altText, folderID, id)
	return err
}

// MoveBatch 将多个媒体文件批量移动到目标文件夹（更新 folder_id）。
// 当 ids 为空时直接返回，不执行任何数据库操作。
// folderID 为 nil 时表示移动到根目录（不属于任何文件夹）。
func (r *MediaRepo) MoveBatch(ctx context.Context, ids []int64, folderID *int64) error {
	if len(ids) == 0 {
		return nil
	}
	// 使用 sqlx.In 生成 IN 子句，再通过 Rebind 转换为 PostgreSQL 风格占位符
	query, args, err := sqlx.In(`UPDATE media_files SET folder_id=? WHERE id IN (?)`, folderID, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

// SoftDelete 将单个媒体文件标记为软删除（deleted=true），记录删除时间，不物理删除行数据。
func (r *MediaRepo) SoftDelete(ctx context.Context, id int64) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `UPDATE media_files SET deleted=true, deleted_at=$1 WHERE id=$2`, now, id)
	return err
}

// SoftDeleteBatch 批量将多个媒体文件标记为软删除，统一使用同一删除时间戳。
// 当 ids 为空时直接返回，不执行任何数据库操作。
func (r *MediaRepo) SoftDeleteBatch(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	now := time.Now()
	query, args, err := sqlx.In(`UPDATE media_files SET deleted=true, deleted_at=? WHERE id IN (?)`, now, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

// Restore 将单个媒体文件从回收站恢复（deleted=false，deleted_at 置 NULL）。
func (r *MediaRepo) Restore(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_files SET deleted=false, deleted_at=NULL WHERE id=$1`, id)
	return err
}

// RestoreBatch 批量将多个媒体文件从回收站恢复。
// 当 ids 为空时直接返回，不执行任何数据库操作。
func (r *MediaRepo) RestoreBatch(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	query, args, err := sqlx.In(`UPDATE media_files SET deleted=false, deleted_at=NULL WHERE id IN (?)`, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

// PermanentDelete 从 media_files 表中物理删除单个媒体文件记录。
func (r *MediaRepo) PermanentDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_files WHERE id=$1`, id)
	return err
}

// PermanentDeleteBatch 从 media_files 表中批量物理删除多个媒体文件记录。
// 当 ids 为空时直接返回，不执行任何数据库操作。
func (r *MediaRepo) PermanentDeleteBatch(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	query, args, err := sqlx.In(`DELETE FROM media_files WHERE id IN (?)`, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

// EmptyTrash 从 media_files 表中物理删除所有已软删除（deleted=true）的媒体文件，即清空回收站。
func (r *MediaRepo) EmptyTrash(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_files WHERE deleted=true`)
	return err
}

// UpdateFileContent 在文件内容编辑后更新 media_files 表中的存储路径、访问 URL、文件大小和版本号。
// currentVersion 为编辑后的新版本号。
func (r *MediaRepo) UpdateFileContent(ctx context.Context, id int64, filePath, fileURL string, fileSize int64, currentVersion int) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_files SET file_path=$1, file_url=$2, file_size=$3, current_version=$4 WHERE id=$5`,
		filePath, fileURL, fileSize, currentVersion, id)
	return err
}
