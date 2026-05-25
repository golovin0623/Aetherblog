// Package handler · kb_agent_handler.go — /v1/agent/knowledge-bases 路由。
//
// 灵境 KB picker 用：列出当前用户在权限 ≥ USE 的 KB。
// 鉴权与 agent_handler 一致（任意已登录用户均可），picker 速率桶。
package handler

import (
	"errors"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type KBAgentHandler struct {
	svc *service.KBService
}

func NewKBAgentHandler(svc *service.KBService) *KBAgentHandler {
	return &KBAgentHandler{svc: svc}
}

func (h *KBAgentHandler) Mount(g *echo.Group, pickerLimit echo.MiddlewareFunc) {
	g.GET("/knowledge-bases", h.List, pickerLimit)
}

func (h *KBAgentHandler) List(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	uc, err := h.svc.BuildUserContext(c.Request().Context(), lu.UserID, lu.Role)
	if err != nil {
		return response.Error(c, errors.New("加载用户权限失败"))
	}
	keyword := c.QueryParam("q")
	rows, err := h.svc.ListForPicker(c.Request().Context(), uc, keyword)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, rows)
}
