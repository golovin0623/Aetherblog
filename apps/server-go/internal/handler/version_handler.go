package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type VersionHandler struct{ svc *service.VersionService }

func NewVersionHandler(svc *service.VersionService) *VersionHandler {
	return &VersionHandler{svc: svc}
}

func (h *VersionHandler) Mount(g *echo.Group) {
	g.GET("/files/:fileId/versions", h.GetHistory)
	g.POST("/files/:fileId/versions/:versionNumber/restore", h.Restore)
	g.DELETE("/versions/:versionId", h.Delete)
}

func (h *VersionHandler) GetHistory(c echo.Context) error {
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

func (h *VersionHandler) Restore(c echo.Context) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	versionNumber, err := strconv.Atoi(c.Param("versionNumber"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的版本号")
	}
	if err := h.svc.Restore(c.Request().Context(), fileID, versionNumber); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}

func (h *VersionHandler) Delete(c echo.Context) error {
	versionID, err := strconv.ParseInt(c.Param("versionId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的版本ID")
	}
	if err := h.svc.Delete(c.Request().Context(), versionID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
