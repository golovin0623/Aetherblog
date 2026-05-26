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
// Phase 0 仅 /health（读权限即可，由 g 自带的 content.atlas.read 中间件兜底）。
//
// 红线 RBAC (PR #724 review fix): mutating routes 必须额外 require content.atlas.write，
// 由 server.go 装配时传入 `write` MiddlewareFunc，sub-handler 自行套到 POST/PATCH/DELETE。
//
// 子 handler 由外部装配（server.go）注入，避免循环依赖。
func (h *AtlasHandler) MountAdmin(g *echo.Group, write echo.MiddlewareFunc, subs ...SubHandler) {
	g.GET("/health", h.Health)
	for _, sh := range subs {
		sh.Mount(g, write)
	}
}

// SubHandler 是 Atlas 子路由 handler 的统一接口。
// `write` 是写权限中间件（content.atlas.write）—— sub-handler 必须给所有
// POST/PATCH/DELETE 单独套上，GET 不需要。
type SubHandler interface {
	Mount(g *echo.Group, write echo.MiddlewareFunc)
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
