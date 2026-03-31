package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// ActivityHandler 负责处理 3 个管理端活动日志接口。
type ActivityHandler struct{ svc *service.ActivityService }

// NewActivityHandler 创建一个 ActivityHandler 实例。
func NewActivityHandler(svc *service.ActivityService) *ActivityHandler {
	return &ActivityHandler{svc: svc}
}

// Mount 将活动日志相关路由注册到指定的管理员路由组。
func (h *ActivityHandler) Mount(g *echo.Group) {
	g.GET("/recent", h.Recent)
	g.GET("", h.List)
	g.GET("/user/:userId", h.ByUser)
}

// Recent 处理 GET /api/v1/admin/activities/recent 请求，
// 返回最近的活动日志列表。
func (h *ActivityHandler) Recent(c echo.Context) error {
	vos, err := h.svc.GetRecent(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

// List 处理 GET /api/v1/admin/activities?eventType=&status=&pageNum=1&pageSize=20 请求，
// 支持按事件类型和状态过滤，返回分页活动日志列表。
func (h *ActivityHandler) List(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 20)
	eventType := c.QueryParam("eventType")
	// 同时兼容旧的 category 参数名
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

// ByUser 处理 GET /api/v1/admin/activities/user/:userId 请求，
// 返回指定用户的分页活动日志列表。
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
