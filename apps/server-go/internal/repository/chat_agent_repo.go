package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// ChatAgentRepo 提供 chat_agents / chat_conversation_agents 的数据访问能力。
type ChatAgentRepo struct{ db *sqlx.DB }

// NewChatAgentRepo 创建 ChatAgentRepo。
func NewChatAgentRepo(db *sqlx.DB) *ChatAgentRepo { return &ChatAgentRepo{db: db} }

// CreateAgent 插入一个 Agent 定义并返回完整记录。
func (r *ChatAgentRepo) CreateAgent(ctx context.Context, a *model.ChatAgent) (*model.ChatAgent, error) {
	var out model.ChatAgent
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO chat_agents (
			name, slug, avatar, description, provider_code, model_id, system_prompt,
			scope, team_id, status, created_by, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		RETURNING *`,
		a.Name, a.Slug, a.Avatar, a.Description, a.ProviderCode, a.ModelID, a.SystemPrompt,
		a.Scope, a.TeamID, a.Status, a.CreatedBy,
	).StructScan(&out)
	return &out, err
}

// FindAgent 按 ID 查询 Agent。未找到返回 (nil, nil)。
func (r *ChatAgentRepo) FindAgent(ctx context.Context, id int64) (*model.ChatAgent, error) {
	var a model.ChatAgent
	err := r.db.GetContext(ctx, &a, `SELECT * FROM chat_agents WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &a, err
}

// UpdateAgent 全量更新可变字段并返回最新记录。
func (r *ChatAgentRepo) UpdateAgent(ctx context.Context, a *model.ChatAgent) (*model.ChatAgent, error) {
	var out model.ChatAgent
	err := r.db.QueryRowxContext(ctx, `
		UPDATE chat_agents SET
			name=$2, avatar=$3, description=$4, provider_code=$5, model_id=$6,
			system_prompt=$7, status=$8, updated_at=CURRENT_TIMESTAMP
		WHERE id=$1
		RETURNING *`,
		a.ID, a.Name, a.Avatar, a.Description, a.ProviderCode, a.ModelID, a.SystemPrompt, a.Status,
	).StructScan(&out)
	return &out, err
}

// DeleteAgent 删除 Agent。会话入座关系经 FK ON DELETE CASCADE 自动清理，
// 历史消息的 agent_id 经 ON DELETE SET NULL 置空（保留消息内容）。
func (r *ChatAgentRepo) DeleteAgent(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM chat_agents WHERE id=$1`, id)
	return err
}

// SlugExists 判断 slug 是否已被占用。
func (r *ChatAgentRepo) SlugExists(ctx context.Context, slug string) (bool, error) {
	var exists bool
	err := r.db.GetContext(ctx, &exists, `SELECT EXISTS(SELECT 1 FROM chat_agents WHERE slug=$1)`, slug)
	return exists, err
}

// ListAgentsForUser 返回用户可见的 Agent：自己创建的（含 DISABLED 便于管理）
// + 全站 GLOBAL（ACTIVE）+ 所属团队的 TEAM（ACTIVE）。
func (r *ChatAgentRepo) ListAgentsForUser(ctx context.Context, userID int64) ([]model.ChatAgent, error) {
	var agents []model.ChatAgent
	err := r.db.SelectContext(ctx, &agents, `
		SELECT a.* FROM chat_agents a
		WHERE a.created_by = $1
		   OR (a.status = 'ACTIVE' AND (
		        a.scope = 'GLOBAL'
		        OR (a.scope = 'TEAM' AND EXISTS(
		            SELECT 1 FROM team_members tm
		            WHERE tm.team_id = a.team_id AND tm.user_id = $1 AND tm.status = 'ACTIVE'
		        ))
		   ))
		ORDER BY a.name`, userID)
	return agents, err
}

// CanUserUseAgent 判断单个用户当前是否有权使用该 Agent（与 ListAgentsForUser 同口径：
// GLOBAL / 创建者本人 / 所属团队活跃成员）。发言前用它复查发起者的实时权限——
// 否则被移出团队的成员（仍是 DIRECT/GROUP 会话成员）仍能以团队 Agent 身份发言。
func (r *ChatAgentRepo) CanUserUseAgent(ctx context.Context, agentID, userID int64) (bool, error) {
	var ok bool
	err := r.db.GetContext(ctx, &ok, `
		SELECT EXISTS(
			SELECT 1 FROM chat_agents a
			WHERE a.id = $1 AND (
			    a.created_by = $2
			    OR (a.status = 'ACTIVE' AND (
			        a.scope = 'GLOBAL'
			        OR (a.scope = 'TEAM' AND EXISTS(
			            SELECT 1 FROM team_members tm
			            WHERE tm.team_id = a.team_id AND tm.user_id = $2 AND tm.status = 'ACTIVE'
			        ))
			    ))
			)
		)`, agentID, userID)
	return ok, err
}

// AllConversationMembersCanUseAgent 判断会话中**每一位有效成员**是否都有权使用该 Agent。
//
// SECURITY: 入座 / 列出 / 发言端点仅校验「会话成员」，因此把 Agent 纳入会话等于
// 让全体成员可用它。若只校验入座发起者的可见性，TEAM 范围 Agent 会被带入含团队外
// 成员的私聊从而泄漏；PRIVATE Agent 会泄漏给会话其他成员。故入座前要求全体成员都满足
// 与 ListAgentsForUser 同口径的可见性（GLOBAL / 创建者本人 / 所属团队活跃成员）。
//
// 「有效成员」口径与 Phase 1 一致：TEAM 会话的 chat_conversation_members 会保留已退出团队
// 的陈旧行（读路径用 team_members 过滤），这里同样排除这些陈旧行——否则团队 Agent 连
// 团队自己的群聊都会因一条陈旧成员行而被拒绝入座。
func (r *ChatAgentRepo) AllConversationMembersCanUseAgent(ctx context.Context, convID, agentID int64) (bool, error) {
	var allAllowed bool
	err := r.db.GetContext(ctx, &allAllowed, `
		SELECT NOT EXISTS(
			SELECT 1
			FROM chat_conversation_members m
			JOIN chat_conversations c ON c.id = m.conversation_id
			CROSS JOIN chat_agents a
			WHERE m.conversation_id = $1 AND a.id = $2
			  -- 只考察有效成员：TEAM 会话排除已退出 / 禁用团队的陈旧成员行
			  AND (c.kind <> 'TEAM' OR EXISTS(
			      SELECT 1 FROM team_members ctm
			      WHERE ctm.team_id = c.team_id AND ctm.user_id = m.user_id AND ctm.status = 'ACTIVE'
			  ))
			  AND NOT (
			      a.created_by = m.user_id
			      OR (a.status = 'ACTIVE' AND (
			          a.scope = 'GLOBAL'
			          OR (a.scope = 'TEAM' AND EXISTS(
			              SELECT 1 FROM team_members tm
			              WHERE tm.team_id = a.team_id AND tm.user_id = m.user_id AND tm.status = 'ACTIVE'
			          ))
			      ))
			  )
		)`, convID, agentID)
	return allAllowed, err
}

// AddConversationAgent 把 Agent 入座到会话（已存在则重新激活）。
func (r *ChatAgentRepo) AddConversationAgent(ctx context.Context, convID, agentID, addedBy int64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO chat_conversation_agents (conversation_id, agent_id, added_by, status)
		VALUES ($1, $2, $3, 'ACTIVE')
		ON CONFLICT (conversation_id, agent_id)
		DO UPDATE SET status='ACTIVE', added_by=EXCLUDED.added_by`, convID, agentID, addedBy)
	return err
}

