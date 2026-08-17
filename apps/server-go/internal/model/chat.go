package model

import (
	"time"

	"github.com/lib/pq"
)

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

// Agent 可见范围。
const (
	ChatAgentScopePrivate = "PRIVATE" // 仅创建者可见 / 使用
	ChatAgentScopeTeam    = "TEAM"    // 所属团队的活跃成员可见
	ChatAgentScopeGlobal  = "GLOBAL"  // 全站可见（创建需管理员）
)

// Agent 状态。
const (
	ChatAgentActive   = "ACTIVE"
	ChatAgentDisabled = "DISABLED"
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
	ConversationID    int64      `db:"conversation_id"`
	UserID            int64      `db:"user_id"`
	MemberRole        string     `db:"member_role"`
	LastReadMessageID *int64     `db:"last_read_message_id"`
	Muted             bool       `db:"muted"`
	PinnedAt          *time.Time `db:"pinned_at"` // 会话置顶时间（NULL = 未置顶），000087
	JoinedAt          time.Time  `db:"joined_at"`
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
	ReplyToID      *int64        `db:"reply_to_id"`
	ClientMsgID    *string       `db:"client_msg_id"`
	AgentID        *int64        `db:"agent_id"` // sender_type='AGENT' 时归属的 Agent
	Mentions       pq.Int64Array `db:"mentions"` // @提及的用户 id 集合，000087
	EditedAt       *time.Time    `db:"edited_at"`
	RecalledAt     *time.Time    `db:"recalled_at"` // 软撤回时间（保留占位行），000087
	DeletedAt      *time.Time    `db:"deleted_at"`
	CreatedAt      time.Time     `db:"created_at"`
}

// ChatMessageReaction 对应 chat_message_reactions 表，一条 = 某用户对某消息的一个表情回应。
type ChatMessageReaction struct {
	MessageID int64     `db:"message_id"`
	UserID    int64     `db:"user_id"`
	Emoji     string    `db:"emoji"`
	CreatedAt time.Time `db:"created_at"`
}

// ChatAgent 对应 chat_agents 表，表示一个可被纳入聊天的智能体。
type ChatAgent struct {
	ID           int64     `db:"id"`
	Name         string    `db:"name"`
	Slug         string    `db:"slug"`
	Avatar       *string   `db:"avatar"`
	Description  *string   `db:"description"`
	ProviderCode *string   `db:"provider_code"`
	ModelID      *string   `db:"model_id"`
	SystemPrompt *string   `db:"system_prompt"`
	Scope        string    `db:"scope"`
	TeamID       *int64    `db:"team_id"`
	Status       string    `db:"status"`
	CreatedBy    *int64    `db:"created_by"`
	CreatedAt    time.Time `db:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"`
}

// ChatConversationAgent 对应 chat_conversation_agents 表，表示 Agent 在会话中的入座关系。
type ChatConversationAgent struct {
	ConversationID int64     `db:"conversation_id"`
	AgentID        int64     `db:"agent_id"`
	AddedBy        *int64    `db:"added_by"`
	Status         string    `db:"status"`
	JoinedAt       time.Time `db:"joined_at"`
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
