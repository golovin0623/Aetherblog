package dto

import "time"

// ChatConversationVO 是会话列表 / 详情的对外视图。
// Pinned / Muted 为**当前调用者**在该会话的偏好；MentionCount 是未读中 @我 的条数（000087）。
type ChatConversationVO struct {
	ID            int64          `json:"id"`
	Kind          string         `json:"kind"`
	TeamID        *int64         `json:"teamId,omitempty"`
	Title         string         `json:"title"`
	LastMessageAt *time.Time     `json:"lastMessageAt,omitempty"`
	UnreadCount   int64          `json:"unreadCount"`
	MentionCount  int64          `json:"mentionCount"`
	Pinned        bool           `json:"pinned"`
	Muted         bool           `json:"muted"`
	Members       []ChatMemberVO `json:"members,omitempty"`
	LastMessage   *ChatMessageVO `json:"lastMessage,omitempty"`
	CreatedAt     time.Time      `json:"createdAt"`
}

// ChatMemberVO 是会话成员视图。LastReadMessageID 供前端渲染已读回执（✓✓）。
type ChatMemberVO struct {
	UserID            int64   `json:"userId"`
	Username          string  `json:"username"`
	Nickname          *string `json:"nickname,omitempty"`
	Avatar            *string `json:"avatar,omitempty"`
	MemberRole        string  `json:"memberRole"`
	Muted             bool    `json:"muted"`
	LastReadMessageID *int64  `json:"lastReadMessageId,omitempty"`
}

// ChatReactionVO 是单条消息上同一表情的聚合回应。
type ChatReactionVO struct {
	Emoji   string  `json:"emoji"`
	UserIDs []int64 `json:"userIds"`
}

// ChatReplyPreviewVO 是被引用消息的预览快照 —— 引用可能落在前端已加载
// 历史页之外，快照让引用块始终可渲染（不可跳转时仅展示）。
type ChatReplyPreviewVO struct {
	SenderName  string `json:"senderName"`
	MessageType string `json:"messageType"`
	Content     string `json:"content,omitempty"`
	Recalled    bool   `json:"recalled,omitempty"`
	Sticker     bool   `json:"sticker,omitempty"`
}

// ChatMessageVO 是消息视图。
type ChatMessageVO struct {
	ID             int64          `json:"id"`
	ConversationID int64          `json:"conversationId"`
	SenderID       *int64         `json:"senderId,omitempty"`
	SenderType     string         `json:"senderType"`
	SenderName     *string        `json:"senderName,omitempty"`
	SenderAvatar   *string        `json:"senderAvatar,omitempty"`
	AgentID        *int64         `json:"agentId,omitempty"` // sender_type='AGENT' 时归属的 Agent
	MessageType    string         `json:"messageType"`
	Content        *string        `json:"content,omitempty"`
	AttachmentURL  *string        `json:"attachmentUrl,omitempty"`
	AttachmentName *string        `json:"attachmentName,omitempty"`
	AttachmentMime *string        `json:"attachmentMime,omitempty"`
	AttachmentSize *int64         `json:"attachmentSize,omitempty"`
	AttachmentMeta map[string]any `json:"attachmentMeta,omitempty"`
	ReplyToID      *int64              `json:"replyToId,omitempty"`
	ReplyPreview   *ChatReplyPreviewVO `json:"replyPreview,omitempty"`
	ClientMsgID    *string             `json:"clientMsgId,omitempty"`
	Mentions       []int64             `json:"mentions,omitempty"`
	Reactions      []ChatReactionVO    `json:"reactions,omitempty"`
	EditedAt       *time.Time          `json:"editedAt,omitempty"`
	RecalledAt     *time.Time          `json:"recalledAt,omitempty"`
	CreatedAt      time.Time           `json:"createdAt"`
}

// OpenDirectRequest 打开 / 创建一条私聊会话。
type OpenDirectRequest struct {
	UserID int64 `json:"userId" validate:"required,gt=0"`
}

// SendMessageRequest 发送消息（REST 兜底通道，与 WebSocket 等价）。
type SendMessageRequest struct {
	MessageType    string         `json:"messageType" validate:"omitempty,oneof=TEXT IMAGE FILE VOICE"`
	Content        string         `json:"content"`
	AttachmentURL  string         `json:"attachmentUrl"`
	AttachmentName string         `json:"attachmentName"`
	AttachmentMime string         `json:"attachmentMime"`
	AttachmentSize int64          `json:"attachmentSize"`
	AttachmentMeta map[string]any `json:"attachmentMeta"`
	ReplyToID      *int64         `json:"replyToId"`
	ClientMsgID    string         `json:"clientMsgId"`
	Mentions       []int64        `json:"mentions" validate:"omitempty,max=32,dive,gt=0"`
}

