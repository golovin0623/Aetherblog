package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

const (
	maxSearchTermPatterns = 5
	noSearchTermPattern   = "\ue000aetherblog-no-search-term\ue000"
)

// PostRepo 提供对 posts 表及相关 post_tags 关联表的数据访问能力。
type PostRepo struct{ db *sqlx.DB }

// NewPostRepo 创建一个由指定数据库连接支撑的 PostRepo 实例。
func NewPostRepo(db *sqlx.DB) *PostRepo { return &PostRepo{db: db} }

// --- 核心 CRUD ---

// FindByID 根据主键查询未删除的文章，不存在时返回 nil。
// 操作表：posts；过滤条件：deleted = false。
func (r *PostRepo) FindByID(ctx context.Context, id int64) (*model.Post, error) {
	var p model.Post
	err := r.db.GetContext(ctx, &p, `SELECT * FROM posts WHERE id = $1 AND deleted = false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

// FindOwnership 仅拉取用于 ownership 校验的最小列（author_id）。
// 避免走 FindByID 的 SELECT * —— 后者会把可能达到 MB 级的 Markdown 正文、
// 全部元数据字段一并加载，而写操作前的权限校验只需要一列。AutoSave 在编辑
// 器里被高频调用，此路径收益最明显。
// 返回值：exists=false 表示记录不存在或已软删除；exists=true 时 authorID
// 可为 nil（VanBlog 导入的遗留文章 author_id 允许 NULL）。
func (r *PostRepo) FindOwnership(ctx context.Context, id int64) (bool, *int64, error) {
	var authorID *int64
	err := r.db.GetContext(ctx, &authorID,
		`SELECT author_id FROM posts WHERE id = $1 AND deleted = false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	return true, authorID, nil
}

// FindBySlug 根据 slug 查询未删除的文章（不限状态），不存在时返回 nil。
// 操作表：posts；过滤条件：deleted = false，状态不限。
func (r *PostRepo) FindBySlug(ctx context.Context, slug string) (*model.Post, error) {
	var p model.Post
	err := r.db.GetContext(ctx, &p, `SELECT * FROM posts WHERE slug = $1 AND deleted = false`, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

// FindBySlugPublished 根据 slug 查询已发布、可见且未删除的文章。
// 过滤条件：status = 'PUBLISHED' AND is_hidden = false AND deleted = false。
// 文章不存在或尚未发布时返回 nil。
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

// FindPublishedSharedByID 根据 ID 查询可通过身份共享入口读取的已发布文章。
// 与公开 slug 读取不同，这里允许 is_hidden=true，因为隐藏文章是共享授权的主要业务场景。
func (r *PostRepo) FindPublishedSharedByID(ctx context.Context, id int64) (*model.Post, error) {
	var p model.Post
	err := r.db.GetContext(ctx, &p,
		`SELECT * FROM posts WHERE id = $1 AND deleted = false AND status = 'PUBLISHED'`,
		id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

// Create 向 posts 表插入一条新文章记录，view_count/comment_count/like_count 初始化为 0，
// embedding_status 初始化为 'PENDING'，并返回完整的创建后记录。
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

// Update 更新指定文章的主要内容字段，并返回更新后的完整记录。
// 操作表：posts；WHERE 条件：id = $17 AND deleted = false。
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

// allowedPostColumns 是 UpdateProperties 方法允许动态更新的列名白名单，
// 用于防止 SQL 注入，避免调用方传入任意列名。
var allowedPostColumns = map[string]bool{
	"title": true, "summary": true, "cover_image": true, "category_id": true,
	"status": true, "is_pinned": true, "pin_priority": true, "allow_comment": true,
	"password": true, "is_hidden": true, "slug": true, "created_at": true,
	"published_at": true, "view_count": true, "updated_at": true,
}

// UpdateProperties 动态更新 fields 中指定的列（局部更新）。
// 列名会通过 allowedPostColumns 白名单校验，防止 SQL 注入。
// 更新成功后返回修改后的完整文章记录。
func (r *PostRepo) UpdateProperties(ctx context.Context, id int64, fields map[string]any) (*model.Post, error) {
	if len(fields) == 0 {
		// fields 为空时直接查询当前记录，避免执行无意义的 UPDATE
		return r.FindByID(ctx, id)
	}
	setClauses := make([]string, 0, len(fields)+1)
	args := make([]any, 0, len(fields)+2)
	i := 1
	for k, v := range fields {
		// 校验列名是否在白名单中，阻止非法列名注入
		if !allowedPostColumns[k] {
			return nil, fmt.Errorf("invalid column: %s", k)
		}
		setClauses = append(setClauses, fmt.Sprintf("%s=$%d", k, i))
		args = append(args, v)
		i++
	}
	// 追加 updated_at=NOW() 保证每次更新都刷新时间戳
	setClauses = append(setClauses, fmt.Sprintf("updated_at=NOW()"))
	args = append(args, id)
	query := fmt.Sprintf("UPDATE posts SET %s WHERE id=$%d AND deleted=false RETURNING *",
		strings.Join(setClauses, ","), i)
	var out model.Post
	err := r.db.QueryRowxContext(ctx, query, args...).StructScan(&out)
	return &out, err
}

// SoftDelete 对文章执行软删除，将 deleted 标志置为 true，不物理删除行。
// 操作表：posts；同时更新 updated_at 时间戳。
func (r *PostRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE posts SET deleted=true, updated_at=NOW() WHERE id=$1`, id)
	return err
}

// IncrementViewCount 原子地将指定文章的浏览计数加 1。
// 错误会被静默忽略，以避免阻塞 HTTP 响应 goroutine。
func (r *PostRepo) IncrementViewCount(ctx context.Context, id int64) {
	r.db.ExecContext(ctx, `UPDATE posts SET view_count = view_count + 1 WHERE id = $1`, id)
}

// --- 管理后台文章列表 ---

// AdminPostFilter 包含管理后台文章列表查询的所有可选筛选条件。
type AdminPostFilter struct {
	Status       *string // 按文章状态筛选（DRAFT|PUBLISHED|ARCHIVED|SCHEDULED）；nil 表示不限
	Keyword      *string // 对 title 和 content_markdown 进行 ILIKE 模糊搜索；nil 表示不限
	CategoryID   *int64  // 按分类筛选；nil 表示不限
	TagID        *int64  // 按标签筛选（需关联 post_tags 表）；nil 表示不限
	MinViewCount *int64  // 浏览量下限（含）；nil 表示不限
	MaxViewCount *int64  // 浏览量上限（含）；nil 表示不限
	StartDate    *string // created_at 的 ISO 时间字符串下限；nil 表示不限
	EndDate      *string // created_at 的 ISO 时间字符串上限；nil 表示不限
	Hidden       *bool   // 按 is_hidden 筛选；nil 表示同时包含隐藏和可见文章
	PageNum      int     // 从 1 开始的页码
	PageSize     int     // 每页记录数
}

// postListRow 是文章列表查询的内部投影类型，在 model.Post 基础上附加了分类名称字段。
type postListRow struct {
	model.Post
	CategoryName *string `db:"category_name"`
}

// FindForAdmin 返回符合筛选条件的文章分页列表（含分类名称）及匹配总数，供管理后台使用。
// 核心逻辑：通过 buildAdminWhere 动态构建 WHERE 子句，LEFT JOIN categories 获取分类名，
// 按标签筛选时额外 JOIN post_tags 表，使用 COUNT(DISTINCT p.id) 去重统计总数。
func (r *PostRepo) FindForAdmin(ctx context.Context, f AdminPostFilter) ([]postListRow, int64, error) {
	where, args := buildAdminWhere(f)

	// 先查总数，用于前端分页计算
	var total int64
	countSQL := "SELECT COUNT(DISTINCT p.id) FROM posts p " +
		"LEFT JOIN categories c ON p.category_id = c.id " +
		buildTagJoin(f.TagID) + where
	if err := r.db.GetContext(ctx, &total, countSQL, args...); err != nil {
		return nil, 0, err
	}

	// 再查分页数据，按创建时间倒序
	offset := (f.PageNum - 1) * f.PageSize
	listSQL := `SELECT p.*, c.name AS category_name FROM posts p
		LEFT JOIN categories c ON p.category_id = c.id ` +
		buildTagJoin(f.TagID) + where +
		fmt.Sprintf(" ORDER BY p.created_at DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	args = append(args, f.PageSize, offset)

	var rows []postListRow
	err := r.db.SelectContext(ctx, &rows, listSQL, args...)
	return rows, total, err
}

// buildTagJoin 当 tagID 不为 nil 时返回 post_tags 的 INNER JOIN 子句，
// 用于按标签筛选文章列表。
func buildTagJoin(tagID *int64) string {
	if tagID != nil {
		return "JOIN post_tags pt ON p.id = pt.post_id "
	}
	return ""
}

// buildAdminWhere 根据 AdminPostFilter 的各字段动态构建带参数占位符的 WHERE 子句。
// 返回以 " WHERE " 开头的子句字符串及对应的位置参数切片。
// 采用闭包 placeholder 自动递增参数编号（$1、$2…），保证 SQL 安全。
func buildAdminWhere(f AdminPostFilter) (string, []any) {
	clauses := []string{"p.deleted = false"} // 基础条件：排除软删除记录
	args := []any{}
	n := 1
	// placeholder 追加一个参数并返回其占位符字符串（如 $1、$2）
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
		// 对标题和正文 Markdown 做大小写不敏感的模糊匹配
		pattern := "%" + dbutil.EscapeLike(*f.Keyword) + "%"
		ph := placeholder(pattern)
		clauses = append(clauses,
			fmt.Sprintf("(p.title ILIKE %s ESCAPE E'\\\\' OR p.content_markdown ILIKE %s ESCAPE E'\\\\')", ph, ph))
	}
	if f.CategoryID != nil {
		clauses = append(clauses, "p.category_id = "+placeholder(*f.CategoryID))
	}
	if f.TagID != nil {
		// 需配合 buildTagJoin 生成的 JOIN 子句使用
		clauses = append(clauses, "pt.tag_id = "+placeholder(*f.TagID))
	}
	if f.MinViewCount != nil {
		clauses = append(clauses, "p.view_count >= "+placeholder(*f.MinViewCount))
	}
	if f.MaxViewCount != nil {
		clauses = append(clauses, "p.view_count <= "+placeholder(*f.MaxViewCount))
	}
	if f.StartDate != nil {
		clauses = append(clauses, "p.created_at >= "+placeholder(*f.StartDate))
	}
	if f.EndDate != nil {
		clauses = append(clauses, "p.created_at <= "+placeholder(*f.EndDate))
	}
	if f.Hidden != nil {
		clauses = append(clauses, "p.is_hidden = "+placeholder(*f.Hidden))
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

// --- 博客前台公开列表 ---

// FindPublished 返回博客前台展示用的已发布、可见文章分页列表及总数。
// 排序规则：is_pinned DESC → pin_priority DESC → published_at DESC（置顶优先）。
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
			" ORDER BY p.is_pinned DESC, p.pin_priority DESC, p.published_at DESC LIMIT $1 OFFSET $2",
		pageSize, offset)
	return rows, total, err
}

// FindPublishedNoPassword 与 FindPublished 类似，但额外排除密码保护文章。
// 专用于 Agent picker 的 @ 文章选择器：picker 选中的文章会被注入 LLM prompt，
// 因此密码保护文章必须在 SQL 层就剔除（避免 IDOR / 信息泄露）。
// 排序规则：published_at DESC（picker 不需要置顶逻辑，按发布时间倒序即可）。
//
// LIMIT / OFFSET 走 $1 / $2 占位符（而非 fmt.Sprintf），让 driver 走预编译路径。
// 即便 pageSize / offset 已在 handler 层做了边界校验，占位符仍是更稳的写法
// —— 将来若有人把校验改弱也不会变成 SQL 注入入口。
func (r *PostRepo) FindPublishedNoPassword(ctx context.Context, pageNum, pageSize int) ([]postListRow, int64, error) {
	const baseWhere = " WHERE p.deleted=false AND p.status='PUBLISHED' AND p.is_hidden=false AND p.password IS NULL"
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
			` ORDER BY p.published_at DESC NULLS LAST, p.id DESC LIMIT $1 OFFSET $2`,
		pageSize, offset)
	return rows, total, err
}

// FindPublishedSharedByIDs 返回指定 ID 集合中的已发布文章，允许隐藏文章进入共享列表。
func (r *PostRepo) FindPublishedSharedByIDs(ctx context.Context, ids []int64) ([]postListRow, error) {
	if len(ids) == 0 {
		return []postListRow{}, nil
	}
	query, args, err := sqlx.In(`
		SELECT p.*, c.name AS category_name
		FROM posts p
		LEFT JOIN categories c ON p.category_id = c.id
		WHERE p.id IN (?) AND p.deleted = false AND p.status = 'PUBLISHED'
		ORDER BY p.published_at DESC NULLS LAST, p.id DESC`, ids)
	if err != nil {
		return nil, err
	}
	query = r.db.Rebind(query)
	var rows []postListRow
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, err
	}
	return rows, nil
}

// FindByCategory 返回指定分类下已发布、可见文章的分页列表及总数。
// 操作表：posts LEFT JOIN categories；WHERE 条件额外增加 category_id = $1。
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
			" ORDER BY p.published_at DESC LIMIT $2 OFFSET $3",
		categoryID, pageSize, offset)
	return rows, total, err
}

// FindByTag 返回带有指定标签的已发布、可见文章分页列表及总数。
// 操作表：posts INNER JOIN post_tags（过滤标签）LEFT JOIN categories（获取分类名）。
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
			" ORDER BY p.published_at DESC LIMIT $2 OFFSET $3",
		tagID, pageSize, offset)
	return rows, total, err
}

// --- 文章标签操作 ---

// FindTagsByPostID 通过 post_tags 关联表查询指定文章的所有标签。
// 操作表：tags INNER JOIN post_tags；参数 postID 为文章主键。
func (r *PostRepo) FindTagsByPostID(ctx context.Context, postID int64) ([]model.Tag, error) {
	var tags []model.Tag
	err := r.db.SelectContext(ctx, &tags,
		`SELECT t.* FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = $1`, postID)
	return tags, err
}

// FindTagsByPostIDs 批量查询多篇文章的标签，返回 postID → []Tag 的映射。
// 用于列表页批量加载标签，避免 N+1 查询问题。
// 操作表：tags INNER JOIN post_tags；使用 IN 子句一次性查询所有 postID 对应的标签。
func (r *PostRepo) FindTagsByPostIDs(ctx context.Context, postIDs []int64) (map[int64][]model.Tag, error) {
	if len(postIDs) == 0 {
		return map[int64][]model.Tag{}, nil
	}
	type row struct {
		PostID int64 `db:"post_id"`
		model.Tag
	}
	// 构建 IN 子句的占位符列表（$1, $2, ...）
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
	// 将平铺结果按 post_id 分组聚合为 map
	m := make(map[int64][]model.Tag)
	for _, r := range rows {
		m[r.PostID] = append(m[r.PostID], r.Tag)
	}
	return m, nil
}

// SetTags 在事务中原子地替换文章的完整标签集合。
// 先删除 post_tags 中该文章的全部关联，再逐一插入新标签（ON CONFLICT DO NOTHING 防重复）。
func (r *PostRepo) SetTags(ctx context.Context, postID int64, tagIDs []int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() // 发生错误时自动回滚
	// 清除该文章的所有现有标签关联
	if _, err := tx.ExecContext(ctx, `DELETE FROM post_tags WHERE post_id = $1`, postID); err != nil {
		return err
	}
	// 逐一插入新标签关联，ON CONFLICT DO NOTHING 避免重复键错误
	for _, tagID := range tagIDs {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO post_tags (post_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			postID, tagID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// --- 上下篇导航 ---

// adjacentRow 是上下篇导航查询的内部投影类型，仅包含 id、title、slug 三个字段。
type adjacentRow struct {
	ID    int64  `db:"id"`
	Title string `db:"title"`
	Slug  string `db:"slug"`
}

// FindAdjacentPosts 根据发布时间查找指定文章的上一篇和下一篇已发布、可见文章。
// 上一篇：published_at < publishedAt，按 DESC 取最近一条。
// 下一篇：published_at > publishedAt，按 ASC 取最早一条。
// 参数 postID 用于排除文章自身，防止出现"自己的上/下篇是自己"的情况。
func (r *PostRepo) FindAdjacentPosts(ctx context.Context, publishedAt string, postID int64) (*adjacentRow, *adjacentRow, error) {
	const baseWhere = `FROM posts WHERE deleted=false AND status='PUBLISHED' AND is_hidden=false AND id != $2`
	var prev, next adjacentRow

	// 查询上一篇（发布时间更早，倒序取第一条）
	err1 := r.db.GetContext(ctx, &prev,
		`SELECT id,title,slug `+baseWhere+` AND published_at < $1 ORDER BY published_at DESC LIMIT 1`,
		publishedAt, postID)
	// 查询下一篇（发布时间更晚，正序取第一条）
	err2 := r.db.GetContext(ctx, &next,
		`SELECT id,title,slug `+baseWhere+` AND published_at > $1 ORDER BY published_at ASC LIMIT 1`,
		publishedAt, postID)

	var prevPtr, nextPtr *adjacentRow
	// sql.ErrNoRows 不算错误，表示已是首篇或末篇
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

// --- 归档统计 ---

// ArchiveMonth 保存归档侧边栏使用的按月发文统计数据。
type ArchiveMonth struct {
	YearMonth string `db:"year_month"` // 格式：YYYY-MM
	Count     int    `db:"count"`      // 该月已发布的文章数量
}

// FindArchiveStats 返回已发布文章按月分组的统计数据，按月份倒序排列。
// 操作表：posts；使用 TO_CHAR 将 published_at 格式化为 YYYY-MM，供归档侧边栏展示。
func (r *PostRepo) FindArchiveStats(ctx context.Context) ([]ArchiveMonth, error) {
	var rows []ArchiveMonth
	err := r.db.SelectContext(ctx, &rows,
		`SELECT TO_CHAR(published_at, 'YYYY-MM') AS year_month, COUNT(*) AS count
		 FROM posts WHERE deleted=false AND status='PUBLISHED' AND is_hidden=false
		 GROUP BY year_month ORDER BY year_month DESC`)
	return rows, err
}

// FindArchivePosts 返回按 "YYYY-MM" 分组的已发布文章 map，供完整归档页面使用。
// 操作表：posts；按 published_at 倒序查询后，在内存中按月份分组聚合为 map。
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
	// 将查询结果按年月分组，构建 map[YYYY-MM][]Post
	m := make(map[string][]model.Post)
	for _, p := range posts {
		m[p.YearMonth] = append(m[p.YearMonth], p.Post)
	}
	return m, nil
}

// CountPublished 返回已发布文章的总数量，用于站点统计展示。
// 操作表：posts；过滤条件：deleted = false AND status = 'PUBLISHED'。
func (r *PostRepo) CountPublished(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM posts WHERE deleted=false AND status='PUBLISHED'`)
	return n, err
}

// --- 全文搜索 ---

// SearchResultRow 是关键词搜索查询的投影类型。
type SearchResultRow struct {
	ID           int64      `db:"id"`
	Title        string     `db:"title"`
	Slug         string     `db:"slug"`
	Summary      *string    `db:"summary"`
	CategoryName *string    `db:"category_name"`
	Rank         float64    `db:"rank"`
	PublishedAt  *time.Time `db:"published_at"`
}

func postSearchDocumentSQL(alias string) string {
	qualifier := ""
	if alias != "" {
		qualifier = alias + "."
	}
	return fmt.Sprintf(
		"left(%stitle || ' ' || COALESCE(%ssummary, '') || ' ' || COALESCE(%scontent_markdown, ''), %d)",
		qualifier,
		qualifier,
		qualifier,
		fulltextSearchDocumentMaxChars,
	)
}

type searchRuneClass int

const (
	searchRuneSeparator searchRuneClass = iota
	searchRuneASCII
	searchRuneCJK
	searchRuneOtherWord
)

func classifySearchRune(r rune) searchRuneClass {
	switch {
	case r <= unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)):
		return searchRuneASCII
	case unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul):
		return searchRuneCJK
	case unicode.IsLetter(r) || unicode.IsDigit(r):
		return searchRuneOtherWord
	default:
		return searchRuneSeparator
	}
}

func isSearchTokenConnector(r rune) bool {
	switch r {
	case '_', '-', '+', '#', '%', '.':
		return true
	default:
		return false
	}
}

func derivedSearchTerms(term string) []string {
	for _, prefix := range []string{"什么是", "怎么", "如何", "怎样", "为何", "为什么"} {
		if !strings.HasPrefix(term, prefix) {
			continue
		}
		rest := strings.TrimSpace(strings.TrimPrefix(term, prefix))
		if utf8.RuneCountInString(rest) >= 2 {
			return []string{rest}
		}
	}
	return nil
}

func splitSearchTerms(raw string) []string {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		return nil
	}

	terms := make([]string, 0, maxSearchTermPatterns)
	seen := make(map[string]struct{})
	var builder strings.Builder
	lastClass := searchRuneSeparator

	addTerm := func(term string) {
		if term == "" {
			return
		}
		firstRune, _ := utf8.DecodeRuneInString(term)
		if runeCount := utf8.RuneCountInString(term); runeCount < 2 && classifySearchRune(firstRune) == searchRuneASCII {
			return
		}
		if _, ok := seen[term]; ok {
			return
		}
		seen[term] = struct{}{}
		terms = append(terms, term)
	}

	flush := func() {
		if builder.Len() == 0 {
			return
		}
		term := strings.Trim(builder.String(), "_-%.")
		builder.Reset()
		lastClass = searchRuneSeparator
		addTerm(term)
	}

	for _, r := range normalized {
		if isSearchTokenConnector(r) {
			if builder.Len() > 0 {
				builder.WriteRune(r)
			} else {
				lastClass = searchRuneSeparator
			}
			continue
		}

		class := classifySearchRune(r)
		if class == searchRuneSeparator {
			flush()
			continue
		}
		if builder.Len() > 0 && class != lastClass {
			flush()
		}
		builder.WriteRune(r)
		lastClass = class
	}
	flush()

	baseTerms := append([]string(nil), terms...)
	for _, term := range baseTerms {
		for _, derived := range derivedSearchTerms(term) {
			addTerm(derived)
		}
		if len(terms) >= maxSearchTermPatterns {
			break
		}
	}

	if len(terms) > maxSearchTermPatterns {
		return terms[:maxSearchTermPatterns]
	}
	return terms
}

