package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/realtime"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// 聊天领域哨兵错误，handler 层据此映射 HTTP 状态码。
var (
	ErrChatNotMember    = errors.New("无权访问该会话")
	ErrChatConvNotFound = errors.New("会话不存在")
	ErrChatBadTarget    = errors.New("无效的私聊对象")
	ErrChatBadMessage   = errors.New("消息内容不合法")
)

// ChatService 编排团队聊天的会话 / 消息 / 偏好逻辑，并通过 realtime.Hub 实时扇出。
type ChatService struct {
	repo     *repository.ChatRepo
	userRepo *repository.UserRepo
	hub      *realtime.Hub // 可为 nil（无实时层时仅落库 + REST 轮询）
}

// NewChatService 创建 ChatService。
func NewChatService(repo *repository.ChatRepo, userRepo *repository.UserRepo) *ChatService {
	return &ChatService{repo: repo, userRepo: userRepo}
}

// AttachHub 注入实时分发 Hub。
func (s *ChatService) AttachHub(h *realtime.Hub) { s.hub = h }

// ListConversations 返回用户的会话列表（含未读数与最后一条消息），并填充展示标题。
func (s *ChatService) ListConversations(ctx context.Context, userID int64) ([]dto.ChatConversationVO, error) {
	rows, err := s.repo.ListConversationsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	// 批量拉取全部会话成员，避免逐会话查询造成的 N+1。
	ids := make([]int64, len(rows))
	for i := range rows {
		ids[i] = rows[i].ID
	}
	memberMap, err := s.repo.ListMembersForConversations(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]dto.ChatConversationVO, 0, len(rows))
	for i := range rows {
		out = append(out, s.buildConversationVO(&rows[i], userID, memberRowsToVO(memberMap[rows[i].ID])))
	}
	return out, nil
}

// OpenDirect 查找或创建与目标用户的私聊会话。
func (s *ChatService) OpenDirect(ctx context.Context, userID, targetID int64) (*dto.ChatConversationVO, error) {
	if targetID == userID || targetID <= 0 {
		return nil, ErrChatBadTarget
	}
	target, err := s.userRepo.FindByID(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, ErrChatBadTarget
	}
	conv, _, err := s.repo.FindOrCreateDirect(ctx, userID, targetID, userID)
	if err != nil {
		return nil, err
	}
	return s.loadConversationVO(ctx, conv.ID, userID)
}

// EnsureTeamConversation 校验调用者是团队成员后，查找或创建团队群聊会话。
func (s *ChatService) EnsureTeamConversation(ctx context.Context, userID, teamID int64) (*dto.ChatConversationVO, error) {
	member, err := s.repo.IsTeamMember(ctx, teamID, userID)
	if err != nil {
		return nil, err
	}
	if !member {
		return nil, ErrChatNotMember
	}
	conv, err := s.repo.EnsureTeamConversation(ctx, teamID, "", userID)
	if err != nil {
		return nil, err
	}
	return s.loadConversationVO(ctx, conv.ID, userID)
}

// GetHistory 校验成员资格后倒序拉取历史，并按时间升序返回（便于前端追加渲染）。
func (s *ChatService) GetHistory(ctx context.Context, userID, convID int64, beforeID *int64, limit int) ([]dto.ChatMessageVO, error) {
	if err := s.assertMember(ctx, convID, userID); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListMessages(ctx, convID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]dto.ChatMessageVO, 0, len(rows))
	// 数据库按 id DESC 返回，反转为升序。
	for i := len(rows) - 1; i >= 0; i-- {
		out = append(out, messageRowToVO(&rows[i]))
	}
	return out, nil
}

// GetMembers 校验成员资格后返回会话成员列表。
func (s *ChatService) GetMembers(ctx context.Context, userID, convID int64) ([]dto.ChatMemberVO, error) {
	if err := s.assertMember(ctx, convID, userID); err != nil {
		return nil, err
	}
	return s.members(ctx, convID)
}

// SendMessage 校验成员资格后落库消息，更新会话活跃时间，并向全体成员实时扇出。
func (s *ChatService) SendMessage(ctx context.Context, userID, convID int64, req dto.SendMessageRequest) (*dto.ChatMessageVO, error) {
	if err := s.assertMember(ctx, convID, userID); err != nil {
		return nil, err
	}
	msgType := strings.ToUpper(strings.TrimSpace(req.MessageType))
	if msgType == "" {
		msgType = model.ChatMsgText
	}
	if msgType == model.ChatMsgText {
		if strings.TrimSpace(req.Content) == "" {
			return nil, ErrChatBadMessage
		}
	} else if strings.TrimSpace(req.AttachmentURL) == "" {
		return nil, ErrChatBadMessage
	}

	m := &model.ChatMessage{
		ConversationID: convID,
		SenderID:       &userID,
		SenderType:     model.ChatSenderUser,
		MessageType:    msgType,
		Content:        strPtr(req.Content),
		AttachmentURL:  strPtr(req.AttachmentURL),
		AttachmentName: strPtr(req.AttachmentName),
		AttachmentMime: strPtr(req.AttachmentMime),
		ReplyToID:      req.ReplyToID,
		ClientMsgID:    strPtr(req.ClientMsgID),
		AttachmentMeta: metaToJSON(req.AttachmentMeta),
	}
	if req.AttachmentSize > 0 {
		m.AttachmentSize = &req.AttachmentSize
	}

	saved, created, err := s.repo.InsertMessage(ctx, m)
	if err != nil {
		return nil, err
	}
	row, err := s.repo.GetMessageRow(ctx, saved.ID)
	if err != nil || row == nil {
		// 落库成功但回查失败：返回最小可用 VO，不阻断发送。
		vo := messageModelToVO(saved)
		return &vo, nil
	}
	vo := messageRowToVO(row)

	if created {
		_ = s.repo.TouchConversation(ctx, convID, saved.CreatedAt)
		s.broadcast(ctx, convID, realtime.Event{Type: "message", ConversationID: convID, Payload: vo})
	}
	return &vo, nil
}

