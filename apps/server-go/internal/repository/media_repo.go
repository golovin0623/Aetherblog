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

// mediaColumns lists only the columns mapped in model.MediaFile (excludes JSONB columns exif_data, ai_labels).
const mediaColumns = `id, filename, original_name, file_path, file_url, file_size, mime_type, file_type,
	storage_type, width, height, alt_text, uploader_id, created_at, folder_id,
	storage_provider_id, cdn_url, blurhash, current_version, is_archived, archived_at, archived_by, deleted, deleted_at`

type MediaRepo struct{ db *sqlx.DB }

func NewMediaRepo(db *sqlx.DB) *MediaRepo { return &MediaRepo{db: db} }

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

type MediaFilter struct {
	FolderID *int64
	FileType string
	Keyword  string
	Deleted  bool // true = trash view
	PageNum  int
	PageSize int
}

func (r *MediaRepo) FindForAdmin(ctx context.Context, f MediaFilter) ([]model.MediaFile, int64, error) {
	var sb strings.Builder
	args := []any{}
	idx := 1

	sb.WriteString("FROM media_files WHERE deleted=$1")
	args = append(args, f.Deleted)
	idx++

	if f.FolderID != nil {
		sb.WriteString(fmt.Sprintf(" AND folder_id=$%d", idx))
		args = append(args, *f.FolderID)
		idx++
	}
	if f.FileType != "" {
		sb.WriteString(fmt.Sprintf(" AND file_type=$%d", idx))
		args = append(args, f.FileType)
		idx++
	}
	if f.Keyword != "" {
		sb.WriteString(fmt.Sprintf(" AND (filename ILIKE $%d OR original_name ILIKE $%d)", idx, idx))
		args = append(args, "%"+f.Keyword+"%")
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

	query := fmt.Sprintf("SELECT "+mediaColumns+" %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d", base, idx, idx+1)
	args = append(args, pageSize, (pageNum-1)*pageSize)

	var ms []model.MediaFile
	if err := r.db.SelectContext(ctx, &ms, query, args...); err != nil {
		return nil, 0, err
	}
	return ms, total, nil
}

func (r *MediaRepo) CountTrash(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM media_files WHERE deleted=true`).Scan(&n)
	return n, err
}

type MediaStats struct {
	TotalCount int64   `db:"total_count"`
	TotalSize  int64   `db:"total_size"`
	ImageCount int64   `db:"image_count"`
	VideoCount int64   `db:"video_count"`
	AudioCount int64   `db:"audio_count"`
	DocCount   int64   `db:"doc_count"`
	OtherCount int64   `db:"other_count"`
}

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

func (r *MediaRepo) Create(ctx context.Context, m *model.MediaFile) error {
	return r.db.QueryRowContext(ctx, `
		INSERT INTO media_files (filename, original_name, file_path, file_url, file_size, mime_type, file_type, storage_type, width, height, uploader_id, folder_id, storage_provider_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at`,
		m.Filename, m.OriginalName, m.FilePath, m.FileURL, m.FileSize, m.MimeType, m.FileType,
		m.StorageType, m.Width, m.Height, m.UploaderID, m.FolderID, m.StorageProviderID,
	).Scan(&m.ID, &m.CreatedAt)
}

func (r *MediaRepo) Update(ctx context.Context, id int64, altText *string, folderID *int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_files SET alt_text=$1, folder_id=$2 WHERE id=$3`, altText, folderID, id)
	return err
}

func (r *MediaRepo) MoveBatch(ctx context.Context, ids []int64, folderID *int64) error {
	if len(ids) == 0 {
		return nil
	}
	query, args, err := sqlx.In(`UPDATE media_files SET folder_id=? WHERE id IN (?)`, folderID, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

func (r *MediaRepo) SoftDelete(ctx context.Context, id int64) error {
	now := time.Now()
	_, err := r.db.ExecContext(ctx, `UPDATE media_files SET deleted=true, deleted_at=$1 WHERE id=$2`, now, id)
	return err
}

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

func (r *MediaRepo) Restore(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE media_files SET deleted=false, deleted_at=NULL WHERE id=$1`, id)
	return err
}

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

func (r *MediaRepo) PermanentDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_files WHERE id=$1`, id)
	return err
}

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

func (r *MediaRepo) EmptyTrash(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM media_files WHERE deleted=true`)
	return err
}
