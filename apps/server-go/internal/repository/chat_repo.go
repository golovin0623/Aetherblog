package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// ChatRepo 提供 chat_* 表族的数据访问能力（会话 / 成员 / 消息 / 偏好）。
type ChatRepo struct{ db *sqlx.DB }

// NewChatRepo 创建 ChatRepo。
func NewChatRepo(db *sqlx.DB) *ChatRepo { return &ChatRepo{db: db} }

// ChatConversationListRow 是会话列表查询的内部投影：会话本体 + 未读数 + 最后一条消息摘要。
type ChatConversationListRow struct {
	model.ChatConversation
	UnreadCount      int64      `db:"unread_count"`
	LastMsgID        *int64     `db:"last_msg_id"`
	LastMsgType      *string    `db:"last_msg_type"`
	LastMsgContent   *string    `db:"last_msg_content"`
	LastMsgSenderID  *int64     `db:"last_msg_sender_id"`
	LastMsgCreatedAt *time.Time `db:"last_msg_created_at"`
}

// ChatMemberRow 是会话成员查询的内部投影（join users）。
type ChatMemberRow struct {
	UserID     int64   `db:"user_id"`
	Username   string  `db:"username"`
	Nickname   *string `db:"nickname"`
	Avatar     *string `db:"avatar"`
	MemberRole string  `db:"member_role"`
	Muted      bool    `db:"muted"`
}

// ChatMessageRow 是消息查询的内部投影：消息本体 + 发送者展示名 / 头像。
type ChatMessageRow struct {
	model.ChatMessage
	SenderName   *string `db:"sender_name"`
	SenderAvatar *string `db:"sender_avatar"`
}

