package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

// NoteRepo 提供 notes 表族的数据访问能力。
type NoteRepo struct{ db *sqlx.DB }

// NewNoteRepo 创建 NoteRepo。
func NewNoteRepo(db *sqlx.DB) *NoteRepo { return &NoteRepo{db: db} }

// ParsedNoteLink 是 service 层解析出的 wiki link 结果。
type ParsedNoteLink struct {
	TargetTitle   string
	LinkText      string
	PositionStart *int
	PositionEnd   *int
}

// NoteListRow 是笔记列表查询的内部投影类型。
type NoteListRow struct {
	model.Note
	FolderName *string        `db:"folder_name"`
	TagNames   pq.StringArray `db:"tag_names"`
}

// AdminNoteFilter 包含后台笔记列表筛选条件。
type AdminNoteFilter struct {
	Keyword    *string
	View       *string
	FolderID   *int64
	Tag        *string
	SourceType *string
	Archived   *bool
	PageNum    int
	PageSize   int
}

// FindByID 查询未删除笔记。
func (r *NoteRepo) FindByID(ctx context.Context, id int64) (*model.Note, error) {
	var n model.Note
	err := r.db.GetContext(ctx, &n, `SELECT * FROM notes WHERE id=$1 AND deleted=false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &n, err
}

// FindOwnership 只拉取 author_id, 供未来放开非 ADMIN 后做轻量权限判断。
func (r *NoteRepo) FindOwnership(ctx context.Context, id int64) (bool, *int64, error) {
	var authorID *int64
	err := r.db.GetContext(ctx, &authorID, `SELECT author_id FROM notes WHERE id=$1 AND deleted=false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	return true, authorID, nil
}

// Create 插入笔记并返回完整记录。
func (r *NoteRepo) Create(ctx context.Context, n *model.Note) (*model.Note, error) {
	var out model.Note
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO notes (
			title, content_markdown, summary, folder_id, author_id,
			source_type, source_url, source_title, source_meta,
			is_pinned, is_favorite, archived, deleted, word_count, embedding_status,
			created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,false,$12,$13,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		RETURNING *`,
		n.Title, n.ContentMarkdown, n.Summary, n.FolderID, n.AuthorID,
		n.SourceType, n.SourceURL, n.SourceTitle, n.SourceMeta,
		n.IsPinned, n.IsFavorite, n.WordCount, n.EmbeddingStatus,
	).StructScan(&out)
	return &out, err
}

// Update 全量更新笔记主体字段。
func (r *NoteRepo) Update(ctx context.Context, id int64, n *model.Note) (*model.Note, error) {
	var out model.Note
	err := r.db.QueryRowxContext(ctx, `
		UPDATE notes SET
			title=$1, content_markdown=$2, summary=$3, folder_id=$4,
			source_type=$5, source_url=$6, source_title=$7, source_meta=$8,
			is_pinned=$9, is_favorite=$10, word_count=$11, embedding_status=$12,
			updated_at=CURRENT_TIMESTAMP
		WHERE id=$13 AND deleted=false
		RETURNING *`,
		n.Title, n.ContentMarkdown, n.Summary, n.FolderID,
		n.SourceType, n.SourceURL, n.SourceTitle, n.SourceMeta,
		n.IsPinned, n.IsFavorite, n.WordCount, n.EmbeddingStatus, id,
	).StructScan(&out)
	return &out, err
}

var allowedNoteColumns = map[string]bool{
	"title": true, "summary": true, "folder_id": true, "source_type": true,
	"source_url": true, "source_title": true, "source_meta": true,
	"is_pinned": true, "is_favorite": true, "archived": true,
	"last_opened_at": true, "updated_at": true,
}

// UpdateProperties 按白名单局部更新笔记属性。
func (r *NoteRepo) UpdateProperties(ctx context.Context, id int64, fields map[string]any) (*model.Note, error) {
	if len(fields) == 0 {
		return r.FindByID(ctx, id)
	}
	setClauses := make([]string, 0, len(fields)+1)
	args := make([]any, 0, len(fields)+1)
	i := 1
	for k, v := range fields {
		if !allowedNoteColumns[k] {
			return nil, fmt.Errorf("invalid column: %s", k)
		}
		setClauses = append(setClauses, fmt.Sprintf("%s=$%d", k, i))
		args = append(args, v)
		i++
	}
	setClauses = append(setClauses, "updated_at=CURRENT_TIMESTAMP")
	args = append(args, id)
	query := fmt.Sprintf("UPDATE notes SET %s WHERE id=$%d AND deleted=false RETURNING *",
		strings.Join(setClauses, ","), i)
	var out model.Note
	err := r.db.QueryRowxContext(ctx, query, args...).StructScan(&out)
	return &out, err
}

// SoftDelete 对笔记执行软删除。
func (r *NoteRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE notes SET deleted=true, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND deleted=false`, id)
	return err
}

// MarkOpened 记录最近打开时间, 不刷新 updated_at。
func (r *NoteRepo) MarkOpened(ctx context.Context, id int64, openedAt time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE notes SET last_opened_at=$1 WHERE id=$2 AND deleted=false`, openedAt, id)
	return err
}

// Duplicate 从现有笔记复制一份新笔记。
func (r *NoteRepo) Duplicate(ctx context.Context, id int64, title string, authorID *int64) (*model.Note, error) {
	var out model.Note
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO notes (
			title, content_markdown, summary, folder_id, author_id,
			source_type, source_url, source_title, source_meta,
			is_pinned, is_favorite, archived, deleted, word_count, embedding_status,
			created_at, updated_at
		)
		SELECT $1, content_markdown, summary, folder_id, $2,
			source_type, source_url, source_title, source_meta,
			false, is_favorite, false, false, word_count, 'PENDING',
			CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		FROM notes
		WHERE id=$3 AND deleted=false
		RETURNING *`, title, authorID, id).StructScan(&out)
	return &out, err
}

