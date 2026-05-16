package handler

import (
	"strconv"
	"strings"
	"time"

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

// List 处理 GET /api/v1/admin/activities 请求，支持以下查询参数：
//   - category   按事件分类过滤（event_category 列, 如 "post"/"comment"/"system"）
//   - eventType  按精确事件类型过滤（event_type 列, 如 "post.create"）
//   - status     按状态过滤（INFO/SUCCESS/WARNING/ERROR）
//   - search     在 title / description 上做模糊匹配
//   - userId     限定触发用户
//   - startTime / endTime  RFC3339 时间区间限定 created_at
//   - pageNum / pageSize   分页参数
func (h *ActivityHandler) List(c echo.Context) error {
	p := pagination.ParseWithDefaultsAndMax(c, 1, 10, 200)

	category := c.QueryParam("category")
	eventType := c.QueryParam("eventType")

	f := repository.ActivityFilter{
		Category:  category,
		EventType: eventType,
		Status:    strings.ToUpper(strings.TrimSpace(c.QueryParam("status"))),
		Search:    strings.TrimSpace(c.QueryParam("search")),
		Params:    p,
	}

	if uidStr := c.QueryParam("userId"); uidStr != "" {
		if uid, err := strconv.ParseInt(uidStr, 10, 64); err == nil && uid > 0 {
			f.UserID = uid
		}
	}
	if v := strings.TrimSpace(c.QueryParam("startTime")); v != "" {
		if t := parseFlexibleTime(v); t != nil {
			f.StartTime = *t
		}
	}
	if v := strings.TrimSpace(c.QueryParam("endTime")); v != "" {
		if t := parseFlexibleTime(v); t != nil {
			// 仅日期格式时把 23:59:59.999999999 作为区间右端点，避免漏掉当天活动
			tt := *t
			if tt.Hour() == 0 && tt.Minute() == 0 && tt.Second() == 0 && len(v) <= 10 {
				tt = tt.Add(24*time.Hour - time.Nanosecond)
			}
			f.EndTime = tt
		}
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
	p := pagination.ParseWithDefaultsAndMax(c, 1, 10, 200)
	pr, err := h.svc.GetByUser(c.Request().Context(), userID, p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}
