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

// importResult is the dry-run result returned to the client.
type importResult struct {
	Mode       string `json:"mode"`
	Posts      int    `json:"posts"`
	Drafts     int    `json:"drafts"`
	Categories int    `json:"categories"`
	Tags       int    `json:"tags"`
	Meta       int    `json:"meta"`
	Users      int    `json:"users"`
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
		Mode:       mode,
		Posts:      len(backup.Articles),
		Drafts:     len(backup.Drafts),
		Categories: len(catSet),
		Tags:       len(tagSet),
		Meta:       len(backup.Meta),
		Users:      len(backup.Users),
	}

	return response.OK(c, result)
}
