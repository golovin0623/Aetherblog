// Package repository · agent_session_repo.go — agent_chat_sessions /
// agent_chat_messages（migration 000089）数据访问层。
//
// 安全边界：所有查询都强制 user_id 过滤 —— 会话 id 是客户端生成的全局主键，
// 命中他人会话与不存在必须不可区分（上层统一 404）。整会话 upsert 在单事务
// 内完成 "锁行 → 归属/LWW 判定 → meta upsert → 消息全量替换"，避免双设备
// 并发写同一会话时交错。
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

var (
	// ErrAgentSessionNotOwned 表示会话存在但归属其他用户（上层必须表现为 404，不泄露存在性）。
	ErrAgentSessionNotOwned = errors.New("agent session owned by another user")
	// ErrAgentSessionConflict 表示 LWW 判定失败：库内 client_updated_at 比请求更新（上层 409）。
	ErrAgentSessionConflict = errors.New("agent session has newer server version")
)

// AgentSessionRepo 提供灵境会话云同步的数据访问能力。
type AgentSessionRepo struct{ db *sqlx.DB }

// NewAgentSessionRepo 创建 AgentSessionRepo。
func NewAgentSessionRepo(db *sqlx.DB) *AgentSessionRepo { return &AgentSessionRepo{db: db} }

// agentSessionColumns 会话查询列（JSONB 以 ::text 扫描，同 agent_workflow 模式）。
const agentSessionColumns = `
	id, user_id, title, mode, model_id, provider_code,
	model_params::text AS model_params, pinned, context_break_id, draft,
	client_created_at, client_updated_at, created_at, updated_at`

// ListByUser 按用户取会话列表（不含消息正文），置顶优先、按最近更新倒序。
func (r *AgentSessionRepo) ListByUser(ctx context.Context, userID int64, limit int) ([]model.AgentChatSessionListRow, error) {
	rows := []model.AgentChatSessionListRow{}
	err := r.db.SelectContext(ctx, &rows, `
		SELECT `+agentSessionColumns+`,
			(SELECT COUNT(*) FROM agent_chat_messages m WHERE m.session_id = s.id) AS message_count
		FROM agent_chat_sessions s
		WHERE s.user_id = $1
		ORDER BY s.pinned DESC, s.updated_at DESC
		LIMIT $2`, userID, limit)
	return rows, err
}

// CountByUser 统计用户会话总数（云同步配额校验用，user_id 有索引）。
func (r *AgentSessionRepo) CountByUser(ctx context.Context, userID int64) (int, error) {
	var n int
	err := r.db.GetContext(ctx, &n, `
		SELECT COUNT(*) FROM agent_chat_sessions WHERE user_id = $1`, userID)
	return n, err
}

