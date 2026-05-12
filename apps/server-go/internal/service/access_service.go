package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// AccessService 负责 RBAC、团队成员和内容共享授权的业务逻辑。
type AccessService struct {
	repo *repository.AccessRepo
}

// NewAccessService 创建 AccessService。
func NewAccessService(repo *repository.AccessRepo) *AccessService {
	return &AccessService{repo: repo}
}

// UserHasPermission 供 RBAC middleware 调用，判断当前用户是否拥有指定权限。
func (s *AccessService) UserHasPermission(ctx context.Context, userID int64, legacyRole string, permissionCode string) (bool, error) {
	if strings.EqualFold(legacyRole, "ADMIN") {
		return true, nil
	}
	return s.repo.UserHasPermission(ctx, userID, legacyRole, permissionCode)
}

// UserAccess 返回当前用户的角色与权限代码。
func (s *AccessService) UserAccess(ctx context.Context, userID int64, legacyRole string) ([]string, []string, error) {
	roles, err := s.repo.GetUserRoleCodes(ctx, userID, legacyRole)
	if err != nil {
		return nil, nil, err
	}
	perms, err := s.repo.GetUserPermissionCodes(ctx, userID, legacyRole)
	if err != nil {
		return nil, nil, err
	}
	return roles, perms, nil
}

// ListUsers 返回管理后台用户分页。
func (s *AccessService) ListUsers(ctx context.Context, f repository.UserListFilter) (*response.PageResult, error) {
	if f.PageNum < 1 {
		f.PageNum = 1
	}
	if f.PageSize <= 0 {
		f.PageSize = 20
	}
	rows, total, err := s.repo.ListUsers(ctx, f)
	if err != nil {
		return nil, err
	}
	items := make([]dto.ManagedUserVO, len(rows))
	for i := range rows {
		items[i] = managedUserVO(rows[i])
	}
	pr := response.NewPageResult(items, total, f.PageNum, f.PageSize)
	return &pr, nil
}

// CreateUser 创建新用户并分配角色。
func (s *AccessService) CreateUser(ctx context.Context, req dto.CreateManagedUserRequest, actorID *int64) (*dto.ManagedUserVO, error) {
	roleCodes := normalizeRoleCodes(req.RoleCodes)
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	if status == "" {
		status = "ACTIVE"
	}
	nickname := nullString(req.Nickname)
	row, err := s.repo.CreateUserWithRoles(ctx, repository.CreateUserInput{
		Username:           strings.TrimSpace(req.Username),
		Email:              strings.TrimSpace(req.Email),
		PasswordHash:       string(hash),
		Nickname:           nickname,
		Role:               roleCodes[0],
		Status:             status,
		MustChangePassword: req.MustChangePassword,
		RoleCodes:          roleCodes,
		AssignedBy:         actorID,
	})
	if err != nil {
		return nil, err
	}
	vo := managedUserVO(*row)
	return &vo, nil
}

// UpdateUser 更新用户资料、状态和角色。若目标是最后一个管理员，不允许移除其 ADMIN 能力。
func (s *AccessService) UpdateUser(ctx context.Context, id int64, req dto.UpdateManagedUserRequest, actorID *int64) (*dto.ManagedUserVO, error) {
	roleCodes := normalizeRoleCodes(req.RoleCodes)
	if err := s.preventLastAdminLoss(ctx, id, roleCodes, req.Status); err != nil {
		return nil, err
	}
	row, err := s.repo.UpdateUserWithRoles(ctx, id, repository.UpdateUserInput{
		Email:              trimStringPtr(req.Email),
		Nickname:           req.Nickname,
		Bio:                req.Bio,
		Status:             upperStringPtr(req.Status),
		MustChangePassword: req.MustChangePassword,
		RoleCodes:          roleCodes,
		AssignedBy:         actorID,
	})
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	vo := managedUserVO(*row)
	return &vo, nil
}

// AssignRoles 替换用户角色。
func (s *AccessService) AssignRoles(ctx context.Context, id int64, req dto.AssignUserRolesRequest, actorID *int64) (*dto.ManagedUserVO, error) {
	roleCodes := normalizeRoleCodes(req.RoleCodes)
	if err := s.preventLastAdminLoss(ctx, id, roleCodes, nil); err != nil {
		return nil, err
	}
	row, err := s.repo.UpdateUserWithRoles(ctx, id, repository.UpdateUserInput{
		RoleCodes:  roleCodes,
		AssignedBy: actorID,
	})
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	vo := managedUserVO(*row)
	return &vo, nil
}

