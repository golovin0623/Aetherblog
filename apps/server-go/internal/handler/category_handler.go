package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// CategoryHandler handles CRUD operations for blog categories.
type CategoryHandler struct{ svc *service.CategoryService }

// NewCategoryHandler creates a CategoryHandler backed by the given CategoryService.
func NewCategoryHandler(svc *service.CategoryService) *CategoryHandler {
	return &CategoryHandler{svc: svc}
}

// MountAdmin registers admin CRUD routes (list-as-tree, get, create, update, delete) on g.
func (h *CategoryHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
}

// MountPublic registers the public flat-list endpoint on g.
func (h *CategoryHandler) MountPublic(g *echo.Group) {
	g.GET("", h.ListPublic)
}

// List handles GET /admin/categories. Returns the full category tree (nested children).
func (h *CategoryHandler) List(c echo.Context) error {
	tree, err := h.svc.ListTree(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tree)
}

// ListPublic handles GET /public/categories. Returns a flat list of all categories for the blog frontend.
func (h *CategoryHandler) ListPublic(c echo.Context) error {
	cats, err := h.svc.ListFlat(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, cats)
}

// Get handles GET /admin/categories/:id. Returns a single category by ID.
func (h *CategoryHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	cat, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if cat == nil {
		return response.FailWith(c, response.NotFound, "分类不存在")
	}
	return response.OK(c, cat)
}

// Create handles POST /admin/categories. Creates a new category; auto-generates slug if not provided.
func (h *CategoryHandler) Create(c echo.Context) error {
	var req dto.CategoryRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	cat, err := h.svc.Create(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, cat)
}

// Update handles PUT /admin/categories/:id. Updates an existing category.
func (h *CategoryHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.CategoryRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	cat, err := h.svc.Update(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, cat)
}

// Delete handles DELETE /admin/categories/:id. Rejects deletion when the category contains posts.
func (h *CategoryHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}