// FindForAdmin 返回后台笔记分页列表。
func (r *NoteRepo) FindForAdmin(ctx context.Context, f AdminNoteFilter) ([]NoteListRow, int64, error) {
	where, args := buildNoteAdminWhere(f)

	var total int64
	countSQL := "SELECT COUNT(DISTINCT n.id) FROM notes n " + where
	if err := r.db.GetContext(ctx, &total, countSQL, args...); err != nil {
		return nil, 0, err
	}

	orderBy := "n.is_pinned DESC, n.updated_at DESC, n.id DESC"
	if f.View != nil && *f.View == "recent" {
		orderBy = "COALESCE(n.last_opened_at, n.updated_at) DESC, n.id DESC"
	}

	offset := (f.PageNum - 1) * f.PageSize
	listSQL := `SELECT n.id, n.title, n.content_markdown, n.summary, n.folder_id, n.author_id,
			n.source_type, n.source_url, n.source_title, n.source_meta, n.is_pinned,
			n.is_favorite, n.archived, n.deleted, n.word_count, n.embedding_status,
			n.last_opened_at, n.created_at, n.updated_at,
			nf.name AS folder_name,
			COALESCE(array_agg(DISTINCT nt.name) FILTER (WHERE nt.name IS NOT NULL), '{}') AS tag_names
		FROM notes n
		LEFT JOIN note_folders nf ON n.folder_id = nf.id AND nf.deleted=false
		LEFT JOIN note_tag_links ntl ON n.id = ntl.note_id
		LEFT JOIN note_tags nt ON ntl.tag_id = nt.id ` + where +
		fmt.Sprintf(" GROUP BY n.id, nf.name ORDER BY %s LIMIT $%d OFFSET $%d", orderBy, len(args)+1, len(args)+2)
	args = append(args, f.PageSize, offset)

	var rows []NoteListRow
	err := r.db.SelectContext(ctx, &rows, listSQL, args...)
	return rows, total, err
}

