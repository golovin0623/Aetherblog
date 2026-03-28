package handler

import (
	"encoding/json"
	"io"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// MigrationHandler handles data import/export operations.
type MigrationHandler struct{}

func NewMigrationHandler() *MigrationHandler { return &MigrationHandler{} }

func (h *MigrationHandler) Mount(g *echo.Group) {
	g.POST("/vanblog/import", h.ImportVanBlog)
}

// vanBlogBackup represents the top-level structure of a VanBlog JSON backup.
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
	// Keep other fields as raw for forward compat
}

type vanBlogCategory struct {
	Name string `json:"name"`
}

type vanBlogTag struct {
	Name string `json:"name"`
}

type vanBlogMeta struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

type vanBlogUser struct {
	Name string `json:"name"`
}

// importResult is the result returned to the client matching frontend shape.
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
// Accepts multipart file upload (field "file") and query param "mode" (default "dry-run").
// Parses the VanBlog JSON backup and returns counts of each entity type.
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

	// Collect unique tags from articles if top-level tags list is empty
	tagSet := make(map[string]struct{})
	for _, t := range backup.Tags {
		tagSet[t.Name] = struct{}{}
	}
	for _, a := range backup.Articles {
		for _, t := range a.Tags {
			tagSet[t] = struct{}{}
		}
	}
	for _, a := range backup.Drafts {
		for _, t := range a.Tags {
			tagSet[t] = struct{}{}
		}
	}

	// Collect unique categories
	catSet := make(map[string]struct{})
	for _, cat := range backup.Categories {
		catSet[cat.Name] = struct{}{}
	}
	for _, a := range backup.Articles {
		if a.Category != "" {
			catSet[a.Category] = struct{}{}
		}
	}
	for _, a := range backup.Drafts {
		if a.Category != "" {
			catSet[a.Category] = struct{}{}
		}
	}

	result := importResult{
		Summary: importSummary{
			ImportableArticles: len(backup.Articles),
			ImportableDrafts:   len(backup.Drafts),
			CreatedCategories:  len(catSet),
			ReusedCategories:   0,
			CreatedTags:        len(tagSet),
			ReusedTags:         0,
			CreatedPosts:       0,
			UpdatedPosts:       0,
			SkippedRecords:     0,
			SlugConflicts:      0,
			InvalidRecords:     0,
		},
		Warnings: []string{},
		Errors:   []string{},
		Items:    []any{},
	}
	_ = mode

	return response.OK(c, result)
}
