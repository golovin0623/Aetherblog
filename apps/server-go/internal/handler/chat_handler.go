package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/coder/websocket"
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/realtime"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// ChatHandler 处理团队聊天 REST 接口与 WebSocket 实时通道。
type ChatHandler struct {
	svc           *service.ChatService
	media         *service.MediaService
	settingSvc    *service.SiteSettingService // 读取 upload_max_size，对聊天附件施加与媒体库一致的大小上限
	hub           *realtime.Hub
	wsOriginAllow []string // WebSocket 握手允许的 Origin host 模式（防 CSWSH）
}

// NewChatHandler 创建 ChatHandler。
func NewChatHandler(svc *service.ChatService, media *service.MediaService, settingSvc *service.SiteSettingService, hub *realtime.Hub, wsOriginAllow []string) *ChatHandler {
	return &ChatHandler{svc: svc, media: media, settingSvc: settingSvc, hub: hub, wsOriginAllow: wsOriginAllow}
}

// maxUploadBytes 返回聊天附件单文件上限（字节），与媒体库 upload_max_size 同源；
// settingSvc 未注入或读取失败时回落到 100MB 硬上限。
func (h *ChatHandler) maxUploadBytes(ctx context.Context) int64 {
	if h.settingSvc == nil {
		return maxUploadHardCeilingBytes
	}
	v, err := h.settingSvc.GetValue(ctx, "upload_max_size")
	if err != nil || v == "" {
		return maxUploadHardCeilingBytes
	}
	mb, err := strconv.ParseFloat(v, 64)
	if err != nil || mb <= 0 {
		return maxUploadHardCeilingBytes
	}
	limit := int64(mb * 1024 * 1024)
	if limit <= 0 || limit > maxUploadHardCeilingBytes {
		return maxUploadHardCeilingBytes
	}
	return limit
}

// ChatRouteLimits 聚合按端点定制的限流中间件（nil 项跳过）。
//   - Open：会话创建（direct/team）。按 ID 定位用户，存在性差异可被枚举，须比普通写路径更紧。
//   - Search：私聊选人搜索。输入防抖后的目录查询，独立计桶避免占用创建额度。
type ChatRouteLimits struct {
	Open   echo.MiddlewareFunc
	Search echo.MiddlewareFunc
}

func (l ChatRouteLimits) open() []echo.MiddlewareFunc {
	if l.Open == nil {
		return nil
	}
	return []echo.MiddlewareFunc{l.Open}
}

func (l ChatRouteLimits) search() []echo.MiddlewareFunc {
	if l.Search == nil {
		return nil
	}
	return []echo.MiddlewareFunc{l.Search}
}

// Mount 注册 /v1/chat 路由。整组已挂 authMW + pwdRotated，
// WebSocket 复用同一鉴权（浏览器同源握手会自动携带 ab_access_token Cookie）。
func (h *ChatHandler) Mount(g *echo.Group, limits ChatRouteLimits) {
	g.GET("/ws", h.WS)
	g.GET("/conversations", h.ListConversations)
	g.GET("/dm-targets", h.SearchDMTargets, limits.search()...)
	g.GET("/teams", h.MyTeams)
	g.POST("/conversations/direct", h.OpenDirect, limits.open()...)
	g.POST("/conversations/team/:teamId", h.OpenTeam, limits.open()...)
	g.GET("/conversations/:id/messages", h.History)
	g.POST("/conversations/:id/messages", h.SendMessage)
	g.PATCH("/conversations/:id/messages/:msgId", h.EditMessage)
	g.DELETE("/conversations/:id/messages/:msgId", h.RecallMessage)
	g.POST("/conversations/:id/messages/:msgId/reactions", h.AddReaction)
	g.DELETE("/conversations/:id/messages/:msgId/reactions", h.RemoveReaction)
	g.PUT("/conversations/:id/prefs", h.UpdateConvPrefs)
	g.POST("/conversations/:id/read", h.MarkRead)
	g.GET("/conversations/:id/members", h.Members)
	g.POST("/attachments", h.UploadAttachment)
	g.GET("/settings", h.GetSettings)
	g.PUT("/settings", h.UpdateSettings)
}

// WS 升级为 WebSocket 长连接，承载消息推送 / 打字提示 / 已读回执 / 在线状态。
func (h *ChatHandler) WS(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	conn, err := websocket.Accept(c.Response().Writer, c.Request(), &websocket.AcceptOptions{
		OriginPatterns: h.wsOriginAllow,
	})
	if err != nil {
		// Accept 失败时已写入握手响应，直接返回。
		return nil
	}

	userID := lu.UserID
	// 上线广播（用独立 ctx，请求 ctx 在连接关闭后会被取消）。
	h.svc.BroadcastPresence(context.Background(), userID, true)

	client := h.hub.NewClient(conn, userID, func(ictx context.Context, raw []byte) {
		h.handleInbound(ictx, userID, raw)
	})
	client.Serve(c.Request().Context())

	// 仅当本实例已无该用户的其他连接时才广播下线，减少多标签页误判。
	if !h.hub.LocalOnline(userID) {
		h.svc.BroadcastPresence(context.Background(), userID, false)
	}
	return nil
}

