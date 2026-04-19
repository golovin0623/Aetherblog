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
)

// MigrationRepo 提供 VanBlog 迁移专用的批量读写接口，避免老 handler 里
// 每条文章一次 FindByName/FindBySlug 的 N+1 查询。
//
// 所有 Load* 方法都以 `WHERE col = ANY($1)` 一次性取回所有用到的实体；
// Batch* 写方法使用多行 VALUES INSERT（每批 500/200 行，远低于 pg 32k 占位符上限）
// 并开放 `ON CONFLICT` 行为的裁定给调用方。
type MigrationRepo struct{ db *sqlx.DB }

// NewMigrationRepo 由给定数据库连接构造迁移仓库实例。
func NewMigrationRepo(db *sqlx.DB) *MigrationRepo { return &MigrationRepo{db: db} }

// --- 批量读 ---

// LoadCategoryMap 按名称批量查询分类，返回 name → id 映射。
// 未命中的名称不会出现在 map 里；调用方凭此决定需要创建哪些新分类。
func (r *MigrationRepo) LoadCategoryMap(ctx context.Context, names []string) (map[string]int64, error) {
	return r.loadNameMap(ctx, "categories", names)
}

// LoadTagMap 按名称批量查询标签，返回 name → id 映射。语义同 LoadCategoryMap。
func (r *MigrationRepo) LoadTagMap(ctx context.Context, names []string) (map[string]int64, error) {
	return r.loadNameMap(ctx, "tags", names)
}

// loadNameMap 是 categories/tags 按 name 批量查询的共享实现。
// 注：categories.name 和 tags.name 均非 UNIQUE（schema 见 migration 000001），
// 同名记录可能存在多行；这里取 id 最小的一条（ORDER BY id ASC）与 migration 约定一致。
func (r *MigrationRepo) loadNameMap(
	ctx context.Context, table string, names []string,
) (map[string]int64, error) {
	m := make(map[string]int64, len(names))
	if len(names) == 0 {
		return m, nil
	}
	type row struct {
		ID   int64  `db:"id"`
		Name string `db:"name"`
	}
	var rows []row
	// 表名来自本函数内部常量（categories/tags），不拼接用户输入 → 无 SQL 注入风险。
	q := fmt.Sprintf(`SELECT id, name FROM %s WHERE name = ANY($1) ORDER BY id ASC`, table)
	if err := r.db.SelectContext(ctx, &rows, q, pq.Array(names)); err != nil {
		return nil, err
	}
	for _, it := range rows {
		// 同名多行时保留第一次出现的（最小 id），避免被后续行覆盖。
		if _, seen := m[it.Name]; !seen {
			m[it.Name] = it.ID
		}
	}
	return m, nil
}

// LoadCategorySlugSet 按 slug 批量查询 categories，用于 service 层在 INSERT 前
// 规避与 "现有分类" 的 slug UNIQUE 冲突。返回已存在的 slug 集合。
func (r *MigrationRepo) LoadCategorySlugSet(ctx context.Context, slugs []string) (map[string]struct{}, error) {
	return r.loadSlugSet(ctx, "categories", slugs)
}

// LoadTagSlugSet 与 LoadCategorySlugSet 对称。
func (r *MigrationRepo) LoadTagSlugSet(ctx context.Context, slugs []string) (map[string]struct{}, error) {
	return r.loadSlugSet(ctx, "tags", slugs)
}

func (r *MigrationRepo) loadSlugSet(
	ctx context.Context, table string, slugs []string,
) (map[string]struct{}, error) {
	set := make(map[string]struct{}, len(slugs))
	if len(slugs) == 0 {
		return set, nil
	}
	q := fmt.Sprintf(`SELECT slug FROM %s WHERE slug = ANY($1)`, table)
	var rows []string
	if err := r.db.SelectContext(ctx, &rows, q, pq.Array(slugs)); err != nil {
		return nil, err
	}
	for _, s := range rows {
		set[s] = struct{}{}
	}
	return set, nil
}

// LoadSourceKeyMap 批量查询 posts 表中已存在的 source_key，返回 source_key → post_id 映射。
// 用于幂等检测：同一个 VanBlog 文章（按 vanblog:<id>）不会被二次导入。
//
// 为兼容旧版 handler 使用的 vanblog:<title> 格式，调用方可以传入两套 key 做双读。
func (r *MigrationRepo) LoadSourceKeyMap(ctx context.Context, keys []string) (map[string]int64, error) {
	m := make(map[string]int64, len(keys))
	if len(keys) == 0 {
		return m, nil
	}
	type row struct {
		ID        int64  `db:"id"`
		SourceKey string `db:"source_key"`
	}
	var rows []row
	err := r.db.SelectContext(ctx, &rows,
		`SELECT id, source_key FROM posts WHERE source_key = ANY($1) AND deleted = false`,
		pq.Array(keys))
	if err != nil {
		return nil, err
	}
	for _, it := range rows {
		m[it.SourceKey] = it.ID
	}
	return m, nil
}

