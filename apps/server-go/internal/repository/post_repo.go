package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

type PostRepo struct{ db *sqlx.DB }

func NewPostRepo(db *sqlx.DB) *PostRepo { return &PostRepo{db: db} }

// --- Core CRUD ---

func (r *PostRepo) FindByID(ctx context.Context, id int64) (*model.Post, error) {
	var p model.Post
	err := r.db.GetContext(ctx, &p, `SELECT * FROM posts WHERE id = $1 AND deleted = false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (r *PostRepo) FindBySlug(ctx context.Context, slug string) (*model.Post, error) {
	var p model.Post
	err := r.db.GetContext(ctx, &p, `SELECT * FROM posts WHERE slug = $1 AND deleted = false`, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (r *PostRepo) FindBySlugPublished(ctx context.Context, slug string) (*model.Post, error) {
	var p model.Post
	err := r.db.GetContext(ctx, &p,
		`SELECT * FROM posts WHERE slug = $1 AND deleted = false AND status = 'PUBLISHED' AND is_hidden = false`,
		slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (r *PostRepo) Create(ctx context.Context, p *model.Post) (*model.Post, error) {
	var out model.Post
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO posts (title, slug, content_markdown, content_html, summary, cover_image,
			status, category_id, author_id, is_pinned, pin_priority, is_featured, is_hidden,
			allow_comment, password, seo_title, seo_description, seo_keywords,
			word_count, reading_time, view_count, comment_count, like_count,
			embedding_status, deleted, published_at, scheduled_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
			0,0,0,'PENDING',false,$21,$22,NOW(),NOW()) RETURNING *`,
		p.Title, p.Slug, p.ContentMarkdown, p.ContentHTML, p.Summary, p.CoverImage,
		p.Status, p.CategoryID, p.AuthorID, p.IsPinned, p.PinPriority, p.IsFeatured, p.IsHidden,
		p.AllowComment, p.Password, p.SEOTitle, p.SEODescription, p.SEOKeywords,
		p.WordCount, p.ReadingTime, p.PublishedAt, p.ScheduledAt,
	).StructScan(&out)
	return &out, err
}

func (r *PostRepo) Update(ctx context.Context, id int64, p *model.Post) (*model.Post, error) {
	var out model.Post
	err := r.db.QueryRowxContext(ctx, `
		UPDATE posts SET title=$1, slug=$2, content_markdown=$3, content_html=$4, summary=$5,
			cover_image=$6, status=$7, category_id=$8, is_pinned=$9, pin_priority=$10,
			is_hidden=$11, allow_comment=$12, password=$13, word_count=$14, reading_time=$15,
			published_at=$16, updated_at=NOW()
		WHERE id=$17 AND deleted=false RETURNING *`,
		p.Title, p.Slug, p.ContentMarkdown, p.ContentHTML, p.Summary,
		p.CoverImage, p.Status, p.CategoryID, p.IsPinned, p.PinPriority,
		p.IsHidden, p.AllowComment, p.Password, p.WordCount, p.ReadingTime,
		p.PublishedAt, id,
	).StructScan(&out)
	return &out, err
}

// allowedPostColumns is the whitelist of columns that can be updated via UpdateProperties.
var allowedPostColumns = map[string]bool{
	"title": true, "summary": true, "cover_image": true, "category_id": true,
	"status": true, "is_pinned": true, "pin_priority": true, "allow_comment": true,
	"password": true, "is_hidden": true, "slug": true, "created_at": true,
	"published_at": true, "view_count": true, "updated_at": true,
}

func (r *PostRepo) UpdateProperties(ctx context.Context, id int64, fields map[string]any) (*model.Post, error) {
	if len(fields) == 0 {
		return r.FindByID(ctx, id)
	}
	setClauses := make([]string, 0, len(fields)+1)
	args := make([]any, 0, len(fields)+2)
	i := 1
	for k, v := range fields {
		if !allowedPostColumns[k] {
			return nil, fmt.Errorf("invalid column: %s", k)
		}
		setClauses = append(setClauses, fmt.Sprintf("%s=$%d", k, i))
		args = append(args, v)
		i++
	}
	setClauses = append(setClauses, fmt.Sprintf("updated_at=NOW()"))
	args = append(args, id)
	query := fmt.Sprintf("UPDATE posts SET %s WHERE id=$%d AND deleted=false RETURNING *",
		strings.Join(setClauses, ","), i)
	var out model.Post
	err := r.db.QueryRowxContext(ctx, query, args...).StructScan(&out)
	return &out, err
}