func buildSearchLikePattern(term string) string {
	return "%" + dbutil.EscapeLike(strings.ToLower(strings.TrimSpace(term))) + "%"
}

func buildSearchPublishedArgs(keyword string, limit, offset int) []any {
	args := []any{keyword, buildSearchLikePattern(keyword)}
	terms := splitSearchTerms(keyword)
	for i := 0; i < maxSearchTermPatterns; i++ {
		if i < len(terms) {
			args = append(args, buildSearchLikePattern(terms[i]))
			continue
		}
		args = append(args, noSearchTermPattern)
	}
	return append(args, limit, offset)
}

func postSearchLikeAnySQL(column string, start, count int) string {
	parts := make([]string, 0, count)
	for i := 0; i < count; i++ {
		parts = append(parts, fmt.Sprintf("%s ILIKE $%d ESCAPE '\\'", column, start+i))
	}
	return "(" + strings.Join(parts, " OR ") + ")"
}

func postSearchTagLikeAnySQL(start, count int) string {
	parts := make([]string, 0, count*2)
	for i := 0; i < count; i++ {
		placeholder := start + i
		parts = append(parts,
			fmt.Sprintf("t.name ILIKE $%d ESCAPE '\\'", placeholder),
			fmt.Sprintf("t.slug ILIKE $%d ESCAPE '\\'", placeholder),
		)
	}
	return strings.Join(parts, " OR ")
}

