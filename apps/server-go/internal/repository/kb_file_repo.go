// Package repository · kb_file_repo.go — kb_files CRUD + 状态聚合 + 时间桶。
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
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

type KBFileRepo struct{ db *sqlx.DB }

func NewKBFileRepo(db *sqlx.DB) *KBFileRepo { return &KBFileRepo{db: db} }

const kbFileColumns = `id, kb_id, media_file_id, post_id, category, title, source_url,
    doc_chars, doc_tokens, chunk_count, vector_status, vector_error, vector_profile_id,
    vectorized_at, attempt_count, archived_year, archived_month, archived_day,
    created_by, created_at, updated_at`

// FindByID 单条查询。
func (r *KBFileRepo) FindByID(ctx context.Context, id int64) (*model.KBFile, error) {
	var f model.KBFile
	err := r.db.GetContext(ctx, &f, `SELECT `+kbFileColumns+` FROM kb_files WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

// FindByMediaInKB 在 KB 内按 media_file_id 查找。
func (r *KBFileRepo) FindByMediaInKB(ctx context.Context, kbID, mediaFileID int64) (*model.KBFile, error) {
	var f model.KBFile
	err := r.db.GetContext(ctx, &f,
		`SELECT `+kbFileColumns+` FROM kb_files WHERE kb_id=$1 AND media_file_id=$2`,
		kbID, mediaFileID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

// KBFileListFilter 列表过滤。
type KBFileListFilter struct {
	KBID     int64
	Status   string
	Category string
	Keyword  string
	Year     int
	Month    int
	Day      int
	PageNum  int
	PageSize int
}

// ListByKB 列表查询，返回行 + 总数。
func (r *KBFileRepo) ListByKB(ctx context.Context, f KBFileListFilter) ([]model.KBFile, int64, error) {
	sb := strings.Builder{}
	args := []any{}
	idx := 1
	sb.WriteString("FROM kb_files WHERE kb_id=$1")
	args = append(args, f.KBID)
	idx++

	if f.Status != "" {
		sb.WriteString(fmt.Sprintf(" AND vector_status=$%d", idx))
		args = append(args, f.Status)
		idx++
	}
	if f.Category != "" {
		sb.WriteString(fmt.Sprintf(" AND category=$%d", idx))
		args = append(args, f.Category)
		idx++
	}
	if f.Keyword != "" {
		sb.WriteString(fmt.Sprintf(" AND (COALESCE(title,'') ILIKE $%d ESCAPE E'\\\\' OR COALESCE(category,'') ILIKE $%d ESCAPE E'\\\\')", idx, idx))
		args = append(args, "%"+dbutil.EscapeLike(f.Keyword)+"%")
		idx++
	}
	if f.Year > 0 {
		sb.WriteString(fmt.Sprintf(" AND archived_year=$%d", idx))
		args = append(args, f.Year)
		idx++
	}
	if f.Month > 0 {
		sb.WriteString(fmt.Sprintf(" AND archived_month=$%d", idx))
		args = append(args, f.Month)
		idx++
	}
	if f.Day > 0 {
		sb.WriteString(fmt.Sprintf(" AND archived_day=$%d", idx))
		args = append(args, f.Day)
		idx++
	}
	base := sb.String()

	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	pageNum := f.PageNum
	if pageNum < 1 {
		pageNum = 1
	}
	pageSize := f.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	args = append(args, pageSize, (pageNum-1)*pageSize)
	q := fmt.Sprintf("SELECT %s %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		kbFileColumns, base, idx, idx+1)

	var fs []model.KBFile
	if err := r.db.SelectContext(ctx, &fs, q, args...); err != nil {
		return nil, 0, err
	}
	return fs, total, nil
}

// KBFileCreateRequest 携带 Create 字段。
type KBFileCreateRequest struct {
	KBID        int64
	MediaFileID *int64
	PostID      *int64
	Category    *string
	Title       *string
	SourceURL   *string
	DocChars    *int
	DocTokens   *int
	CreatedBy   *int64
	ArchivedAt  time.Time // 解析出年月日填到三个列
}

// Create 写入新 kb_files 行。
func (r *KBFileRepo) Create(ctx context.Context, req KBFileCreateRequest) (int64, error) {
	year, month, day := req.ArchivedAt.Year(), int(req.ArchivedAt.Month()), req.ArchivedAt.Day()
	var id int64
	err := r.db.QueryRowContext(ctx, `
        INSERT INTO kb_files (kb_id, media_file_id, post_id, category, title, source_url,
            doc_chars, doc_tokens, archived_year, archived_month, archived_day, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id`,
		req.KBID, req.MediaFileID, req.PostID, req.Category, req.Title, req.SourceURL,
		req.DocChars, req.DocTokens, year, month, day, req.CreatedBy,
	).Scan(&id)
	return id, err
}

// MarkRunning 将状态置为 RUNNING 并自增尝试次数（在 ai-service 拉起 index 前调用）。
func (r *KBFileRepo) MarkRunning(ctx context.Context, id int64, profileID int64) error {
	_, err := r.db.ExecContext(ctx, `
        UPDATE kb_files SET vector_status='RUNNING',
            vector_profile_id=$1,
            attempt_count=attempt_count+1,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=$2`, profileID, id)
	return err
}

// MarkSucceeded 写入成功状态 + 文档维度统计。
func (r *KBFileRepo) MarkSucceeded(ctx context.Context, id int64, chunkCount, docChars, docTokens int) error {
	_, err := r.db.ExecContext(ctx, `
        UPDATE kb_files SET vector_status='SUCCEEDED',
            vector_error=NULL,
            chunk_count=$1, doc_chars=$2, doc_tokens=$3,
            vectorized_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=$4`, chunkCount, docChars, docTokens, id)
	return err
}

// MarkFailed 写入失败状态与错误摘要。
func (r *KBFileRepo) MarkFailed(ctx context.Context, id int64, errMsg string) error {
	_, err := r.db.ExecContext(ctx, `
        UPDATE kb_files SET vector_status='FAILED',
            vector_error=$1,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=$2`, errMsg, id)
	return err
}

// Delete 永久删除 kb_files 行（CASCADE 清向量）。
// 注意：物理 media_files 由 service 层决定是否同步删除。
func (r *KBFileRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM kb_files WHERE id=$1`, id)
	return err
}

// CountByStatus 返回 KB 各状态的文件数。
func (r *KBFileRepo) CountByStatus(ctx context.Context, kbID int64) (map[string]int, error) {
	rows, err := r.db.QueryContext(ctx, `
        SELECT vector_status, COUNT(*) FROM kb_files WHERE kb_id=$1 GROUP BY vector_status`, kbID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		out[status] = count
	}
	return out, rows.Err()
}

// TimelineBuckets 返回 KB 近 24 个月按年月分桶的文件数。
type TimelineBucket struct {
	Year  int `db:"year"`
	Month int `db:"month"`
	Count int `db:"count"`
}

func (r *KBFileRepo) TimelineBuckets(ctx context.Context, kbID int64) ([]TimelineBucket, error) {
	var bs []TimelineBucket
	err := r.db.SelectContext(ctx, &bs, `
        SELECT archived_year AS year, archived_month AS month, COUNT(*) AS count
        FROM kb_files
        WHERE kb_id=$1 AND archived_year IS NOT NULL
        GROUP BY archived_year, archived_month
        ORDER BY year DESC, month DESC
        LIMIT 24`, kbID)
	return bs, err
}
