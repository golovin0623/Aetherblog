package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// Agent 领域哨兵错误。
var (
	ErrAgentNotFound  = errors.New("Agent 不存在")
	ErrAgentForbidden = errors.New("无权操作该 Agent")
	ErrAgentScope     = errors.New("Agent 可见范围设置不合法")
)

// ChatActor 是发起 Agent 操作的调用者快照（解耦 echo / JWT）。
type ChatActor struct {
	UserID  int64
	IsAdmin bool
}

// ChatAgentService 编排 Agent 的管理（CRUD）、入座会话与以 Agent 身份发言。
//
// 权限模型：
//   - 创建 GLOBAL Agent 需管理员；TEAM 需为该团队活跃成员；PRIVATE 任意登录用户。
//   - 编辑 / 删除：创建者本人或管理员。
//   - 入座 / 发言：调用者须为会话成员，且 Agent 对其可见 / 已活跃入座。
type ChatAgentService struct {
	repo     *repository.ChatAgentRepo
	chatRepo *repository.ChatRepo
	chat     *ChatService
}

// NewChatAgentService 创建 ChatAgentService。
func NewChatAgentService(repo *repository.ChatAgentRepo, chatRepo *repository.ChatRepo, chat *ChatService) *ChatAgentService {
	return &ChatAgentService{repo: repo, chatRepo: chatRepo, chat: chat}
}

// ListAgents 返回调用者可见的 Agent 列表。
func (s *ChatAgentService) ListAgents(ctx context.Context, actor ChatActor) ([]dto.ChatAgentVO, error) {
	agents, err := s.repo.ListAgentsForUser(ctx, actor.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.ChatAgentVO, 0, len(agents))
	for i := range agents {
		out = append(out, agentToVO(&agents[i], s.canManage(&agents[i], actor)))
	}
	return out, nil
}

// CreateAgent 创建 Agent，按 scope 校验权限。
func (s *ChatAgentService) CreateAgent(ctx context.Context, actor ChatActor, req dto.CreateAgentRequest) (*dto.ChatAgentVO, error) {
	scope := strings.ToUpper(strings.TrimSpace(req.Scope))
	if scope == "" {
		scope = model.ChatAgentScopePrivate
	}
	switch scope {
	case model.ChatAgentScopeGlobal:
		if !actor.IsAdmin {
			return nil, ErrAgentForbidden
		}
	case model.ChatAgentScopeTeam:
		if req.TeamID == nil {
			return nil, ErrAgentScope
		}
		member, err := s.chatRepo.IsTeamMember(ctx, *req.TeamID, actor.UserID)
		if err != nil {
			return nil, err
		}
		if !member && !actor.IsAdmin {
			return nil, ErrAgentForbidden
		}
	case model.ChatAgentScopePrivate:
		// 任意登录用户可建私有 Agent。
	default:
		return nil, ErrAgentScope
	}

	slug, err := s.uniqueSlug(ctx, req.Name)
	if err != nil {
		return nil, err
	}
	a := &model.ChatAgent{
		Name:         strings.TrimSpace(req.Name),
		Slug:         slug,
		Avatar:       strPtr(req.Avatar),
		Description:  strPtr(req.Description),
		ProviderCode: strPtr(req.ProviderCode),
		ModelID:      strPtr(req.ModelID),
		SystemPrompt: strPtr(req.SystemPrompt),
		Scope:        scope,
		Status:       model.ChatAgentActive,
		CreatedBy:    &actor.UserID,
	}
	if scope == model.ChatAgentScopeTeam {
		a.TeamID = req.TeamID
	}
	created, err := s.repo.CreateAgent(ctx, a)
	if err != nil {
		return nil, err
	}
	vo := agentToVO(created, true)
	return &vo, nil
}

// UpdateAgent 更新 Agent 可变字段（创建者或管理员）。
func (s *ChatAgentService) UpdateAgent(ctx context.Context, actor ChatActor, id int64, req dto.UpdateAgentRequest) (*dto.ChatAgentVO, error) {
	a, err := s.repo.FindAgent(ctx, id)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, ErrAgentNotFound
	}
	if !s.canManage(a, actor) {
		return nil, ErrAgentForbidden
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
		a.Name = strings.TrimSpace(*req.Name)
	}
	if req.Avatar != nil {
		a.Avatar = strPtr(*req.Avatar)
	}
	if req.Description != nil {
		a.Description = strPtr(*req.Description)
	}
	if req.ProviderCode != nil {
		a.ProviderCode = strPtr(*req.ProviderCode)
	}
	if req.ModelID != nil {
		a.ModelID = strPtr(*req.ModelID)
	}
	if req.SystemPrompt != nil {
		a.SystemPrompt = strPtr(*req.SystemPrompt)
	}
	if req.Status != nil && (*req.Status == model.ChatAgentActive || *req.Status == model.ChatAgentDisabled) {
		a.Status = *req.Status
	}
	updated, err := s.repo.UpdateAgent(ctx, a)
	if err != nil {
		return nil, err
	}
	vo := agentToVO(updated, true)
	return &vo, nil
}

