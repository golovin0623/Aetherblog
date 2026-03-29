package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type FriendLinkHandler struct{ svc *service.FriendLinkService }

func NewFriendLinkHandler(svc *service.FriendLinkService) *FriendLinkHandler {
	return &FriendLinkHandler{svc: svc}
}

func (h *FriendLinkHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/page", h.Page)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.DELETE("/batch", h.BatchDelete)
	g.PATCH("/:id/toggle-visible", h.ToggleVisible)
	g.PATCH("/reorder", h.Reorder)
}

func (h *FriendLinkHandler) MountPublic(g *echo.Group) {
	g.GET("", h.ListPublic)
}

func (h *FriendLinkHandler) List(c echo.Context) error {
	links, err := h.svc.ListAll(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, links)
}

func (h *FriendLinkHandler) ListPublic(c echo.Context) error {
	links, err := h.svc.ListVisible(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, links)
}

func (h *FriendLinkHandler) Page(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.Page(c.Request().Context(), p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

func (h *FriendLinkHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	fl, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if fl == nil {
		return response.FailWith(c, response.NotFound, "友链不存在")
	}
	return response.OK(c, fl)
}

func (h *FriendLinkHandler) Create(c echo.Context) error {
	var req dto.FriendLinkRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	fl, err := h.svc.Create(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, fl)
}

func (h *FriendLinkHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.FriendLinkRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	fl, err := h.svc.Update(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, fl)
}

func (h *FriendLinkHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *FriendLinkHandler) BatchDelete(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.DeleteBatch(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *FriendLinkHandler) ToggleVisible(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	fl, err := h.svc.ToggleVisible(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, fl)
}

func (h *FriendLinkHandler) Reorder(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.Reorder(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
