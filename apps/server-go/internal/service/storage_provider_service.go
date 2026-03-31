package service

import (
	"context"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// StorageProviderService manages configurable storage backends (local, S3, OSS, etc.).
type StorageProviderService struct {
	repo *repository.StorageProviderRepo
}

// NewStorageProviderService creates a StorageProviderService backed by the given repository.
func NewStorageProviderService(repo *repository.StorageProviderRepo) *StorageProviderService {
	return &StorageProviderService{repo: repo}
}

// List returns all registered storage providers ordered by priority.
func (s *StorageProviderService) List(ctx context.Context) ([]dto.StorageProviderVO, error) {
	ps, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return toProviderVOs(ps), nil
}

// GetByID returns a storage provider by primary key, or nil if not found.
func (s *StorageProviderService) GetByID(ctx context.Context, id int64) (*dto.StorageProviderVO, error) {
	p, err := s.repo.FindByID(ctx, id)
	if err != nil || p == nil {
		return nil, err
	}
	vo := toProviderVO(*p)
	return &vo, nil
}

// GetDefault returns the enabled provider marked as default, or nil if none.
func (s *StorageProviderService) GetDefault(ctx context.Context) (*dto.StorageProviderVO, error) {
	p, err := s.repo.FindDefault(ctx)
	if err != nil || p == nil {
		return nil, err
	}
	vo := toProviderVO(*p)
	return &vo, nil
}

// Create registers a new storage provider.
func (s *StorageProviderService) Create(ctx context.Context, req dto.StorageProviderRequest) (*dto.StorageProviderVO, error) {
	p, err := s.repo.Create(ctx, repository.StorageProviderRequest{
		Name:         req.Name,
		ProviderType: req.ProviderType,
		ConfigJSON:   req.ConfigJSON,
		IsEnabled:    req.IsEnabled,
		Priority:     req.Priority,
	})
	if err != nil {
		return nil, err
	}
	vo := toProviderVO(*p)
	return &vo, nil
}

// Update modifies an existing storage provider's configuration.
func (s *StorageProviderService) Update(ctx context.Context, id int64, req dto.StorageProviderRequest) error {
	return s.repo.Update(ctx, id, repository.StorageProviderRequest{
		Name:         req.Name,
		ProviderType: req.ProviderType,
		ConfigJSON:   req.ConfigJSON,
		IsEnabled:    req.IsEnabled,
		Priority:     req.Priority,
	})
}

// Delete permanently removes a storage provider.
func (s *StorageProviderService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// SetDefault marks a provider as the default (clears the flag on all others first).
func (s *StorageProviderService) SetDefault(ctx context.Context, id int64) error {
	return s.repo.SetDefault(ctx, id)
}

// Test validates provider connectivity.
func (s *StorageProviderService) Test(ctx context.Context, id int64) (bool, string) {
	p, err := s.repo.FindByID(ctx, id)
	if err != nil || p == nil {
		return false, "提供商不存在"
	}
	if p.ProviderType == "LOCAL" {
		return true, "本地存储连接正常"
	}
	// Try to create a storage instance and test connectivity
	store, err := storage.NewFromConfig(p.ProviderType, p.ConfigJSON)
	if err != nil {
		return false, "配置解析失败: " + err.Error()
	}
	// S3-compatible: test with HeadBucket
	if s3Store, ok := store.(*storage.S3Storage); ok {
		if err := s3Store.TestConnection(ctx); err != nil {
			return false, "连接失败: " + err.Error()
		}
		return true, "S3 存储连接正常"
	}
	return true, "存储配置有效"
}

// --- Helpers ---

func toProviderVO(p model.StorageProvider) dto.StorageProviderVO {
	return dto.StorageProviderVO{
		ID:           p.ID,
		Name:         p.Name,
		ProviderType: p.ProviderType,
		ConfigJSON:   p.ConfigJSON,
		IsDefault:    p.IsDefault,
		IsEnabled:    p.IsEnabled,
		Priority:     p.Priority,
		CreatedAt:    p.CreatedAt,
	}
}

func toProviderVOs(ps []model.StorageProvider) []dto.StorageProviderVO {
	vos := make([]dto.StorageProviderVO, len(ps))
	for i, p := range ps {
		vos[i] = toProviderVO(p)
	}
	return vos
}
