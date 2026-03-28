package handler

import (
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// VisitorHandler serves the 2 public visit endpoints.
type VisitorHandler struct{ svc *service.AnalyticsService }

func NewVisitorHandler(svc *service.AnalyticsService) *VisitorHandler {
	return &VisitorHandler{svc: svc}
}

func (h *VisitorHandler) Mount(g *echo.Group) {
	g.POST("", h.Record)
	g.GET("/today", h.TodayCount)
}

// visitRequest is the body for POST /api/v1/public/visit.
type visitRequest struct {
	PageURL   string `json:"pageUrl"`
	PageTitle string `json:"pageTitle"`
	Referer   string `json:"referer"`
}

// POST /api/v1/public/visit
func (h *VisitorHandler) Record(c echo.Context) error {
	var req visitRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	if req.PageURL == "" {
		return response.FailWith(c, response.BadRequest, "pageUrl 不能为空")
	}

	ip := c.RealIP()
	ua := c.Request().UserAgent()

	// Fire-and-forget; handler returns immediately.
	h.svc.RecordVisit(c.Request().Context(), req.PageURL, req.PageTitle, ip, ua, req.Referer)

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