// ResetPassword 重置用户密码。
func (s *AccessService) ResetPassword(ctx context.Context, id int64, req dto.ResetUserPasswordRequest) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	return s.repo.ResetPassword(ctx, id, string(hash), req.MustChangePassword)
}

func (s *AccessService) preventLastAdminLoss(ctx context.Context, userID int64, nextRoles []string, nextStatus *string) error {
	isAdmin, err := s.repo.UserHasAdminRole(ctx, userID)
	if err != nil {
		return err
	}
	if !isAdmin {
		return nil
	}
	willHaveAdmin := containsString(nextRoles, "ADMIN")
	statusActive := true
	if nextStatus != nil && strings.ToUpper(strings.TrimSpace(*nextStatus)) != "ACTIVE" {
		statusActive = false
	}
	if willHaveAdmin && statusActive {
		return nil
	}
	admins, err := s.repo.CountActiveAdmins(ctx)
	if err != nil {
		return err
	}
	if admins <= 1 {
		return errors.New("至少需要保留一个可用的管理员账号")
	}
	return nil
}

// ListRoles 返回角色权限矩阵。
func (s *AccessService) ListRoles(ctx context.Context) ([]dto.RoleVO, error) {
	roles, err := s.repo.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	roleIDs := make([]int64, len(roles))
	for i := range roles {
		roleIDs[i] = roles[i].ID
	}
	permsByRole, err := s.repo.ListPermissionsByRoleIDs(ctx, roleIDs)
	if err != nil {
		return nil, err
	}
	out := make([]dto.RoleVO, len(roles))
	for i, r := range roles {
		out[i] = roleVO(r, permsByRole[r.ID])
	}
	return out, nil
}

// ListPermissions 返回所有权限。
func (s *AccessService) ListPermissions(ctx context.Context) ([]dto.PermissionVO, error) {
	perms, err := s.repo.ListPermissions(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]dto.PermissionVO, len(perms))
	for i := range perms {
		out[i] = permissionVO(perms[i])
	}
	return out, nil
}

// UpdateRolePermissions 替换角色权限集合。
func (s *AccessService) UpdateRolePermissions(ctx context.Context, roleID int64, req dto.UpdateRolePermissionsRequest) (*dto.RoleVO, error) {
	codes := normalizePermissionCodes(req.PermissionCodes)
	if err := s.repo.SetRolePermissions(ctx, roleID, codes); err != nil {
		return nil, err
	}
	roles, err := s.ListRoles(ctx)
	if err != nil {
		return nil, err
	}
	for i := range roles {
		if roles[i].ID == roleID {
			return &roles[i], nil
		}
	}
	return nil, nil
}

// ListTeams 返回团队列表。
func (s *AccessService) ListTeams(ctx context.Context) ([]dto.TeamVO, error) {
	rows, err := s.repo.ListTeams(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]dto.TeamVO, len(rows))
	for i := range rows {
		out[i] = teamVO(rows[i])
	}
	return out, nil
}

// CreateTeam 创建团队。
func (s *AccessService) CreateTeam(ctx context.Context, req dto.CreateTeamRequest, actorID *int64) (*dto.TeamVO, error) {
	visibility := strings.ToUpper(strings.TrimSpace(req.Visibility))
	if visibility == "" {
		visibility = "PRIVATE"
	}
	t := &model.Team{
		Name:        strings.TrimSpace(req.Name),
		Slug:        strings.TrimSpace(req.Slug),
		Description: req.Description,
		OwnerID:     req.OwnerID,
		Visibility:  visibility,
		CreatedBy:   actorID,
	}
	row, err := s.repo.CreateTeam(ctx, t)
	if err != nil {
		return nil, err
	}
	vo := teamVO(*row)
	return &vo, nil
}