// wsInbound 是客户端通过 WebSocket 发来的信令。
type wsInbound struct {
	Type           string `json:"type"` // typing | read | ping
	ConversationID int64  `json:"conversationId"`
	Typing         bool   `json:"typing"`
	MessageID      int64  `json:"messageId"`
}

func (h *ChatHandler) handleInbound(ctx context.Context, userID int64, raw []byte) {
	var in wsInbound
	if err := json.Unmarshal(raw, &in); err != nil {
		return
	}
	switch in.Type {
	case "typing":
		if in.ConversationID > 0 {
			h.svc.HandleTyping(ctx, userID, in.ConversationID, in.Typing)
		}
	case "read":
		if in.ConversationID > 0 && in.MessageID > 0 {
			_ = h.svc.MarkRead(ctx, userID, in.ConversationID, in.MessageID)
		}
	case "ping":
		// 心跳，无需处理（连接活性由底层维持）。
	}
}

// ListConversations 返回当前用户的会话列表。
func (h *ChatHandler) ListConversations(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	list, err := h.svc.ListConversations(c.Request().Context(), lu.UserID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, list)
}

// OpenDirect 打开 / 创建与目标用户的私聊。
func (h *ChatHandler) OpenDirect(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	var req dto.OpenDirectRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	vo, err := h.svc.OpenDirect(c.Request().Context(), lu.UserID, req.UserID, isAdminRole(lu.Role))
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, vo)
}

// isAdminRole 与 kb_service 同款判定：角色比较大小写不敏感。
func isAdminRole(role string) bool { return strings.EqualFold(role, "admin") }

// SearchDMTargets 私聊选人搜索（GET /dm-targets?q=）。
// 结果按 chat_dm_scope 策略过滤，与 OpenDirect 同源判据。
func (h *ChatHandler) SearchDMTargets(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	list, err := h.svc.SearchDMTargets(c.Request().Context(), lu.UserID, isAdminRole(lu.Role), c.QueryParam("q"))
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, list)
}

// MyTeams 返回当前用户所在的团队列表（GET /teams），供群聊入口点选。
func (h *ChatHandler) MyTeams(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	list, err := h.svc.ListMyTeams(c.Request().Context(), lu.UserID)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, list)
}

// OpenTeam 查找 / 创建团队群聊会话。
func (h *ChatHandler) OpenTeam(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	teamID, err := strconv.ParseInt(c.Param("teamId"), 10, 64)
	if err != nil || teamID <= 0 {
		return response.FailWith(c, response.BadRequest, "团队 ID 非法")
	}
	vo, err := h.svc.EnsureTeamConversation(c.Request().Context(), lu.UserID, teamID)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, vo)
}

// History 倒序拉取会话历史（游标分页）。
func (h *ChatHandler) History(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	limit := parseIntDefault(c.QueryParam("limit"), 30)
	var before *int64
	if v := c.QueryParam("before"); v != "" {
		if id, e := strconv.ParseInt(v, 10, 64); e == nil && id > 0 {
			before = &id
		}
	}
	list, err := h.svc.GetHistory(c.Request().Context(), lu.UserID, convID, before, limit)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, list)
}

// SendMessage 发送消息（REST 兜底通道；落库后由实时层向成员扇出）。
func (h *ChatHandler) SendMessage(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	var req dto.SendMessageRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	vo, err := h.svc.SendMessage(c.Request().Context(), lu.UserID, convID, req)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, vo)
}

// EditMessage 编辑自己的文本消息（2 分钟窗口），成功后向成员广播 message-updated。
func (h *ChatHandler) EditMessage(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	convID, msgID, err := parseChatMsgIDs(c)
	if err != nil {
		return err
	}
	var req dto.EditMessageRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	vo, err := h.svc.EditMessage(c.Request().Context(), lu.UserID, convID, msgID, req.Content, req.Mentions)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, vo)
}

// RecallMessage 软撤回自己的消息（2 分钟窗口），成功后向成员广播 message-updated。
func (h *ChatHandler) RecallMessage(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	convID, msgID, err := parseChatMsgIDs(c)
	if err != nil {
		return err
	}
	vo, err := h.svc.RecallMessage(c.Request().Context(), lu.UserID, convID, msgID)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, vo)
}