// LoadPostSlugSet 按 slug 批量检测冲突，返回已存在的 slug 集合。
// 配合 service 层的 seen-set（内存去重）即可把 slug 冲突检查降到一次 SQL。
func (r *MigrationRepo) LoadPostSlugSet(ctx context.Context, slugs []string) (map[string]struct{}, error) {
	return r.loadSlugSet(ctx, "posts", slugs)
}

// --- 批量写 ---

// CategoryInsert 描述一行待写入的分类。
type CategoryInsert struct {
	Name string
	Slug string
}

// BatchInsertCategories 用多行 VALUES INSERT 批量写入分类，返回 name → id 映射。
// ON CONFLICT (slug) 命中时回传现有行的 id/name，service 层据此决定是否告警。
func (r *MigrationRepo) BatchInsertCategories(
	ctx context.Context, tx *sqlx.Tx, items []CategoryInsert,
) (map[string]int64, error) {
	return r.batchInsertNameSlug(ctx, tx, "categories",
		`INSERT INTO categories (name, slug, post_count, created_at, updated_at) VALUES `,
		items)
}

// TagInsert 描述一行待写入的标签。
type TagInsert struct {
	Name string
	Slug string
}

// BatchInsertTags 与 BatchInsertCategories 对称。
func (r *MigrationRepo) BatchInsertTags(
	ctx context.Context, tx *sqlx.Tx, items []TagInsert,
) (map[string]int64, error) {
	cats := make([]CategoryInsert, len(items))
	for i, t := range items {
		cats[i] = CategoryInsert{Name: t.Name, Slug: t.Slug}
	}
	return r.batchInsertNameSlug(ctx, tx, "tags",
		`INSERT INTO tags (name, slug, post_count, created_at, updated_at) VALUES `,
		cats)
}

// batchInsertNameSlug 是 categories/tags 两张 (name, slug) 形制相同表的共享写入路径。
// SQL 形如：
//
//	INSERT INTO <table> (name, slug, post_count, created_at, updated_at)
//	VALUES ($1,$2,0,NOW(),NOW()), ($3,$4,0,NOW(),NOW()), ...
//	ON CONFLICT (slug) DO UPDATE SET updated_at = EXCLUDED.updated_at
//	RETURNING id, name
//
// 注：ON CONFLICT (slug) 意味着若现有分类已用同一 slug（即使 name 不同），
// 我们接纳其 id。service 层在 slug 碰撞但 name 不同时会产出 warning。
func (r *MigrationRepo) batchInsertNameSlug(
	ctx context.Context, tx *sqlx.Tx, table, prefix string, items []CategoryInsert,
) (map[string]int64, error) {
	m := make(map[string]int64, len(items))
	if len(items) == 0 {
		return m, nil
	}
	const batch = 500
	for start := 0; start < len(items); start += batch {
		end := start + batch
		if end > len(items) {
			end = len(items)
		}
		chunk := items[start:end]
		placeholders := make([]string, 0, len(chunk))
		args := make([]any, 0, len(chunk)*2)
		for i, it := range chunk {
			placeholders = append(placeholders,
				fmt.Sprintf("($%d,$%d,0,NOW(),NOW())", i*2+1, i*2+2))
			args = append(args, it.Name, it.Slug)
		}
		_ = table // table 名已嵌入 prefix；保留参数以便未来拆分时校验。
		q := prefix + strings.Join(placeholders, ",") +
			` ON CONFLICT (slug) DO UPDATE SET updated_at = EXCLUDED.updated_at RETURNING id, name`
		type row struct {
			ID   int64  `db:"id"`
			Name string `db:"name"`
		}
		var rows []row
		if err := tx.SelectContext(ctx, &rows, q, args...); err != nil {
			return nil, fmt.Errorf("batch insert %s failed: %w", table, err)
		}
		for _, rr := range rows {
			m[rr.Name] = rr.ID
		}
	}
	return m, nil
}

