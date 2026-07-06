package repository

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

// ReadingBookRepo 提供 reading_books 表（拟真阅读）的数据访问能力，
// 同时封装从知识库文件重建纯文本的辅助查询。
type ReadingBookRepo struct{ db *sqlx.DB }

// NewReadingBookRepo 创建 ReadingBookRepo。
func NewReadingBookRepo(db *sqlx.DB) *ReadingBookRepo { return &ReadingBookRepo{db: db} }

// ReadingBookListFilter 后台列表筛选条件。
type ReadingBookListFilter struct {
	Keyword    string
	SourceType string
	Status     string
	PageNum    int
	PageSize   int
}

const readingBookListColumns = `
	id, slug, title, author, cover_image, source_type, source_id, source_ref,
	word_count, reading_time, status, error, theme, generated_at, created_at, updated_at`

// Create 插入一条记录并回填生成字段。
func (r *ReadingBookRepo) Create(ctx context.Context, b *model.ReadingBook) (*model.ReadingBook, error) {
	var out model.ReadingBook
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO reading_books
			(slug, title, author, cover_image, source_type, source_id, source_ref,
			 content_html, toc, word_count, reading_time, status, error, theme,
			 created_by, generated_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
		RETURNING *`,
		b.Slug, b.Title, b.Author, b.CoverImage, b.SourceType, b.SourceID, b.SourceRef,
		b.ContentHTML, b.TOC, b.WordCount, b.ReadingTime, b.Status, b.Error, b.Theme,
		b.CreatedBy, b.GeneratedAt,
	).StructScan(&out)
	return &out, err
}

// Update 全量更新（重新生成时使用），按 id 定位。
func (r *ReadingBookRepo) Update(ctx context.Context, b *model.ReadingBook) (*model.ReadingBook, error) {
	var out model.ReadingBook
	err := r.db.QueryRowxContext(ctx, `
		UPDATE reading_books SET
			title=$2, author=$3, cover_image=$4, source_ref=$5,
			content_html=$6, toc=$7, word_count=$8, reading_time=$9,
			status=$10, error=$11, theme=$12, generated_at=$13, updated_at=NOW()
		WHERE id=$1
		RETURNING *`,
		b.ID, b.Title, b.Author, b.CoverImage, b.SourceRef,
		b.ContentHTML, b.TOC, b.WordCount, b.ReadingTime,
		b.Status, b.Error, b.Theme, b.GeneratedAt,
	).StructScan(&out)
	return &out, err
}

// FindByID 按主键查询。
func (r *ReadingBookRepo) FindByID(ctx context.Context, id int64) (*model.ReadingBook, error) {
	var b model.ReadingBook
	err := r.db.GetContext(ctx, &b, `SELECT * FROM reading_books WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &b, err
}

// FindBySlug 按 slug 查询（供前台阅读器使用）。
func (r *ReadingBookRepo) FindBySlug(ctx context.Context, slug string) (*model.ReadingBook, error) {
	var b model.ReadingBook
	err := r.db.GetContext(ctx, &b, `SELECT * FROM reading_books WHERE slug=$1`, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &b, err
}

// FindBySource 查询某来源是否已生成过书（用于重新导入即更新）。
func (r *ReadingBookRepo) FindBySource(ctx context.Context, sourceType string, sourceID int64) (*model.ReadingBook, error) {
	var b model.ReadingBook
	err := r.db.GetContext(ctx, &b,
		`SELECT * FROM reading_books WHERE source_type=$1 AND source_id=$2`, sourceType, sourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &b, err
}

// SlugExists 判断 slug 是否被其它记录占用。
func (r *ReadingBookRepo) SlugExists(ctx context.Context, slug string, excludeID int64) (bool, error) {
	var exists bool
	err := r.db.GetContext(ctx, &exists,
		`SELECT EXISTS(SELECT 1 FROM reading_books WHERE slug=$1 AND id<>$2)`, slug, excludeID)
	return exists, err
}

// List 分页查询后台书架。
func (r *ReadingBookRepo) List(ctx context.Context, f ReadingBookListFilter) ([]model.ReadingBook, int64, error) {
	conds := []string{"1=1"}
	args := []any{}
	idx := 1
	if f.Keyword != "" {
		conds = append(conds, "title ILIKE $"+itoa(idx)+" ESCAPE E'\\\\'")
		args = append(args, "%"+dbutil.EscapeLike(f.Keyword)+"%")
		idx++
	}
	if f.SourceType != "" {
		conds = append(conds, "source_type=$"+itoa(idx))
		args = append(args, f.SourceType)
		idx++
	}
	if f.Status != "" {
		conds = append(conds, "status=$"+itoa(idx))
		args = append(args, f.Status)
		idx++
	}
	where := strings.Join(conds, " AND ")

	var total int64
	if err := r.db.GetContext(ctx, &total,
		`SELECT COUNT(*) FROM reading_books WHERE `+where, args...); err != nil {
		return nil, 0, err
	}

	offset := (f.PageNum - 1) * f.PageSize
	listSQL := `SELECT ` + readingBookListColumns + ` FROM reading_books WHERE ` + where +
		` ORDER BY created_at DESC LIMIT $` + itoa(idx) + ` OFFSET $` + itoa(idx+1)
	args = append(args, f.PageSize, offset)

	var rows []model.ReadingBook
	if err := r.db.SelectContext(ctx, &rows, listSQL, args...); err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// Delete 物理删除一本书。
func (r *ReadingBookRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM reading_books WHERE id=$1`, id)
	return err
}

// KBFileSource 是知识库文件来源信息。
type KBFileSource struct {
	Title         *string `db:"title"`
	PostID        *int64  `db:"post_id"`
	VectorProfile *int64  `db:"vector_profile_id"`
	KBName        string  `db:"kb_name"`
}

type kbChunkingConfig struct {
	ChunkerKind        string `db:"chunker_kind"`
	ChunkOverlapTokens int    `db:"chunk_overlap_tokens"`
}

// FindKBFileSource 拉取知识库文件的基础信息与归属库名。
func (r *ReadingBookRepo) FindKBFileSource(ctx context.Context, fileID int64) (*KBFileSource, error) {
	var s KBFileSource
	err := r.db.GetContext(ctx, &s, `
		SELECT f.title AS title, f.post_id AS post_id, f.vector_profile_id AS vector_profile_id,
		       k.name AS kb_name
		FROM kb_files f
		JOIN knowledge_bases k ON k.id = f.kb_id
		WHERE f.id=$1`, fileID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

// ReconstructKBFileText 从 kb_embeddings 重建知识库文件的可读文本。
// 优先使用文件登记的向量档案（vector_profile_id）以避免跨档案重复；
// 若为空则退化为该文件出现的最小 profile_id。chunk 之间用空行拼接。
func (r *ReadingBookRepo) ReconstructKBFileText(ctx context.Context, fileID int64, profileID *int64) (string, error) {
	pid := int64(0)
	if profileID != nil {
		pid = *profileID
	} else {
		// 退化：取该文件的最小 profile_id。
		if err := r.db.GetContext(ctx, &pid,
			`SELECT COALESCE(MIN(profile_id),0) FROM kb_embeddings WHERE kb_file_id=$1`, fileID); err != nil {
			return "", err
		}
	}
	if pid == 0 {
		return "", nil
	}
	var cfg kbChunkingConfig
	if err := r.db.GetContext(ctx, &cfg, `
		SELECT chunker_kind, chunk_overlap_tokens FROM kb_profiles WHERE id=$1`, pid); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	var chunks []string
	if err := r.db.SelectContext(ctx, &chunks, `
		SELECT chunk_text FROM kb_embeddings
		WHERE kb_file_id=$1 AND profile_id=$2
		ORDER BY chunk_index ASC`, fileID, pid); err != nil {
		return "", err
	}
	return joinKBChunks(chunks, cfg.usesOverlap()), nil
}

func (c kbChunkingConfig) usesOverlap() bool {
	if c.ChunkOverlapTokens <= 0 {
		return false
	}
	switch c.ChunkerKind {
	case "qa", "parent_child":
		return false
	default:
		return true
	}
}

const minKBChunkOverlapRunes = 12

func joinKBChunks(chunks []string, deoverlap bool) string {
	parts := make([]string, 0, len(chunks))
	prev := ""
	for _, raw := range chunks {
		chunk := normalizeKBChunk(raw)
		if chunk == "" {
			continue
		}
		if deoverlap && prev != "" {
			chunk = trimLeadingChunkOverlap(prev, chunk)
		}
		if chunk == "" {
			continue
		}
		parts = append(parts, chunk)
		prev = chunk
	}
	return strings.Join(parts, "\n\n")
}

func normalizeKBChunk(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.TrimSpace(text)
}

func trimLeadingChunkOverlap(previous, chunk string) string {
	prevRunes := []rune(normalizeKBChunk(previous))
	chunkRunes := []rune(normalizeKBChunk(chunk))
	maxOverlap := min(len(prevRunes), len(chunkRunes))
	for size := maxOverlap; size >= minKBChunkOverlapRunes; size-- {
		if equalRunes(prevRunes[len(prevRunes)-size:], chunkRunes[:size]) {
			return strings.TrimSpace(string(chunkRunes[size:]))
		}
	}
	return strings.TrimSpace(string(chunkRunes))
}

func equalRunes(a, b []rune) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func itoa(i int) string { return strconv.Itoa(i) }
