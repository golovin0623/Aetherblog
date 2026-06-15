package model

import "time"

// 会话类型常量。
const (
	ChatKindTeam   = "TEAM"   // 团队群聊，绑定 teams.id
	ChatKindDirect = "DIRECT" // 两人私聊
	ChatKindGroup  = "GROUP"  // 预留：临时多人群
)

// 会话成员角色常量。AGENT 为后续智能体入座预留。
const (
	ChatMemberOwner  = "OWNER"
	ChatMemberAdmin  = "ADMIN"
	ChatMemberMember = "MEMBER"
	ChatMemberAgent  = "AGENT"
)

// 消息发送方类型。AGENT / SYSTEM 为智能对话与系统提示预留。
const (
	ChatSenderUser   = "USER"
	ChatSenderAgent  = "AGENT"
	ChatSenderSystem = "SYSTEM"
)

// 消息类型。
const (
	ChatMsgText   = "TEXT"
	ChatMsgImage  = "IMAGE"
	ChatMsgFile   = "FILE"
	ChatMsgVoice  = "VOICE"
	ChatMsgSystem = "SYSTEM"
)

// ChatConversation 对应 chat_conversations 表，表示一条聊天线。
type ChatConversation struct {
	ID            int64      `db:"id"`
	Kind          string     `db:"kind"`
	TeamID        *int64     `db:"team_id"`
	Title         *string    `db:"title"`
	DMKey         *string    `db:"dm_key"`
	CreatedBy     *int64     `db:"created_by"`
	LastMessageAt *time.Time `db:"last_message_at"`
	CreatedAt     time.Time  `db:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at"`
}

// ChatConversationMember 对应 chat_conversation_members 表。
type ChatConversationMember struct {
	ConversationID    int64     `db:"conversation_id"`
	UserID            int64     `db:"user_id"`
	MemberRole        string    `db:"member_role"`
	LastReadMessageID *int64    `db:"last_read_message_id"`
	Muted             bool      `db:"muted"`
	JoinedAt          time.Time `db:"joined_at"`
}

// ChatMessage 对应 chat_messages 表。
type ChatMessage struct {
	ID             int64      `db:"id"`
	ConversationID int64      `db:"conversation_id"`
	SenderID       *int64     `db:"sender_id"`
	SenderType     string     `db:"sender_type"`
	MessageType    string     `db:"message_type"`
	Content        *string    `db:"content"`
	AttachmentURL  *string    `db:"attachment_url"`
	AttachmentName *string    `db:"attachment_name"`
	AttachmentMime *string    `db:"attachment_mime"`
	AttachmentSize *int64     `db:"attachment_size"`
	AttachmentMeta *string    `db:"attachment_meta"` // 原始 JSON 文本，service 层按需解析。
	ReplyToID      *int64     `db:"reply_to_id"`
	ClientMsgID    *string    `db:"client_msg_id"`
	EditedAt       *time.Time `db:"edited_at"`
	DeletedAt      *time.Time `db:"deleted_at"`
	CreatedAt      time.Time  `db:"created_at"`
}

// ChatUserSettings 对应 chat_user_settings 表，持久化用户聊天皮肤偏好。
type ChatUserSettings struct {
	UserID      int64     `db:"user_id"`
	ThemeSkin   string    `db:"theme_skin"`
	BubbleStyle string    `db:"bubble_style"`
	FontFamily  *string   `db:"font_family"`
	AccentColor *string   `db:"accent_color"`
	Preferences *string   `db:"preferences"`
	UpdatedAt   time.Time `db:"updated_at"`
}
