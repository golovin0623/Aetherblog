// Package service · agent_session_service.go — 灵境会话云同步业务层。
//
// 职责：
//   - 输入校验（id 形态 ^[A-Za-z0-9_-]{8,64}$、mode/role 白名单、时间戳与
//     消息数量上限、单条 content / draft 长度上限、JSON 字段合法性）与
//     单用户会话数配额（新建路径 ≥500 拒绝）—— 违规返回
//     AgentSessionValidationError 包装（handler 层映射 400）。
//   - 归属与 LWW 语义翻译：repo 的 ErrAgentSessionNotOwned → 统一"不存在"
//     （handler 404，不泄露存在性）；ErrAgentSessionConflict → 加载服务端版本
//     供 handler 以 409 回传。
//   - model ↔ dto 转换（JSONB text ↔ json.RawMessage、客户端毫秒时间戳直通）。
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"unicode/utf8"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// AgentSessionStore 抽象 repo 依赖，便于 handler 测试注入内存实现。
// 语义契约见 repository.AgentSessionRepo。
type AgentSessionStore interface {
	ListByUser(ctx context.Context, userID int64, limit int) ([]model.AgentChatSessionListRow, error)
	GetByIDForUser(ctx context.Context, id string, userID int64) (*model.AgentChatSession, []model.AgentChatMessage, error)
	CountByUser(ctx context.Context, userID int64) (int, error)
	Upsert(ctx context.Context, s *model.AgentChatSession, msgs []model.AgentChatMessage) error
	Delete(ctx context.Context, id string, userID int64) (bool, error)
}

// agentSessionIDPattern 校验客户端生成的会话 / 消息 id
// （uuid 或 sess_/msg_ 前缀串均满足）。
var agentSessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// AgentSessionValidationError 表示请求形态非法（handler 映射 400）。
type AgentSessionValidationError struct{ Reason string }

func (e *AgentSessionValidationError) Error() string { return e.Reason }

func invalidAgentSession(format string, args ...any) error {
	return &AgentSessionValidationError{Reason: fmt.Sprintf(format, args...)}
}

// AgentSessionConflictError 表示 LWW 冲突，Server 携带库内更新的完整版本
// （handler 以 409 + data=Server 回传）。
type AgentSessionConflictError struct{ Server *dto.AgentSessionVO }

func (e *AgentSessionConflictError) Error() string { return "agent session conflict" }

// 会话同步的服务端硬上限。
const (
	agentSessionMaxMessages     = 2000           // 单会话消息数上限
	agentSessionMaxTitleRunes   = 300            // 标题长度上限（rune）
	agentSessionMaxContentRunes = 64 * 1024      // 单条消息 content 长度上限（rune）
	agentSessionMaxDraftRunes   = 16 * 1024      // 草稿长度上限（rune）
	agentSessionMaxPerUser      = 500            // 单用户会话数配额（新建路径校验）
	agentSessionMaxTimestampMS  = 32503680000000 // 3000-01-01，拦截明显非法的客户端时钟
	AgentSessionDefaultLimit    = 100            // 列表默认条数
	AgentSessionMaxLimit        = 500            // 列表条数硬上限
)

// AgentSessionService 灵境会话云同步业务层。
type AgentSessionService struct{ store AgentSessionStore }

// NewAgentSessionService 创建 AgentSessionService。
func NewAgentSessionService(store AgentSessionStore) *AgentSessionService {
	return &AgentSessionService{store: store}
}

// ValidAgentSessionID 判断 id 是否满足客户端 id 契约。
func ValidAgentSessionID(id string) bool { return agentSessionIDPattern.MatchString(id) }

// List 返回用户的会话列表（不含消息正文，含 messageCount）。
func (s *AgentSessionService) List(ctx context.Context, userID int64, limit int) ([]dto.AgentSessionMetaVO, error) {
	if limit <= 0 {
		limit = AgentSessionDefaultLimit
	}
	if limit > AgentSessionMaxLimit {
		limit = AgentSessionMaxLimit
	}
	rows, err := s.store.ListByUser(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentSessionMetaVO, 0, len(rows))
	for i := range rows {
		out = append(out, toAgentSessionMetaVO(&rows[i].AgentChatSession, int(rows[i].MessageCount)))
	}
	return out, nil
}

