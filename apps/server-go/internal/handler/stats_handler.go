package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// StatsHandler 处理管理后台的 5 个统计数据接口。
type StatsHandler struct{ svc *service.AnalyticsService }

// NewStatsHandler 创建由指定 AnalyticsService 驱动的 StatsHandler 实例。
func NewStatsHandler(svc *service.AnalyticsService) *StatsHandler {
	return &StatsHandler{svc: svc}
}

// Mount 将所有统计路由注册到路由组 g。
func (h *StatsHandler) Mount(g *echo.Group) {
	g.GET("/dashboard", h.Dashboard)
	g.GET("/top-posts", h.TopPosts)
	g.GET("/visitor-trend", h.VisitorTrend)
	g.GET("/archives", h.Archives)
	g.GET("/ai-dashboard", h.AIDashboard)
}

// Dashboard 处理 GET /api/v1/admin/stats/dashboard 请求。
// 聚合并返回前端 DashboardData 接口所需的全量数据，结构如下：
//
//	{ stats, topPosts, visitorTrend, archiveStats, deviceStats, trends }
//
// AI 用量、趋势变化和设备统计均采用非阻塞方式获取，失败时降级为零值。
func (h *StatsHandler) Dashboard(c echo.Context) error {
	ctx := c.Request().Context()

	// 获取核心仪表盘汇总数据
	dashboard, err := h.svc.GetDashboard(ctx)
	if err != nil {
		return response.Error(c, err)
	}

	// 获取热门文章列表，失败时降级为空数组
	topPosts, _ := h.svc.GetTopPosts(ctx)
	if topPosts == nil {
		topPosts = []service.TopPostVO{}
	}

	// 获取最近 7 天的访客趋势，失败时降级为空数组
	visitorTrend, _ := h.svc.GetVisitorTrend(ctx, 7)
	if visitorTrend == nil {
		visitorTrend = []service.DailyVisitVO{}
	}

	// 获取按月归档的文章数量统计，失败时降级为空数组
	archiveStats, _ := h.svc.GetArchiveStats(ctx)
	if archiveStats == nil {
		archiveStats = []service.ArchiveMonthVO{}
	}

	// 获取 AI 用量统计（非阻塞——失败时使用零值）
	var aiTokens int64
	var aiCost float64
	if aiDash, err := h.svc.GetAIDashboard(ctx); err == nil && aiDash != nil {
		aiTokens = aiDash.Overview.TotalTokens
		aiCost = aiDash.Overview.TotalCost
	}

	// 获取数据增长趋势（非阻塞——失败时全部使用零值）
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

	// 获取设备类型统计（非阻塞——失败时使用空数组）
	var deviceStats any = []any{}
	if ds, err := h.svc.GetDeviceStats(ctx); err == nil && ds != nil {
		deviceStats = ds
	}

	// 将各项数据映射为前端 DashboardData 结构
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

// TopPosts 处理 GET /api/v1/admin/stats/top-posts 请求。
// 返回浏览量排名靠前的文章列表。
func (h *StatsHandler) TopPosts(c echo.Context) error {
	vos, err := h.svc.GetTopPosts(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

// VisitorTrend 处理 GET /api/v1/admin/stats/visitor-trend?days=30 请求。
// 返回指定天数内的每日访客趋势数据，默认查询最近 30 天。
// 查询参数 days 为统计天数（正整数）。
func (h *StatsHandler) VisitorTrend(c echo.Context) error {
	// 解析 days 查询参数，默认 30 天
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

// Archives 处理 GET /api/v1/admin/stats/archives 请求。
// 返回按月归档的文章发布数量统计，该接口受管理员身份认证保护。
func (h *StatsHandler) Archives(c echo.Context) error {
	vos, err := h.svc.GetArchiveStats(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

// AIDashboard 处理 GET /api/v1/admin/stats/ai-dashboard 请求。
// 返回 AI 调用的聚合统计及分页明细记录，支持多维度过滤。
// 查询参数：days（天数）、pageNum（页码）、pageSize（每页条数）、
// taskType（任务类型）、modelId（模型 ID）、success（是否成功）、keyword（关键词）。
func (h *StatsHandler) AIDashboard(c echo.Context) error {
	ctx := c.Request().Context()

	var filter repository.AIDashboardFilter

	// 解析时间范围过滤参数
	if v := c.QueryParam("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			filter.Days = n
		}
	}
	// 解析分页参数
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
	// 解析字符串类型过滤参数
	filter.TaskType = c.QueryParam("taskType")
	filter.ModelID = c.QueryParam("modelId")
	filter.Keyword = c.QueryParam("keyword")

	// 解析是否成功的布尔过滤参数
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
