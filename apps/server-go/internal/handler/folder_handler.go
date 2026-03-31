package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// FolderHandler 负责处理媒体文件夹管理相关接口。
type FolderHandler struct{ svc *service.FolderService }

// NewFolderHandler 创建一个 FolderHandler 实例。
func NewFolderHandler(svc *service.FolderService) *FolderHandler { return &FolderHandler{svc: svc} }

// Mount 将文件夹相关路由注册到指定的管理员路由组。
func (h *FolderHandler) Mount(g *echo.Group) {
	g.GET("/tree", h.Tree)
	g.GET("/:id", h.Get)
	g.GET("/:id/children", h.Children)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.POST("/:id/move", h.Move)
}

// Tree 处理 GET /tree 请求，
// 以嵌套树形结构返回所有文件夹。
func (h *FolderHandler) Tree(c echo.Context) error {
	tree, err := h.svc.GetTree(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tree)
}

// Get 处理 GET /:id 请求，
// 根据 ID 返回单个文件夹信息。
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

// Children 处理 GET /:id/children 请求，
// 返回指定文件夹的直接子文件夹列表。
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

// Create 处理 POST "" 请求，
// 创建新文件夹，并将当前登录用户设为所有者。
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

// Update 处理 PUT /:id 请求，
// 更新指定文件夹的属性信息。
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

// Delete 处理 DELETE /:id 请求，
// 永久删除指定文件夹。
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

// Move 处理 POST /:id/move 请求，
// 将指定文件夹移动至新的父文件夹下（重新设置父级）。
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
	if err := h.svc.Move(c.Request().Context(), id, req.GetTargetParentID(), updatedBy); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
