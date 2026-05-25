// Package handler · kb_member_handler.go — /v1/admin/kbs/:id/members 路由。
//
// 端点：
//   GET    /v1/admin/kbs/:id/members             列出成员（VIEW 及以上可见列表，但不含 grant_by 等敏感字段）
//   POST   /v1/admin/kbs/:id/members             新增 / upsert 成员
//   DELETE /v1/admin/kbs/:id/members/:mid        撤销成员
package handler

import (
	"fmt"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type KBMemberHandler struct {
	parent *KBHandler
	svc    *service.KBService
}

func NewKBMemberHandler(parent *KBHandler, svc *service.KBService) *KBMemberHandler {
	return &KBMemberHandler{parent: parent, svc: svc}
}

func (h *KBMemberHandler) Mount(g *echo.Group) {
	g.GET("/:id/members", h.List)
	g.POST("/:id/members", h.Upsert)
	g.DELETE("/:id/members/:mid", h.Delete)
}

func (h *KBMemberHandler) List(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	rows, err := h.svc.ListMembers(c.Request().Context(), id, uc)
	if err != nil {
		return h.parent.handleSvcErr(c, err)
	}
	return response.OK(c, rows)
}

func (h *KBMemberHandler) Upsert(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.CreateKBMemberRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.UpsertMember(c.Request().Context(), id, req, uc)
	if err != nil {
		h.parent.recordKBEvent(c, "kb.member.upsert", "成员授权失败", fmt.Sprintf("kb_id=%d %s#%d → %s err=%v", id, req.PrincipalType, req.PrincipalID, req.PermissionLevel, err), "failed")
		return h.parent.handleSvcErr(c, err)
	}
	h.parent.recordKBEvent(c, "kb.member.upsert", fmt.Sprintf("KB #%d 授权 %s#%d", id, req.PrincipalType, req.PrincipalID), "level="+req.PermissionLevel, "success")
	return response.OK(c, vo)
}

func (h *KBMemberHandler) Delete(c echo.Context) error {
	uc, err := h.parent.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	mid, err := parseInt64Param(c, "mid")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的成员ID")
	}
	if err := h.svc.DeleteMember(c.Request().Context(), id, mid, uc); err != nil {
		h.parent.recordKBEvent(c, "kb.member.delete", "撤销成员失败", fmt.Sprintf("kb_id=%d member_id=%d err=%v", id, mid, err), "failed")
		return h.parent.handleSvcErr(c, err)
	}
	h.parent.recordKBEvent(c, "kb.member.delete", fmt.Sprintf("撤销 KB #%d 成员 #%d", id, mid), "", "success")
	return response.OKEmpty(c)
}
