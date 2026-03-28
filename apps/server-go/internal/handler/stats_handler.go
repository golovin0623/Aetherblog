package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// StatsHandler serves the 5 admin stats endpoints.
type StatsHandler struct{ svc *service.AnalyticsService }

func NewStatsHandler(svc *service.AnalyticsService) *StatsHandler {
	return &StatsHandler{svc: svc}
}

func (h *StatsHandler) Mount(g *echo.Group) {
	g.GET("/dashboard", h.Dashboard)
	g.GET("/top-posts", h.TopPosts)
	g.GET("/visitor-trend", h.VisitorTrend)
	g.GET("/archives", h.Archives)
	g.GET("/ai-dashboard", h.AIDashboard)
}

// GET /api/v1/admin/stats/dashboard
func (h *StatsHandler) Dashboard(c echo.Context) error {
	vo, err := h.svc.GetDashboard(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

// GET /api/v1/admin/stats/top-posts
func (h *StatsHandler) TopPosts(c echo.Context) error {
	vos, err := h.svc.GetTopPosts(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

// GET /api/v1/admin/stats/visitor-trend?days=30
func (h *StatsHandler) VisitorTrend(c echo.Context) error {
	days := 30
	if v := c.QueryParam("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			days = n
		}
	}
	vos, err := h.svc.GetVisitorTrend(c.Request().Context(), days)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

// GET /api/v1/admin/stats/archives
// Returns monthly post archive counts gated behind admin auth.
func (h *StatsHandler) Archives(c echo.Context) error {
	vos, err := h.svc.GetArchiveStats(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

// GET /api/v1/admin/stats/ai-dashboard
func (h *StatsHandler) AIDashboard(c echo.Context) error {
	vo, err := h.svc.GetAIDashboard(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}
