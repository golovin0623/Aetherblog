package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// VersionHandler 处理媒体文件版本历史相关的 HTTP 接口。
type VersionHandler struct{ svc *service.VersionService }

// NewVersionHandler 创建 VersionHandler 实例。
func NewVersionHandler(svc *service.VersionService) *VersionHandler {
	return &VersionHandler{svc: svc}
}

// Mount 将版本历史管理路由注册到指定的管理员路由组。
func (h *VersionHandler) Mount(g *echo.Group) {
	g.GET("/files/:fileId/versions", h.GetHistory)
	g.POST("/files/:fileId/versions/:versionNumber/restore", h.Restore)
	g.DELETE("/versions/:versionId", h.Delete)
}

// GetHistory 处理 GET /files/:fileId/versions 请求。
// 返回指定文件的完整版本历史记录列表。
// 路径参数 fileId 为目标文件的数字 ID。
func (h *VersionHandler) GetHistory(c echo.Context) error {
	// 解析路径参数中的文件 ID
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	versions, err := h.svc.GetHistory(c.Request().Context(), fileID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, versions)
}

// Restore 处理 POST /files/:fileId/versions/:versionNumber/restore 请求。
// 将指定文件回滚到指定版本号所对应的历史快照。
// 路径参数 fileId 为文件 ID，versionNumber 为目标版本号。
func (h *VersionHandler) Restore(c echo.Context) error {
	// 解析路径参数中的文件 ID
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	// 解析路径参数中的版本号
	versionNumber, err := strconv.Atoi(c.Param("versionNumber"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的版本号")
	}
	if err := h.svc.Restore(c.Request().Context(), fileID, versionNumber); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}

// Delete 处理 DELETE /versions/:versionId 请求。
// 永久删除指定版本记录（该操作不可逆）。
// 路径参数 versionId 为目标版本记录的数字 ID。
func (h *VersionHandler) Delete(c echo.Context) error {
	// 解析路径参数中的版本 ID
	versionID, err := strconv.ParseInt(c.Param("versionId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的版本ID")
	}
	if err := h.svc.Delete(c.Request().Context(), versionID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
