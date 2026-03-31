package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// CategoryHandler 负责处理博客分类的增删改查操作。
type CategoryHandler struct{ svc *service.CategoryService }

// NewCategoryHandler 创建一个由指定 CategoryService 驱动的 CategoryHandler 实例。
func NewCategoryHandler(svc *service.CategoryService) *CategoryHandler {
	return &CategoryHandler{svc: svc}
}

// MountAdmin 在指定路由组上注册管理端 CRUD 路由（树形列表、获取、创建、更新、删除）。
func (h *CategoryHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
}

// MountPublic 在指定路由组上注册公开的扁平列表接口。
func (h *CategoryHandler) MountPublic(g *echo.Group) {
	g.GET("", h.ListPublic)
}

// List 处理 GET /admin/categories 请求，
// 返回完整的分类树结构（包含嵌套子分类）。
func (h *CategoryHandler) List(c echo.Context) error {
	tree, err := h.svc.ListTree(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tree)
}

// ListPublic 处理 GET /public/categories 请求，
// 为博客前台返回所有分类的扁平列表。
func (h *CategoryHandler) ListPublic(c echo.Context) error {
	cats, err := h.svc.ListFlat(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, cats)
}

// Get 处理 GET /admin/categories/:id 请求，
// 根据 ID 返回单个分类信息。
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

// Create 处理 POST /admin/categories 请求，
// 创建新分类；若未提供 slug 则自动生成。
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

// Update 处理 PUT /admin/categories/:id 请求，
// 更新指定分类的信息。
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

// Delete 处理 DELETE /admin/categories/:id 请求，
// 若分类下存在文章则拒绝删除。
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
