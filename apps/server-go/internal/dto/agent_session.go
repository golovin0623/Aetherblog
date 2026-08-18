package dto

import "encoding/json"

// ============================================================
// /api/v1/agent/sessions —— 灵境会话云同步 DTO
// ============================================================
//
// 同步模型 = 整会话 upsert：PUT 携带 meta + 全量 messages，服务端事务内
// 全量替换；LWW 用客户端毫秒时间戳 updatedAt 判定，库内更新则 409 并在
// data 中回传服务端版本（含 messages），由客户端合并或覆盖本地。
//
// modelParams / 每条消息的 payload 均为服务端不解析的透传 JSON
// （json.RawMessage），与前端 AgentModelParams / AgentMessage 可选元数据对齐。

// AgentSessionMessageVO 是单条消息的传输形态（请求与响应共用同一形状）。
type AgentSessionMessageVO struct {
	ID      string `json:"id"`
	Role    string `json:"role"` // user / assistant
	Content string `json:"content"`
	// CreatedAt 客户端毫秒时间戳。
	CreatedAt int64 `json:"createdAt"`
	// Payload 可选元数据整包（think/sources/retrieval/usage/attachments 元信息
	// (不含 dataUrl)/translation/requestSnapshot/error/errorCode/retryable/
	// startedAt/firstTokenAt/finishedAt）。服务端原样存取。
	Payload json.RawMessage `json:"payload,omitempty"`
}

// AgentSessionMetaVO 是会话 meta（列表项 / PUT 成功响应），不含 messages。
type AgentSessionMetaVO struct {
	ID           string          `json:"id"`
	Title        string          `json:"title"`
	Mode         string          `json:"mode"`
	ModelID      *string         `json:"modelId"`
	ProviderCode *string         `json:"providerCode"`
	ModelParams  json.RawMessage `json:"modelParams,omitempty"`
	Pinned       bool            `json:"pinned"`
	// ContextBreakID 上下文断点消息 id；null = 无断点。
	ContextBreakID *string `json:"contextBreakId"`
	Draft          string  `json:"draft"`
	// CreatedAt / UpdatedAt 客户端毫秒时间戳（UpdatedAt 即 LWW 基准）。
	CreatedAt    int64 `json:"createdAt"`
	UpdatedAt    int64 `json:"updatedAt"`
	MessageCount int   `json:"messageCount"`
}

// AgentSessionVO 是单会话详情：meta + 按 seq 升序的全量消息。
type AgentSessionVO struct {
	AgentSessionMetaVO
	Messages []AgentSessionMessageVO `json:"messages"`
}

// AgentSessionUpsertRequest 是 PUT /v1/agent/sessions/:id 请求体。
// 会话 id 取路径参数；body 为该会话的完整客户端状态。
type AgentSessionUpsertRequest struct {
	Title          string          `json:"title"`
	Mode           string          `json:"mode"`
	ModelID        *string         `json:"modelId"`
	ProviderCode   *string         `json:"providerCode"`
	ModelParams    json.RawMessage `json:"modelParams"`
	Pinned         bool            `json:"pinned"`
	ContextBreakID *string         `json:"contextBreakId"`
	Draft          string          `json:"draft"`
	// CreatedAt / UpdatedAt 客户端毫秒时间戳，必填（>0）。
	// UpdatedAt 同时是 LWW 比较值：库内 client_updated_at 更大 → 409。
	CreatedAt int64                   `json:"createdAt"`
	UpdatedAt int64                   `json:"updatedAt"`
	Messages  []AgentSessionMessageVO `json:"messages"`
}