func postSearchTagExistsSQL(patternSQL string) string {
	return fmt.Sprintf(`EXISTS (
					SELECT 1
					FROM post_tags pt
					JOIN tags t ON t.id = pt.tag_id
					WHERE pt.post_id = p.id
						AND (%s)
				)`, patternSQL)
}

func postSearchTermRankSQL(start, count int) string {
	parts := make([]string, 0, count*5)
	for i := 0; i < count; i++ {
		placeholder := start + i
		parts = append(parts,
			fmt.Sprintf("CASE WHEN p.title ILIKE $%d ESCAPE '\\' THEN 0.45 ELSE 0 END", placeholder),
			fmt.Sprintf("CASE WHEN COALESCE(p.summary,'') ILIKE $%d ESCAPE '\\' THEN 0.15 ELSE 0 END", placeholder),
			fmt.Sprintf("CASE WHEN COALESCE(p.content_markdown,'') ILIKE $%d ESCAPE '\\' THEN 0.04 ELSE 0 END", placeholder),
			fmt.Sprintf("CASE WHEN (c.name ILIKE $%d ESCAPE '\\' OR c.slug ILIKE $%d ESCAPE '\\') THEN 0.28 ELSE 0 END", placeholder, placeholder),
			fmt.Sprintf("CASE WHEN %s THEN 0.28 ELSE 0 END",
				postSearchTagExistsSQL(postSearchTagLikeAnySQL(placeholder, 1))),
		)
	}
	return "(" + strings.Join(parts, " + ") + ")"
}

