package handler

import (
	"context"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// PostHandler handles all blog-post related endpoints under /admin/posts and /public/posts.
type PostHandler struct{ svc *service.PostService }

// NewPostHandler creates a PostHandler backed by the given PostService.
func NewPostHandler(svc *service.PostService) *PostHandler { return &PostHandler{svc: svc} }

// MountAdmin registers authenticated admin CRUD routes on g.
func (h *PostHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.AdminList)
	g.GET("/:id", h.AdminGet)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.PATCH("/:id/properties", h.UpdateProperties)
	g.POST("/:id/auto-save", h.AutoSave)
	g.DELETE("/:id", h.Delete)
	g.PATCH("/:id/publish", h.Publish)
}

// MountPublic registers unauthenticated public read routes on g.
func (h *PostHandler) MountPublic(g *echo.Group) {
	g.GET("", h.PublicList)
	g.GET("/category/:categoryId", h.ByCategory)
	g.GET("/tag/:tagId", h.ByTag)
	g.GET("/:slug/adjacent", h.Adjacent)
	g.GET("/:slug", h.PublicGet)
	// verify-password is registered in server.go with rate limiting
}

// --- Admin ---

// AdminList handles GET /admin/posts with optional filter query params
// (status, keyword, categoryId, tagId, minViewCount, maxViewCount, startDate, endDate, hidden).
func (h *PostHandler) AdminList(c echo.Context) error {
	f := dto.PostFilter{
		Status:  c.QueryParam("status"),
		Keyword: c.QueryParam("keyword"),
		PageNum: parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize: parseIntDefault(c.QueryParam("pageSize"), 10),
	}
	if v := c.QueryParam("categoryId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.CategoryID = &id
		}
	}
	if v := c.QueryParam("tagId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.TagID = &id
		}
	}
	if v := c.QueryParam("minViewCount"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.MinViewCount = &n
		}
	}
	if v := c.QueryParam("maxViewCount"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.MaxViewCount = &n
		}
	}
	if v := c.QueryParam("startDate"); v != "" {
		if t := parseFlexibleTime(v); t != nil {
			f.StartDate = t
		}
	}
	if v := c.QueryParam("endDate"); v != "" {
		if t := parseFlexibleTime(v); t != nil {
			f.EndDate = t
		}
	}
	if v := c.QueryParam("hidden"); v != "" {
		b := v == "true"
		f.Hidden = &b
	}

	pr, err := h.svc.GetForAdmin(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// AdminGet handles GET /admin/posts/:id. Returns full post detail including draft cache.
func (h *PostHandler) AdminGet(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	post, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if post == nil {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	return response.OK(c, post)
}

// Create handles POST /admin/posts. Creates a new post with the authenticated user as author.
func (h *PostHandler) Create(c echo.Context) error {
	var req dto.CreatePostRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var authorID int64
	if lu != nil {
		authorID = lu.UserID
	}
	post, err := h.svc.Create(c.Request().Context(), req, authorID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, post)
}

// Update handles PUT /admin/posts/:id. Replaces the post content; also clears the Redis draft cache.
func (h *PostHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.CreatePostRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var authorID int64
	if lu != nil {
		authorID = lu.UserID
	}
	post, err := h.svc.Update(c.Request().Context(), id, req, authorID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, post)
}

// UpdateProperties handles PATCH /admin/posts/:id/properties.
// Accepts a partial payload — only the provided fields are updated (e.g. status, isPinned).
func (h *PostHandler) UpdateProperties(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.UpdatePostPropertiesRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	post, err := h.svc.UpdateProperties(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, post)
}

// AutoSave handles POST /admin/posts/:id/auto-save.
// Persists the editor content as a Redis draft without updating the database,
// enabling crash-recovery on the editor page.
func (h *PostHandler) AutoSave(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.CreatePostRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if err := h.svc.AutoSave(c.Request().Context(), id, req); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Delete handles DELETE /admin/posts/:id. Soft-deletes the post and clears its Redis draft.
func (h *PostHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Publish handles PATCH /admin/posts/:id/publish. Sets status to PUBLISHED and records publish time.
func (h *PostHandler) Publish(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Publish(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// --- Public ---

// PublicList handles GET /public/posts. Returns paginated published, visible posts
// ordered by pin priority then publish date.
func (h *PostHandler) PublicList(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.GetPublished(c.Request().Context(), p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// PublicGet handles GET /public/posts/:slug. Returns the post and increments the view
// counter asynchronously. Returns a password-stub (no content) if the post is protected.
func (h *PostHandler) PublicGet(c echo.Context) error {
	slug := c.Param("slug")
	post, err := h.svc.GetPublicBySlug(c.Request().Context(), slug, "")
	if err != nil {
		return response.Error(c, err)
	}
	if post == nil {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	if !post.PasswordRequired {
		go h.svc.IncrementViewCount(context.Background(), post.ID)
	}
	return response.OK(c, post)
}

// VerifyPassword handles POST /public/posts/:slug/verify-password.
// Validates the submitted password for a password-protected post and returns the full content on success.
func (h *PostHandler) VerifyPassword(c echo.Context) error {
	slug := c.Param("slug")
	var req dto.PostPasswordRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	post, err := h.svc.GetPublicBySlug(c.Request().Context(), slug, req.Password)
	if err != nil {
		return response.Error(c, err)
	}
	if post == nil {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	if post.PasswordRequired {
		return response.FailWith(c, response.Forbidden, "密码错误")
	}
	go h.svc.IncrementViewCount(context.Background(), post.ID)
	return response.OK(c, post)
}

// ByCategory handles GET /public/posts/category/:categoryId. Returns paginated posts in a category.
func (h *PostHandler) ByCategory(c echo.Context) error {
	catID, err := strconv.ParseInt(c.Param("categoryId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的分类ID")
	}
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.GetByCategory(c.Request().Context(), catID, p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// ByTag handles GET /public/posts/tag/:tagId. Returns paginated posts tagged with the given tag.
func (h *PostHandler) ByTag(c echo.Context) error {
	tagID, err := strconv.ParseInt(c.Param("tagId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的标签ID")
	}
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.GetByTag(c.Request().Context(), tagID, p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// Adjacent handles GET /public/posts/:slug/adjacent.
// Returns the previous and next published posts by publish date for navigation links.
func (h *PostHandler) Adjacent(c echo.Context) error {
	slug := c.Param("slug")
	adj, err := h.svc.GetAdjacentPosts(c.Request().Context(), slug)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, adj)
}

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// parseFlexibleTime accepts multiple datetime formats from the frontend:
// - RFC3339:          "2024-03-15T00:00:00Z" or "2024-03-15T00:00:00+08:00"
// - ISO without TZ:   "2024-03-15T00:00:00"
// - Date only:        "2024-03-15"
func parseFlexibleTime(s string) *time.Time {
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return &t
		}
	}
	return nil
}
