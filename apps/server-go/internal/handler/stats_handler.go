package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
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
// Returns aggregated DashboardData matching frontend DashboardData interface:
// { stats, topPosts, visitorTrend, archiveStats, trends }
func (h *StatsHandler) Dashboard(c echo.Context) error {
	ctx := c.Request().Context()

	dashboard, err := h.svc.GetDashboard(ctx)
	if err != nil {
		return response.Error(c, err)
	}

	topPosts, _ := h.svc.GetTopPosts(ctx)
	if topPosts == nil {
		topPosts = []service.TopPostVO{}
	}

	visitorTrend, _ := h.svc.GetVisitorTrend(ctx, 7)
	if visitorTrend == nil {
		visitorTrend = []service.DailyVisitVO{}
	}

	archiveStats, _ := h.svc.GetArchiveStats(ctx)
	if archiveStats == nil {
		archiveStats = []service.ArchiveMonthVO{}
	}

	// Fetch AI usage stats (non-blocking — use zero on failure)
	var aiTokens int64
	var aiCost float64
	if aiDash, err := h.svc.GetAIDashboard(ctx); err == nil && aiDash != nil {
		aiTokens = aiDash.Overview.TotalTokens
		aiCost = aiDash.Overview.TotalCost
	}

	// Fetch trends (non-blocking — use zeros on failure)
	trendsMap := map[string]any{
		"posts":          0,
		"categories":     0,
		"views":          0,
		"visitors":       0,
		"comments":       0,
		"words":          0,
		"postsThisMonth": 0,
	}
	if trends, err := h.svc.GetTrends(ctx); err == nil && trends != nil {
		trendsMap = map[string]any{
			"posts":          trends.Posts,
			"categories":     trends.Categories,
			"views":          trends.Views,
			"visitors":       trends.Visitors,
			"comments":       trends.Comments,
			"words":          trends.Words,
			"postsThisMonth": trends.PostsThisMonth,
		}
	}

	// Fetch device stats (non-blocking — use empty on failure)
	var deviceStats any = []any{}
	if ds, err := h.svc.GetDeviceStats(ctx); err == nil && ds != nil {
		deviceStats = ds
	}

	// Map to frontend DashboardData shape
	result := map[string]any{
		"stats": map[string]any{
			"posts":      dashboard.PostCount,
			"categories": dashboard.CategoryCount,
			"tags":       dashboard.TagCount,
			"comments":   dashboard.CommentCount,
			"views":      dashboard.ViewTotal,
			"visitors":   dashboard.UniqueVisitors,
			"totalWords": dashboard.TotalWords,
			"aiTokens":   aiTokens,
			"aiCost":     aiCost,
		},
		"topPosts":     topPosts,
		"visitorTrend": visitorTrend,
		"archiveStats": archiveStats,
		"deviceStats":  deviceStats,
		"trends":       trendsMap,
	}

	return response.OK(c, result)
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

// GET /api/v1/admin/stats/ai-dashboard?days=30&pageNum=1&pageSize=20&taskType=&modelId=&success=&keyword=
func (h *StatsHandler) AIDashboard(c echo.Context) error {
	ctx := c.Request().Context()

	var filter repository.AIDashboardFilter

	if v := c.QueryParam("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			filter.Days = n
		}
	}
	if v := c.QueryParam("pageNum"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			filter.PageNum = n
		}
	}
	if v := c.QueryParam("pageSize"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			filter.PageSize = n
		}
	}
	filter.TaskType = c.QueryParam("taskType")
	filter.ModelID = c.QueryParam("modelId")
	filter.Keyword = c.QueryParam("keyword")

	if v := c.QueryParam("success"); v != "" {
		b := v == "true"
		filter.Success = &b
	}

	vo, err := h.svc.GetAIDashboardFiltered(ctx, filter)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}