// EditMessageRequest 编辑消息正文（2 分钟窗口，仅本人文本消息）。
// Mentions 随新文本整体覆盖旧值（service 层过滤为会话真实成员）。
type EditMessageRequest struct {
	Content  string  `json:"content" validate:"required,max=8000"`
	Mentions []int64 `json:"mentions" validate:"omitempty,max=32,dive,gt=0"`
}

// ChatReactionRequest 添加 / 移除消息回应。
type ChatReactionRequest struct {
	Emoji string `json:"emoji" validate:"required,max=32"`
}

// UpdateConvPrefsRequest 更新当前用户的会话偏好；nil 字段不变。
type UpdateConvPrefsRequest struct {
	Pinned *bool `json:"pinned"`
	Muted  *bool `json:"muted"`
}

// ChatConvPrefsVO 返回更新后的会话偏好。
type ChatConvPrefsVO struct {
	Pinned bool `json:"pinned"`
	Muted  bool `json:"muted"`
}

// MarkReadRequest 标记已读位点。
type MarkReadRequest struct {
	MessageID int64 `json:"messageId" validate:"required,gt=0"`
}

// ChatSettingsVO 是用户聊天皮肤偏好视图。
type ChatSettingsVO struct {
	ThemeSkin   string         `json:"themeSkin"`
	BubbleStyle string         `json:"bubbleStyle"`
	FontFamily  *string        `json:"fontFamily,omitempty"`
	AccentColor *string        `json:"accentColor,omitempty"`
	Preferences map[string]any `json:"preferences,omitempty"`
}

// UpdateChatSettingsRequest 更新聊天皮肤偏好。
type UpdateChatSettingsRequest struct {
	ThemeSkin   *string        `json:"themeSkin"`
	BubbleStyle *string        `json:"bubbleStyle"`
	FontFamily  *string        `json:"fontFamily"`
	AccentColor *string        `json:"accentColor"`
	Preferences map[string]any `json:"preferences"`
}

// --- Phase 2: Agent 纳入与管理 ---

// ChatAgentVO 是 Agent 的对外视图。
type ChatAgentVO struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	Slug         string    `json:"slug"`
	Avatar       *string   `json:"avatar,omitempty"`
	Description  *string   `json:"description,omitempty"`
	ProviderCode *string   `json:"providerCode,omitempty"`
	ModelID      *string   `json:"modelId,omitempty"`
	SystemPrompt *string   `json:"systemPrompt,omitempty"`
	Scope        string    `json:"scope"`
	TeamID       *int64    `json:"teamId,omitempty"`
	Status       string    `json:"status"`
	CreatedBy    *int64    `json:"createdBy,omitempty"`
	CanManage    bool      `json:"canManage"` // 当前调用者是否可编辑 / 删除该 Agent
	CreatedAt    time.Time `json:"createdAt"`
}

// CreateAgentRequest 创建 Agent。
type CreateAgentRequest struct {
	Name         string `json:"name" validate:"required,max=100"`
	Avatar       string `json:"avatar"`
	Description  string `json:"description"`
	ProviderCode string `json:"providerCode"`
	ModelID      string `json:"modelId"`
	SystemPrompt string `json:"systemPrompt"`
	Scope        string `json:"scope" validate:"omitempty,oneof=PRIVATE TEAM GLOBAL"`
	TeamID       *int64 `json:"teamId"`
}

// UpdateAgentRequest 更新 Agent（字段为 nil 表示不改）。
type UpdateAgentRequest struct {
	Name         *string `json:"name"`
	Avatar       *string `json:"avatar"`
	Description  *string `json:"description"`
	ProviderCode *string `json:"providerCode"`
	ModelID      *string `json:"modelId"`
	SystemPrompt *string `json:"systemPrompt"`
	Status       *string `json:"status" validate:"omitempty,oneof=ACTIVE DISABLED"`
}

// SeatAgentRequest 把 Agent 入座到会话。
type SeatAgentRequest struct {
	AgentID int64 `json:"agentId" validate:"required,gt=0"`
}

// PostAgentMessageRequest 以 Agent 身份在会话中发言（人工操作 Agent 人设；
// Phase 3 起 AI 自动回复将复用同一服务方法）。
type PostAgentMessageRequest struct {
	Content     string `json:"content" validate:"required"`
	ClientMsgID string `json:"clientMsgId"`
}
