package service

import (
	"context"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// PermissionService 管理媒体文件夹的访问权限授予与撤销。
type PermissionService struct {
	repo *repository.PermissionRepo
}

// NewPermissionService 创建一个由给定仓储支持的 PermissionService 实例。
func NewPermissionService(repo *repository.PermissionRepo) *PermissionService {
	return &PermissionService{repo: repo}
}

// GetByFolderID 返回指定文件夹的所有权限授予记录。
func (s *PermissionService) GetByFolderID(ctx context.Context, folderID int64) ([]dto.FolderPermissionVO, error) {
	perms, err := s.repo.FindByFolderID(ctx, folderID)
	if err != nil {
		return nil, err
	}
	return toPermissionVOs(perms), nil
}

// Grant 为指定用户在指定文件夹上创建一条权限授予记录。
// 若请求中包含 ExpiresAt（RFC3339 格式），则解析并写入过期时间；解析失败时忽略该字段。
func (s *PermissionService) Grant(ctx context.Context, folderID int64, req dto.GrantPermissionRequest, grantedBy *int64) (*dto.FolderPermissionVO, error) {
	p := &model.FolderPermission{
		FolderID:        folderID,
		UserID:          req.UserID,
		PermissionLevel: req.PermissionLevel,
		GrantedBy:       grantedBy,
	}
	// 解析可选的过期时间（RFC3339 格式）
	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err == nil {
			p.ExpiresAt = &t
		}
	}
	if err := s.repo.Create(ctx, p); err != nil {
		return nil, err
	}
	vo := toPermissionVO(*p)
	return &vo, nil
}

// Update 修改已有权限授予记录的权限级别或过期时间。
// 修改后重新查询并返回最新的权限视图对象。
func (s *PermissionService) Update(ctx context.Context, permissionID int64, req dto.UpdatePermissionRequest) (*dto.FolderPermissionVO, error) {
	if err := s.repo.Update(ctx, permissionID, req.PermissionLevel, req.ExpiresAt); err != nil {
		return nil, err
	}
	p, err := s.repo.FindByID(ctx, permissionID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, nil
	}
	vo := toPermissionVO(*p)
	return &vo, nil
}

// Revoke 按主键永久删除一条权限授予记录。
func (s *PermissionService) Revoke(ctx context.Context, permissionID int64) error {
	return s.repo.Delete(ctx, permissionID)
}

// GetFolderID 返回指定权限记录所关联的 folder_id，用于 handler 层 ownership
// 校验（caller 必须是该 folder 的 owner 或 admin 才能改/撤权限）。
// 记录不存在时返回 (0, false, nil)。
func (s *PermissionService) GetFolderID(ctx context.Context, permissionID int64) (folderID int64, found bool, err error) {
	p, err := s.repo.FindByID(ctx, permissionID)
	if err != nil {
		return 0, false, err
	}
	if p == nil {
		return 0, false, nil
	}
	return p.FolderID, true, nil
}

// --- 内部辅助函数 ---

// toPermissionVO 将 FolderPermission 模型转换为视图对象。
func toPermissionVO(p model.FolderPermission) dto.FolderPermissionVO {
	return dto.FolderPermissionVO{
		ID:              p.ID,
		FolderID:        p.FolderID,
		UserID:          p.UserID,
		PermissionLevel: p.PermissionLevel,
		GrantedBy:       p.GrantedBy,
		GrantedAt:       p.GrantedAt,
		ExpiresAt:       p.ExpiresAt,
	}
}

// toPermissionVOs 批量将 FolderPermission 模型列表转换为视图对象列表。
func toPermissionVOs(perms []model.FolderPermission) []dto.FolderPermissionVO {
	vos := make([]dto.FolderPermissionVO, len(perms))
	for i, p := range perms {
		vos[i] = toPermissionVO(p)
	}
	return vos
}