// PostInsert 描述一行待写入的文章。字段顺序与下方 INSERT 的列顺序对齐。
// 时间戳三字段语义：
//   - PublishedAt nil → 存 NULL
//   - CreatedAt   nil → 插入时回退到 time.Now()
//   - UpdatedAt   nil → 插入时回退到 time.Now()
type PostInsert struct {
	Title              string
	Slug               string
	ContentMarkdown    *string
	Summary            *string
	CoverImage         *string
	Status             string
	CategoryID         *int64
	AuthorID           *int64
	IsPinned           bool
	PinPriority        int
	IsHidden           bool
	Password           *string
	WordCount          int
	ReadingTime        int
	PublishedAt        *time.Time
	SourceKey          string
	LegacyAuthorName   *string
	LegacyVisitedCount int64
	LegacyCopyright    *string
	CreatedAt          *time.Time
	UpdatedAt          *time.Time
	AllowComment       bool
}

// BatchInsertPosts 批量插入文章。22 列 × 200 行/批 = 4400 占位符，远低于 pg 32k 上限。
// 返回 source_key → post_id 映射，供后续 post_tags 写入定位 post.id。
// ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING —— 同一 VanBlog
// 文章被重复跑时不会报错；调用方依靠 Analyze 阶段的 existing-source-key-map 已经
// 过滤掉重复项，此处 DO NOTHING 是额外的防御层。
func (r *MigrationRepo) BatchInsertPosts(
	ctx context.Context, tx *sqlx.Tx, items []PostInsert,
) (map[string]int64, error) {
	m := make(map[string]int64, len(items))
	if len(items) == 0 {
		return m, nil
	}
	const batch = 200
	const colsPerRow = 22
	now := time.Now()
	for start := 0; start < len(items); start += batch {
		end := start + batch
		if end > len(items) {
			end = len(items)
		}
		chunk := items[start:end]
		placeholders := make([]string, 0, len(chunk))
		args := make([]any, 0, len(chunk)*colsPerRow)
		for i, p := range chunk {
			base := i * colsPerRow
			ph := make([]string, colsPerRow)
			for j := 0; j < colsPerRow; j++ {
				ph[j] = fmt.Sprintf("$%d", base+j+1)
			}
			placeholders = append(placeholders, "("+strings.Join(ph, ",")+")")

			createdAt := now
			if p.CreatedAt != nil {
				createdAt = *p.CreatedAt
			}
			updatedAt := now
			if p.UpdatedAt != nil {
				updatedAt = *p.UpdatedAt
			}

			args = append(args,
				p.Title, p.Slug, p.ContentMarkdown, p.Summary, p.CoverImage,
				p.Status, p.CategoryID, p.AuthorID,
				p.IsPinned, p.PinPriority, p.IsHidden, p.Password,
				p.WordCount, p.ReadingTime,
				p.PublishedAt, p.SourceKey,
				p.LegacyAuthorName, p.LegacyVisitedCount, p.LegacyCopyright,
				createdAt, updatedAt,
				p.AllowComment,
			)
		}
		q := `INSERT INTO posts
			(title, slug, content_markdown, summary, cover_image,
			 status, category_id, author_id,
			 is_pinned, pin_priority, is_hidden, password,
			 word_count, reading_time,
			 published_at, source_key,
			 legacy_author_name, legacy_visited_count, legacy_copyright,
			 created_at, updated_at, allow_comment)
			VALUES ` + strings.Join(placeholders, ",") + `
			ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
			RETURNING id, source_key`
		type row struct {
			ID        int64  `db:"id"`
			SourceKey string `db:"source_key"`
		}
		var rows []row
		if err := tx.SelectContext(ctx, &rows, q, args...); err != nil {
			return nil, fmt.Errorf("batch insert posts failed: %w", err)
		}
		for _, rr := range rows {
			m[rr.SourceKey] = rr.ID
		}
	}
	return m, nil
}

