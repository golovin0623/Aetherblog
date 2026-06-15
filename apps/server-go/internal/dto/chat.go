package dto

import "time"

// ChatConversationVO 是会话列表 / 详情的对外视图。
type ChatConversationVO struct {
	ID            int64          `json:"id"`
	Kind          string         `json:"kind"`
	TeamID        *int64         `json:"teamId,omitempty"`
	Title         string         `json:"title"`
	LastMessageAt *time.Time     `json:"lastMessageAt,omitempty"`
	UnreadCount   int64          `json:"unreadCount"`
	Members       []ChatMemberVO `json:"members,omitempty"`
	LastMessage   *ChatMessageVO `json:"lastMessage,omitempty"`
	CreatedAt     time.Time      `json:"createdAt"`
}

// ChatMemberVO 是会话成员视图。
type ChatMemberVO struct {
	UserID     int64   `json:"userId"`
	Username   string  `json:"username"`
	Nickname   *string `json:"nickname,omitempty"`
	Avatar     *string `json:"avatar,omitempty"`
	MemberRole string  `json:"memberRole"`
	Muted      bool    `json:"muted"`
}

// ChatMessageVO 是消息视图。
type ChatMessageVO struct {
	ID             int64          `json:"id"`
	ConversationID int64          `json:"conversationId"`
	SenderID       *int64         `json:"senderId,omitempty"`
	SenderType     string         `json:"senderType"`
	SenderName     *string        `json:"senderName,omitempty"`
	SenderAvatar   *string        `json:"senderAvatar,omitempty"`
	MessageType    string         `json:"messageType"`
	Content        *string        `json:"content,omitempty"`
	AttachmentURL  *string        `json:"attachmentUrl,omitempty"`
	AttachmentName *string        `json:"attachmentName,omitempty"`
	AttachmentMime *string        `json:"attachmentMime,omitempty"`
	AttachmentSize *int64         `json:"attachmentSize,omitempty"`
	AttachmentMeta map[string]any `json:"attachmentMeta,omitempty"`
	ReplyToID      *int64         `json:"replyToId,omitempty"`
	ClientMsgID    *string        `json:"clientMsgId,omitempty"`
	EditedAt       *time.Time     `json:"editedAt,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
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
