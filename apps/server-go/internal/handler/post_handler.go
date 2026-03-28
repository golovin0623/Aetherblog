package handler

import (
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type PostHandler struct{ svc *service.PostService }

func NewPostHandler(svc *service.PostService) *PostHandler { return &PostHandler{svc: svc} }

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

func (h *PostHandler) MountPublic(g *echo.Group) {
	g.GET("", h.PublicList)
	g.GET("/category/:categoryId", h.ByCategory)
	g.GET("/tag/:tagId", h.ByTag)
	g.GET("/:slug/adjacent", h.Adjacent)
	g.GET("/:slug", h.PublicGet)
	g.POST("/:slug/verify-password", h.VerifyPassword)
}

// --- Admin ---

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
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.StartDate = &t
		}
	}
	if v := c.QueryParam("endDate"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.EndDate = &t
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

func (h *PostHandler) PublicList(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.GetPublished(c.Request().Context(), p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

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
		go h.svc.IncrementViewCount(c.Request().Context(), post.ID)
	}
	return response.OK(c, post)
}

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
	go h.svc.IncrementViewCount(c.Request().Context(), post.ID)
	return response.OK(c, post)
}

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
