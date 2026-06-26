// Package repository · kb_repo.go — 知识库主表 CRUD + 权限聚合查询。
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

// ErrKBSlugDuplicate 来自数据库 uniq 约束的语义版本。
// service 层捕获后映射到面向客户端的 ErrKBSlugConflict。
//
// 触发条件：并发两个 Create 同 slug 绕过 service 层的 FindBySlug 预检
// 同时到达 INSERT —— PG 抛 23505 (unique_violation)。
var ErrKBSlugDuplicate = errors.New("kb slug duplicate (uniq violation)")

// KBRepo 负责 knowledge_bases 表的访问。
type KBRepo struct{ db *sqlx.DB }

func NewKBRepo(db *sqlx.DB) *KBRepo { return &KBRepo{db: db} }

const kbColumns = `id, slug, name, description, icon, color, cover_image, kind, owner_id, visibility, folder_id,
	active_profile_id, file_count, chunk_count, vectorized_count, failed_count, total_tokens,
	is_archived, created_by, updated_by, created_at, updated_at`

// FindByID 返回单个 KB，不存在时返回 nil。
func (r *KBRepo) FindByID(ctx context.Context, id int64) (*model.KnowledgeBase, error) {
	var kb model.KnowledgeBase
	err := r.db.GetContext(ctx, &kb, `SELECT `+kbColumns+` FROM knowledge_bases WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &kb, nil
}

// FindBySlug 按 slug 查找。
func (r *KBRepo) FindBySlug(ctx context.Context, slug string) (*model.KnowledgeBase, error) {
	var kb model.KnowledgeBase
	err := r.db.GetContext(ctx, &kb, `SELECT `+kbColumns+` FROM knowledge_bases WHERE slug=$1`, slug)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &kb, nil
}

// AccessibleFilter 控制 ListAccessible 的过滤条件。
type AccessibleFilter struct {
	UserID    int64    // 当前请求用户
	IsAdmin   bool     // 系统管理员（绕开 owner / 成员检查）
	TeamIDs   []int64  // 用户所属 team ID（用于 principal_type='TEAM' 匹配）
	RoleIDs   []int64  // 用户拥有的 role ID（用于 principal_type='ROLE' 匹配）
	Kind      string   // 'CUSTOM' | 'SYSTEM_POSTS' | '' (全部)
	Keyword   string   // 模糊匹配 name/description
	MinLevels []string // 要求权限 ≥ 这些等级中任一（例如 ["USE","EDIT","MANAGE"]）
}

// ListAccessible 返回当前用户在权限范围内可见的 KB 列表。
// 规则：
//   - 系统管理员：返回全部
//   - 否则：owner_id = userID  ∪  kb_members（USER/TEAM/ROLE 匹配，且权限 ≥ MinLevels 任一）
//   - SYSTEM_POSTS 库对所有 admin 可见；对普通用户根据 visibility 决定
//
// 实际 SQL 用 UNION 收口，避免 OR 在大表上的执行计划退化。
func (r *KBRepo) ListAccessible(ctx context.Context, f AccessibleFilter) ([]model.KnowledgeBase, error) {
	if f.IsAdmin {
		// admin 全可见
		var rows []model.KnowledgeBase
		sb := strings.Builder{}
		sb.WriteString("SELECT " + kbColumns + " FROM knowledge_bases WHERE is_archived = FALSE")
		args := []any{}
		idx := 1
		if f.Kind != "" {
			sb.WriteString(fmt.Sprintf(" AND kind = $%d", idx))
			args = append(args, f.Kind)
			idx++
		}
		if f.Keyword != "" {
			sb.WriteString(fmt.Sprintf(" AND (name ILIKE $%d OR COALESCE(description,'') ILIKE $%d)", idx, idx))
			args = append(args, "%"+dbutil.EscapeLike(f.Keyword)+"%")
			idx++
		}
		sb.WriteString(" ORDER BY kind ASC, created_at DESC")
		if err := r.db.SelectContext(ctx, &rows, sb.String(), args...); err != nil {
			return nil, err
		}
		return rows, nil
	}

	// 普通用户的可见集合：owner ∪ member ∪ PUBLIC visibility
	minLevels := f.MinLevels
	if len(minLevels) == 0 {
		minLevels = []string{model.KBPermissionView, model.KBPermissionUse, model.KBPermissionEdit, model.KBPermissionManage}
	}
	// 构造 IN ('LV1','LV2',...)
	lvPlaceholders := make([]string, len(minLevels))
	lvArgs := make([]any, len(minLevels))
	for i, lv := range minLevels {
		lvPlaceholders[i] = fmt.Sprintf("$%d", i+1)
		lvArgs[i] = lv
	}
	// 团队 / 角色集合（可能为空，用 SQL 数组）
	teamArr := int64ArrayLiteral(f.TeamIDs)
	roleArr := int64ArrayLiteral(f.RoleIDs)

	args := append([]any{}, lvArgs...)
	userArgIdx := len(args) + 1
	args = append(args, f.UserID)
	teamArgIdx := len(args) + 1
	args = append(args, teamArr)
	roleArgIdx := len(args) + 1
	args = append(args, roleArr)

	sb := strings.Builder{}
	sb.WriteString("SELECT " + kbColumns + " FROM knowledge_bases WHERE is_archived = FALSE AND id IN (")
	sb.WriteString(fmt.Sprintf(`
        SELECT id FROM knowledge_bases WHERE owner_id = $%d
        UNION
        SELECT m.kb_id FROM kb_members m
          WHERE m.permission_level IN (%s)
            AND (
              (m.principal_type = 'USER' AND m.principal_id = $%d) OR
              (m.principal_type = 'TEAM' AND m.principal_id = ANY($%d::bigint[])) OR
              (m.principal_type = 'ROLE' AND m.principal_id = ANY($%d::bigint[]))
            )
            AND (m.expires_at IS NULL OR m.expires_at > NOW())
        UNION
        SELECT id FROM knowledge_bases WHERE visibility = 'PUBLIC'
    `, userArgIdx, strings.Join(lvPlaceholders, ","), userArgIdx, teamArgIdx, roleArgIdx))
	sb.WriteString(")")
	idx := len(args) + 1
	if f.Kind != "" {
		sb.WriteString(fmt.Sprintf(" AND kind = $%d", idx))
		args = append(args, f.Kind)
		idx++
	}
	if f.Keyword != "" {
		sb.WriteString(fmt.Sprintf(" AND (name ILIKE $%d OR COALESCE(description,'') ILIKE $%d)", idx, idx))
		args = append(args, "%"+dbutil.EscapeLike(f.Keyword)+"%")
		idx++
	}
	sb.WriteString(" ORDER BY kind ASC, created_at DESC")

	var rows []model.KnowledgeBase
	if err := r.db.SelectContext(ctx, &rows, sb.String(), args...); err != nil {
		return nil, err
	}
	return rows, nil
}

// CreateRequest 携带 Create 时需要的字段（与 dto 解耦）。
type KBCreateRequest struct {
	Slug        string
	Name        string
	Description *string
	Icon        *string
	Color       *string
	Kind        string
	OwnerID     *int64
	Visibility  string
	FolderID    *int64
	CreatedBy   *int64
}

// Create 插入新 KB 行，返回 id。active_profile_id 在 profile 创建后单独 update。
// 当 slug 唯一约束冲突（PG 23505）时返回 ErrKBSlugDuplicate，让 service 层
// 映射到面向客户端的 ErrKBSlugConflict（避免 500，给出 400 + 明确文案）。
func (r *KBRepo) Create(ctx context.Context, req KBCreateRequest) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
        INSERT INTO knowledge_bases (slug, name, description, icon, color, kind, owner_id, visibility, folder_id, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
        RETURNING id`,
		req.Slug, req.Name, req.Description, req.Icon, req.Color, req.Kind,
		req.OwnerID, req.Visibility, req.FolderID, req.CreatedBy,
	).Scan(&id)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return 0, ErrKBSlugDuplicate
		}
	}
	return id, err
}