// MarkRead 推进已读位点并向其他成员广播已读回执。
func (s *ChatService) MarkRead(ctx context.Context, userID, convID, messageID int64) error {
	if err := s.assertMember(ctx, convID, userID); err != nil {
		return err
	}
	if err := s.repo.MarkRead(ctx, convID, userID, messageID); err != nil {
		return err
	}
	s.broadcastExcept(ctx, convID, userID, realtime.Event{
		Type:           "read",
		ConversationID: convID,
		Payload:        map[string]any{"userId": userID, "messageId": messageID},
	})
	return nil
}

// HandleTyping 处理「正在输入」信令：校验成员资格后向其他成员广播（不落库）。
func (s *ChatService) HandleTyping(ctx context.Context, userID, convID int64, typing bool) {
	if err := s.assertMember(ctx, convID, userID); err != nil {
		return
	}
	s.broadcastExcept(ctx, convID, userID, realtime.Event{
		Type:           "typing",
		ConversationID: convID,
		Payload:        map[string]any{"userId": userID, "typing": typing},
	})
}

// BroadcastPresence 在用户上线 / 下线时，向其聊天对端广播在线状态。
func (s *ChatService) BroadcastPresence(ctx context.Context, userID int64, online bool) {
	if s.hub == nil {
		return
	}
	peers, err := s.repo.PeerUserIDs(ctx, userID)
	if err != nil || len(peers) == 0 {
		return
	}
	s.hub.Publish(ctx, peers, realtime.Event{
		Type:    "presence",
		Payload: map[string]any{"userId": userID, "online": online},
	})
}

// GetSettings 返回用户聊天偏好（未设置则返回默认值）。
func (s *ChatService) GetSettings(ctx context.Context, userID int64) (*dto.ChatSettingsVO, error) {
	st, err := s.repo.GetUserSettings(ctx, userID)
	if err != nil {
		return nil, err
	}
	if st == nil {
		return &dto.ChatSettingsVO{ThemeSkin: "aurora", BubbleStyle: "rounded"}, nil
	}
	return settingsToVO(st), nil
}

// UpdateSettings 更新用户聊天偏好（皮肤 / 气泡 / 字体 / 主题色）。
func (s *ChatService) UpdateSettings(ctx context.Context, userID int64, req dto.UpdateChatSettingsRequest) (*dto.ChatSettingsVO, error) {
	current, err := s.repo.GetUserSettings(ctx, userID)
	if err != nil {
		return nil, err
	}
	next := &model.ChatUserSettings{UserID: userID, ThemeSkin: "aurora", BubbleStyle: "rounded"}
	if current != nil {
		next = current
	}
	if req.ThemeSkin != nil {
		next.ThemeSkin = *req.ThemeSkin
	}
	if req.BubbleStyle != nil {
		next.BubbleStyle = *req.BubbleStyle
	}
	if req.FontFamily != nil {
		next.FontFamily = strPtr(*req.FontFamily)
	}
	if req.AccentColor != nil {
		next.AccentColor = strPtr(*req.AccentColor)
	}
	if req.Preferences != nil {
		next.Preferences = metaToJSON(req.Preferences)
	}
	saved, err := s.repo.UpsertUserSettings(ctx, next)
	if err != nil {
		return nil, err
	}
	return settingsToVO(saved), nil
}

// --- 内部辅助 ---

func (s *ChatService) assertMember(ctx context.Context, convID, userID int64) error {
	// 对 TEAM 会话实时回查团队成员资格 —— 被移出团队的用户即刻失去群聊访问权。
	ok, err := s.repo.IsAuthorizedMember(ctx, convID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrChatNotMember
	}
	return nil
}

func (s *ChatService) members(ctx context.Context, convID int64) ([]dto.ChatMemberVO, error) {
	rows, err := s.repo.ListMembers(ctx, convID)
	if err != nil {
		return nil, err
	}
	return memberRowsToVO(rows), nil
}

