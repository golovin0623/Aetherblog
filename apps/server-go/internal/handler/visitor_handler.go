package handler

import (
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// VisitorHandler serves the 2 public visit endpoints.
type VisitorHandler struct{ svc *service.AnalyticsService }

// NewVisitorHandler creates a VisitorHandler backed by the given AnalyticsService.
func NewVisitorHandler(svc *service.AnalyticsService) *VisitorHandler {
	return &VisitorHandler{svc: svc}
}

// Mount registers the public visit recording and today-count routes on g.
func (h *VisitorHandler) Mount(g *echo.Group) {
	g.POST("", h.Record)
	g.GET("/today", h.TodayCount)
}

// visitRequest is the body for POST /api/v1/public/visit.
// Accepts both Java format (path, postId) and extended format (pageUrl, pageTitle, referer).
type visitRequest struct {
	Path      string `json:"path"`      // Java field
	PostID    *int64 `json:"postId"`    // Java field
	PageURL   string `json:"pageUrl"`   // extended
	PageTitle string `json:"pageTitle"` // extended
	Referer   string `json:"referer"`   // extended
}

// POST /api/v1/public/visit
func (h *VisitorHandler) Record(c echo.Context) error {
	var req visitRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	// Prefer Java-style "path" if provided, fallback to "pageUrl"
	pageURL := req.Path
	if pageURL == "" {
		pageURL = req.PageURL
	}
	if pageURL == "" {
		return response.FailWith(c, response.BadRequest, "path 不能为空")
	}

	ip := c.RealIP()
	ua := c.Request().UserAgent()

	// Fire-and-forget; handler returns immediately.
	h.svc.RecordVisit(c.Request().Context(), pageURL, req.PageTitle, ip, ua, req.Referer)

	return response.OKEmpty(c)
}

// GET /api/v1/public/visit/today
func (h *VisitorHandler) TodayCount(c echo.Context) error {
	n, err := h.svc.GetTodayCount(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, map[string]int64{"count": n})
}