func postSearchTermWhereSQL(start, count int) string {
	return strings.Join([]string{
		postSearchLikeAnySQL("p.title", start, count),
		postSearchLikeAnySQL("COALESCE(p.summary,'')", start, count),
		postSearchLikeAnySQL("COALESCE(p.content_markdown,'')", start, count),
		postSearchLikeAnySQL("c.name", start, count),
		postSearchLikeAnySQL("c.slug", start, count),
		postSearchTagExistsSQL(postSearchTagLikeAnySQL(start, count)),
	}, "\n					OR ")
}

func searchPublishedQuery() string {
	searchDocument := postSearchDocumentSQL("p")
	termStart := 3
	limitPlaceholder := termStart + maxSearchTermPatterns
	offsetPlaceholder := limitPlaceholder + 1
	return fmt.Sprintf(`
		WITH q AS (
			SELECT plainto_tsquery('simple', lower($1)) AS tsq
		)
		SELECT p.id, p.title, p.slug, p.summary, c.name AS category_name, p.published_at,
			LEAST(
				ts_rank(
					to_tsvector('simple', %[1]s),
					(SELECT tsq FROM q)
				),
				0.35
			)
			+ CASE WHEN p.title ILIKE $2 ESCAPE '\' THEN 2.4 ELSE 0 END
			+ CASE WHEN COALESCE(p.summary,'') ILIKE $2 ESCAPE '\' THEN 0.8 ELSE 0 END
			+ CASE WHEN COALESCE(p.content_markdown,'') ILIKE $2 ESCAPE '\' THEN 0.18 ELSE 0 END
			+ CASE WHEN (c.name ILIKE $2 ESCAPE '\' OR c.slug ILIKE $2 ESCAPE '\') THEN 1.2 ELSE 0 END
			+ CASE WHEN %[2]s THEN 1.0 ELSE 0 END
			+ %[3]s AS rank
		FROM posts p
		LEFT JOIN categories c ON p.category_id = c.id
		WHERE p.deleted = false AND p.status = 'PUBLISHED' AND p.is_hidden = false
			AND p.password IS NULL
			AND (
				to_tsvector('simple', %[1]s)
					@@ (SELECT tsq FROM q)
				OR p.title ILIKE $2 ESCAPE '\'
				OR COALESCE(p.summary,'') ILIKE $2 ESCAPE '\'
				OR COALESCE(p.content_markdown,'') ILIKE $2 ESCAPE '\'
				OR c.name ILIKE $2 ESCAPE '\'
				OR c.slug ILIKE $2 ESCAPE '\'
				OR %[2]s
				OR (
					%[4]s
					)
				)
			ORDER BY rank DESC, p.published_at DESC NULLS LAST
			LIMIT $%[5]d OFFSET $%[6]d`,
		searchDocument,
		postSearchTagExistsSQL(`t.name ILIKE $2 ESCAPE '\' OR t.slug ILIKE $2 ESCAPE '\'`),
		postSearchTermRankSQL(termStart, maxSearchTermPatterns),
		postSearchTermWhereSQL(termStart, maxSearchTermPatterns),
		limitPlaceholder,
		offsetPlaceholder,
	)
}

