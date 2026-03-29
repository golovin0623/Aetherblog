package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jmoiron/sqlx"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// MigrationHandler handles data import/export operations.
type MigrationHandler struct {
	db      *sqlx.DB
	catRepo *repository.CategoryRepo
	tagRepo *repository.TagRepo
	postRepo *repository.PostRepo
}

func NewMigrationHandler(db *sqlx.DB, catRepo *repository.CategoryRepo, tagRepo *repository.TagRepo, postRepo *repository.PostRepo) *MigrationHandler {
	return &MigrationHandler{db: db, catRepo: catRepo, tagRepo: tagRepo, postRepo: postRepo}
}

func (h *MigrationHandler) Mount(g *echo.Group) {
	g.POST("/vanblog/import", h.ImportVanBlog)
}

// --- VanBlog data types ---

type vanBlogBackup struct {
	Articles   []vanBlogArticle  `json:"articles"`
	Categories []vanBlogCategory `json:"categories"`
	Tags       []vanBlogTag      `json:"tags"`
	Meta       []vanBlogMeta     `json:"meta"`
	Users      []vanBlogUser     `json:"users"`
	Drafts     []vanBlogArticle  `json:"drafts"`
}

type vanBlogArticle struct {
	Title    string   `json:"title"`
	Content  string   `json:"content"`
	Category string   `json:"category"`
	Tags     []string `json:"tags"`
	Top      int      `json:"top"`
	Hidden   bool     `json:"hidden"`
	Password string   `json:"password"`
}

type vanBlogCategory struct{ Name string `json:"name"` }
type vanBlogTag struct{ Name string `json:"name"` }
type vanBlogMeta struct{ Key string `json:"key"`; Value any `json:"value"` }
type vanBlogUser struct{ Name string `json:"name"` }

// --- Result types ---

type importResult struct {
	Summary  importSummary `json:"summary"`
	Warnings []string      `json:"warnings"`
	Errors   []string      `json:"errors"`
	Items    []any         `json:"items"`
}

type importSummary struct {
	ImportableArticles int `json:"importableArticles"`
	ImportableDrafts   int `json:"importableDrafts"`
	CreatedCategories  int `json:"createdCategories"`
	ReusedCategories   int `json:"reusedCategories"`
	CreatedTags        int `json:"createdTags"`
	ReusedTags         int `json:"reusedTags"`
	CreatedPosts       int `json:"createdPosts"`
	UpdatedPosts       int `json:"updatedPosts"`
	SkippedRecords     int `json:"skippedRecords"`
	SlugConflicts      int `json:"slugConflicts"`
	InvalidRecords     int `json:"invalidRecords"`
}

// ImportVanBlog handles POST /api/v1/admin/migrations/vanblog/import
// Accepts multipart file upload (field "file") and query param "mode" (dry-run | import).
func (h *MigrationHandler) ImportVanBlog(c echo.Context) error {
	mode := c.QueryParam("mode")
	if mode == "" {
		mode = "dry-run"
	}

	fh, err := c.FormFile("file")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "未找到文件，请上传 VanBlog 备份 JSON 文件")
	}
	f, err := fh.Open()
	if err != nil {
		return response.FailWith(c, response.InternalError, "无法打开上传文件")
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return response.FailWith(c, response.InternalError, "读取文件失败")
	}

	var backup vanBlogBackup
	if err := json.Unmarshal(data, &backup); err != nil {
		return response.FailWith(c, response.BadRequest, "JSON 解析失败，请确认文件格式正确")
	}

	ctx := c.Request().Context()
	result, err := h.processImport(ctx, &backup, mode)
	if err != nil {
		return response.FailWith(c, response.InternalError, err.Error())
	}
	return response.OK(c, result)
}

