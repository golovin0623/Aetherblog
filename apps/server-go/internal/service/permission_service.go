package service

import (
	"context"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

type PermissionService struct {
	repo *repository.PermissionRepo
}

func NewPermissionService(repo *repository.PermissionRepo) *PermissionService {
	return &PermissionService{repo: repo}
}

func (s *PermissionService) GetByFolderID(ctx context.Context, folderID int64) ([]dto.FolderPermissionVO, error) {
	perms, err := s.repo.FindByFolderID(ctx, folderID)
	if err != nil {
		return nil, err
	}
	return toPermissionVOs(perms), nil
}

func (s *PermissionService) Grant(ctx context.Context, folderID int64, req dto.GrantPermissionRequest, grantedBy *int64) (*dto.FolderPermissionVO, error) {
	p := &model.FolderPermission{
		FolderID:        folderID,
		UserID:          req.UserID,
		PermissionLevel: req.PermissionLevel,
		GrantedBy:       grantedBy,
	}
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

func (s *PermissionService) Revoke(ctx context.Context, permissionID int64) error {
	return s.repo.Delete(ctx, permissionID)
}

// --- Helpers ---

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

func toPermissionVOs(perms []model.FolderPermission) []dto.FolderPermissionVO {
	vos := make([]dto.FolderPermissionVO, len(perms))
	for i, p := range perms {
		vos[i] = toPermissionVO(p)
	}
	return vos
}
