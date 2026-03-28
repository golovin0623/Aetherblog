package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type FolderHandler struct{ svc *service.FolderService }

func NewFolderHandler(svc *service.FolderService) *FolderHandler { return &FolderHandler{svc: svc} }

func (h *FolderHandler) Mount(g *echo.Group) {
	g.GET("/tree", h.Tree)
	g.GET("/:id", h.Get)
	g.GET("/:id/children", h.Children)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.POST("/:id/move", h.Move)
}

func (h *FolderHandler) Tree(c echo.Context) error {
	tree, err := h.svc.GetTree(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tree)
}

func (h *FolderHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	vo, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "文件夹不存在")
	}
	return response.OK(c, vo)
}

func (h *FolderHandler) Children(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	vos, err := h.svc.GetChildren(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

func (h *FolderHandler) Create(c echo.Context) error {
	var req dto.FolderRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var ownerID *int64
	if lu != nil {
		ownerID = &lu.UserID
	}
	vo, err := h.svc.Create(c.Request().Context(), req, ownerID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

func (h *FolderHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.FolderRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var ownerID *int64
	if lu != nil {
		ownerID = &lu.UserID
	}
	if err := h.svc.Update(c.Request().Context(), id, req, ownerID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *FolderHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *FolderHandler) Move(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.MoveFolderRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	lu := middleware.GetLoginUser(c)
	var updatedBy *int64
	if lu != nil {
		updatedBy = &lu.UserID
	}
	if err := h.svc.Move(c.Request().Context(), id, req.ParentID, updatedBy); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