// UpdatePostBySourceKey 以 matchKey 为定位键覆盖一条文章（overwrite 策略）。
// 返回被更新的 post.id；matchKey 未命中时返回 0 + nil。
//
// 语义：
//   - WHERE 用 matchKey（可能是新格式 vanblog:<id>，也可能是老 handler 遗留的 vanblog:<title>）
//   - SET source_key = p.SourceKey（新格式），顺便把老行升级到新 key —— 一次 overwrite
//     同时完成 "内容更新" 与 "source_key 格式迁移" 两件事
//   - Password 使用 COALESCE($11, password) —— 调用方传 nil 时保留原密码
//     (ImportOptions.PreservePasswords=true 的默认行为)
//
// 边界：若另一行已占用 p.SourceKey，UPDATE 会踩 UNIQUE 约束抛错 —— 调用方降级到
// failed 计数。实践中 classifyArticle 新/老 key 顺序查找已经避免了这种场景。
func (r *MigrationRepo) UpdatePostBySourceKey(
	ctx context.Context, tx *sqlx.Tx, p PostInsert, matchKey string,
) (int64, error) {
	const q = `
		UPDATE posts SET
			title=$1, slug=$2, content_markdown=$3, summary=$4, cover_image=$5,
			status=$6, category_id=$7, is_pinned=$8, pin_priority=$9, is_hidden=$10,
			password=COALESCE($11, password),
			word_count=$12, reading_time=$13, published_at=$14,
			legacy_author_name=$15, legacy_visited_count=$16, legacy_copyright=$17,
			created_at=COALESCE($18, created_at),
			updated_at=COALESCE($19, updated_at),
			source_key=$20
		WHERE source_key = $21 AND deleted = false
		RETURNING id`
	var id int64
	err := tx.QueryRowxContext(ctx, q,
		p.Title, p.Slug, p.ContentMarkdown, p.Summary, p.CoverImage,
		p.Status, p.CategoryID, p.IsPinned, p.PinPriority, p.IsHidden,
		p.Password, p.WordCount, p.ReadingTime, p.PublishedAt,
		p.LegacyAuthorName, p.LegacyVisitedCount, p.LegacyCopyright,
		p.CreatedAt, p.UpdatedAt, p.SourceKey, matchKey,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return id, err
}

// PostTagLink 描述一行 post_tags 关联。
type PostTagLink struct {
	PostID int64
	TagID  int64
}

// BatchInsertPostTags 批量插入文章-标签关联，ON CONFLICT DO NOTHING 避免重复键。
func (r *MigrationRepo) BatchInsertPostTags(
	ctx context.Context, tx *sqlx.Tx, links []PostTagLink,
) (int, error) {
	if len(links) == 0 {
		return 0, nil
	}
	const batch = 1000
	total := 0
	for start := 0; start < len(links); start += batch {
		end := start + batch
		if end > len(links) {
			end = len(links)
		}
		chunk := links[start:end]
		placeholders := make([]string, 0, len(chunk))
		args := make([]any, 0, len(chunk)*2)
		for i, l := range chunk {
			placeholders = append(placeholders, fmt.Sprintf("($%d,$%d)", i*2+1, i*2+2))
			args = append(args, l.PostID, l.TagID)
		}
		q := `INSERT INTO post_tags (post_id, tag_id) VALUES ` +
			strings.Join(placeholders, ",") + ` ON CONFLICT DO NOTHING`
		res, err := tx.ExecContext(ctx, q, args...)
		if err != nil {
			return total, fmt.Errorf("batch insert post_tags failed: %w", err)
		}
		if n, err := res.RowsAffected(); err == nil {
			total += int(n)
		}
	}
	return total, nil
}

// ClearPostTags 删除 postID 的所有 post_tags 关联（overwrite 时重建用）。
func (r *MigrationRepo) ClearPostTags(ctx context.Context, tx *sqlx.Tx, postID int64) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM post_tags WHERE post_id = $1`, postID)
	return err
}

// RecomputePostCounts 在导入尾端更新 categories.post_count / tags.post_count 缓存字段。
// 使用聚合子查询，避免逐条 increment 的竞态。
func (r *MigrationRepo) RecomputePostCounts(ctx context.Context, tx *sqlx.Tx) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE categories c SET post_count = COALESCE(sub.cnt, 0)
		FROM (
			SELECT category_id, COUNT(*) AS cnt
			FROM posts WHERE deleted = false AND category_id IS NOT NULL
			GROUP BY category_id
		) sub
		WHERE c.id = sub.category_id`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE tags t SET post_count = COALESCE(sub.cnt, 0)
		FROM (
			SELECT pt.tag_id, COUNT(DISTINCT pt.post_id) AS cnt
			FROM post_tags pt
			JOIN posts p ON p.id = pt.post_id
			WHERE p.deleted = false
			GROUP BY pt.tag_id
		) sub
		WHERE t.id = sub.tag_id`); err != nil {
		return err
	}
	return nil
}

// SetPreserveUpdatedAt 打开/关闭当前事务对 updated_at 的保留。
// 触发器 update_updated_at_column 识别 `app.preserve_updated_at = 'true'` 后
// 跳过自动改写 NEW.updated_at —— 从而让 VanBlog 的时间戳活下来。见 migration 000028。
//
// 注：本设置仅对 UPDATE 生效；INSERT 路径的时间戳由 PostInsert.CreatedAt/UpdatedAt 直接决定。
func (r *MigrationRepo) SetPreserveUpdatedAt(ctx context.Context, tx *sqlx.Tx, enabled bool) error {
	v := "false"
	if enabled {
		v = "true"
	}
	_, err := tx.ExecContext(ctx, fmt.Sprintf(`SET LOCAL app.preserve_updated_at = '%s'`, v))
	return err
}