// SearchPublished 使用 PostgreSQL 全文搜索查找已发布文章，按相关性排序。
// 为兼容中文/CJK 查询，保留 ts_rank 打分的同时叠加 ILIKE 作为兜底匹配：
// 'simple' 分词器以空白切分，无法切分中文整词，会导致 tsvector 路径对中文查询返回 0 结果；
// ILIKE 子串匹配确保在这种情况下仍能命中。title/summary 命中给予更高加权。
// 大小写兼容：在 CTE 里显式 lower($1),让 tsquery 的词位和 ILIKE 的子串模式都走
// 小写分支;'simple' 分词器理论上已经 lowercase,但部分 PG 字典/本地化配置会打破
// 这个假设,导致 "Docker" 与 "docker" 出不同结果。前置 lower 让两条查询等价。
// PostgreSQL 对 tsvector 输入有约 1MB 限制，搜索索引只使用正文前段派生文本；
// content_markdown 本身仍完整保存，ILIKE 兜底也继续覆盖全文。
func (r *PostRepo) SearchPublished(ctx context.Context, keyword string, limit, offset int) ([]SearchResultRow, error) {
	var rows []SearchResultRow
	err := r.db.SelectContext(ctx, &rows, searchPublishedQuery(), buildSearchPublishedArgs(keyword, limit, offset)...)
	return rows, err
}