// FindConversation 按 ID 查询会话。未找到返回 (nil, nil)。
func (r *ChatRepo) FindConversation(ctx context.Context, id int64) (*model.ChatConversation, error) {
	var c model.ChatConversation
	err := r.db.GetContext(ctx, &c, `SELECT * FROM chat_conversations WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// IsMember 判断用户是否为会话成员，并返回其角色。
func (r *ChatRepo) IsMember(ctx context.Context, convID, userID int64) (bool, string, error) {
	var role string
	err := r.db.GetContext(ctx, &role,
		`SELECT member_role FROM chat_conversation_members WHERE conversation_id=$1 AND user_id=$2`,
		convID, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return true, role, nil
}

// IsAuthorizedMember 判断用户是否有权访问会话 —— 在「是会话成员」的基础上，
// 对 TEAM 会话**额外**校验其仍是该团队的活跃成员。
//
// SECURITY: chat_conversation_members 由 EnsureTeamConversation 同步写入，但团队成员
// 被移除 / 禁用时不会回收这条聊天成员记录（access_repo.RemoveTeamMember 只删 team_members）。
// 因此 TEAM 会话的鉴权必须实时回查 team_members，否则被踢出团队的用户仍能读写团队群聊。
// 单条 SQL 完成判定，避免在发送 / 读取热路径上多发查询。
func (r *ChatRepo) IsAuthorizedMember(ctx context.Context, convID, userID int64) (bool, error) {
	var ok bool
	err := r.db.GetContext(ctx, &ok, `
		SELECT EXISTS(
			SELECT 1
			FROM chat_conversation_members m
			JOIN chat_conversations c ON c.id = m.conversation_id
			WHERE m.conversation_id = $1 AND m.user_id = $2
			  AND (
			      c.kind <> 'TEAM'
			      OR EXISTS(
			          SELECT 1 FROM team_members tm
			          WHERE tm.team_id = c.team_id AND tm.user_id = $2 AND tm.status = 'ACTIVE'
			      )
			  )
		)`, convID, userID)
	return ok, err
}

// ActiveMemberUserIDs 返回会话内**有权接收**的成员 user_id —— 用于实时广播目标集合。
//
// SECURITY: 与 IsAuthorizedMember 对称，对 TEAM 会话剔除已被移出 / 禁用团队的陈旧成员，
// 否则被踢出团队但仍持有 WS 连接的用户会继续收到 message/typing/read 扇出（REST 鉴权挡不住推送）。
func (r *ChatRepo) ActiveMemberUserIDs(ctx context.Context, convID int64) ([]int64, error) {
	var ids []int64
	err := r.db.SelectContext(ctx, &ids, `
		SELECT m.user_id
		FROM chat_conversation_members m
		JOIN chat_conversations c ON c.id = m.conversation_id
		WHERE m.conversation_id = $1
		  AND (
		      c.kind <> 'TEAM'
		      OR EXISTS(
		          SELECT 1 FROM team_members tm
		          WHERE tm.team_id = c.team_id AND tm.user_id = m.user_id AND tm.status = 'ACTIVE'
		      )
		  )`, convID)
	return ids, err
}

// ListMembers 返回会话成员（含用户展示信息）。
func (r *ChatRepo) ListMembers(ctx context.Context, convID int64) ([]ChatMemberRow, error) {
	var rows []ChatMemberRow
	err := r.db.SelectContext(ctx, &rows, `
		SELECT m.user_id, u.username, u.nickname, u.avatar, m.member_role, m.muted
		FROM chat_conversation_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.conversation_id = $1
		ORDER BY m.joined_at`, convID)
	return rows, err
}

// ListMembersForConversations 批量拉取多个会话的成员（含用户展示信息），
// 按 conversation_id 分组返回 —— 用于会话列表避免 N+1 查询。
func (r *ChatRepo) ListMembersForConversations(ctx context.Context, convIDs []int64) (map[int64][]ChatMemberRow, error) {
	out := make(map[int64][]ChatMemberRow)
	if len(convIDs) == 0 {
		return out, nil
	}
	type row struct {
		ConversationID int64 `db:"conversation_id"`
		ChatMemberRow
	}
	var rows []row
	err := r.db.SelectContext(ctx, &rows, `
		SELECT m.conversation_id, m.user_id, u.username, u.nickname, u.avatar, m.member_role, m.muted
		FROM chat_conversation_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.conversation_id = ANY($1)
		ORDER BY m.joined_at`, pq.Array(convIDs))
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ConversationID] = append(out[r.ConversationID], r.ChatMemberRow)
	}
	return out, nil
}

// ListConversationsForUser 返回用户参与的全部会话，附带未读数与最后一条消息摘要，
// 按最近活跃排序。
func (r *ChatRepo) ListConversationsForUser(ctx context.Context, userID int64) ([]ChatConversationListRow, error) {
	var rows []ChatConversationListRow
	err := r.db.SelectContext(ctx, &rows, `
		SELECT c.*,
		       COALESCE(uc.cnt, 0)   AS unread_count,
		       lm.id                 AS last_msg_id,
		       lm.message_type       AS last_msg_type,
		       lm.content            AS last_msg_content,
		       lm.sender_id          AS last_msg_sender_id,
		       lm.created_at         AS last_msg_created_at
		FROM chat_conversations c
		JOIN chat_conversation_members m
		  ON m.conversation_id = c.id AND m.user_id = $1
		LEFT JOIN LATERAL (
		    SELECT id, message_type, content, sender_id, created_at
		    FROM chat_messages msg
		    WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL
		    ORDER BY msg.id DESC LIMIT 1
		) lm ON true
		LEFT JOIN LATERAL (
		    SELECT COUNT(*) AS cnt
		    FROM chat_messages msg
		    WHERE msg.conversation_id = c.id
		      AND msg.deleted_at IS NULL
		      AND msg.id > COALESCE(m.last_read_message_id, 0)
		      AND msg.sender_id IS DISTINCT FROM $1
		) uc ON true
		-- SECURITY: 对 TEAM 会话过滤掉已被移出 / 禁用团队的陈旧成员，
		-- 否则被踢出团队的用户仍能在列表里看到群聊及其最后消息预览。
		WHERE c.kind <> 'TEAM'
		   OR EXISTS(
		       SELECT 1 FROM team_members tm
		       WHERE tm.team_id = c.team_id AND tm.user_id = $1 AND tm.status = 'ACTIVE'
		   )
		ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`, userID)
	return rows, err
}

// FindOrCreateDirect 按规范化 dm_key 查找或创建一条两人私聊会话。
// 返回会话与是否新建的标志。
func (r *ChatRepo) FindOrCreateDirect(ctx context.Context, a, b int64, createdBy int64) (*model.ChatConversation, bool, error) {
	dmKey := directKey(a, b)
	var existing model.ChatConversation
	err := r.db.GetContext(ctx, &existing,
		`SELECT * FROM chat_conversations WHERE kind='DIRECT' AND dm_key=$1`, dmKey)
	if err == nil {
		return &existing, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, err
	}

	var out model.ChatConversation
	txErr := r.withTx(ctx, func(tx *sqlx.Tx) error {
		if err := tx.QueryRowxContext(ctx, `
			INSERT INTO chat_conversations (kind, dm_key, created_by, created_at, updated_at)
			VALUES ('DIRECT', $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING *`, dmKey, createdBy).StructScan(&out); err != nil {
			return err
		}
		for _, uid := range []int64{a, b} {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO chat_conversation_members (conversation_id, user_id, member_role)
				VALUES ($1, $2, 'MEMBER')
				ON CONFLICT (conversation_id, user_id) DO NOTHING`, out.ID, uid); err != nil {
				return err
			}
		}
		return nil
	})
	if txErr != nil {
		// 并发下另一个事务先建好了 —— 回查一次。
		if isUniqueViolation(txErr) {
			if e := r.db.GetContext(ctx, &existing,
				`SELECT * FROM chat_conversations WHERE kind='DIRECT' AND dm_key=$1`, dmKey); e == nil {
				return &existing, false, nil
			}
		}
		return nil, false, txErr
	}
	return &out, true, nil
}