// RemoveConversationAgent 让 Agent 离席（软禁用，保留历史归属）。
func (r *ChatAgentRepo) RemoveConversationAgent(ctx context.Context, convID, agentID int64) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE chat_conversation_agents SET status='DISABLED'
		WHERE conversation_id=$1 AND agent_id=$2`, convID, agentID)
	return err
}

// IsConversationAgentActive 判断 Agent 是否在会话中处于「可发言」状态：
// 既要求入座关系活跃，也要求 Agent 本身未被禁用（status='ACTIVE'）——
// 否则已入座的 Agent 被 UpdateAgent 改为 DISABLED 后仍能继续发言（绕过吊销）。
func (r *ChatAgentRepo) IsConversationAgentActive(ctx context.Context, convID, agentID int64) (bool, error) {
	var ok bool
	err := r.db.GetContext(ctx, &ok, `
		SELECT EXISTS(
			SELECT 1 FROM chat_conversation_agents ca
			JOIN chat_agents a ON a.id = ca.agent_id
			WHERE ca.conversation_id=$1 AND ca.agent_id=$2
			  AND ca.status='ACTIVE' AND a.status='ACTIVE'
		)`, convID, agentID)
	return ok, err
}

// IsSeatActive 只检查入座行本身是否活跃（不复查 Agent 全局 status）——
// 供 Seat/Unseat 的幂等判断使用（避免重复入座 / 重复系统消息；且能清理已禁用 Agent 的残留座位）。
func (r *ChatAgentRepo) IsSeatActive(ctx context.Context, convID, agentID int64) (bool, error) {
	var ok bool
	err := r.db.GetContext(ctx, &ok, `
		SELECT EXISTS(
			SELECT 1 FROM chat_conversation_agents
			WHERE conversation_id=$1 AND agent_id=$2 AND status='ACTIVE'
		)`, convID, agentID)
	return ok, err
}

// ListConversationAgentsForUser 返回会话中活跃入座、且对指定用户**当前仍可见**的 Agent。
//
// SECURITY: 列出端点仅校验会话成员，但被移出团队的成员仍是 DIRECT/GROUP 会话成员，
// 不应再读到团队 Agent 的详情（含 system_prompt）。故按调用者的实时可见性过滤
// （口径与 CanUserUseAgent / ListAgentsForUser 一致）。
func (r *ChatAgentRepo) ListConversationAgentsForUser(ctx context.Context, convID, userID int64) ([]model.ChatAgent, error) {
	var agents []model.ChatAgent
	err := r.db.SelectContext(ctx, &agents, `
		SELECT a.* FROM chat_conversation_agents ca
		JOIN chat_agents a ON a.id = ca.agent_id
		WHERE ca.conversation_id = $1 AND ca.status = 'ACTIVE'
		  AND (
		      a.created_by = $2
		      OR (a.status = 'ACTIVE' AND (
		          a.scope = 'GLOBAL'
		          OR (a.scope = 'TEAM' AND EXISTS(
		              SELECT 1 FROM team_members tm
		              WHERE tm.team_id = a.team_id AND tm.user_id = $2 AND tm.status = 'ACTIVE'
		          ))
		      ))
		  )
		ORDER BY ca.joined_at`, convID, userID)
	return agents, err
}
