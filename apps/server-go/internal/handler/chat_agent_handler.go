package handler

import (
	"errors"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// ChatAgentHandler 处理团队聊天的 Agent 纳入与管理接口。
type ChatAgentHandler struct {
	svc *service.ChatAgentService
}

// NewChatAgentHandler 创建 ChatAgentHandler。
func NewChatAgentHandler(svc *service.ChatAgentService) *ChatAgentHandler {
	return &ChatAgentHandler{svc: svc}
}

// Mount 在 /v1/chat 组下注册 Agent 路由（组已挂 authMW + pwdRotated + 写限流）。
func (h *ChatAgentHandler) Mount(g *echo.Group) {
	g.GET("/agents", h.ListAgents)
	g.POST("/agents", h.CreateAgent)
	g.PUT("/agents/:agentId", h.UpdateAgent)
	g.DELETE("/agents/:agentId", h.DeleteAgent)
	g.GET("/conversations/:id/agents", h.ListConversationAgents)
	g.POST("/conversations/:id/agents", h.SeatAgent)
	g.DELETE("/conversations/:id/agents/:agentId", h.UnseatAgent)
	g.POST("/conversations/:id/agents/:agentId/messages", h.PostAgentMessage)
}

func actorOf(c echo.Context) service.ChatActor {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return service.ChatActor{}
	}
	return service.ChatActor{UserID: lu.UserID, IsAdmin: strings.EqualFold(lu.Role, "admin")}
}

// ListAgents 返回调用者可见的 Agent 列表。
func (h *ChatAgentHandler) ListAgents(c echo.Context) error {
	list, err := h.svc.ListAgents(c.Request().Context(), actorOf(c))
	if err != nil {
		return h.agentError(c, err)
	}
	return response.OK(c, list)
}

// CreateAgent 创建 Agent。
func (h *ChatAgentHandler) CreateAgent(c echo.Context) error {
	var req dto.CreateAgentRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	vo, err := h.svc.CreateAgent(c.Request().Context(), actorOf(c), req)
	if err != nil {
		return h.agentError(c, err)
	}
	return response.OK(c, vo)
}

// UpdateAgent 更新 Agent。
func (h *ChatAgentHandler) UpdateAgent(c echo.Context) error {
	id, err := parseAgentID(c)
	if err != nil {
		return err
	}
	var req dto.UpdateAgentRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	vo, err := h.svc.UpdateAgent(c.Request().Context(), actorOf(c), id, req)
	if err != nil {
		return h.agentError(c, err)
	}
	return response.OK(c, vo)
}

// DeleteAgent 删除 Agent。
func (h *ChatAgentHandler) DeleteAgent(c echo.Context) error {
	id, err := parseAgentID(c)
	if err != nil {
		return err
	}
	if err := h.svc.DeleteAgent(c.Request().Context(), actorOf(c), id); err != nil {
		return h.agentError(c, err)
	}
	return response.OKEmpty(c)
}

// ListConversationAgents 返回会话中活跃入座的 Agent。
func (h *ChatAgentHandler) ListConversationAgents(c echo.Context) error {
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	list, err := h.svc.ListConversationAgents(c.Request().Context(), actorOf(c), convID)
	if err != nil {
		return h.agentError(c, err)
	}
	return response.OK(c, list)
}

// SeatAgent 把 Agent 纳入会话。
func (h *ChatAgentHandler) SeatAgent(c echo.Context) error {
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	var req dto.SeatAgentRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	vo, err := h.svc.SeatAgent(c.Request().Context(), actorOf(c), convID, req.AgentID)
	if err != nil {
		return h.agentError(c, err)
	}
	return response.OK(c, vo)
}

// UnseatAgent 让 Agent 离席。
func (h *ChatAgentHandler) UnseatAgent(c echo.Context) error {
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	agentID, err := parseAgentID(c)
	if err != nil {
		return err
	}
	if err := h.svc.UnseatAgent(c.Request().Context(), actorOf(c), convID, agentID); err != nil {
		return h.agentError(c, err)
	}
	return response.OKEmpty(c)
}

// PostAgentMessage 以 Agent 身份在会话中发言。
func (h *ChatAgentHandler) PostAgentMessage(c echo.Context) error {
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	agentID, err := parseAgentID(c)
	if err != nil {
		return err
	}
	var req dto.PostAgentMessageRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	vo, err := h.svc.PostAgentMessage(c.Request().Context(), actorOf(c), convID, agentID, req.Content, req.ClientMsgID)
	if err != nil {
		return h.agentError(c, err)
	}
	return response.OK(c, vo)
}

// agentError 把 service 哨兵错误映射到 HTTP 业务码。
func (h *ChatAgentHandler) agentError(c echo.Context, err error) error {
	switch {
	case errors.Is(err, service.ErrAgentNotFound), errors.Is(err, service.ErrChatConvNotFound):
		return response.FailWith(c, response.NotFound, err.Error())
	case errors.Is(err, service.ErrAgentForbidden), errors.Is(err, service.ErrChatNotMember):
		return response.FailWith(c, response.Forbidden, err.Error())
	case errors.Is(err, service.ErrAgentScope), errors.Is(err, service.ErrChatBadMessage):
		return response.FailWith(c, response.BadRequest, err.Error())
	default:
		return response.Error(c, err)
	}
}

func parseAgentID(c echo.Context) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("agentId")), 10, 64)
	if err != nil || id <= 0 {
		return 0, response.FailWith(c, response.BadRequest, "Agent ID 非法")
	}
	return id, nil
}
