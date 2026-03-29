package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type StorageProviderHandler struct{ svc *service.StorageProviderService }

func NewStorageProviderHandler(svc *service.StorageProviderService) *StorageProviderHandler {
	return &StorageProviderHandler{svc: svc}
}

func (h *StorageProviderHandler) Mount(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/default", h.Default)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.POST("/:id/set-default", h.SetDefault)
	g.POST("/:id/test", h.Test)
}

func (h *StorageProviderHandler) List(c echo.Context) error {
	vos, err := h.svc.List(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

func (h *StorageProviderHandler) Default(c echo.Context) error {
	vo, err := h.svc.GetDefault(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

func (h *StorageProviderHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	vo, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "存储提供商不存在")
	}
	return response.OK(c, vo)
}

func (h *StorageProviderHandler) Create(c echo.Context) error {
	var req dto.StorageProviderRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.Create(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

func (h *StorageProviderHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.StorageProviderRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.Update(c.Request().Context(), id, req); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *StorageProviderHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *StorageProviderHandler) SetDefault(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.SetDefault(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *StorageProviderHandler) Test(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	ok, msg := h.svc.Test(c.Request().Context(), id)
	return response.OK(c, map[string]interface{}{"success": ok, "message": msg})
}