// EnsureTeamConversation 查找或创建团队群聊会话，并把团队的活跃成员同步进会话成员表。
func (r *ChatRepo) EnsureTeamConversation(ctx context.Context, teamID int64, title string, createdBy int64) (*model.ChatConversation, error) {
	var conv model.ChatConversation
	err := r.db.GetContext(ctx, &conv,
		`SELECT * FROM chat_conversations WHERE kind='TEAM' AND team_id=$1`, teamID)
	if errors.Is(err, sql.ErrNoRows) {
		txErr := r.withTx(ctx, func(tx *sqlx.Tx) error {
			return tx.QueryRowxContext(ctx, `
				INSERT INTO chat_conversations (kind, team_id, title, created_by, created_at, updated_at)
				VALUES ('TEAM', $1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
				ON CONFLICT (team_id) WHERE kind='TEAM' DO UPDATE SET updated_at = EXCLUDED.updated_at
				RETURNING *`, teamID, nullableStr(title), createdBy).StructScan(&conv)
		})
		if txErr != nil {
			return nil, txErr
		}
	} else if err != nil {
		return nil, err
	}

	// 同步：把团队活跃成员补进会话（已存在则跳过），让新加入的团队成员自动进群。
	if _, err := r.db.ExecContext(ctx, `
		INSERT INTO chat_conversation_members (conversation_id, user_id, member_role)
		SELECT $1, tm.user_id,
		       CASE WHEN tm.member_role = 'OWNER' THEN 'OWNER'
		            WHEN tm.member_role = 'MANAGER' THEN 'ADMIN'
		            ELSE 'MEMBER' END
		FROM team_members tm
		WHERE tm.team_id = $2 AND tm.status = 'ACTIVE'
		ON CONFLICT (conversation_id, user_id) DO NOTHING`, conv.ID, teamID); err != nil {
		return nil, err
	}
	return &conv, nil
}