func buildNoteAdminWhere(f AdminNoteFilter) (string, []any) {
	clauses := []string{"n.deleted=false"}
	args := []any{}
	n := 1
	placeholder := func(v any) string {
		args = append(args, v)
		s := fmt.Sprintf("$%d", n)
		n++
		return s
	}

	if f.View != nil {
		switch *f.View {
		case "archived":
			clauses = append(clauses, "n.archived=true")
		case "pinned":
			clauses = append(clauses, "n.is_pinned=true", "n.archived=false")
		case "unorganized":
			clauses = append(clauses, "n.folder_id IS NULL", "n.archived=false")
		case "recent", "all":
			clauses = append(clauses, "n.archived=false")
		}
	}
	if f.Archived != nil {
		clauses = append(clauses, "n.archived="+placeholder(*f.Archived))
	}
	if f.Keyword != nil && *f.Keyword != "" {
		pattern := "%" + dbutil.EscapeLike(*f.Keyword) + "%"
		ph := placeholder(pattern)
		clauses = append(clauses, fmt.Sprintf(`(
			n.title ILIKE %s OR n.content_markdown ILIKE %s OR n.summary ILIKE %s OR
			EXISTS (
				SELECT 1 FROM note_tag_links stl
				JOIN note_tags st ON st.id = stl.tag_id
				WHERE stl.note_id = n.id AND st.name ILIKE %s
			)
		)`, ph, ph, ph, ph))
	}
	if f.FolderID != nil {
		clauses = append(clauses, "n.folder_id="+placeholder(*f.FolderID))
	}
	if f.Tag != nil && *f.Tag != "" {
		clauses = append(clauses, `EXISTS (
			SELECT 1 FROM note_tag_links ftl
			JOIN note_tags ft ON ft.id = ftl.tag_id
			WHERE ftl.note_id = n.id AND ft.name = `+placeholder(*f.Tag)+`)`)
	}
	if f.SourceType != nil && *f.SourceType != "" {
		clauses = append(clauses, "n.source_type="+placeholder(*f.SourceType))
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

// ReplaceTags 用 tagNames 重建指定笔记的标签关联。
func (r *NoteRepo) ReplaceTags(ctx context.Context, noteID int64, tagNames []string) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM note_tag_links WHERE note_id=$1`, noteID); err != nil {
		return err
	}
	for _, name := range tagNames {
		var tagID int64
		if err := tx.QueryRowxContext(ctx, `
			INSERT INTO note_tags (name, created_at, updated_at)
			VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT (name) DO UPDATE SET updated_at=note_tags.updated_at
			RETURNING id`, name).Scan(&tagID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO note_tag_links (note_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			noteID, tagID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetTagNames 返回指定笔记的标签名称。
func (r *NoteRepo) GetTagNames(ctx context.Context, noteID int64) ([]string, error) {
	var names []string
	err := r.db.SelectContext(ctx, &names, `
		SELECT nt.name
		FROM note_tag_links ntl
		JOIN note_tags nt ON nt.id = ntl.tag_id
		WHERE ntl.note_id=$1
		ORDER BY nt.name`, noteID)
	return names, err
}

// ReplaceLinks 用解析出的 wiki links 重建笔记出链。
func (r *NoteRepo) ReplaceLinks(ctx context.Context, noteID int64, links []ParsedNoteLink) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM note_links WHERE source_note_id=$1`, noteID); err != nil {
		return err
	}
	for _, link := range links {
		var targetID *int64
		var id int64
		err := tx.QueryRowxContext(ctx,
			`SELECT id FROM notes WHERE title=$1 AND deleted=false ORDER BY updated_at DESC LIMIT 1`,
			link.TargetTitle).Scan(&id)
		if err == nil {
			targetID = &id
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO note_links (
				source_note_id, target_note_id, target_title, link_text, position_start, position_end
			) VALUES ($1,$2,$3,$4,$5,$6)`,
			noteID, targetID, link.TargetTitle, link.LinkText, link.PositionStart, link.PositionEnd); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// FindOutLinks 返回指定笔记的出链。
func (r *NoteRepo) FindOutLinks(ctx context.Context, noteID int64) ([]dto.NoteLinkItem, error) {
	var links []dto.NoteLinkItem
	err := r.db.SelectContext(ctx, &links, `
		SELECT nl.id, nl.source_note_id, sn.title AS source_title, nl.target_note_id,
			nl.target_title, nl.link_text, nl.position_start, nl.position_end
		FROM note_links nl
		JOIN notes sn ON sn.id = nl.source_note_id AND sn.deleted=false
		WHERE nl.source_note_id=$1
		ORDER BY nl.id`, noteID)
	return links, err
}

// FindBackLinks 返回指向指定笔记的反向链接。
func (r *NoteRepo) FindBackLinks(ctx context.Context, noteID int64) ([]dto.NoteLinkItem, error) {
	var links []dto.NoteLinkItem
	err := r.db.SelectContext(ctx, &links, `
		SELECT nl.id, nl.source_note_id, sn.title AS source_title, nl.target_note_id,
			nl.target_title, nl.link_text, nl.position_start, nl.position_end
		FROM note_links nl
		JOIN notes sn ON sn.id = nl.source_note_id AND sn.deleted=false
		JOIN notes target ON target.id = $1 AND target.deleted=false
		WHERE nl.target_note_id=$1 OR nl.target_title=target.title
		ORDER BY sn.updated_at DESC, nl.id`, noteID)
	return links, err
}

// ListFolders 返回未删除文件夹。
func (r *NoteRepo) ListFolders(ctx context.Context) ([]model.NoteFolder, error) {
	var folders []model.NoteFolder
	err := r.db.SelectContext(ctx, &folders, `
		SELECT * FROM note_folders
		WHERE deleted=false
		ORDER BY sort_order ASC, name ASC`)
	return folders, err
}

// CreateFolder 创建笔记文件夹。
func (r *NoteRepo) CreateFolder(ctx context.Context, f *model.NoteFolder) (*model.NoteFolder, error) {
	var out model.NoteFolder
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO note_folders (name, parent_id, sort_order, deleted, created_at, updated_at)
		VALUES ($1,$2,$3,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		RETURNING *`, f.Name, f.ParentID, f.SortOrder).StructScan(&out)
	return &out, err
}

// ListTags 返回全部笔记标签。
func (r *NoteRepo) ListTags(ctx context.Context) ([]model.NoteTag, error) {
	var tags []model.NoteTag
	err := r.db.SelectContext(ctx, &tags, `SELECT * FROM note_tags ORDER BY name ASC`)
	return tags, err
}
