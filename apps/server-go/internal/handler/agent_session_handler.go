// Package handler · agent_session_handler.go — /api/v1/agent/sessions 路由族。
//
// 灵境 AI 会话云同步（跨设备漫游，migration 000088）。鉴权与 /v1/agent 组一致：
// 任意已登录用户；所有查询强制 user_id = JWT 主体，越权 / 不存在一律 404，
// 不泄露会话存在性。
//
// 端点：
//
//	GET    /v1/agent/sessions        列表（不含 messages；含 messageCount；置顶优先按更新倒序；?limit= 默认 100）
//	GET    /v1/agent/sessions/:id    单会话详情（含全部 messages，按 seq 升序）
//	PUT    /v1/agent/sessions/:id    整会话 upsert（LWW：库内 client_updated_at 更新 → 409 + data=服务端版本）
//	DELETE /v1/agent/sessions/:id    删除会话（消息级联）
//
// 同步模型 = 整会话 upsert：body 携带 meta + 全量 messages，服务端事务内全量
// 替换，幂等可重放。写路径限流（rate:agent:sessions 60/min/user）与 4MB body
// 上限在 server.go 挂载处配置。
package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// AgentSessionHandler 处理灵境会话云同步路由。
type AgentSessionHandler struct {
	svc *service.AgentSessionService
}

// NewAgentSessionHandler 创建 AgentSessionHandler。
func NewAgentSessionHandler(svc *service.AgentSessionService) *AgentSessionHandler {
	return &AgentSessionHandler{svc: svc}
}

// Mount 注册路由。调用方传入 /v1/agent/sessions 子组
// （鉴权 / 写限流 / body 上限中间件在 server.go 组装）。
func (h *AgentSessionHandler) Mount(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/:id", h.Get)
	g.PUT("/:id", h.Put)
	g.DELETE("/:id", h.Delete)
}

// List 处理 GET /v1/agent/sessions。
func (h *AgentSessionHandler) List(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	limit := service.AgentSessionDefaultLimit
	if raw := c.QueryParam("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			return response.FailWith(c, response.BadRequest, "limit 非法")
		}
		limit = n
	}
	rows, err := h.svc.List(c.Request().Context(), lu.UserID, limit)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, rows)
}

// Get 处理 GET /v1/agent/sessions/:id。
func (h *AgentSessionHandler) Get(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	vo, err := h.svc.Get(c.Request().Context(), c.Param("id"), lu.UserID)
	if err != nil {
		return h.mapError(c, err)
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "会话不存在")
	}
	return response.OK(c, vo)
}

// Put 处理 PUT /v1/agent/sessions/:id（整会话 upsert）。
func (h *AgentSessionHandler) Put(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	var req dto.AgentSessionUpsertRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体不是合法 JSON")
	}
	meta, err := h.svc.Upsert(c.Request().Context(), c.Param("id"), lu.UserID, &req)
	if err != nil {
		return h.mapError(c, err)
	}
	if meta == nil {
		// 会话 id 已被其他用户占用 —— 与不存在不可区分。
		return response.FailWith(c, response.NotFound, "会话不存在")
	}
	return response.OK(c, meta)
}

// Delete 处理 DELETE /v1/agent/sessions/:id。
func (h *AgentSessionHandler) Delete(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	ok, err := h.svc.Delete(c.Request().Context(), c.Param("id"), lu.UserID)
	if err != nil {
		return h.mapError(c, err)
	}
	if !ok {
		return response.FailWith(c, response.NotFound, "会话不存在")
	}
	return response.OKEmpty(c)
}

// mapError 统一映射 service 层语义错误：
//   - 校验失败 → 400
//   - LWW 冲突 → HTTP 409，业务码 409，data 携带服务端版本（可能为 null，
//     null 时客户端应 GET 自取）
//   - 其余 → 500
func (h *AgentSessionHandler) mapError(c echo.Context, err error) error {
	var vErr *service.AgentSessionValidationError
	if errors.As(err, &vErr) {
		return response.FailWith(c, response.BadRequest, vErr.Reason)
	}
	var conflict *service.AgentSessionConflictError
	if errors.As(err, &conflict) {
		var data any
		if conflict.Server != nil {
			data = conflict.Server
		}
		// response 包没有 409 结果码：LWW 冲突需要客户端可编程识别，
		// 直接以标准 R 信封 + HTTP 409 返回（data = 服务端版本）。
		return c.JSON(http.StatusConflict, response.R{
			Code:          http.StatusConflict,
			Message:       "会话已在其他设备更新",
			Data:          data,
			Timestamp:     time.Now().UnixMilli(),
			TraceID:       ctxutil.TraceID(c),
			ErrorCategory: "conflict",
		})
	}
	return response.Error(c, err)
}
