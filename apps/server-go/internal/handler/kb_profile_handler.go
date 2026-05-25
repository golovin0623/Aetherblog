// Package handler · kb_profile_handler.go — /v1/admin/kbs/:id/profiles 路由。
//
// 端点：
//   GET    /v1/admin/kbs/:id/profiles                    列表
//   POST   /v1/admin/kbs/:id/profiles                    创建（status=shadow）
//   PUT    /v1/admin/kbs/:id/profiles/:pid               更新
//   POST   /v1/admin/kbs/:id/profiles/:pid/activate      激活（蓝绿）
//   DELETE /v1/admin/kbs/:id/profiles/:pid               删除（仅 deprecated）
package handler

import (
	"fmt"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type KBProfileHandler struct {
	parent *KBHandler // 复用 buildUC + handleSvcErr
	svc    *service.KBService
}

func NewKBProfileHandler(parent *KBHandler, svc *service.KBService) *KBProfileHandler {
	return &KBProfileHandler{parent: parent, svc: svc}
}

func (h *KBProfileHandler) Mount(g *echo.Group) {
	g.GET("/:id/profiles", h.List)
	g.POST("/:id/profiles", h.Create)
	g.PUT("/:id/profiles/:pid", h.Update)
	g.POST("/:id/profiles/:pid/activate", h.Activate)
	g.POST("/:id/profiles/:pid/migrate", h.Migrate)
	g.DELETE("/:id/profiles/:pid", h.Delete)
}

func (h *KBProfileHandler) List(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	rows, err := h.svc.ListProfiles(c.Request().Context(), id, uc)
	if err != nil {
		return h.parent.handleSvcErr(c, err)
	}
	return response.OK(c, rows)
}

func (h *KBProfileHandler) Create(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.CreateKBProfileRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.CreateProfile(c.Request().Context(), id, req, uc)
	if err != nil {
		return h.parent.handleSvcErr(c, err)
	}
	return response.OK(c, vo)
}

func (h *KBProfileHandler) Update(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	pid, err := parseInt64Param(c, "pid")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的档案ID")
	}
	var req dto.UpdateKBProfileRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.UpdateProfile(c.Request().Context(), id, pid, req, uc)
	if err != nil {
		return h.parent.handleSvcErr(c, err)
	}
	return response.OK(c, vo)
}

func (h *KBProfileHandler) Activate(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	pid, err := parseInt64Param(c, "pid")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的档案ID")
	}
	if err := h.svc.ActivateProfile(c.Request().Context(), id, pid, uc); err != nil {
		h.parent.recordKBEvent(c, "kb.profile.activate", "Profile 激活失败", fmt.Sprintf("kb_id=%d profile_id=%d err=%v", id, pid, err), "failed")
		return h.parent.handleSvcErr(c, err)
	}
	h.parent.recordKBEvent(c, "kb.profile.activate", fmt.Sprintf("激活 KB #%d Profile #%d", id, pid), "", "success")
	return response.OKEmpty(c)
}

// Migrate 触发蓝绿迁移：用目标 profile 重新索引整库 → 全部成功后原子激活。
// 同步阻塞返回（可能较慢），admin UI 应展示进度提示。
func (h *KBProfileHandler) Migrate(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	pid, err := parseInt64Param(c, "pid")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的档案ID")
	}
	if err := h.svc.MigrateProfile(c.Request().Context(), id, pid, uc); err != nil {
		h.parent.recordKBEvent(c, "kb.profile.migrate", "Profile 蓝绿迁移失败", fmt.Sprintf("kb_id=%d profile_id=%d err=%v", id, pid, err), "failed")
		return h.parent.handleSvcErr(c, err)
	}
	h.parent.recordKBEvent(c, "kb.profile.migrate", fmt.Sprintf("蓝绿迁移 KB #%d → Profile #%d", id, pid), "", "success")
	return response.OKEmpty(c)
}

func (h *KBProfileHandler) Delete(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	pid, err := parseInt64Param(c, "pid")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的档案ID")
	}
	if err := h.svc.DeleteProfile(c.Request().Context(), id, pid, uc); err != nil {
		return h.parent.handleSvcErr(c, err)
	}
	return response.OKEmpty(c)
}