// TeamMemberUserIDs 返回团队的活跃成员 user_id。
func (r *ChatRepo) TeamMemberUserIDs(ctx context.Context, teamID int64) ([]int64, error) {
	var ids []int64
	err := r.db.SelectContext(ctx, &ids,
		`SELECT user_id FROM team_members WHERE team_id=$1 AND status='ACTIVE'`, teamID)
	return ids, err
}

// IsTeamMember 判断用户是否为团队的活跃成员。
func (r *ChatRepo) IsTeamMember(ctx context.Context, teamID, userID int64) (bool, error) {
	var exists bool
	err := r.db.GetContext(ctx, &exists,
		`SELECT EXISTS(SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='ACTIVE')`,
		teamID, userID)
	return exists, err
}

// PeerUserIDs 返回与某用户共享至少一条会话的其他用户 ID（去重）——
// 用于上线 / 下线时只向「聊天对端」广播在线状态，避免全局风暴。
func (r *ChatRepo) PeerUserIDs(ctx context.Context, userID int64) ([]int64, error) {
	var ids []int64
	err := r.db.SelectContext(ctx, &ids, `
		SELECT DISTINCT peer.user_id
		FROM chat_conversation_members mine
		JOIN chat_conversation_members peer
		  ON peer.conversation_id = mine.conversation_id AND peer.user_id <> mine.user_id
		WHERE mine.user_id = $1`, userID)
	return ids, err
}

// InsertMessage 落库一条消息。若带 client_msg_id 命中幂等冲突，则回查并返回已存在的那条
// （created=false），用于断线重发 / 乐观渲染对账。
func (r *ChatRepo) InsertMessage(ctx context.Context, m *model.ChatMessage) (*model.ChatMessage, bool, error) {
	if m.ClientMsgID != nil && *m.ClientMsgID != "" {
		if existing, err := r.findByClientMsgID(ctx, m.ConversationID, *m.ClientMsgID); err != nil {
			return nil, false, err
		} else if existing != nil {
			return existing, false, nil
		}
	}

	var out model.ChatMessage
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO chat_messages (
			conversation_id, sender_id, sender_type, message_type, content,
			attachment_url, attachment_name, attachment_mime, attachment_size, attachment_meta,
			reply_to_id, client_msg_id, agent_id, created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)
		RETURNING *`,
		m.ConversationID, m.SenderID, m.SenderType, m.MessageType, m.Content,
		m.AttachmentURL, m.AttachmentName, m.AttachmentMime, m.AttachmentSize, m.AttachmentMeta,
		m.ReplyToID, m.ClientMsgID, m.AgentID,
	).StructScan(&out)
	if err != nil {
		if isUniqueViolation(err) && m.ClientMsgID != nil {
			if existing, e := r.findByClientMsgID(ctx, m.ConversationID, *m.ClientMsgID); e == nil && existing != nil {
				return existing, false, nil
			}
		}
		return nil, false, err
	}
	return &out, true, nil
}

func (r *ChatRepo) findByClientMsgID(ctx context.Context, convID int64, clientMsgID string) (*model.ChatMessage, error) {
	var m model.ChatMessage
	err := r.db.GetContext(ctx, &m,
		`SELECT * FROM chat_messages WHERE conversation_id=$1 AND client_msg_id=$2`, convID, clientMsgID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &m, err
}

// GetMessageRow 按 ID 拉取单条消息（含发送者展示信息），用于广播组装。
func (r *ChatRepo) GetMessageRow(ctx context.Context, id int64) (*ChatMessageRow, error) {
	var row ChatMessageRow
	err := r.db.GetContext(ctx, &row, `
		SELECT msg.*,
		       COALESCE(ag.name, u.nickname, u.username,
		                CASE WHEN msg.sender_type = 'AGENT' THEN '已删除智能体' END) AS sender_name,
		       COALESCE(ag.avatar, u.avatar) AS sender_avatar
		FROM chat_messages msg
		LEFT JOIN users u ON u.id = msg.sender_id
		LEFT JOIN chat_agents ag ON ag.id = msg.agent_id
		WHERE msg.id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &row, err
}