// UpdateTeam 更新团队。
func (s *AccessService) UpdateTeam(ctx context.Context, id int64, req dto.UpdateTeamRequest) (*dto.TeamVO, error) {
	existing, err := s.repo.FindTeam(ctx, id)
	if err != nil || existing == nil {
		return nil, err
	}
	next := existing.Team
	if req.Name != nil {
		next.Name = strings.TrimSpace(*req.Name)
	}
	if req.Slug != nil {
		next.Slug = strings.TrimSpace(*req.Slug)
	}
	if req.Description != nil {
		next.Description = req.Description
	}
	if req.OwnerID != nil {
		next.OwnerID = req.OwnerID
	}
	if req.Visibility != nil {
		next.Visibility = strings.ToUpper(strings.TrimSpace(*req.Visibility))
	}
	row, err := s.repo.UpdateTeam(ctx, id, &next)
	if err != nil || row == nil {
		return nil, err
	}
	vo := teamVO(*row)
	return &vo, nil
}

// ListTeamMembers 返回团队成员。
func (s *AccessService) ListTeamMembers(ctx context.Context, teamID int64) ([]dto.TeamMemberVO, error) {
	rows, err := s.repo.ListTeamMembers(ctx, teamID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.TeamMemberVO, len(rows))
	for i := range rows {
		out[i] = teamMemberVO(rows[i])
	}
	return out, nil
}

// UpsertTeamMember 新增或更新团队成员。
func (s *AccessService) UpsertTeamMember(ctx context.Context, teamID int64, req dto.UpsertTeamMemberRequest, actorID *int64) (*dto.TeamMemberVO, error) {
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	if status == "" {
		status = "ACTIVE"
	}
	row, err := s.repo.UpsertTeamMember(ctx, &model.TeamMember{
		TeamID:     teamID,
		UserID:     req.UserID,
		MemberRole: strings.ToUpper(strings.TrimSpace(req.MemberRole)),
		Status:     status,
		AddedBy:    actorID,
	})
	if err != nil || row == nil {
		return nil, err
	}
	vo := teamMemberVO(*row)
	return &vo, nil
}

// RemoveTeamMember 移除团队成员。
func (s *AccessService) RemoveTeamMember(ctx context.Context, teamID, userID int64) error {
	return s.repo.RemoveTeamMember(ctx, teamID, userID)
}

// ListContentShares 返回内容共享授权。
func (s *AccessService) ListContentShares(ctx context.Context, f repository.ContentShareFilter) ([]dto.ContentShareVO, error) {
	shares, err := s.repo.ListContentShares(ctx, f)
	if err != nil {
		return nil, err
	}
	out := make([]dto.ContentShareVO, len(shares))
	for i := range shares {
		out[i] = contentShareVO(shares[i])
	}
	return out, nil
}

// CreateContentShare 创建或覆盖内容共享授权。
func (s *AccessService) CreateContentShare(ctx context.Context, req dto.CreateContentShareRequest, actorID *int64) (*dto.ContentShareVO, error) {
	var expiresAt *time.Time
	if req.ExpiresAt != nil && strings.TrimSpace(*req.ExpiresAt) != "" {
		t, err := parseAccessTime(*req.ExpiresAt)
		if err != nil {
			return nil, fmt.Errorf("过期时间格式错误")
		}
		expiresAt = &t
	}
	share, err := s.repo.UpsertContentShare(ctx, &model.ContentShare{
		ResourceType:    strings.ToUpper(req.ResourceType),
		ResourceID:      req.ResourceID,
		PrincipalType:   strings.ToUpper(req.PrincipalType),
		PrincipalID:     req.PrincipalID,
		PermissionLevel: strings.ToUpper(req.PermissionLevel),
		GrantedBy:       actorID,
		ExpiresAt:       expiresAt,
	})
	if err != nil {
		return nil, err
	}
	vo := contentShareVO(*share)
	return &vo, nil
}

// DeleteContentShare 删除内容共享授权。
func (s *AccessService) DeleteContentShare(ctx context.Context, id int64) error {
	return s.repo.DeleteContentShare(ctx, id)
}

// UserCanAccessContent 判断用户是否通过角色、团队或直接授权访问指定资源。
func (s *AccessService) UserCanAccessContent(ctx context.Context, userID int64, legacyRole, resourceType string, resourceID int64, requiredLevel string) (bool, error) {
	level, err := s.repo.UserContentPermissionLevel(ctx, userID, legacyRole, strings.ToUpper(resourceType), resourceID)
	if err != nil {
		return false, err
	}
	return contentPermissionAllows(level, requiredLevel), nil
}

func parseAccessTime(raw string) (time.Time, error) {
	s := strings.TrimSpace(raw)
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time")
}