func (r *PostRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE posts SET deleted=true, updated_at=NOW() WHERE id=$1`, id)
	return err
}

func (r *PostRepo) IncrementViewCount(ctx context.Context, id int64) {
	r.db.ExecContext(ctx, `UPDATE posts SET view_count = view_count + 1 WHERE id = $1`, id)
}

// --- Admin filtered list ---

type AdminPostFilter struct {
	Status       *string
	Keyword      *string
	CategoryID   *int64
	TagID        *int64
	MinViewCount *int64
	MaxViewCount *int64
	StartDate    *string // ISO datetime string
	EndDate      *string
	Hidden       *bool
	PageNum      int
	PageSize     int
}

type postListRow struct {
	model.Post
	CategoryName *string `db:"category_name"`
}

func (r *PostRepo) FindForAdmin(ctx context.Context, f AdminPostFilter) ([]postListRow, int64, error) {
	where, args := buildAdminWhere(f)

	var total int64
	countSQL := "SELECT COUNT(DISTINCT p.id) FROM posts p " +
		"LEFT JOIN categories c ON p.category_id = c.id " +
		buildTagJoin(f.TagID) + where
	if err := r.db.GetContext(ctx, &total, countSQL, args...); err != nil {
		return nil, 0, err
	}

	offset := (f.PageNum - 1) * f.PageSize
	listSQL := `SELECT p.*, c.name AS category_name FROM posts p
		LEFT JOIN categories c ON p.category_id = c.id ` +
		buildTagJoin(f.TagID) + where +
		fmt.Sprintf(" ORDER BY p.created_at DESC LIMIT %d OFFSET %d", f.PageSize, offset)
	var rows []postListRow
	err := r.db.SelectContext(ctx, &rows, listSQL, args...)
	return rows, total, err
}

func buildTagJoin(tagID *int64) string {
	if tagID != nil {
		return "JOIN post_tags pt ON p.id = pt.post_id "
	}
	return ""
}

func buildAdminWhere(f AdminPostFilter) (string, []any) {
	clauses := []string{"p.deleted = false"}
	args := []any{}
	n := 1
	placeholder := func(v any) string {
		args = append(args, v)
		s := fmt.Sprintf("$%d", n)
		n++
		return s
	}
	if f.Status != nil {
		clauses = append(clauses, "p.status = "+placeholder(*f.Status))
	}
	if f.Keyword != nil && *f.Keyword != "" {
		pattern := "%" + *f.Keyword + "%"
		clauses = append(clauses,
			fmt.Sprintf("(p.title ILIKE %s OR p.content_markdown ILIKE %s)", placeholder(pattern), placeholder(pattern)))
	}
	if f.CategoryID != nil {
		clauses = append(clauses, "p.category_id = "+placeholder(*f.CategoryID))
	}
	if f.TagID != nil {
		clauses = append(clauses, "pt.tag_id = "+placeholder(*f.TagID))
	}
	if f.MinViewCount != nil {
		clauses = append(clauses, "p.view_count >= "+placeholder(*f.MinViewCount))
	}
	if f.MaxViewCount != nil {
		clauses = append(clauses, "p.view_count <= "+placeholder(*f.MaxViewCount))
	}
	if f.StartDate != nil {
		clauses = append(clauses, "p.published_at >= "+placeholder(*f.StartDate))
	}
	if f.EndDate != nil {
		clauses = append(clauses, "p.published_at <= "+placeholder(*f.EndDate))
	}
	if f.Hidden != nil {
		clauses = append(clauses, "p.is_hidden = "+placeholder(*f.Hidden))
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

// --- Public lists ---

func (r *PostRepo) FindPublished(ctx context.Context, pageNum, pageSize int) ([]postListRow, int64, error) {
	const baseWhere = " WHERE p.deleted=false AND p.status='PUBLISHED' AND p.is_hidden=false"
	var total int64
	if err := r.db.GetContext(ctx, &total,
		"SELECT COUNT(*) FROM posts p"+baseWhere); err != nil {
		return nil, 0, err
	}
	offset := (pageNum - 1) * pageSize
	var rows []postListRow
	err := r.db.SelectContext(ctx, &rows,
		`SELECT p.*, c.name AS category_name FROM posts p
		 LEFT JOIN categories c ON p.category_id = c.id`+baseWhere+
			fmt.Sprintf(" ORDER BY p.is_pinned DESC, p.pin_priority DESC, p.published_at DESC LIMIT %d OFFSET %d",
				pageSize, offset))
	return rows, total, err
}

func (r *PostRepo) FindByCategory(ctx context.Context, categoryID int64, pageNum, pageSize int) ([]postListRow, int64, error) {
	where := " WHERE p.deleted=false AND p.status='PUBLISHED' AND p.is_hidden=false AND p.category_id=$1"
	var total int64
	if err := r.db.GetContext(ctx, &total, "SELECT COUNT(*) FROM posts p"+where, categoryID); err != nil {
		return nil, 0, err
	}
	offset := (pageNum - 1) * pageSize
	var rows []postListRow
	err := r.db.SelectContext(ctx, &rows,
		`SELECT p.*, c.name AS category_name FROM posts p
		 LEFT JOIN categories c ON p.category_id = c.id`+where+
			fmt.Sprintf(" ORDER BY p.published_at DESC LIMIT %d OFFSET %d", pageSize, offset),
		categoryID)
	return rows, total, err
}

func (r *PostRepo) FindByTag(ctx context.Context, tagID int64, pageNum, pageSize int) ([]postListRow, int64, error) {
	const baseWhere = ` WHERE p.deleted=false AND p.status='PUBLISHED' AND p.is_hidden=false AND pt.tag_id=$1`
	var total int64
	if err := r.db.GetContext(ctx, &total,
		"SELECT COUNT(*) FROM posts p JOIN post_tags pt ON p.id=pt.post_id"+baseWhere, tagID); err != nil {
		return nil, 0, err
	}
	offset := (pageNum - 1) * pageSize
	var rows []postListRow
	err := r.db.SelectContext(ctx, &rows,
		`SELECT p.*, c.name AS category_name FROM posts p
		 LEFT JOIN categories c ON p.category_id = c.id
		 JOIN post_tags pt ON p.id = pt.post_id`+baseWhere+
			fmt.Sprintf(" ORDER BY p.published_at DESC LIMIT %d OFFSET %d", pageSize, offset),
		tagID)
	return rows, total, err
}

// --- Tags for posts ---

func (r *PostRepo) FindTagsByPostID(ctx context.Context, postID int64) ([]model.Tag, error) {
	var tags []model.Tag
	err := r.db.SelectContext(ctx, &tags,
		`SELECT t.* FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = $1`, postID)
	return tags, err
}

func (r *PostRepo) FindTagsByPostIDs(ctx context.Context, postIDs []int64) (map[int64][]model.Tag, error) {
	if len(postIDs) == 0 {
		return map[int64][]model.Tag{}, nil
	}
	type row struct {
		PostID int64 `db:"post_id"`
		model.Tag
	}
	placeholders := make([]string, len(postIDs))
	args := make([]any, len(postIDs))
	for i, id := range postIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	var rows []row
	err := r.db.SelectContext(ctx, &rows,
		fmt.Sprintf(`SELECT pt.post_id, t.* FROM tags t JOIN post_tags pt ON t.id=pt.tag_id WHERE pt.post_id IN (%s)`,
			strings.Join(placeholders, ",")), args...)
	if err != nil {
		return nil, err
	}
	m := make(map[int64][]model.Tag)
	for _, r := range rows {
		m[r.PostID] = append(m[r.PostID], r.Tag)
	}
	return m, nil
}

func (r *PostRepo) SetTags(ctx context.Context, postID int64, tagIDs []int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM post_tags WHERE post_id = $1`, postID); err != nil {
		return err
	}
	for _, tagID := range tagIDs {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO post_tags (post_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			postID, tagID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// --- Adjacent posts ---

type adjacentRow struct {
	ID    int64  `db:"id"`
	Title string `db:"title"`
	Slug  string `db:"slug"`
}

func (r *PostRepo) FindAdjacentPosts(ctx context.Context, publishedAt string, postID int64) (*adjacentRow, *adjacentRow, error) {
	const baseWhere = `FROM posts WHERE deleted=false AND status='PUBLISHED' AND is_hidden=false AND id != $2`
	var prev, next adjacentRow

	err1 := r.db.GetContext(ctx, &prev,
		`SELECT id,title,slug `+baseWhere+` AND published_at < $1 ORDER BY published_at DESC LIMIT 1`,
		publishedAt, postID)
	err2 := r.db.GetContext(ctx, &next,
		`SELECT id,title,slug `+baseWhere+` AND published_at > $1 ORDER BY published_at ASC LIMIT 1`,
		publishedAt, postID)

	var prevPtr, nextPtr *adjacentRow
	if err1 != nil && !errors.Is(err1, sql.ErrNoRows) {
		return nil, nil, err1
	}
	if err1 == nil {
		prevPtr = &prev
	}
	if err2 != nil && !errors.Is(err2, sql.ErrNoRows) {
		return nil, nil, err2
	}
	if err2 == nil {
		nextPtr = &next
	}
	return prevPtr, nextPtr, nil
}

// --- Archives ---

type ArchiveMonth struct {
	YearMonth string `db:"year_month"`
	Count     int    `db:"count"`
}

func (r *PostRepo) FindArchiveStats(ctx context.Context) ([]ArchiveMonth, error) {
	var rows []ArchiveMonth
	err := r.db.SelectContext(ctx, &rows,
		`SELECT TO_CHAR(published_at, 'YYYY-MM') AS year_month, COUNT(*) AS count
		 FROM posts WHERE deleted=false AND status='PUBLISHED' AND is_hidden=false
		 GROUP BY year_month ORDER BY year_month DESC`)
	return rows, err
}

func (r *PostRepo) FindArchivePosts(ctx context.Context) (map[string][]model.Post, error) {
	var posts []struct {
		model.Post
		YearMonth string `db:"year_month"`
	}
	err := r.db.SelectContext(ctx, &posts,
		`SELECT *, TO_CHAR(published_at, 'YYYY-MM') AS year_month
		 FROM posts WHERE deleted=false AND status='PUBLISHED' AND is_hidden=false
		 ORDER BY published_at DESC`)
	if err != nil {
		return nil, err
	}
	m := make(map[string][]model.Post)
	for _, p := range posts {
		m[p.YearMonth] = append(m[p.YearMonth], p.Post)
	}
	return m, nil
}

// CountPublished returns the total number of published posts (for site stats).
func (r *PostRepo) CountPublished(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM posts WHERE deleted=false AND status='PUBLISHED'`)
	return n, err
}
