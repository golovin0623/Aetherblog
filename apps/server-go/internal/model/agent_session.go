package model

import "time"

// AgentChatSession 对应 `agent_chat_sessions` 表（migration 000089），
// 是灵境 AI 工作台会话的云端持久化实体。id 由客户端生成
// （uuid 或 sess_ 前缀串，^[A-Za-z0-9_-]{8,64}$）。
//
// 时间戳双轨：client_created_at / client_updated_at 为客户端毫秒时间戳
// （主导时钟，LWW 冲突判定用 client_updated_at）；created_at / updated_at
// 为服务端换算出的 TIMESTAMPTZ 视图，仅用于排序与运维排查。
//
// JSONB 字段在 repository 查询时统一以 ::text 扫描为 *string，避免 sqlx
// 直接扫描 JSONB 的兼容性问题（同 agent_workflow 模式）。
type AgentChatSession struct {
	ID              string    `db:"id"`
	UserID          int64     `db:"user_id"`
	Title           string    `db:"title"`
	Mode            string    `db:"mode"` // chat / cowork / code
	ModelID         *string   `db:"model_id"`
	ProviderCode    *string   `db:"provider_code"`
	ModelParams     *string   `db:"model_params"` // JSONB → text
	Pinned          bool      `db:"pinned"`
	ContextBreakID  *string   `db:"context_break_id"`
	Draft           string    `db:"draft"`
	ClientCreatedAt int64     `db:"client_created_at"`
	ClientUpdatedAt int64     `db:"client_updated_at"`
	CreatedAt       time.Time `db:"created_at"`
	UpdatedAt       time.Time `db:"updated_at"`
}

// AgentChatSessionListRow 是列表查询行：会话 meta + 消息数（不拉正文）。
type AgentChatSessionListRow struct {
	AgentChatSession
	MessageCount int64 `db:"message_count"`
}

// AgentChatMessage 对应 `agent_chat_messages` 表。seq 为会话内顺序，
// 整会话 upsert 时由服务端按请求数组下标重排。payload 承载全部可选
// 流式元数据（think/sources/retrieval/usage/attachments 元信息/translation/
// requestSnapshot/error/errorCode/retryable/各时间戳），服务端不解析。
type AgentChatMessage struct {
	ID        string  `db:"id"`
	SessionID string  `db:"session_id"`
	Seq       int     `db:"seq"`
	Role      string  `db:"role"` // user / assistant
	Content   string  `db:"content"`
	Payload   *string `db:"payload"` // JSONB → text
	CreatedAt int64   `db:"created_at"`
}

// Agent 会话模式常量（与前端 AgentMode 对齐）。
const (
	AgentSessionModeChat   = "chat"
	AgentSessionModeCowork = "cowork"
	AgentSessionModeCode   = "code"
)
