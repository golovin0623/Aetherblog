package handler

import (
	"fmt"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// FriendLinkHandler 负责管理博客友情链接（Blogroll）资源。
type FriendLinkHandler struct {
	svc         *service.FriendLinkService
	activitySvc *service.ActivityService
}

// NewFriendLinkHandler 创建一个由指定 FriendLinkService 驱动的 FriendLinkHandler 实例。
func NewFriendLinkHandler(svc *service.FriendLinkService, activitySvc *service.ActivityService) *FriendLinkHandler {
	return &FriendLinkHandler{svc: svc, activitySvc: activitySvc}
}

// MountAdmin 在指定路由组上注册管理端 CRUD 及管理路由。
func (h *FriendLinkHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/page", h.Page)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.DELETE("/batch", h.BatchDelete)
	g.PATCH("/:id/toggle-visible", h.ToggleVisible)
	g.PATCH("/reorder", h.Reorder)
}

// MountPublic 在指定路由组上注册公开的可见友链列表接口。
func (h *FriendLinkHandler) MountPublic(g *echo.Group) {
	g.GET("", h.ListPublic)
}

// List 处理 GET /admin/friend-links 请求，
// 返回所有友链（含隐藏链接）供管理后台使用。
func (h *FriendLinkHandler) List(c echo.Context) error {
	links, err := h.svc.ListAll(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, links)
}

// ListPublic 处理 GET /public/friend-links 请求，
// 仅返回按 sort_order 排序的可见友链列表。
func (h *FriendLinkHandler) ListPublic(c echo.Context) error {
	links, err := h.svc.ListVisible(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, links)
}

// Page 处理 GET /admin/friend-links/page 请求，
// 返回分页友链列表供管理端列表视图使用。
func (h *FriendLinkHandler) Page(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.Page(c.Request().Context(), p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// Get 处理 GET /admin/friend-links/:id 请求，
// 根据 ID 返回单条友链信息。
func (h *FriendLinkHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	fl, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if fl == nil {
		return response.FailWith(c, response.NotFound, "友链不存在")
	}
	return response.OK(c, fl)
}

// Create 处理 POST /admin/friend-links 请求，
// 创建新的友情链接。
func (h *FriendLinkHandler) Create(c echo.Context) error {
	var req dto.FriendLinkRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	fl, err := h.svc.Create(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}

	// 记录新增友链活动
	h.recordFriendActivity(c, "friend.create", "新增友链: "+req.Name, fmt.Sprintf("友链 %s 已创建", req.Name))

	return response.OK(c, fl)
}

// Update 处理 PUT /admin/friend-links/:id 请求，
// 更新指定友链的信息。
func (h *FriendLinkHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.FriendLinkRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	fl, err := h.svc.Update(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, fl)
}

// Delete 处理 DELETE /admin/friend-links/:id 请求，
// 永久删除指定友链。
func (h *FriendLinkHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}

	// 记录删除友链活动
	h.recordFriendActivity(c, "friend.delete", fmt.Sprintf("删除友链 #%d", id), fmt.Sprintf("友链 #%d 已删除", id))

	return response.OKEmpty(c)
}

// BatchDelete 处理 DELETE /admin/friend-links/batch 请求，
// 根据 ID 列表批量删除友链。
func (h *FriendLinkHandler) BatchDelete(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.DeleteBatch(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// ToggleVisible 处理 PATCH /admin/friend-links/:id/toggle-visible 请求，
// 切换指定友链的可见性状态。
func (h *FriendLinkHandler) ToggleVisible(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	fl, err := h.svc.ToggleVisible(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, fl)
}

// Reorder 处理 PATCH /admin/friend-links/reorder 请求，
// 根据提供的 ID 顺序重新设置各友链的 sort_order 值。
func (h *FriendLinkHandler) Reorder(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.Reorder(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// recordFriendActivity 记录友链相关活动事件，失败时仅记录日志不阻塞主流程。
func (h *FriendLinkHandler) recordFriendActivity(c echo.Context, eventType, title, description string) {
	if h.activitySvc == nil {
		return
	}
	evtCat := "friend"
	evtStatus := "SUCCESS"
	var userID *int64
	if lu := middleware.GetLoginUser(c); lu != nil {
		userID = &lu.UserID
	}
	if err := h.activitySvc.Create(c.Request().Context(), &model.ActivityEvent{
		EventType:     eventType,
		EventCategory: &evtCat,
		Title:         title,
		Description:   &description,
		UserID:        userID,
		Status:        &evtStatus,
	}); err != nil {
		log.Warn().Err(err).Msg("record activity failed")
	}
}