func contentPermissionAllows(granted, required string) bool {
	levels := map[string]int{
		"VIEW":    1,
		"COMMENT": 2,
		"EDIT":    3,
		"MANAGE":  4,
	}
	g, okG := levels[strings.ToUpper(strings.TrimSpace(granted))]
	r, okR := levels[strings.ToUpper(strings.TrimSpace(required))]
	return okG && okR && g >= r
}

func normalizeRoleCodes(codes []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(codes))
	for _, code := range codes {
		c := strings.ToUpper(strings.TrimSpace(code))
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	if len(out) == 0 {
		return []string{"USER"}
	}
	return out
}

func normalizePermissionCodes(codes []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(codes))
	for _, code := range codes {
		c := strings.TrimSpace(code)
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	return out
}

func containsString(values []string, target string) bool {
	for _, v := range values {
		if v == target {
			return true
		}
	}
	return false
}

func nullString(s string) *string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func trimStringPtr(v *string) *string {
	if v == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*v)
	return &trimmed
}

func upperStringPtr(v *string) *string {
	if v == nil {
		return nil
	}
	upper := strings.ToUpper(strings.TrimSpace(*v))
	return &upper
}

func managedUserVO(row repository.ManagedUserRow) dto.ManagedUserVO {
	return dto.ManagedUserVO{
		ID:                 row.ID,
		Username:           row.Username,
		Email:              row.Email,
		Nickname:           row.Nickname,
		Avatar:             row.Avatar,
		Bio:                row.Bio,
		Role:               row.Role,
		Roles:              splitCSV(row.RolesCSV, row.Role),
		Status:             row.Status,
		MustChangePassword: row.MustChangePassword,
		LastLoginAt:        row.LastLoginAt,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
	}
}

func splitCSV(csv string, fallback string) []string {
	if strings.TrimSpace(csv) == "" {
		if fallback == "" {
			return []string{"USER"}
		}
		return []string{fallback}
	}
	parts := strings.Split(csv, ",")
	return normalizeRoleCodes(parts)
}

func permissionVO(p model.Permission) dto.PermissionVO {
	return dto.PermissionVO{
		ID:          p.ID,
		Code:        p.Code,
		Module:      p.Module,
		Action:      p.Action,
		Name:        p.Name,
		Description: p.Description,
	}
}

func roleVO(r model.Role, perms []model.Permission) dto.RoleVO {
	out := dto.RoleVO{
		ID:          r.ID,
		Code:        r.Code,
		Name:        r.Name,
		Description: r.Description,
		IsSystem:    r.IsSystem,
		SortOrder:   r.SortOrder,
		Permissions: make([]dto.PermissionVO, len(perms)),
	}
	for i := range perms {
		out.Permissions[i] = permissionVO(perms[i])
	}
	sort.Slice(out.Permissions, func(i, j int) bool { return out.Permissions[i].Code < out.Permissions[j].Code })
	return out
}

func teamVO(row repository.TeamRow) dto.TeamVO {
	return dto.TeamVO{
		ID:          row.ID,
		Name:        row.Name,
		Slug:        row.Slug,
		Description: row.Description,
		OwnerID:     row.OwnerID,
		Visibility:  row.Visibility,
		MemberCount: row.MemberCount,
		CreatedBy:   row.CreatedBy,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func teamMemberVO(row repository.TeamMemberRow) dto.TeamMemberVO {
	return dto.TeamMemberVO{
		TeamID:     row.TeamID,
		UserID:     row.UserID,
		Username:   row.Username,
		Nickname:   row.Nickname,
		Email:      row.Email,
		MemberRole: row.MemberRole,
		Status:     row.Status,
		AddedBy:    row.AddedBy,
		JoinedAt:   row.JoinedAt,
	}
}

func contentShareVO(s model.ContentShare) dto.ContentShareVO {
	return dto.ContentShareVO{
		ID:              s.ID,
		ResourceType:    s.ResourceType,
		ResourceID:      s.ResourceID,
		PrincipalType:   s.PrincipalType,
		PrincipalID:     s.PrincipalID,
		PermissionLevel: s.PermissionLevel,
		GrantedBy:       s.GrantedBy,
		ExpiresAt:       s.ExpiresAt,
		CreatedAt:       s.CreatedAt,
		UpdatedAt:       s.UpdatedAt,
	}
}