// DeleteAgent 删除 Agent（创建者或管理员）。
func (s *ChatAgentService) DeleteAgent(ctx context.Context, actor ChatActor, id int64) error {
	a, err := s.repo.FindAgent(ctx, id)
	if err != nil {
		return err
	}
	if a == nil {
		return ErrAgentNotFound
	}
	if !s.canManage(a, actor) {
		return ErrAgentForbidden
	}
	return s.repo.DeleteAgent(ctx, id)
}

// ListConversationAgents 返回会话中活跃入座的 Agent（调用者须为会话成员）。
func (s *ChatAgentService) ListConversationAgents(ctx context.Context, actor ChatActor, convID int64) ([]dto.ChatAgentVO, error) {
	if err := s.chat.assertMember(ctx, convID, actor.UserID); err != nil {
		return nil, err
	}
	agents, err := s.repo.ListConversationAgents(ctx, convID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.ChatAgentVO, 0, len(agents))
	for i := range agents {
		out = append(out, agentToVO(&agents[i], s.canManage(&agents[i], actor)))
	}
	return out, nil
}

// SeatAgent 把 Agent 纳入会话并写入系统提示。
func (s *ChatAgentService) SeatAgent(ctx context.Context, actor ChatActor, convID, agentID int64) (*dto.ChatAgentVO, error) {
	if err := s.chat.assertMember(ctx, convID, actor.UserID); err != nil {
		return nil, err
	}
	a, err := s.repo.FindAgent(ctx, agentID)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, ErrAgentNotFound
	}
	if a.Status != model.ChatAgentActive {
		return nil, ErrAgentForbidden
	}
	visible, err := s.repo.IsAgentVisibleTo(ctx, agentID, actor.UserID)
	if err != nil {
		return nil, err
	}
	if !visible {
		return nil, ErrAgentForbidden
	}
	if err := s.repo.AddConversationAgent(ctx, convID, agentID, actor.UserID); err != nil {
		return nil, err
	}
	_, _ = s.chat.SystemMessage(ctx, convID, fmt.Sprintf("智能体「%s」已加入会话", a.Name))
	vo := agentToVO(a, s.canManage(a, actor))
	return &vo, nil
}

// UnseatAgent 让 Agent 离席并写入系统提示。
func (s *ChatAgentService) UnseatAgent(ctx context.Context, actor ChatActor, convID, agentID int64) error {
	if err := s.chat.assertMember(ctx, convID, actor.UserID); err != nil {
		return err
	}
	a, err := s.repo.FindAgent(ctx, agentID)
	if err != nil {
		return err
	}
	if a == nil {
		return ErrAgentNotFound
	}
	if err := s.repo.RemoveConversationAgent(ctx, convID, agentID); err != nil {
		return err
	}
	_, _ = s.chat.SystemMessage(ctx, convID, fmt.Sprintf("智能体「%s」已离开会话", a.Name))
	return nil
}

// PostAgentMessage 以 Agent 身份在会话中发言（人工操作；Phase 3 的 AI 自动回复复用此路径）。
func (s *ChatAgentService) PostAgentMessage(ctx context.Context, actor ChatActor, convID, agentID int64, content, clientMsgID string) (*dto.ChatMessageVO, error) {
	if err := s.chat.assertMember(ctx, convID, actor.UserID); err != nil {
		return nil, err
	}
	active, err := s.repo.IsConversationAgentActive(ctx, convID, agentID)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, ErrAgentForbidden
	}
	return s.chat.AgentMessage(ctx, convID, agentID, content, clientMsgID)
}

func (s *ChatAgentService) canManage(a *model.ChatAgent, actor ChatActor) bool {
	if actor.IsAdmin {
		return true
	}
	return a.CreatedBy != nil && *a.CreatedBy == actor.UserID
}

// uniqueSlug 由名称派生一个唯一 slug；冲突时追加短随机后缀。
func (s *ChatAgentService) uniqueSlug(ctx context.Context, name string) (string, error) {
	base := slugify(name)
	if base == "" {
		base = "agent"
	}
	candidate := base
	for i := 0; i < 5; i++ {
		exists, err := s.repo.SlugExists(ctx, candidate)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
		candidate = base + "-" + randomSuffix()
	}
	// 极端冲突兜底：纯随机。
	return "agent-" + randomSuffix() + randomSuffix(), nil
}

func randomSuffix() string {
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "x1y2z3"
	}
	return hex.EncodeToString(b)
}

func agentToVO(a *model.ChatAgent, canManage bool) dto.ChatAgentVO {
	return dto.ChatAgentVO{
		ID:           a.ID,
		Name:         a.Name,
		Slug:         a.Slug,
		Avatar:       a.Avatar,
		Description:  a.Description,
		ProviderCode: a.ProviderCode,
		ModelID:      a.ModelID,
		SystemPrompt: a.SystemPrompt,
		Scope:        a.Scope,
		TeamID:       a.TeamID,
		Status:       a.Status,
		CreatedBy:    a.CreatedBy,
		CanManage:    canManage,
		CreatedAt:    a.CreatedAt,
	}
}