// memberRowsToVO 把成员行投影转换为对外 VO 列表。
func memberRowsToVO(rows []repository.ChatMemberRow) []dto.ChatMemberVO {
	out := make([]dto.ChatMemberVO, 0, len(rows))
	for _, m := range rows {
		out = append(out, dto.ChatMemberVO{
			UserID:     m.UserID,
			Username:   m.Username,
			Nickname:   m.Nickname,
			Avatar:     m.Avatar,
			MemberRole: m.MemberRole,
			Muted:      m.Muted,
		})
	}
	return out
}

func (s *ChatService) broadcast(ctx context.Context, convID int64, ev realtime.Event) {
	if s.hub == nil {
		return
	}
	ids, err := s.repo.ActiveMemberUserIDs(ctx, convID)
	if err != nil {
		return
	}
	s.hub.Publish(ctx, ids, ev)
}

func (s *ChatService) broadcastExcept(ctx context.Context, convID, exclude int64, ev realtime.Event) {
	if s.hub == nil {
		return
	}
	ids, err := s.repo.ActiveMemberUserIDs(ctx, convID)
	if err != nil {
		return
	}
	targets := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id != exclude {
			targets = append(targets, id)
		}
	}
	if len(targets) > 0 {
		s.hub.Publish(ctx, targets, ev)
	}
}

func (s *ChatService) loadConversationVO(ctx context.Context, convID, userID int64) (*dto.ChatConversationVO, error) {
	conv, err := s.repo.FindConversation(ctx, convID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return nil, ErrChatConvNotFound
	}
	members, err := s.members(ctx, convID)
	if err != nil {
		return nil, err
	}
	row := &repository.ChatConversationListRow{ChatConversation: *conv}
	vo := s.buildConversationVO(row, userID, members)
	return &vo, nil
}

// buildConversationVO 把会话行 + 已加载的成员装配成对外 VO，并解析展示标题：
//   - DIRECT：取对端用户的昵称 / 用户名
//   - TEAM / GROUP：取会话标题（缺省留空，前端兜底显示团队名）
//
// 成员由调用方传入（列表场景批量加载，单条场景单独加载），本函数不再触发查询。
func (s *ChatService) buildConversationVO(row *repository.ChatConversationListRow, userID int64, members []dto.ChatMemberVO) dto.ChatConversationVO {
	title := ""
	if row.Title != nil {
		title = *row.Title
	}
	if row.Kind == model.ChatKindDirect {
		for _, m := range members {
			if m.UserID != userID {
				if m.Nickname != nil && *m.Nickname != "" {
					title = *m.Nickname
				} else {
					title = m.Username
				}
				break
			}
		}
	}
	vo := dto.ChatConversationVO{
		ID:            row.ID,
		Kind:          row.Kind,
		TeamID:        row.TeamID,
		Title:         title,
		LastMessageAt: row.LastMessageAt,
		UnreadCount:   row.UnreadCount,
		Members:       members,
		CreatedAt:     row.CreatedAt,
	}
	if row.LastMsgID != nil {
		lm := &dto.ChatMessageVO{
			ID:             *row.LastMsgID,
			ConversationID: row.ID,
			SenderID:       row.LastMsgSenderID,
			MessageType:    derefStr(row.LastMsgType, model.ChatMsgText),
			Content:        row.LastMsgContent,
		}
		if row.LastMsgCreatedAt != nil {
			lm.CreatedAt = *row.LastMsgCreatedAt
		}
		vo.LastMessage = lm
	}
	return vo
}

func messageRowToVO(row *repository.ChatMessageRow) dto.ChatMessageVO {
	vo := messageModelToVO(&row.ChatMessage)
	vo.SenderName = row.SenderName
	vo.SenderAvatar = row.SenderAvatar
	return vo
}

func messageModelToVO(m *model.ChatMessage) dto.ChatMessageVO {
	return dto.ChatMessageVO{
		ID:             m.ID,
		ConversationID: m.ConversationID,
		SenderID:       m.SenderID,
		SenderType:     m.SenderType,
		MessageType:    m.MessageType,
		Content:        m.Content,
		AttachmentURL:  m.AttachmentURL,
		AttachmentName: m.AttachmentName,
		AttachmentMime: m.AttachmentMime,
		AttachmentSize: m.AttachmentSize,
		AttachmentMeta: jsonToMeta(m.AttachmentMeta),
		ReplyToID:      m.ReplyToID,
		ClientMsgID:    m.ClientMsgID,
		EditedAt:       m.EditedAt,
		CreatedAt:      m.CreatedAt,
	}
}

func settingsToVO(s *model.ChatUserSettings) *dto.ChatSettingsVO {
	return &dto.ChatSettingsVO{
		ThemeSkin:   s.ThemeSkin,
		BubbleStyle: s.BubbleStyle,
		FontFamily:  s.FontFamily,
		AccentColor: s.AccentColor,
		Preferences: jsonToMeta(s.Preferences),
	}
}

func derefStr(p *string, fallback string) string {
	if p == nil {
		return fallback
	}
	return *p
}

func metaToJSON(m map[string]any) *string {
	if len(m) == 0 {
		return nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}

func jsonToMeta(p *string) map[string]any {
	if p == nil || *p == "" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(*p), &m); err != nil {
		return nil
	}
	return m
}