func (h *MigrationHandler) processImport(ctx context.Context, backup *vanBlogBackup, mode string) (*importResult, error) {
	res := &importResult{
		Warnings: []string{},
		Errors:   []string{},
		Items:    []any{},
	}
	res.Summary.ImportableArticles = len(backup.Articles)
	res.Summary.ImportableDrafts = len(backup.Drafts)

	// Collect unique categories & tags
	catNames := collectCategoryNames(backup)
	tagNames := collectTagNames(backup)

	// Dry-run: just count without writing
	if mode == "dry-run" {
		res.Summary.CreatedCategories = len(catNames)
		res.Summary.CreatedTags = len(tagNames)
		// Check for existing categories/tags to report reuse counts
		for _, name := range catNames {
			if c, _ := h.catRepo.FindByName(ctx, name); c != nil {
				res.Summary.ReusedCategories++
				res.Summary.CreatedCategories--
			}
		}
		for _, name := range tagNames {
			if t, _ := h.tagRepo.FindByName(ctx, name); t != nil {
				res.Summary.ReusedTags++
				res.Summary.CreatedTags--
			}
		}
		// Check slug conflicts for articles
		for _, a := range append(backup.Articles, backup.Drafts...) {
			slug := generateSlug(a.Title)
			if p, _ := h.postRepo.FindBySlug(ctx, slug); p != nil {
				res.Summary.SlugConflicts++
			}
		}
		return res, nil
	}

	// Import mode: use transaction
	tx, err := h.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("开始事务失败: %w", err)
	}
	defer tx.Rollback()

	// 1. Resolve categories (create or reuse)
	catMap := make(map[string]int64) // name -> id
	for _, name := range catNames {
		existing, _ := h.catRepo.FindByName(ctx, name)
		if existing != nil {
			catMap[name] = existing.ID
			res.Summary.ReusedCategories++
		} else {
			var id int64
			err := tx.QueryRowContext(ctx,
				`INSERT INTO categories (name, slug, post_count, created_at, updated_at) VALUES ($1, $2, 0, NOW(), NOW()) RETURNING id`,
				name, generateSlug(name),
			).Scan(&id)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("创建分类 [%s] 失败: %v", name, err))
				continue
			}
			catMap[name] = id
			res.Summary.CreatedCategories++
		}
	}

	// 2. Resolve tags (create or reuse)
	tagMap := make(map[string]int64) // name -> id
	for _, name := range tagNames {
		existing, _ := h.tagRepo.FindByName(ctx, name)
		if existing != nil {
			tagMap[name] = existing.ID
			res.Summary.ReusedTags++
		} else {
			var id int64
			err := tx.QueryRowContext(ctx,
				`INSERT INTO tags (name, slug, post_count, created_at, updated_at) VALUES ($1, $2, 0, NOW(), NOW()) RETURNING id`,
				name, generateSlug(name),
			).Scan(&id)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("创建标签 [%s] 失败: %v", name, err))
				continue
			}
			tagMap[name] = id
			res.Summary.CreatedTags++
		}
	}

	// 3. Import articles
	now := time.Now()
	importArticles := func(articles []vanBlogArticle, status string) {
		for _, a := range articles {
			if a.Title == "" {
				res.Summary.InvalidRecords++
				continue
			}

			sourceKey := "vanblog:" + a.Title
			// Check idempotency by source_key
			var existingID int64
			err := tx.QueryRowContext(ctx,
				`SELECT id FROM posts WHERE source_key = $1 AND deleted = false`, sourceKey,
			).Scan(&existingID)
			if err == nil {
				// Already imported
				res.Summary.SkippedRecords++
				continue
			}

			// Generate unique slug
			slug := generateSlug(a.Title)
			for suffix := 0; ; suffix++ {
				candidate := slug
				if suffix > 0 {
					candidate = fmt.Sprintf("%s-%d", slug, suffix)
				}
				if p, _ := h.postRepo.FindBySlug(ctx, candidate); p == nil {
					slug = candidate
					break
				}
				res.Summary.SlugConflicts++
				if suffix > 100 {
					slug = fmt.Sprintf("%s-%d", slug, now.UnixMilli())
					break
				}
			}

			// Build post fields
			var catID *int64
			if cid, ok := catMap[a.Category]; ok {
				catID = &cid
			}
			var pwd *string
			if a.Password != "" {
				pwd = &a.Password
			}
			content := a.Content
			wordCount := utf8.RuneCountInString(content)
			readingTime := wordCount / 300
			if readingTime < 1 {
				readingTime = 1
			}

			var publishedAt *time.Time
			if status == "PUBLISHED" {
				publishedAt = &now
			}

			var postID int64
			err = tx.QueryRowContext(ctx, `
				INSERT INTO posts (title, slug, content_markdown, status, category_id, author_id,
					is_pinned, pin_priority, is_hidden, allow_comment, password,
					word_count, reading_time, view_count, comment_count, like_count,
					embedding_status, deleted, published_at, source_key, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,true,$9,$10,$11,0,0,0,'PENDING',false,$12,$13,NOW(),NOW())
				RETURNING id`,
				a.Title, slug, content, status, catID,
				a.Top > 0, a.Top, a.Hidden, pwd,
				wordCount, readingTime, publishedAt, sourceKey,
			).Scan(&postID)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("导入文章 [%s] 失败: %v", a.Title, err))
				res.Summary.InvalidRecords++
				continue
			}
			res.Summary.CreatedPosts++

			// Link tags
			for _, tagName := range a.Tags {
				if tagID, ok := tagMap[tagName]; ok {
					_, _ = tx.ExecContext(ctx,
						`INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
						postID, tagID,
					)
				}
			}
		}
	}

	importArticles(backup.Articles, "PUBLISHED")
	importArticles(backup.Drafts, "DRAFT")

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务失败: %w", err)
	}

	log.Info().
		Int("created_posts", res.Summary.CreatedPosts).
		Int("created_categories", res.Summary.CreatedCategories).
		Int("created_tags", res.Summary.CreatedTags).
		Msg("VanBlog import completed")

	return res, nil
}

// --- Helpers ---

var slugRegex = regexp.MustCompile(`[^a-z0-9\p{Han}]+`)

func generateSlug(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	s = slugRegex.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "untitled"
	}
	if len(s) > 100 {
		s = s[:100]
	}
	return s
}

func collectCategoryNames(b *vanBlogBackup) []string {
	set := make(map[string]bool)
	for _, c := range b.Categories {
		if c.Name != "" {
			set[c.Name] = true
		}
	}
	for _, a := range b.Articles {
		if a.Category != "" {
			set[a.Category] = true
		}
	}
	for _, a := range b.Drafts {
		if a.Category != "" {
			set[a.Category] = true
		}
	}
	names := make([]string, 0, len(set))
	for n := range set {
		names = append(names, n)
	}
	return names
}

func collectTagNames(b *vanBlogBackup) []string {
	set := make(map[string]bool)
	for _, t := range b.Tags {
		if t.Name != "" {
			set[t.Name] = true
		}
	}
	for _, a := range b.Articles {
		for _, t := range a.Tags {
			if t != "" {
				set[t] = true
			}
		}
	}
	for _, a := range b.Drafts {
		for _, t := range a.Tags {
			if t != "" {
				set[t] = true
			}
		}
	}
	names := make([]string, 0, len(set))
	for n := range set {
		names = append(names, n)
	}
	return names
}