// AddReaction 给消息添加表情回应，返回该消息最新的回应聚合。
func (h *ChatHandler) AddReaction(c echo.Context) error {
	return h.react(c, true)
}

// RemoveReaction 移除自己的表情回应，返回该消息最新的回应聚合。
func (h *ChatHandler) RemoveReaction(c echo.Context) error {
	return h.react(c, false)
}

func (h *ChatHandler) react(c echo.Context, add bool) error {
	lu := middleware.GetLoginUser(c)
	convID, msgID, err := parseChatMsgIDs(c)
	if err != nil {
		return err
	}
	var req dto.ChatReactionRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	list, err := h.svc.React(c.Request().Context(), lu.UserID, convID, msgID, req.Emoji, add)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, map[string]any{"messageId": msgID, "reactions": list})
}

// UpdateConvPrefs 更新当前用户在会话内的偏好（置顶 / 免打扰）。
func (h *ChatHandler) UpdateConvPrefs(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	var req dto.UpdateConvPrefsRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	vo, err := h.svc.UpdateConvPrefs(c.Request().Context(), lu.UserID, convID, req)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, vo)
}

// MarkRead 标记已读位点。
func (h *ChatHandler) MarkRead(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	var req dto.MarkReadRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if err := h.svc.MarkRead(c.Request().Context(), lu.UserID, convID, req.MessageID); err != nil {
		return h.chatError(c, err)
	}
	return response.OKEmpty(c)
}

// Members 返回会话成员列表。
func (h *ChatHandler) Members(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	convID, err := parseChatID(c)
	if err != nil {
		return err
	}
	list, err := h.svc.GetMembers(c.Request().Context(), lu.UserID, convID)
	if err != nil {
		return h.chatError(c, err)
	}
	return response.OK(c, list)
}

// UploadAttachment 上传聊天附件（图片 / 文件 / 语音），复用媒体库存储，返回可访问 URL 与元数据。
func (h *ChatHandler) UploadAttachment(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	fh, err := c.FormFile("file")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "缺少上传文件")
	}
	if maxBytes := h.maxUploadBytes(c.Request().Context()); fh.Size > maxBytes {
		return response.FailWith(c, response.BadRequest, fmt.Sprintf("文件大小超过限制 (最大 %d MB)", maxBytes/(1024*1024)))
	}
	uploader := lu.UserID
	vo, err := h.media.Upload(c.Request().Context(), fh, &uploader, nil)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	url := vo.CdnURL
	if url == "" {
		url = vo.FileURL
	}
	out := map[string]any{
		"url":      url,
		"name":     vo.OriginalName,
		"size":     vo.FileSize,
		"mime":     vo.MimeType,
		"fileType": vo.FileType,
	}
	if vo.Width != nil {
		out["width"] = *vo.Width
	}
	if vo.Height != nil {
		out["height"] = *vo.Height
	}
	return response.OK(c, out)
}

// GetSettings 返回用户聊天皮肤偏好。
func (h *ChatHandler) GetSettings(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	vo, err := h.svc.GetSettings(c.Request().Context(), lu.UserID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

// UpdateSettings 更新用户聊天皮肤偏好。
func (h *ChatHandler) UpdateSettings(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	var req dto.UpdateChatSettingsRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体格式错误")
	}
	vo, err := h.svc.UpdateSettings(c.Request().Context(), lu.UserID, req)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

// chatError 把 service 哨兵错误映射到合适的 HTTP 业务码。
func (h *ChatHandler) chatError(c echo.Context, err error) error {
	switch {
	case errors.Is(err, service.ErrChatNotMember):
		return response.FailWith(c, response.Forbidden, err.Error())
	case errors.Is(err, service.ErrChatConvNotFound):
		return response.FailWith(c, response.NotFound, err.Error())
	case errors.Is(err, service.ErrChatBadTarget), errors.Is(err, service.ErrChatBadMessage), errors.Is(err, service.ErrChatEditWindow):
		return response.FailWith(c, response.BadRequest, err.Error())
	default:
		return response.Error(c, err)
	}
}

func parseChatID(c echo.Context) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id <= 0 {
		return 0, response.FailWith(c, response.BadRequest, "会话 ID 非法")
	}
	return id, nil
}

// parseChatMsgIDs 解析 /conversations/:id/messages/:msgId 双路径参数。
func parseChatMsgIDs(c echo.Context) (int64, int64, error) {
	convID, err := parseChatID(c)
	if err != nil {
		return 0, 0, err
	}
	msgID, perr := strconv.ParseInt(strings.TrimSpace(c.Param("msgId")), 10, 64)
	if perr != nil || msgID <= 0 {
		return 0, 0, response.FailWith(c, response.BadRequest, "消息 ID 非法")
	}
	return convID, msgID, nil
}
