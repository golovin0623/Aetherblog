package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// ActivityHandler serves the 3 admin activity endpoints.
type ActivityHandler struct{ svc *service.ActivityService }

// NewActivityHandler creates an ActivityHandler.
func NewActivityHandler(svc *service.ActivityService) *ActivityHandler {
	return &ActivityHandler{svc: svc}
}

// Mount registers the activity routes under the given admin route group.
func (h *ActivityHandler) Mount(g *echo.Group) {
	g.GET("/recent", h.Recent)
	g.GET("", h.List)
	g.GET("/user/:userId", h.ByUser)
}

// GET /api/v1/admin/activities/recent
func (h *ActivityHandler) Recent(c echo.Context) error {
	vos, err := h.svc.GetRecent(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

// GET /api/v1/admin/activities?eventType=&status=&pageNum=1&pageSize=20
func (h *ActivityHandler) List(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 20)
	eventType := c.QueryParam("eventType")
	if eventType == "" {
		eventType = c.QueryParam("category")
	}
	f := repository.ActivityFilter{
		EventType: eventType,
		Status:    c.QueryParam("status"),
		Params:    p,
	}
	pr, err := h.svc.GetForAdmin(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// GET /api/v1/admin/activities/user/:userId
func (h *ActivityHandler) ByUser(c echo.Context) error {
	userID, err := strconv.ParseInt(c.Param("userId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的用户ID")
	}
	p := pagination.ParseWithDefaults(c, 1, 20)
	pr, err := h.svc.GetByUser(c.Request().Context(), userID, p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}
