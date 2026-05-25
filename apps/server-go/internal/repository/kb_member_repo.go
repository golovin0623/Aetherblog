// Package repository · kb_member_repo.go — kb_members CRUD + 权限解析。
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

type KBMemberRepo struct{ db *sqlx.DB }

func NewKBMemberRepo(db *sqlx.DB) *KBMemberRepo { return &KBMemberRepo{db: db} }

const kbMemberColumns = `id, kb_id, principal_type, principal_id, permission_level, granted_by, granted_at, expires_at`

// ListByKB 返回 KB 的全部成员（不过滤过期）。
func (r *KBMemberRepo) ListByKB(ctx context.Context, kbID int64) ([]model.KBMember, error) {
	var ms []model.KBMember
	err := r.db.SelectContext(ctx, &ms,
		`SELECT `+kbMemberColumns+` FROM kb_members WHERE kb_id=$1
         ORDER BY granted_at DESC`, kbID)
	return ms, err
}

// KBMemberWithName 是 ListByKBWithNames 的返回结构，附带 principal 显示名 + grantedBy 显示名。
type KBMemberWithName struct {
	model.KBMember
	PrincipalName *string `db:"principal_name"`
	GrantedByName *string `db:"granted_by_name"`
}

// ListByKBWithNames 在 ListByKB 基础上一次性反查 principal 显示名（按 type 路由到
// users / teams / roles 表）+ 授权人 username。一次 SQL 完成 4 路 LEFT JOIN。
func (r *KBMemberRepo) ListByKBWithNames(ctx context.Context, kbID int64) ([]KBMemberWithName, error) {
	var ms []KBMemberWithName
	err := r.db.SelectContext(ctx, &ms, `
        SELECT m.id, m.kb_id, m.principal_type, m.principal_id, m.permission_level,
               m.granted_by, m.granted_at, m.expires_at,
               CASE m.principal_type
                   WHEN 'USER' THEN (SELECT COALESCE(NULLIF(nickname,''), username) FROM users WHERE id = m.principal_id)
                   WHEN 'TEAM' THEN (SELECT name FROM teams WHERE id = m.principal_id)
                   WHEN 'ROLE' THEN (SELECT name FROM roles WHERE id = m.principal_id)
               END AS principal_name,
               (SELECT COALESCE(NULLIF(u.nickname,''), u.username) FROM users u WHERE u.id = m.granted_by) AS granted_by_name
        FROM kb_members m
        WHERE m.kb_id = $1
        ORDER BY m.granted_at DESC`, kbID)
	return ms, err
}

// FindByID 单条。
func (r *KBMemberRepo) FindByID(ctx context.Context, id int64) (*model.KBMember, error) {
	var m model.KBMember
	err := r.db.GetContext(ctx, &m, `SELECT `+kbMemberColumns+` FROM kb_members WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

// KBMemberCreateRequest 携带 Create 字段。
type KBMemberCreateRequest struct {
	KBID            int64
	PrincipalType   string
	PrincipalID     int64
	PermissionLevel string
	GrantedBy       *int64
	ExpiresAt       *any // *time.Time 但避免硬依赖 time 包；用 any 让 service 传 nil 或 sql.NullTime
}

// Upsert 写入或更新（按 uq_kb_member 冲突时更新 level / granted_by / expires_at）。
func (r *KBMemberRepo) Upsert(ctx context.Context, kbID int64, principalType string, principalID int64,
	level string, grantedBy *int64, expiresAt any,
) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
        INSERT INTO kb_members (kb_id, principal_type, principal_id, permission_level, granted_by, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (kb_id, principal_type, principal_id)
        DO UPDATE SET permission_level=EXCLUDED.permission_level,
                      granted_by=EXCLUDED.granted_by,
                      expires_at=EXCLUDED.expires_at,
                      granted_at=CURRENT_TIMESTAMP
        RETURNING id`,
		kbID, principalType, principalID, level, grantedBy, expiresAt,
	).Scan(&id)
	return id, err
}

// UpdateByID 更新 permission_level / expires_at（不变更 principal）。
func (r *KBMemberRepo) UpdateByID(ctx context.Context, id int64, level string, expiresAt any) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE kb_members SET permission_level=$1, expires_at=$2 WHERE id=$3`,
		level, expiresAt, id)
	return err
}

// Delete 删除成员。
func (r *KBMemberRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM kb_members WHERE id=$1`, id)
	return err
}

// ResolvePermission 计算给定 principal 在 KB 上的最高权限。
// 输入 user/team/role IDs，按 (USER, TEAM, ROLE) 合并所有匹配行，
// 返回最高级（按 VIEW < USE < EDIT < MANAGE 排序）。
// 未匹配返回空串。
func (r *KBMemberRepo) ResolvePermission(ctx context.Context, kbID int64, userID int64, teamIDs, roleIDs []int64) (string, error) {
	teamArr := int64ArrayLiteral(teamIDs)
	roleArr := int64ArrayLiteral(roleIDs)
	var level sql.NullString
	err := r.db.QueryRowContext(ctx, `
        SELECT MAX(
            CASE permission_level
                WHEN 'MANAGE' THEN 4
                WHEN 'EDIT'   THEN 3
                WHEN 'USE'    THEN 2
                WHEN 'VIEW'   THEN 1
                ELSE 0
            END
        ) FROM kb_members
        WHERE kb_id=$1
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (
              (principal_type='USER' AND principal_id=$2) OR
              (principal_type='TEAM' AND principal_id=ANY($3::bigint[])) OR
              (principal_type='ROLE' AND principal_id=ANY($4::bigint[]))
          )`,
		kbID, userID, teamArr, roleArr).Scan(&level)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if !level.Valid || level.String == "" || level.String == "0" {
		return "", nil
	}
	switch level.String {
	case "4":
		return model.KBPermissionManage, nil
	case "3":
		return model.KBPermissionEdit, nil
	case "2":
		return model.KBPermissionUse, nil
	case "1":
		return model.KBPermissionView, nil
	}
	return "", nil
}

// ListKBsWithMinLevel 返回 principal 在权限 ≥ minLevel 的 KB id 列表。
// 给灵境 picker 用：minLevel='USE' → 返回 owner ∪ USE/EDIT/MANAGE 成员。
func (r *KBMemberRepo) ListKBsWithMinLevel(ctx context.Context, userID int64, teamIDs, roleIDs []int64, minLevel string) ([]int64, error) {
	threshold := 0
	switch minLevel {
	case model.KBPermissionView:
		threshold = 1
	case model.KBPermissionUse:
		threshold = 2
	case model.KBPermissionEdit:
		threshold = 3
	case model.KBPermissionManage:
		threshold = 4
	default:
		return nil, fmt.Errorf("invalid minLevel: %s", minLevel)
	}
	teamArr := int64ArrayLiteral(teamIDs)
	roleArr := int64ArrayLiteral(roleIDs)
	rows, err := r.db.QueryContext(ctx, `
        SELECT DISTINCT kb_id FROM kb_members
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND CASE permission_level
                WHEN 'MANAGE' THEN 4
                WHEN 'EDIT'   THEN 3
                WHEN 'USE'    THEN 2
                WHEN 'VIEW'   THEN 1
                ELSE 0
              END >= $1
          AND (
              (principal_type='USER' AND principal_id=$2) OR
              (principal_type='TEAM' AND principal_id=ANY($3::bigint[])) OR
              (principal_type='ROLE' AND principal_id=ANY($4::bigint[]))
          )`,
		threshold, userID, teamArr, roleArr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