// Get 返回单会话详情（含全量消息，按 seq 升序）。
// 不存在 / 归属他人返回 (nil, nil) —— handler 统一 404。
func (s *AgentSessionService) Get(ctx context.Context, id string, userID int64) (*dto.AgentSessionVO, error) {
	if !ValidAgentSessionID(id) {
		return nil, invalidAgentSession("会话 id 非法")
	}
	sess, msgs, err := s.store.GetByIDForUser(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if sess == nil {
		return nil, nil
	}
	vo := toAgentSessionVO(sess, msgs)
	return &vo, nil
}

// Upsert 整会话 upsert。成功返回落库后的 meta（含 messageCount）。
// LWW 冲突返回 *AgentSessionConflictError（携带服务端版本）；
// 会话 id 被他人占用返回 (nil, nil) —— handler 统一 404。
func (s *AgentSessionService) Upsert(ctx context.Context, id string, userID int64, req *dto.AgentSessionUpsertRequest) (*dto.AgentSessionMetaVO, error) {
	sess, msgs, err := s.buildUpsertModels(id, userID, req)
	if err != nil {
		return nil, err
	}
	// 会话数配额（P2-G）：仅约束「新建」路径 —— 已存在会话的更新即使在配额
	// 满时也必须放行，否则用户连清理旧会话前的正常同步都会被卡死。常规路径
	// 只多一次 COUNT；达到配额才用 Get 探测是否为更新（低频路径）。
	// 目标 id 被他人占用时同样回配额错：与"id 空闲"响应一致，不泄露存在性。
	//
	// ⚠️ 这是**软闸，不是强不变量**（有意为之，别当强约束依赖）：
	// CountByUser 与随后的 Upsert 不在同一事务里，存在 TOCTOU 窗口 ——
	// 同一用户并发 PUT 多个**新** id 时都可能读到 count < 500 后各自落库，
	// 短暂突破 500。这个闸的目的只是「防单账号无限增长失控」，不是精确计费，
	// 超限也是常数量级（并发度）而非无界；下一次写入 COUNT 就会看到真实值并
	// 自然收敛，用户删几条即可恢复。
	//
	// 刻意不用 SELECT ... FOR UPDATE / 咨询锁把它做成强不变量：那会给每次
	// 会话同步（前端每次消息落地都 PUT）加一把用户级写锁，把双设备并发同步
	// 串行化，代价远大于「偶尔多几条会话」的收益。真要做强上限，正确位置是
	// DB 侧约束或配额表，而不是在这条热路径上加锁。
	count, err := s.store.CountByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if count >= agentSessionMaxPerUser {
		existing, _, gerr := s.store.GetByIDForUser(ctx, id, userID)
		if gerr != nil {
			return nil, gerr
		}
		if existing == nil {
			return nil, invalidAgentSession("会话数量已达上限（%d），请删除部分旧对话后重试", agentSessionMaxPerUser)
		}
	}
	if err := s.store.Upsert(ctx, sess, msgs); err != nil {
		switch err {
		case repository.ErrAgentSessionNotOwned:
			return nil, nil
		case repository.ErrAgentSessionConflict:
			server, serverMsgs, gerr := s.store.GetByIDForUser(ctx, id, userID)
			if gerr != nil || server == nil {
				// 服务端版本加载失败：退化为不带 data 的冲突，让客户端下次 GET 自取。
				return nil, &AgentSessionConflictError{Server: nil}
			}
			vo := toAgentSessionVO(server, serverMsgs)
			return nil, &AgentSessionConflictError{Server: &vo}
		default:
			return nil, err
		}
	}
	meta := toAgentSessionMetaVO(sess, len(msgs))
	return &meta, nil
}

// Delete 删除会话。返回 false 表示不存在 / 归属他人（handler 统一 404）。
func (s *AgentSessionService) Delete(ctx context.Context, id string, userID int64) (bool, error) {
	if !ValidAgentSessionID(id) {
		return false, invalidAgentSession("会话 id 非法")
	}
	return s.store.Delete(ctx, id, userID)
}

// buildUpsertModels 校验请求并转换为存储模型（seq 按数组下标重排）。
func (s *AgentSessionService) buildUpsertModels(id string, userID int64, req *dto.AgentSessionUpsertRequest) (*model.AgentChatSession, []model.AgentChatMessage, error) {
	if !ValidAgentSessionID(id) {
		return nil, nil, invalidAgentSession("会话 id 非法")
	}
	if req == nil {
		return nil, nil, invalidAgentSession("请求体缺失")
	}
	mode := req.Mode
	if mode == "" {
		mode = model.AgentSessionModeChat
	}
	switch mode {
	case model.AgentSessionModeChat, model.AgentSessionModeCowork, model.AgentSessionModeCode:
	default:
		return nil, nil, invalidAgentSession("mode 非法：%s", mode)
	}
	if req.CreatedAt <= 0 || req.CreatedAt > agentSessionMaxTimestampMS {
		return nil, nil, invalidAgentSession("createdAt 非法")
	}
	if req.UpdatedAt <= 0 || req.UpdatedAt > agentSessionMaxTimestampMS {
		return nil, nil, invalidAgentSession("updatedAt 非法")
	}
	if len(req.Messages) > agentSessionMaxMessages {
		return nil, nil, invalidAgentSession("消息数超过上限 %d", agentSessionMaxMessages)
	}
	title := req.Title
	if runes := []rune(title); len(runes) > agentSessionMaxTitleRunes {
		title = string(runes[:agentSessionMaxTitleRunes])
	}
	// 草稿超限直接 400（P2-G）—— 不做静默截断：draft 是用户未发送的输入，
	// 截断等于丢数据，让客户端显式感知并处理。
	if utf8.RuneCountInString(req.Draft) > agentSessionMaxDraftRunes {
		return nil, nil, invalidAgentSession("draft 超过上限（%d 字符）", agentSessionMaxDraftRunes)
	}
	modelParams, err := normalizeRawJSON(req.ModelParams, "modelParams")
	if err != nil {
		return nil, nil, err
	}
	if req.ContextBreakID != nil && !ValidAgentSessionID(*req.ContextBreakID) {
		return nil, nil, invalidAgentSession("contextBreakId 非法")
	}

	msgs := make([]model.AgentChatMessage, 0, len(req.Messages))
	seen := make(map[string]struct{}, len(req.Messages))
	for i, m := range req.Messages {
		if !ValidAgentSessionID(m.ID) {
			return nil, nil, invalidAgentSession("第 %d 条消息 id 非法", i+1)
		}
		if _, dup := seen[m.ID]; dup {
			return nil, nil, invalidAgentSession("消息 id 重复：%s", m.ID)
		}
		seen[m.ID] = struct{}{}
		if m.Role != "user" && m.Role != "assistant" {
			return nil, nil, invalidAgentSession("第 %d 条消息 role 非法", i+1)
		}
		// 单条消息 content 硬上限（P2-G）：4MB body 闸只限整包，单条超长
		// 消息仍能把列表 / 详情响应与 LWW 冲突回传撑到不可用。
		if utf8.RuneCountInString(m.Content) > agentSessionMaxContentRunes {
			return nil, nil, invalidAgentSession("第 %d 条消息 content 超过上限（%d 字符）", i+1, agentSessionMaxContentRunes)
		}
		if m.CreatedAt <= 0 || m.CreatedAt > agentSessionMaxTimestampMS {
			return nil, nil, invalidAgentSession("第 %d 条消息 createdAt 非法", i+1)
		}
		payload, err := normalizeRawJSON(m.Payload, fmt.Sprintf("第 %d 条消息 payload", i+1))
		if err != nil {
			return nil, nil, err
		}
		msgs = append(msgs, model.AgentChatMessage{
			ID:        m.ID,
			SessionID: id,
			Seq:       i,
			Role:      m.Role,
			Content:   m.Content,
			Payload:   payload,
			CreatedAt: m.CreatedAt,
		})
	}

	return &model.AgentChatSession{
		ID:              id,
		UserID:          userID,
		Title:           title,
		Mode:            mode,
		ModelID:         req.ModelID,
		ProviderCode:    req.ProviderCode,
		ModelParams:     modelParams,
		Pinned:          req.Pinned,
		ContextBreakID:  req.ContextBreakID,
		Draft:           req.Draft,
		ClientCreatedAt: req.CreatedAt,
		ClientUpdatedAt: req.UpdatedAt,
	}, msgs, nil
}

// normalizeRawJSON 把透传 JSON 规范化为 *string（nil = SQL NULL）。
// 显式 JSON null 与缺省一律归一为 NULL；非法 JSON 返回 400 语义错误。
func normalizeRawJSON(raw json.RawMessage, field string) (*string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if !json.Valid(raw) {
		return nil, invalidAgentSession("%s 不是合法 JSON", field)
	}
	s := string(raw)
	if s == "null" {
		return nil, nil
	}
	return &s, nil
}

// toAgentSessionMetaVO 存储模型 → meta VO。
func toAgentSessionMetaVO(s *model.AgentChatSession, messageCount int) dto.AgentSessionMetaVO {
	var params json.RawMessage
	if s.ModelParams != nil {
		params = json.RawMessage(*s.ModelParams)
	}
	return dto.AgentSessionMetaVO{
		ID:             s.ID,
		Title:          s.Title,
		Mode:           s.Mode,
		ModelID:        s.ModelID,
		ProviderCode:   s.ProviderCode,
		ModelParams:    params,
		Pinned:         s.Pinned,
		ContextBreakID: s.ContextBreakID,
		Draft:          s.Draft,
		CreatedAt:      s.ClientCreatedAt,
		UpdatedAt:      s.ClientUpdatedAt,
		MessageCount:   messageCount,
	}
}

// toAgentSessionVO 存储模型 → 详情 VO（含消息）。
func toAgentSessionVO(s *model.AgentChatSession, msgs []model.AgentChatMessage) dto.AgentSessionVO {
	out := dto.AgentSessionVO{
		AgentSessionMetaVO: toAgentSessionMetaVO(s, len(msgs)),
		Messages:           make([]dto.AgentSessionMessageVO, 0, len(msgs)),
	}
	for _, m := range msgs {
		var payload json.RawMessage
		if m.Payload != nil {
			payload = json.RawMessage(*m.Payload)
		}
		out.Messages = append(out.Messages, dto.AgentSessionMessageVO{
			ID:        m.ID,
			Role:      m.Role,
			Content:   m.Content,
			CreatedAt: m.CreatedAt,
			Payload:   payload,
		})
	}
	return out
}
