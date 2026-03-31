package handler

import (
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// VisitorHandler 提供 2 个公开的访问记录接口。
type VisitorHandler struct{ svc *service.AnalyticsService }

// NewVisitorHandler 创建由指定 AnalyticsService 驱动的 VisitorHandler 实例。
func NewVisitorHandler(svc *service.AnalyticsService) *VisitorHandler {
	return &VisitorHandler{svc: svc}
}

// Mount 将访问记录和今日访客统计路由注册到路由组 g。
func (h *VisitorHandler) Mount(g *echo.Group) {
	g.POST("", h.Record)
	g.GET("/today", h.TodayCount)
}

// visitRequest 是 POST /api/v1/public/visit 接口的请求体结构。
// 兼容两种传参风格：
//   - Java 风格：path（页面路径）、postId（文章 ID）
//   - 扩展风格：pageUrl（完整 URL）、pageTitle（页面标题）、referer（来源页）
type visitRequest struct {
	Path      string `json:"path"`      // Java 风格路径字段
	PostID    *int64 `json:"postId"`    // Java 风格文章 ID 字段
	PageURL   string `json:"pageUrl"`   // 扩展字段：完整页面 URL
	PageTitle string `json:"pageTitle"` // 扩展字段：页面标题
	Referer   string `json:"referer"`   // 扩展字段：来源页地址
}

// Record 处理 POST /api/v1/public/visit 请求。
// 记录一次页面访问，提取客户端 IP 和 User-Agent 后调用分析服务异步写入。
// 路径优先使用 Java 风格的 "path" 字段，缺失时降级使用 "pageUrl"。
func (h *VisitorHandler) Record(c echo.Context) error {
	var req visitRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	// 优先使用 Java 风格的 "path" 字段，缺失时降级使用 "pageUrl"
	pageURL := req.Path
	if pageURL == "" {
		pageURL = req.PageURL
	}
	if pageURL == "" {
		return response.FailWith(c, response.BadRequest, "path 不能为空")
	}

	// 从请求上下文中提取真实 IP 和浏览器 UA
	ip := c.RealIP()
	ua := c.Request().UserAgent()

	// 异步记录访问，handler 立即返回，不等待写入完成
	h.svc.RecordVisit(c.Request().Context(), pageURL, req.PageTitle, ip, ua, req.Referer)

	return response.OKEmpty(c)
}

// TodayCount 处理 GET /api/v1/public/visit/today 请求。
// 返回今日的访客总量（唯一 IP 计数）。
func (h *VisitorHandler) TodayCount(c echo.Context) error {
	n, err := h.svc.GetTodayCount(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, map[string]int64{"count": n})
}