// FilterPublicNoPassword 输入候选 id 列表，返回其中"已发布 + 未隐藏 +
// 未删除 + 未设密码"的 id 子集。
//
// 用途：Agent picker 的 @ 文章选择器拿到 SearchPublished 候选后，必须再做
// 一次 password IS NULL 过滤——SearchResultRow 不带 password 字段，必须
// 单独查一次。让 Repo 而不是 handler 拼 SQL，避免 IN(...) 占位符注入风险。
//
// 复杂度：单次 batch SELECT，最多 60 个 id 一起回表，毫秒级。
func (r *PostRepo) FilterPublicNoPassword(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	query, args, err := sqlx.In(`
		SELECT id FROM posts
		WHERE id IN (?)
		  AND deleted = false
		  AND status = 'PUBLISHED'
		  AND is_hidden = false
		  AND password IS NULL`, ids)
	if err != nil {
		return nil, fmt.Errorf("FilterPublicNoPassword: build IN clause: %w", err)
	}
	query = r.db.Rebind(query)
	var out []int64
	if err := r.db.SelectContext(ctx, &out, query, args...); err != nil {
		return nil, err
	}
	return out, nil
}

// IsPublicNoPassword 判断文章是否可在无需身份与密码的公开接口中直接读取。
func (r *PostRepo) IsPublicNoPassword(ctx context.Context, id int64) (bool, error) {
	var ok bool
	err := r.db.GetContext(ctx, &ok, `
		SELECT EXISTS (
			SELECT 1 FROM posts
			WHERE id = $1
			  AND deleted = false
			  AND status = 'PUBLISHED'
			  AND is_hidden = false
			  AND password IS NULL
		)`, id)
	return ok, err
}