// ListMessages 倒序拉取会话历史。beforeID 为游标（不含），nil 表示最新一页。
func (r *ChatRepo) ListMessages(ctx context.Context, convID int64, beforeID *int64, limit int) ([]ChatMessageRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	var rows []ChatMessageRow
	err := r.db.SelectContext(ctx, &rows, `
		SELECT msg.*,
		       COALESCE(ag.name, u.nickname, u.username,
		                CASE WHEN msg.sender_type = 'AGENT' THEN '已删除智能体' END) AS sender_name,
		       COALESCE(ag.avatar, u.avatar) AS sender_avatar
		FROM chat_messages msg
		LEFT JOIN users u ON u.id = msg.sender_id
		LEFT JOIN chat_agents ag ON ag.id = msg.agent_id
		WHERE msg.conversation_id = $1
		  AND msg.deleted_at IS NULL
		  AND ($2::bigint IS NULL OR msg.id < $2)
		ORDER BY msg.id DESC
		LIMIT $3`, convID, beforeID, limit)
	return rows, err
}

// TouchConversation 更新会话的 last_message_at（消息发出后调用）。
func (r *ChatRepo) TouchConversation(ctx context.Context, convID int64, ts time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE chat_conversations SET last_message_at=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
		convID, ts)
	return err
}

// MarkRead 推进成员已读位点（只前进，不回退）。
//
// 仅当 messageID 确为本会话内的真实消息时才推进 —— 否则客户端可塞入任意大 id
// 永久压制未读数（unread = msg.id > last_read_message_id）并发出虚假已读回执。
func (r *ChatRepo) MarkRead(ctx context.Context, convID, userID, messageID int64) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE chat_conversation_members
		SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $3)
		WHERE conversation_id = $1 AND user_id = $2
		  AND EXISTS(
		      SELECT 1 FROM chat_messages msg
		      WHERE msg.id = $3 AND msg.conversation_id = $1
		  )`, convID, userID, messageID)
	return err
}

// GetUserSettings 读取用户聊天偏好。未设置返回 (nil, nil)，由 service 层填默认值。
func (r *ChatRepo) GetUserSettings(ctx context.Context, userID int64) (*model.ChatUserSettings, error) {
	var s model.ChatUserSettings
	err := r.db.GetContext(ctx, &s, `SELECT * FROM chat_user_settings WHERE user_id=$1`, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

// UpsertUserSettings 插入或更新用户聊天偏好。
func (r *ChatRepo) UpsertUserSettings(ctx context.Context, s *model.ChatUserSettings) (*model.ChatUserSettings, error) {
	var out model.ChatUserSettings
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO chat_user_settings (user_id, theme_skin, bubble_style, font_family, accent_color, preferences, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
		ON CONFLICT (user_id) DO UPDATE SET
			theme_skin   = EXCLUDED.theme_skin,
			bubble_style = EXCLUDED.bubble_style,
			font_family  = EXCLUDED.font_family,
			accent_color = EXCLUDED.accent_color,
			preferences  = EXCLUDED.preferences,
			updated_at   = CURRENT_TIMESTAMP
		RETURNING *`,
		s.UserID, s.ThemeSkin, s.BubbleStyle, s.FontFamily, s.AccentColor, s.Preferences,
	).StructScan(&out)
	return &out, err
}

// withTx 在单事务中执行 fn，失败回滚。
func (r *ChatRepo) withTx(ctx context.Context, fn func(tx *sqlx.Tx) error) error {
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

// directKey 把两个 user_id 规范化为 "min:max" 形式的私聊唯一键。
func directKey(a, b int64) string {
	if a > b {
		a, b = b, a
	}
	return fmt.Sprintf("%d:%d", a, b)
}

func nullableStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// isUniqueViolation 判断错误是否为 Postgres 唯一约束冲突（23505）。
func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) {
		return pqErr.Code == "23505"
	}
	return false
}