// Update 修改 KB 可变字段。nil 字段不动。
func (r *KBRepo) Update(ctx context.Context, id int64, sets map[string]any, updatedBy *int64) error {
	if len(sets) == 0 {
		return nil
	}
	cols := make([]string, 0, len(sets)+1)
	args := make([]any, 0, len(sets)+2)
	i := 1
	for k, v := range sets {
		cols = append(cols, fmt.Sprintf("%s = $%d", k, i))
		args = append(args, v)
		i++
	}
	cols = append(cols, fmt.Sprintf("updated_by = $%d", i))
	args = append(args, updatedBy)
	i++
	cols = append(cols, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	q := fmt.Sprintf("UPDATE knowledge_bases SET %s WHERE id = $%d", strings.Join(cols, ", "), i)
	_, err := r.db.ExecContext(ctx, q, args...)
	return err
}

// SetActiveProfile 翻转 active_profile_id 指针（独立方法，便于事务里调用）。
func (r *KBRepo) SetActiveProfile(ctx context.Context, kbID int64, profileID int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE knowledge_bases SET active_profile_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
		profileID, kbID)
	return err
}

// Delete 删除 KB（CASCADE 自动清 profiles/members/files/embeddings）。SYSTEM_POSTS 库应在 service 层拦截。
func (r *KBRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM knowledge_bases WHERE id=$1`, id)
	return err
}

// RefreshStats 重新计算 KB 统计缓存（file_count / chunk_count / vectorized_count / failed_count / total_tokens）。
// 在文件上传 / 删除 / 向量化状态变更后调用，保证列表卡片数字准确。
func (r *KBRepo) RefreshStats(ctx context.Context, kbID int64) error {
	_, err := r.db.ExecContext(ctx, `
        UPDATE knowledge_bases SET
            file_count = COALESCE((SELECT COUNT(*) FROM kb_files WHERE kb_id = $1), 0),
            chunk_count = COALESCE((SELECT SUM(chunk_count) FROM kb_files WHERE kb_id = $1), 0),
            vectorized_count = COALESCE((SELECT COUNT(*) FROM kb_files WHERE kb_id = $1 AND vector_status = 'SUCCEEDED'), 0),
            failed_count = COALESCE((SELECT COUNT(*) FROM kb_files WHERE kb_id = $1 AND vector_status = 'FAILED'), 0),
            total_tokens = COALESCE((SELECT SUM(doc_tokens) FROM kb_files WHERE kb_id = $1), 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`, kbID)
	return err
}

// int64ArrayLiteral 把 []int64 转为 postgres 数组字面量字符串（"{1,2,3}"）。
// 空列表时返回 "{}"。lib/pq 对 ANY($1::bigint[]) 支持原生切片，但 sqlx 在某些
// 版本下需要显式数组字面量，统一走这个 helper 兼容性更好。
func int64ArrayLiteral(xs []int64) any {
	// 返回 pq.Array 兼容形式 —— sqlx 把 []int64 透传时部分驱动会报错，
	// 用文字字面量最稳。这里返回 string + 让 PG cast 为 bigint[]。
	if len(xs) == 0 {
		return "{}"
	}
	parts := make([]string, len(xs))
	for i, x := range xs {
		parts[i] = fmt.Sprintf("%d", x)
	}
	return "{" + strings.Join(parts, ",") + "}"
}
