package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

// AccessRepo 提供 RBAC、团队和内容共享相关的数据访问能力。
type AccessRepo struct{ db *sqlx.DB }

// NewAccessRepo 创建 AccessRepo 实例。
func NewAccessRepo(db *sqlx.DB) *AccessRepo { return &AccessRepo{db: db} }

// ManagedUserRow 是用户列表查询的聚合行。
type ManagedUserRow struct {
	model.User
	RolesCSV string `db:"roles_csv"`
}

// UserListFilter 是管理端用户列表过滤条件。
type UserListFilter struct {
	Search   string
	RoleCode string
	Status   string
	PageNum  int
	PageSize int
}

// CreateUserInput 是创建用户的数据库输入。
type CreateUserInput struct {
	Username           string
	Email              string
	PasswordHash       string
	Nickname           *string
	Role               string
	Status             string
	MustChangePassword bool
	RoleCodes          []string
	AssignedBy         *int64
}

// UpdateUserInput 是更新用户的数据库输入。
type UpdateUserInput struct {
	Email              *string
	Nickname           *string
	Bio                *string
	Status             *string
	MustChangePassword *bool
	RoleCodes          []string
	AssignedBy         *int64
}

// ListUsers 返回管理端用户分页列表与总数。
func (r *AccessRepo) ListUsers(ctx context.Context, f UserListFilter) ([]ManagedUserRow, int64, error) {
	where, args := buildUserListWhere(f)

	var total int64
	if err := r.db.GetContext(ctx, &total, "SELECT COUNT(*) FROM users u"+where, args...); err != nil {
		return nil, 0, err
	}

	if f.PageNum < 1 {
		f.PageNum = 1
	}
	if f.PageSize <= 0 {
		f.PageSize = 20
	}
	if f.PageSize > 100 {
		f.PageSize = 100
	}
	offset := (f.PageNum - 1) * f.PageSize

	query := fmt.Sprintf(`
		SELECT u.*,
		       COALESCE((
		           SELECT string_agg(r.code, ',' ORDER BY r.sort_order, r.code)
		           FROM user_roles ur
		           JOIN roles r ON r.id = ur.role_id
		           WHERE ur.user_id = u.id
		       ), u.role) AS roles_csv
		FROM users u%s
		ORDER BY u.created_at DESC, u.id DESC
		LIMIT %d OFFSET %d`, where, f.PageSize, offset)

	var rows []ManagedUserRow
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func buildUserListWhere(f UserListFilter) (string, []any) {
	var clauses []string
	var args []any
	n := 1
	placeholder := func(v any) string {
		args = append(args, v)
		s := fmt.Sprintf("$%d", n)
		n++
		return s
	}
	if f.Search != "" {
		pattern := "%" + dbutil.EscapeLike(strings.TrimSpace(f.Search)) + "%"
		ph := placeholder(pattern)
		clauses = append(clauses, "(u.username ILIKE "+ph+" OR u.email ILIKE "+ph+" OR COALESCE(u.nickname, '') ILIKE "+ph+")")
	}
	if f.Status != "" {
		clauses = append(clauses, "u.status = "+placeholder(strings.ToUpper(f.Status)))
	}
	if f.RoleCode != "" {
		role := strings.ToUpper(f.RoleCode)
		ph := placeholder(role)
		clauses = append(clauses, `(u.role = `+ph+` OR EXISTS (
			SELECT 1 FROM user_roles ur
			JOIN roles r ON r.id = ur.role_id
			WHERE ur.user_id = u.id AND r.code = `+ph+`
		))`)
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

// CreateUserWithRoles 在事务中创建用户并写入角色关系。
func (r *AccessRepo) CreateUserWithRoles(ctx context.Context, in CreateUserInput) (*ManagedUserRow, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	status := in.Status
	if status == "" {
		status = "ACTIVE"
	}
	role := in.Role
	if role == "" {
		role = "USER"
	}

	var u model.User
	if err := tx.QueryRowxContext(ctx, `
		INSERT INTO users (username, email, password_hash, nickname, role, status, must_change_password, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		RETURNING *`,
		in.Username, in.Email, in.PasswordHash, in.Nickname, role, status, in.MustChangePassword,
	).StructScan(&u); err != nil {
		return nil, err
	}

	if err := assignUserRolesTx(ctx, tx, u.ID, in.RoleCodes, in.AssignedBy); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.FindManagedUser(ctx, u.ID)
}

// UpdateUserWithRoles 在事务中更新用户资料/状态并可选替换角色。
func (r *AccessRepo) UpdateUserWithRoles(ctx context.Context, id int64, in UpdateUserInput) (*ManagedUserRow, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	setParts := []string{}
	args := []any{}
	n := 1
	addSet := func(col string, v any) {
		setParts = append(setParts, fmt.Sprintf("%s=$%d", col, n))
		args = append(args, v)
		n++
	}
	if in.Email != nil {
		addSet("email", *in.Email)
	}
	if in.Nickname != nil {
		addSet("nickname", nullEmptyString(*in.Nickname))
	}
	if in.Bio != nil {
		addSet("bio", nullEmptyString(*in.Bio))
	}
	if in.Status != nil {
		addSet("status", strings.ToUpper(*in.Status))
	}
	if in.MustChangePassword != nil {
		addSet("must_change_password", *in.MustChangePassword)
	}
	if len(in.RoleCodes) > 0 {
		addSet("role", in.RoleCodes[0])
	}
	if len(setParts) > 0 {
		setParts = append(setParts, "updated_at=NOW()")
		args = append(args, id)
		query := fmt.Sprintf("UPDATE users SET %s WHERE id=$%d", strings.Join(setParts, ","), n)
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			return nil, err
		}
	}
	if len(in.RoleCodes) > 0 {
		if err := assignUserRolesTx(ctx, tx, id, in.RoleCodes, in.AssignedBy); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.FindManagedUser(ctx, id)
}

func nullEmptyString(s string) *string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func assignUserRolesTx(ctx context.Context, tx *sqlx.Tx, userID int64, roleCodes []string, assignedBy *int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_roles WHERE user_id=$1`, userID); err != nil {
		return err
	}
	if len(roleCodes) == 0 {
		return nil
	}
	query, args, err := sqlx.In(`SELECT id, code FROM roles WHERE code IN (?)`, roleCodes)
	if err != nil {
		return err
	}
	query = tx.Rebind(query)
	rows, err := tx.QueryxContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	roleIDs := map[string]int64{}
	for rows.Next() {
		var id int64
		var code string
		if err := rows.Scan(&id, &code); err != nil {
			return err
		}
		roleIDs[code] = id
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(roleIDs) != len(roleCodes) {
		return fmt.Errorf("角色不存在")
	}
	for _, code := range roleCodes {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			userID, roleIDs[code], assignedBy,
		); err != nil {
			return err
		}
	}
	return nil
}

// FindManagedUser 返回单个管理视图用户。
func (r *AccessRepo) FindManagedUser(ctx context.Context, id int64) (*ManagedUserRow, error) {
	var row ManagedUserRow
	err := r.db.GetContext(ctx, &row, `
		SELECT u.*,
		       COALESCE((
		           SELECT string_agg(r.code, ',' ORDER BY r.sort_order, r.code)
		           FROM user_roles ur
		           JOIN roles r ON r.id = ur.role_id
		           WHERE ur.user_id = u.id
		       ), u.role) AS roles_csv
		FROM users u
		WHERE u.id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &row, err
}

// ResetPassword 更新指定用户密码。
func (r *AccessRepo) ResetPassword(ctx context.Context, id int64, passwordHash string, mustChange bool) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET password_hash=$1, must_change_password=$2, updated_at=NOW() WHERE id=$3`,
		passwordHash, mustChange, id)
	return err
}

// CountActiveAdmins 统计仍处于 ACTIVE 状态且具有 ADMIN 角色的用户数。
func (r *AccessRepo) CountActiveAdmins(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.GetContext(ctx, &n, `
		SELECT COUNT(DISTINCT u.id)
		FROM users u
		LEFT JOIN user_roles ur ON ur.user_id = u.id
		LEFT JOIN roles r ON r.id = ur.role_id
		WHERE u.status = 'ACTIVE' AND (u.role = 'ADMIN' OR r.code = 'ADMIN')`)
	return n, err
}

// UserHasAdminRole 判断用户当前是否具有 ADMIN 角色。
func (r *AccessRepo) UserHasAdminRole(ctx context.Context, userID int64) (bool, error) {
	var ok bool
	err := r.db.GetContext(ctx, &ok, `
		SELECT EXISTS (
			SELECT 1
			FROM users u
			LEFT JOIN user_roles ur ON ur.user_id = u.id
			LEFT JOIN roles r ON r.id = ur.role_id
			WHERE u.id=$1 AND (u.role='ADMIN' OR r.code='ADMIN')
		)`, userID)
	return ok, err
}

// UserHasPermission 判断用户是否拥有指定权限。
func (r *AccessRepo) UserHasPermission(ctx context.Context, userID int64, legacyRole string, permissionCode string) (bool, error) {
	var ok bool
	err := r.db.GetContext(ctx, &ok, `
		SELECT EXISTS (
			SELECT 1
			FROM users u
			LEFT JOIN user_roles ur ON ur.user_id = u.id
			LEFT JOIN roles r ON r.id = ur.role_id
			LEFT JOIN role_permissions rp ON rp.role_id = r.id
			LEFT JOIN permissions p ON p.id = rp.permission_id
			WHERE u.id=$1
			  AND u.status='ACTIVE'
			  AND (p.code=$2 OR r.code='ADMIN' OR u.role='ADMIN')
		)`, userID, permissionCode)
	return ok, err
}

// GetUserRoleCodes 返回用户的角色代码；若 user_roles 未初始化则回退 legacyRole。
func (r *AccessRepo) GetUserRoleCodes(ctx context.Context, userID int64, legacyRole string) ([]string, error) {
	var codes []string
	err := r.db.SelectContext(ctx, &codes, `
		SELECT r.code
		FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id
		WHERE ur.user_id=$1
		ORDER BY r.sort_order, r.code`, userID)
	if err != nil {
		return nil, err
	}
	if len(codes) == 0 && legacyRole != "" {
		return []string{legacyRole}, nil
	}
	return codes, nil
}

// GetUserPermissionCodes 返回用户通过角色继承的权限代码。
func (r *AccessRepo) GetUserPermissionCodes(ctx context.Context, userID int64, legacyRole string) ([]string, error) {
	hasAdmin, err := r.UserHasAdminRole(ctx, userID)
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(legacyRole, "ADMIN") || hasAdmin {
		var all []string
		err := r.db.SelectContext(ctx, &all, `SELECT code FROM permissions ORDER BY module, action, code`)
		return all, err
	}
	var codes []string
	err = r.db.SelectContext(ctx, &codes, `
		SELECT DISTINCT p.code
		FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id
		JOIN role_permissions rp ON rp.role_id = r.id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE ur.user_id=$1
		ORDER BY p.code`, userID)
	return codes, err
}

// ListRoles 返回全部角色及权限。
func (r *AccessRepo) ListRoles(ctx context.Context) ([]model.Role, error) {
	var roles []model.Role
	err := r.db.SelectContext(ctx, &roles, `SELECT * FROM roles ORDER BY sort_order, code`)
	return roles, err
}

// ListPermissions 返回全部权限。
func (r *AccessRepo) ListPermissions(ctx context.Context) ([]model.Permission, error) {
	var perms []model.Permission
	err := r.db.SelectContext(ctx, &perms, `SELECT * FROM permissions ORDER BY module, action, code`)
	return perms, err
}

// ListPermissionsByRoleIDs 返回 role_id -> permissions。
func (r *AccessRepo) ListPermissionsByRoleIDs(ctx context.Context, roleIDs []int64) (map[int64][]model.Permission, error) {
	out := map[int64][]model.Permission{}
	if len(roleIDs) == 0 {
		return out, nil
	}
	query, args, err := sqlx.In(`
		SELECT rp.role_id, p.*
		FROM role_permissions rp
		JOIN permissions p ON p.id = rp.permission_id
		WHERE rp.role_id IN (?)
		ORDER BY p.module, p.action, p.code`, roleIDs)
	if err != nil {
		return nil, err
	}
	query = r.db.Rebind(query)
	rows, err := r.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var roleID int64
		var p model.Permission
		if err := rows.Scan(&roleID, &p.ID, &p.Code, &p.Module, &p.Action, &p.Name, &p.Description, &p.CreatedAt); err != nil {
			return nil, err
		}
		out[roleID] = append(out[roleID], p)
	}
	return out, rows.Err()
}

// SetRolePermissions 在事务中替换指定角色的权限集合。
func (r *AccessRepo) SetRolePermissions(ctx context.Context, roleID int64, permissionCodes []string) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM role_permissions WHERE role_id=$1`, roleID); err != nil {
		return err
	}
	if len(permissionCodes) == 0 {
		return tx.Commit()
	}
	query, args, err := sqlx.In(`SELECT id, code FROM permissions WHERE code IN (?)`, permissionCodes)
	if err != nil {
		return err
	}
	query = tx.Rebind(query)
	rows, err := tx.QueryxContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	permissionIDs := map[string]int64{}
	for rows.Next() {
		var id int64
		var code string
		if err := rows.Scan(&id, &code); err != nil {
			return err
		}
		permissionIDs[code] = id
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(permissionIDs) != len(permissionCodes) {
		return fmt.Errorf("权限不存在")
	}
	for _, code := range permissionCodes {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			roleID, permissionIDs[code]); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// TeamRow 是团队列表聚合行。
type TeamRow struct {
	model.Team
	MemberCount int `db:"member_count"`
}

// ListTeams 返回全部团队。
func (r *AccessRepo) ListTeams(ctx context.Context) ([]TeamRow, error) {
	var rows []TeamRow
	err := r.db.SelectContext(ctx, &rows, `
		SELECT t.*,
		       COALESCE((SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=t.id), 0) AS member_count
		FROM teams t
		ORDER BY t.updated_at DESC, t.id DESC`)
	return rows, err
}

// CreateTeam 创建团队并写入 owner 成员关系。
func (r *AccessRepo) CreateTeam(ctx context.Context, t *model.Team) (*TeamRow, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var out model.Team
	if err := tx.QueryRowxContext(ctx, `
		INSERT INTO teams (name, slug, description, owner_id, visibility, created_by, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
		RETURNING *`,
		t.Name, t.Slug, t.Description, t.OwnerID, t.Visibility, t.CreatedBy,
	).StructScan(&out); err != nil {
		return nil, err
	}
	if out.OwnerID != nil {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO team_members (team_id, user_id, member_role, status, added_by)
			VALUES ($1,$2,'OWNER','ACTIVE',$3)
			ON CONFLICT (team_id, user_id) DO UPDATE SET member_role='OWNER', status='ACTIVE'`,
			out.ID, *out.OwnerID, t.CreatedBy); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return r.FindTeam(ctx, out.ID)
}

// UpdateTeam 更新团队。
func (r *AccessRepo) UpdateTeam(ctx context.Context, id int64, in *model.Team) (*TeamRow, error) {
	var out TeamRow
	err := r.db.QueryRowxContext(ctx, `
		UPDATE teams SET name=$1, slug=$2, description=$3, owner_id=$4, visibility=$5, updated_at=NOW()
		WHERE id=$6
		RETURNING *,
			COALESCE((SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=teams.id), 0) AS member_count`,
		in.Name, in.Slug, in.Description, in.OwnerID, in.Visibility, id,
	).StructScan(&out)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &out, err
}

// FindTeam 返回团队。
func (r *AccessRepo) FindTeam(ctx context.Context, id int64) (*TeamRow, error) {
	var out TeamRow
	err := r.db.GetContext(ctx, &out, `
		SELECT t.*,
		       COALESCE((SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=t.id), 0) AS member_count
		FROM teams t WHERE t.id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &out, err
}

// TeamMemberRow 是团队成员与用户基础信息的聚合行。
type TeamMemberRow struct {
	model.TeamMember
	Username string  `db:"username"`
	Nickname *string `db:"nickname"`
	Email    string  `db:"email"`
}

// ListTeamMembers 返回团队成员。
func (r *AccessRepo) ListTeamMembers(ctx context.Context, teamID int64) ([]TeamMemberRow, error) {
	var rows []TeamMemberRow
	err := r.db.SelectContext(ctx, &rows, `
		SELECT tm.*, u.username, u.nickname, u.email
		FROM team_members tm
		JOIN users u ON u.id = tm.user_id
		WHERE tm.team_id=$1
		ORDER BY
			CASE tm.member_role
				WHEN 'OWNER' THEN 1
				WHEN 'MANAGER' THEN 2
				WHEN 'MEMBER' THEN 3
				ELSE 4
			END,
			tm.joined_at DESC`, teamID)
	return rows, err
}

// UpsertTeamMember 创建或更新团队成员。
func (r *AccessRepo) UpsertTeamMember(ctx context.Context, m *model.TeamMember) (*TeamMemberRow, error) {
	status := m.Status
	if status == "" {
		status = "ACTIVE"
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO team_members (team_id, user_id, member_role, status, added_by)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (team_id, user_id) DO UPDATE
		SET member_role=EXCLUDED.member_role,
		    status=EXCLUDED.status,
		    added_by=EXCLUDED.added_by`,
		m.TeamID, m.UserID, m.MemberRole, status, m.AddedBy)
	if err != nil {
		return nil, err
	}
	members, err := r.ListTeamMembers(ctx, m.TeamID)
	if err != nil {
		return nil, err
	}
	for i := range members {
		if members[i].UserID == m.UserID {
			return &members[i], nil
		}
	}
	return nil, nil
}

// RemoveTeamMember 删除团队成员。
func (r *AccessRepo) RemoveTeamMember(ctx context.Context, teamID, userID int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM team_members WHERE team_id=$1 AND user_id=$2`, teamID, userID)
	return err
}

// ContentShareFilter 是内容共享列表过滤条件。
type ContentShareFilter struct {
	ResourceType  string
	ResourceID    int64
	PrincipalType string
	PrincipalID   int64
}

// ListContentShares 返回内容共享授权。
func (r *AccessRepo) ListContentShares(ctx context.Context, f ContentShareFilter) ([]model.ContentShare, error) {
	where := []string{}
	args := []any{}
	n := 1
	add := func(expr string, v any) {
		where = append(where, fmt.Sprintf(expr, n))
		args = append(args, v)
		n++
	}
	if f.ResourceType != "" {
		add("resource_type=$%d", strings.ToUpper(f.ResourceType))
	}
	if f.ResourceID > 0 {
		add("resource_id=$%d", f.ResourceID)
	}
	if f.PrincipalType != "" {
		add("principal_type=$%d", strings.ToUpper(f.PrincipalType))
	}
	if f.PrincipalID > 0 {
		add("principal_id=$%d", f.PrincipalID)
	}
	sqlWhere := ""
	if len(where) > 0 {
		sqlWhere = " WHERE " + strings.Join(where, " AND ")
	}
	var shares []model.ContentShare
	err := r.db.SelectContext(ctx, &shares, `SELECT * FROM content_shares`+sqlWhere+` ORDER BY created_at DESC, id DESC`, args...)
	return shares, err
}

// UpsertContentShare 创建或覆盖共享授权。
func (r *AccessRepo) UpsertContentShare(ctx context.Context, s *model.ContentShare) (*model.ContentShare, error) {
	var out model.ContentShare
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO content_shares (resource_type, resource_id, principal_type, principal_id, permission_level, granted_by, expires_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
		ON CONFLICT (resource_type, resource_id, principal_type, principal_id)
		DO UPDATE SET permission_level=EXCLUDED.permission_level,
		              granted_by=EXCLUDED.granted_by,
		              expires_at=EXCLUDED.expires_at,
		              updated_at=NOW()
		RETURNING *`,
		s.ResourceType, s.ResourceID, s.PrincipalType, s.PrincipalID, s.PermissionLevel, s.GrantedBy, s.ExpiresAt,
	).StructScan(&out)
	return &out, err
}

// DeleteContentShare 删除共享授权。
func (r *AccessRepo) DeleteContentShare(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM content_shares WHERE id=$1`, id)
	return err
}

// UserContentPermissionLevel 返回用户对指定资源的最高共享权限。
func (r *AccessRepo) UserContentPermissionLevel(ctx context.Context, userID int64, legacyRole, resourceType string, resourceID int64) (string, error) {
	if strings.EqualFold(legacyRole, "ADMIN") {
		return "MANAGE", nil
	}
	var level sql.NullString
	err := r.db.GetContext(ctx, &level, `
		WITH user_role_ids AS (
			SELECT r.id
			FROM user_roles ur
			JOIN roles r ON r.id = ur.role_id
			WHERE ur.user_id = $1
			UNION
			SELECT r.id
			FROM users u
			JOIN roles r ON r.code = u.role
			WHERE u.id = $1
		),
		user_team_ids AS (
			SELECT team_id
			FROM team_members
			WHERE user_id = $1 AND status = 'ACTIVE'
		),
		candidate AS (
			SELECT permission_level
			FROM content_shares
			WHERE resource_type = $2
			  AND resource_id = $3
			  AND (expires_at IS NULL OR expires_at > NOW())
			  AND (
				(principal_type = 'USER' AND principal_id = $1)
				OR (principal_type = 'TEAM' AND principal_id IN (SELECT team_id FROM user_team_ids))
				OR (principal_type = 'ROLE' AND principal_id IN (SELECT id FROM user_role_ids))
			  )
		)
		SELECT permission_level
		FROM candidate
		ORDER BY CASE permission_level
			WHEN 'MANAGE' THEN 4
			WHEN 'EDIT' THEN 3
			WHEN 'COMMENT' THEN 2
			WHEN 'VIEW' THEN 1
			ELSE 0
		END DESC
		LIMIT 1`, userID, resourceType, resourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !level.Valid {
		return "", nil
	}
	return level.String, nil
}

// HashPassword 仅供 AccessService 创建/重置用户时复用同一 bcrypt cost。
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}
