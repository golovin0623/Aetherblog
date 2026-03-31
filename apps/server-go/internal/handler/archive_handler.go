package handler

import (
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// ArchiveHandler 负责处理公开归档接口（文章按月份分组）。
type ArchiveHandler struct{ svc *service.PostService }

// NewArchiveHandler 创建一个由 PostService 驱动的 ArchiveHandler 实例。
func NewArchiveHandler(svc *service.PostService) *ArchiveHandler { return &ArchiveHandler{svc: svc} }

// Mount 将归档相关路由注册到指定的公开路由组。
func (h *ArchiveHandler) Mount(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/stats", h.Stats)
}

// List 处理 GET /api/v1/public/archives 请求，
// 返回按年月分组的文章归档列表。
func (h *ArchiveHandler) List(c echo.Context) error {
	archives, err := h.svc.GetArchives(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, archives)
}

// Stats 处理 GET /api/v1/public/archives/stats 请求，
// 返回每月文章发布数量统计。
func (h *ArchiveHandler) Stats(c echo.Context) error {
	stats, err := h.svc.GetArchiveStats(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, stats)
}