// ListEmbeddingStatus 返回文章的向量索引状态列表（仅排除 deleted=true），支持按 embeddingStatus 过滤。
// statusFilter 为空时返回所有文章，否则只返回指定状态的文章。
func (r *PostRepo) ListEmbeddingStatus(ctx context.Context, statusFilter string, limit, offset int) ([]dto.EmbeddingPostItem, int, error) {
	args := []any{}
	where := "WHERE p.deleted = false"
	if statusFilter != "" {
		where += " AND p.embedding_status = $1"
		args = append(args, statusFilter)
	}

	// 统计总数
	countQuery := "SELECT COUNT(*) FROM posts p " + where
	var total int
	if err := r.db.GetContext(ctx, &total, countQuery, args...); err != nil {
		return nil, 0, err
	}

	// 查询列表
	selectQuery := fmt.Sprintf(`
		SELECT p.id, p.title, p.slug, p.status, p.embedding_status, p.published_at, p.updated_at
		FROM posts p %s
		ORDER BY p.id DESC
		LIMIT $%d OFFSET $%d`, where, len(args)+1, len(args)+2)
	args = append(args, limit, offset)

	var items []dto.EmbeddingPostItem
	if err := r.db.SelectContext(ctx, &items, selectQuery, args...); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// FindByIDs 根据一组 ID 查询文章（用于批量索引，排除 deleted=true）。
func (r *PostRepo) FindByIDs(ctx context.Context, ids []int64) ([]model.Post, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	query, args, err := sqlx.In(
		`SELECT * FROM posts WHERE id IN (?) AND deleted = false`, ids)
	if err != nil {
		return nil, err
	}
	query = r.db.Rebind(query)
	var posts []model.Post
	err = r.db.SelectContext(ctx, &posts, query, args...)
	return posts, err
}

// MarkEmbeddingPending 将指定 ID 的文章 embedding_status 置为 'PENDING'。
// 用于异步批量索引前先行登记状态，便于前端进度面板通过 stats 接口感知"待处理"数量。
func (r *PostRepo) MarkEmbeddingPending(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	query, args, err := sqlx.In(
		`UPDATE posts SET embedding_status = 'PENDING', updated_at = NOW()
		 WHERE id IN (?) AND deleted = false`, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}

// MarkEmbeddingFailed 把指定 ID 的文章 embedding_status 置为 'FAILED'。
//
// 用途：backend 调 ai-service /api/v1/admin/search/index 时，若上游拒绝或超时
// 会在 ai-service 内部 raise HTTPException 之前就直接返回，**不**写 DB。如果
// backend 也只在内存 result.Failed++，
// 这条文章会永远卡在 PENDING：stats.failed_posts 不增 → 前端 progress
// panel 永远 0% → 用户以为索引在跑，其实早就失败了。这里兜底落库，
// 让 stats / 列表 / 进度条全都立刻反映真相。
func (r *PostRepo) MarkEmbeddingFailed(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	query, args, err := sqlx.In(
		`UPDATE posts SET embedding_status = 'FAILED', updated_at = NOW()
		 WHERE id IN (?) AND deleted = false`, ids)
	if err != nil {
		return err
	}
	query = r.db.Rebind(query)
	_, err = r.db.ExecContext(ctx, query, args...)
	return err
}
