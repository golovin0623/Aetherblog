package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type TagHandler struct{ svc *service.TagService }

func NewTagHandler(svc *service.TagService) *TagHandler { return &TagHandler{svc: svc} }

func (h *TagHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
}

func (h *TagHandler) List(c echo.Context) error {
	tags, err := h.svc.List(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

func (h *TagHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	tag, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if tag == nil {
		return response.FailWith(c, response.NotFound, "标签不存在")
	}
	return response.OK(c, tag)
}

func (h *TagHandler) Create(c echo.Context) error {
	var req dto.TagRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	tag, err := h.svc.Create(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, tag)
}

func (h *TagHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.TagRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	tag, err := h.svc.Update(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, tag)
}

func (h *TagHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
