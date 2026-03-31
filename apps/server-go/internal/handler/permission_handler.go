package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// PermissionHandler 处理文件夹权限授予/撤销相关的 HTTP 接口。
type PermissionHandler struct{ svc *service.PermissionService }

// NewPermissionHandler 创建 PermissionHandler 实例。
func NewPermissionHandler(svc *service.PermissionService) *PermissionHandler {
	return &PermissionHandler{svc: svc}
}

// Mount 将权限管理路由注册到指定的管理员路由组。
func (h *PermissionHandler) Mount(g *echo.Group) {
	g.GET("/folders/:folderId/permissions", h.GetPermissions)
	g.POST("/folders/:folderId/permissions", h.Grant)
	g.PUT("/permissions/:permissionId", h.Update)
	g.DELETE("/permissions/:permissionId", h.Revoke)
}

// GetPermissions 处理 GET /folders/:folderId/permissions 请求。
// 查询并返回指定文件夹下的所有权限授权记录。
// 路径参数 folderId 为目标文件夹的数字 ID。
func (h *PermissionHandler) GetPermissions(c echo.Context) error {
	// 解析路径参数中的文件夹 ID
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

// Grant 处理 POST /folders/:folderId/permissions 请求。
// 为指定用户授予访问某文件夹的权限；当前登录用户将作为授权人记录。
// 路径参数 folderId 为目标文件夹 ID，请求体为 GrantPermissionRequest。
func (h *PermissionHandler) Grant(c echo.Context) error {
	// 解析路径参数中的文件夹 ID
	folderID, err := strconv.ParseInt(c.Param("folderId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件夹ID")
	}
	var req dto.GrantPermissionRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	// 获取当前登录用户作为授权操作人
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

// Update 处理 PUT /permissions/:permissionId 请求。
// 修改已存在的权限授权记录（如更新访问级别）。
// 路径参数 permissionId 为目标权限记录 ID，请求体为 UpdatePermissionRequest。
func (h *PermissionHandler) Update(c echo.Context) error {
	// 解析路径参数中的权限 ID
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
	// 权限记录不存在时返回 404
	if vo == nil {
		return response.FailWith(c, response.NotFound, "权限不存在")
	}
	return response.OK(c, vo)
}

// Revoke 处理 DELETE /permissions/:permissionId 请求。
// 撤销（删除）一条权限授权记录。
// 路径参数 permissionId 为目标权限记录 ID。
func (h *PermissionHandler) Revoke(c echo.Context) error {
	// 解析路径参数中的权限 ID
	permissionID, err := strconv.ParseInt(c.Param("permissionId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的权限ID")
	}
	if err := h.svc.Revoke(c.Request().Context(), permissionID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
