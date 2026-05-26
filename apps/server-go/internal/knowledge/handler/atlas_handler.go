// Package handler 是 Atlas 域的 HTTP 入口层。
//
// Phase 0 仅挂载 /atlas/health 占位路由，校验路由层 + service + repo + DB 链路。
// Phase 1 起拆为 carrier_handler / annotation_handler 等。
package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// AtlasHandler 处理后台 Atlas 接口。
type AtlasHandler struct {
	svc *service.AtlasService
}

// NewAtlasHandler 创建 AtlasHandler。
func NewAtlasHandler(svc *service.AtlasService) *AtlasHandler {
	return &AtlasHandler{svc: svc}
}

// MountAdmin 注册 /v1/admin/atlas 下的路由。
//
// Phase 0 仅 /health。Phase 1 起加入 /carriers/markdown + /carriers/:id +
// /annotations CRUD + /carriers/:id/annotations。
//
// 子 handler 由外部装配（server.go）后通过 AttachSubHandlers 注入，避免循环依赖。
func (h *AtlasHandler) MountAdmin(g *echo.Group, subs ...SubHandler) {
	g.GET("/health", h.Health)
	for _, sh := range subs {
		sh.Mount(g)
	}
}

// SubHandler 是 Atlas 子路由 handler 的统一接口。
type SubHandler interface {
	Mount(g *echo.Group)
}

// Health 返回 Atlas 子产品的健康状态。
//
// 路径: GET /api/v1/admin/atlas/health
// 200 OK 含 { ok: true, module: "atlas", phase: 0 }
// 503    {... ok: false, reason: "..." }（如 atlas_carriers 表不存在）
func (h *AtlasHandler) Health(c echo.Context) error {
	if err := h.svc.HealthCheck(c.Request().Context()); err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]any{
			"ok":     false,
			"module": "atlas",
			"phase":  0,
			"reason": err.Error(),
		})
	}
	return response.OK(c, map[string]any{
		"ok":     true,
		"module": "atlas",
		"phase":  0,
	})
}
