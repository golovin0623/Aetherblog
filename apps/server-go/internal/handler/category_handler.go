package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type CategoryHandler struct{ svc *service.CategoryService }

func NewCategoryHandler(svc *service.CategoryService) *CategoryHandler {
	return &CategoryHandler{svc: svc}
}

func (h *CategoryHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
}

func (h *CategoryHandler) MountPublic(g *echo.Group) {
	g.GET("", h.ListPublic)
}

func (h *CategoryHandler) List(c echo.Context) error {
	tree, err := h.svc.ListTree(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tree)
}

func (h *CategoryHandler) ListPublic(c echo.Context) error {
	cats, err := h.svc.ListFlat(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, cats)
}

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