// GetByIDForUser 取单会话与全部消息（按 seq 升序）。
// 不存在或归属他人一律返回 (nil, nil, nil) —— 上层统一 404。
func (r *AgentSessionRepo) GetByIDForUser(ctx context.Context, id string, userID int64) (*model.AgentChatSession, []model.AgentChatMessage, error) {
	var s model.AgentChatSession
	err := r.db.GetContext(ctx, &s, `
		SELECT `+agentSessionColumns+`
		FROM agent_chat_sessions s
		WHERE s.id = $1 AND s.user_id = $2`, id, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	msgs := []model.AgentChatMessage{}
	err = r.db.SelectContext(ctx, &msgs, `
		SELECT id, session_id, seq, role, content, payload::text AS payload, created_at
		FROM agent_chat_messages
		WHERE session_id = $1
		ORDER BY seq ASC`, id)
	if err != nil {
		return nil, nil, err
	}
	return &s, msgs, nil
}

// Upsert 整会话 upsert：单事务内锁行 → 归属/LWW 判定 → meta upsert →
// 消息 delete + 全量 insert（幂等：同一 body 重放结果一致）。
//
// 返回错误语义：
//   - ErrAgentSessionNotOwned：会话 id 已被其他用户占用（上层 404）。
//   - ErrAgentSessionConflict：库内 client_updated_at > 请求 UpdatedAt（上层 409，
//     由 service 另行加载服务端版本回传）。相等视为同一次写的重放，接受。
func (r *AgentSessionRepo) Upsert(ctx context.Context, s *model.AgentChatSession, msgs []model.AgentChatMessage) error {
	return r.withTx(ctx, func(tx *sqlx.Tx) error {
		// 1) 锁行 + 归属 / LWW 判定。FOR UPDATE 串行化同一会话的并发 PUT。
		var existing struct {
			UserID          int64 `db:"user_id"`
			ClientUpdatedAt int64 `db:"client_updated_at"`
		}
		err := tx.GetContext(ctx, &existing, `
			SELECT user_id, client_updated_at FROM agent_chat_sessions
			WHERE id = $1 FOR UPDATE`, s.ID)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			// 新会话，直接落库。
		case err != nil:
			return err
		case existing.UserID != s.UserID:
			return ErrAgentSessionNotOwned
		case existing.ClientUpdatedAt > s.ClientUpdatedAt:
			return ErrAgentSessionConflict
		}

		// 2) meta upsert。ON CONFLICT 的 WHERE user_id 守卫是纵深防御：
		// 即使判定与写入之间出现意料外交错，也绝不覆盖他人行。
		res, err := tx.ExecContext(ctx, `
			INSERT INTO agent_chat_sessions
				(id, user_id, title, mode, model_id, provider_code, model_params,
				 pinned, context_break_id, draft, client_created_at, client_updated_at,
				 created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12,
				to_timestamp($13 / 1000.0),
				to_timestamp($14 / 1000.0))
			ON CONFLICT (id) DO UPDATE SET
				title = EXCLUDED.title,
				mode = EXCLUDED.mode,
				model_id = EXCLUDED.model_id,
				provider_code = EXCLUDED.provider_code,
				model_params = EXCLUDED.model_params,
				pinned = EXCLUDED.pinned,
				context_break_id = EXCLUDED.context_break_id,
				draft = EXCLUDED.draft,
				client_created_at = EXCLUDED.client_created_at,
				client_updated_at = EXCLUDED.client_updated_at,
				created_at = EXCLUDED.created_at,
				updated_at = EXCLUDED.updated_at
			WHERE agent_chat_sessions.user_id = EXCLUDED.user_id`,
			// $13/$14 与 $11/$12 值相同但必须是独立参数：lib/pq 走服务端预备
			// 语句，同一参数在 BIGINT 列位与 to_timestamp 的 double 上下文里
			// 复用会触发 42P08「inconsistent types deduced」。传 float64 让
			// PG 直接按 double precision 推导。
			s.ID, s.UserID, s.Title, s.Mode, s.ModelID, s.ProviderCode, s.ModelParams,
			s.Pinned, s.ContextBreakID, s.Draft, s.ClientCreatedAt, s.ClientUpdatedAt,
			float64(s.ClientCreatedAt), float64(s.ClientUpdatedAt))
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err == nil && n == 0 {
			return ErrAgentSessionNotOwned
		}

		// 3) 消息全量替换（delete + insert，天然幂等）。
		if _, err := tx.ExecContext(ctx, `DELETE FROM agent_chat_messages WHERE session_id = $1`, s.ID); err != nil {
			return err
		}
		return insertAgentMessages(ctx, tx, msgs)
	})
}

// agentMessageInsertChunk 单条多值 INSERT 的行数上限（7 列 × 200 行 = 1400 个
// 占位符，远低于 PG 65535 参数上限）。
const agentMessageInsertChunk = 200

// insertAgentMessages 分块多值插入消息。
func insertAgentMessages(ctx context.Context, tx *sqlx.Tx, msgs []model.AgentChatMessage) error {
	for start := 0; start < len(msgs); start += agentMessageInsertChunk {
		end := start + agentMessageInsertChunk
		if end > len(msgs) {
			end = len(msgs)
		}
		chunk := msgs[start:end]
		values := make([]string, 0, len(chunk))
		args := make([]any, 0, len(chunk)*7)
		for i, m := range chunk {
			base := i * 7
			values = append(values, fmt.Sprintf("($%d,$%d,$%d,$%d,$%d,$%d::jsonb,$%d)",
				base+1, base+2, base+3, base+4, base+5, base+6, base+7))
			args = append(args, m.ID, m.SessionID, m.Seq, m.Role, m.Content, m.Payload, m.CreatedAt)
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO agent_chat_messages (id, session_id, seq, role, content, payload, created_at)
			VALUES `+strings.Join(values, ","), args...)
		if err != nil {
			return err
		}
	}
	return nil
}

// Delete 删除会话（消息级联）。返回是否真的删除了行 ——
// false 表示不存在或归属他人（上层统一 404）。
func (r *AgentSessionRepo) Delete(ctx context.Context, id string, userID int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `
		DELETE FROM agent_chat_sessions WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// withTx 在单事务中执行 fn，失败回滚。
func (r *AgentSessionRepo) withTx(ctx context.Context, fn func(tx *sqlx.Tx) error) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
