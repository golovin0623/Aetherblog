package handler

import (
	"bytes"
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
	"golang.org/x/crypto/bcrypt"

	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// MigrationHandler 负责处理数据导入/导出操作。
type MigrationHandler struct {
	db       *sqlx.DB
	catRepo  *repository.CategoryRepo
	tagRepo  *repository.TagRepo
	postRepo *repository.PostRepo
}

// NewMigrationHandler 创建一个 MigrationHandler 实例，注入数据库和各仓库依赖。
func NewMigrationHandler(db *sqlx.DB, catRepo *repository.CategoryRepo, tagRepo *repository.TagRepo, postRepo *repository.PostRepo) *MigrationHandler {
	return &MigrationHandler{db: db, catRepo: catRepo, tagRepo: tagRepo, postRepo: postRepo}
}

// Mount 将迁移相关路由注册到指定的管理员路由组。
func (h *MigrationHandler) Mount(g *echo.Group) {
	g.POST("/vanblog/import", h.ImportVanBlog)
}

// --- VanBlog 数据结构定义 ---

// vanBlogBackup 表示 VanBlog 备份文件的顶层结构。
type vanBlogBackup struct {
	Articles   []vanBlogArticle  `json:"articles"`
	Categories []vanBlogCategory `json:"categories"`
	Tags       []vanBlogTag      `json:"tags"`
	Meta       []vanBlogMeta     `json:"meta"`
	Users      []vanBlogUser     `json:"users"`
	Drafts     []vanBlogArticle  `json:"drafts"`
}

// vanBlogArticle 表示 VanBlog 中单篇文章或草稿的数据结构。
type vanBlogArticle struct {
	Title    string   `json:"title"`
	Content  string   `json:"content"`
	Category string   `json:"category"`
	Tags     []string `json:"tags"`
	Top      int      `json:"top"`
	Hidden   bool     `json:"hidden"`
	Password string   `json:"password"`
}

// vanBlogCategory 表示 VanBlog 中的分类名称。
type vanBlogCategory struct{ Name string `json:"name"` }

// vanBlogTag 表示 VanBlog 中的标签名称。
type vanBlogTag struct{ Name string `json:"name"` }

// vanBlogMeta 表示 VanBlog 中的站点元数据键值对。
type vanBlogMeta struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

// vanBlogUser 表示 VanBlog 中的用户信息。
type vanBlogUser struct{ Name string `json:"name"` }

// --- 导入结果类型 ---

// importResult 表示一次导入操作的完整结果，包含统计摘要、警告和错误信息。
type importResult struct {
	Summary  importSummary `json:"summary"`
	Warnings []string      `json:"warnings"`
	Errors   []string      `json:"errors"`
	Items    []any         `json:"items"`
}

// importSummary 汇总导入操作的各项计数统计。
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

// ImportVanBlog 处理 POST /api/v1/admin/migrations/vanblog/import 请求。
// 接受 multipart 文件上传（字段名 "file"）和查询参数 "mode"（dry-run | import）。
// dry-run 模式仅分析数据不写入；import 模式执行实际导入。
func (h *MigrationHandler) ImportVanBlog(c echo.Context) error {
	// SECURITY (VULN-035): 导入会写 author_id；必须显式取当前管理员，不再
	// 硬编码 user_id=1。
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}

	mode := c.QueryParam("mode")
	if mode == "" {
		mode = "dry-run"
	}

	fh, err := c.FormFile("file")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "未找到文件，请上传 VanBlog 备份 JSON 文件")
	}
	// VULN-034 回退：取消硬编码 50MB 上限，恢复对大型 VanBlog 备份的支持。
	// OOM 风险由上游多层共同约束：网关 client_max_body_size 10G → 后端进程
	// 内存限额（docker-compose `deploy.resources.limits.memory`）→ JSON 解析
	// 器串行消费。如果未来进一步硬化，可改为流式解析（`json.NewDecoder` 直接
	// 包裹 `fh.Open()`），避免 `io.ReadAll` 一次性装载。
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
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&backup); err != nil {
		return response.FailWith(c, response.BadRequest, "JSON 解析失败，请确认文件格式正确: "+err.Error())
	}

	ctx := c.Request().Context()
	result, err := h.processImport(ctx, &backup, mode, lu.UserID)
	if err != nil {
		return response.FailWith(c, response.InternalError, err.Error())
	}
	return response.OK(c, result)
}

