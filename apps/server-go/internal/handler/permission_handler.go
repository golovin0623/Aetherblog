package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type PermissionHandler struct{ svc *service.PermissionService }

func NewPermissionHandler(svc *service.PermissionService) *PermissionHandler {
	return &PermissionHandler{svc: svc}
}

func (h *PermissionHandler) Mount(g *echo.Group) {
	g.GET("/folders/:folderId/permissions", h.GetPermissions)
	g.POST("/folders/:folderId/permissions", h.Grant)
	g.PUT("/permissions/:permissionId", h.Update)
	g.DELETE("/permissions/:permissionId", h.Revoke)
}

func (h *PermissionHandler) GetPermissions(c echo.Context) error {
	folderID, err := strconv.ParseInt(c.Param("folderId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件夹ID")
	}
	perms, err := h.svc.GetByFolderID(c.Request().Context(), folderID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, perms)
}

func (h *PermissionHandler) Grant(c echo.Context) error {
	folderID, err := strconv.ParseInt(c.Param("folderId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件夹ID")
	}
	var req dto.GrantPermissionRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var grantedBy *int64
	if lu != nil {
		grantedBy = &lu.UserID
	}
	vo, err := h.svc.Grant(c.Request().Context(), folderID, req, grantedBy)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

func (h *PermissionHandler) Update(c echo.Context) error {
	permissionID, err := strconv.ParseInt(c.Param("permissionId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的权限ID")
	}
	var req dto.UpdatePermissionRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.Update(c.Request().Context(), permissionID, req)
	if err != nil {
		return response.Error(c, err)
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "权限不存在")
	}
	return response.OK(c, vo)
}

func (h *PermissionHandler) Revoke(c echo.Context) error {
	permissionID, err := strconv.ParseInt(c.Param("permissionId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的权限ID")
	}
	if err := h.svc.Revoke(c.Request().Context(), permissionID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