// processImport 执行 VanBlog 数据的实际导入逻辑（支持 dry-run 和 import 两种模式）。
// callerID 是触发导入的管理员 user_id；将其传入写入的每篇文章 author_id，
// 避免历史版本硬编码 1 的隐患（VULN-035）。
func (h *MigrationHandler) processImport(ctx context.Context, backup *vanBlogBackup, mode string, callerID int64) (*importResult, error) {
	res := &importResult{
		Warnings: []string{},
		Errors:   []string{},
		Items:    []any{},
	}
	res.Summary.ImportableArticles = len(backup.Articles)
	res.Summary.ImportableDrafts = len(backup.Drafts)

	// 收集所有唯一的分类名和标签名
	catNames := collectCategoryNames(backup)
	tagNames := collectTagNames(backup)

	// dry-run 模式：仅统计计数，不执行写入
	if mode == "dry-run" {
		res.Summary.CreatedCategories = len(catNames)
		res.Summary.CreatedTags = len(tagNames)
		// 检查已存在的分类和标签，统计复用数量
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
		// 检查文章是否存在 slug 冲突
		for _, a := range append(backup.Articles, backup.Drafts...) {
			slug := generateSlug(a.Title)
			if p, _ := h.postRepo.FindBySlug(ctx, slug); p != nil {
				res.Summary.SlugConflicts++
			}
		}
		return res, nil
	}

	// import 模式：使用事务执行实际写入
	tx, err := h.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("开始事务失败: %w", err)
	}
	defer tx.Rollback()

	// 1. 解析分类（复用已有或新建）
	catMap := make(map[string]int64) // 分类名 -> ID 映射
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

	// 2. 解析标签（复用已有或新建）
	tagMap := make(map[string]int64) // 标签名 -> ID 映射
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

	// 3. 导入文章（文章和草稿分别处理）
	now := time.Now()
	importArticles := func(articles []vanBlogArticle, status string) {
		for _, a := range articles {
			if a.Title == "" {
				res.Summary.InvalidRecords++
				continue
			}

			// 使用 source_key 实现幂等性检查，避免重复导入
			sourceKey := "vanblog:" + a.Title
			var existingID int64
			err := tx.QueryRowContext(ctx,
				`SELECT id FROM posts WHERE source_key = $1 AND deleted = false`, sourceKey,
			).Scan(&existingID)
			if err == nil {
				// 已导入，跳过
				res.Summary.SkippedRecords++
				continue
			}

			// 生成唯一 slug，若冲突则追加数字后缀
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
					// 防止无限循环，使用时间戳确保唯一性
					slug = fmt.Sprintf("%s-%d", slug, now.UnixMilli())
					break
				}
			}

			// 构建文章字段
			var catID *int64
			if cid, ok := catMap[a.Category]; ok {
				catID = &cid
			}
			// SECURITY (VULN-033): VanBlog 导出里的密码是明文；必须 bcrypt
			// 加密后再存，否则 DB 泄露 == 密码泄露，且 `GetPublicBySlug` 的
			// `bcrypt.CompareHashAndPassword` 也无法匹配（功能坏）。
			var pwd *string
			if a.Password != "" {
				hash, hashErr := bcrypt.GenerateFromPassword([]byte(a.Password), bcrypt.DefaultCost)
				if hashErr != nil {
					res.Errors = append(res.Errors,
						fmt.Sprintf("hash password for [%s] failed: %v", a.Title, hashErr))
					res.Summary.InvalidRecords++
					continue
				}
				h := string(hash)
				pwd = &h
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
			// SECURITY (VULN-035): author_id 使用发起导入的管理员 ID，不再硬编码 1。
			err = tx.QueryRowContext(ctx, `
				INSERT INTO posts (title, slug, content_markdown, status, category_id, author_id,
					is_pinned, pin_priority, is_hidden, allow_comment, password,
					word_count, reading_time, view_count, comment_count, like_count,
					embedding_status, deleted, published_at, source_key, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,0,0,0,'PENDING',false,$13,$14,NOW(),NOW())
				RETURNING id`,
				a.Title, slug, content, status, catID, callerID,
				a.Top > 0, a.Top, a.Hidden, pwd,
				wordCount, readingTime, publishedAt, sourceKey,
			).Scan(&postID)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("导入文章 [%s] 失败: %v", a.Title, err))
				res.Summary.InvalidRecords++
				continue
			}
			res.Summary.CreatedPosts++

			// 关联文章标签
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

	// 分别导入已发布文章和草稿
	importArticles(backup.Articles, "PUBLISHED")
	importArticles(backup.Drafts, "DRAFT")

	// 提交事务
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

// --- 辅助函数 ---

// slugRegex 匹配所有非字母数字、非汉字字符，用于生成 URL 友好的 slug。
var slugRegex = regexp.MustCompile(`[^a-z0-9\p{Han}]+`)

// generateSlug 将标题转换为 URL 友好的 slug 字符串。
// 仅保留小写字母、数字和汉字，其余字符替换为连字符，最长 100 个字符。
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

// collectCategoryNames 从备份数据中收集所有唯一的分类名称（去重）。
func collectCategoryNames(b *vanBlogBackup) []string {
	set := make(map[string]bool)
	for _, c := range b.Categories {
		if c.Name != "" {
			set[c.Name] = true
		}
	}
	// 同时从文章和草稿中收集分类名
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

// collectTagNames 从备份数据中收集所有唯一的标签名称（去重）。
func collectTagNames(b *vanBlogBackup) []string {
	set := make(map[string]bool)
	for _, t := range b.Tags {
		if t.Name != "" {
			set[t.Name] = true
		}
	}
	// 同时从文章和草稿的标签中收集
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
