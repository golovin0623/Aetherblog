package service

import (
	"context"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// StorageProviderService 管理可配置的存储后端（本地、S3、OSS 等）。
type StorageProviderService struct {
	repo *repository.StorageProviderRepo
}

// NewStorageProviderService 创建一个由给定仓储支持的 StorageProviderService 实例。
func NewStorageProviderService(repo *repository.StorageProviderRepo) *StorageProviderService {
	return &StorageProviderService{repo: repo}
}

// List 返回所有已注册的存储提供商，按优先级升序排列。
func (s *StorageProviderService) List(ctx context.Context) ([]dto.StorageProviderVO, error) {
	ps, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return toProviderVOs(ps), nil
}

// GetByID 按主键返回存储提供商，不存在时返回 nil。
func (s *StorageProviderService) GetByID(ctx context.Context, id int64) (*dto.StorageProviderVO, error) {
	p, err := s.repo.FindByID(ctx, id)
	if err != nil || p == nil {
		return nil, err
	}
	vo := toProviderVO(*p)
	return &vo, nil
}

// GetDefault 返回当前被标记为默认且已启用的存储提供商，不存在时返回 nil。
func (s *StorageProviderService) GetDefault(ctx context.Context) (*dto.StorageProviderVO, error) {
	p, err := s.repo.FindDefault(ctx)
	if err != nil || p == nil {
		return nil, err
	}
	vo := toProviderVO(*p)
	return &vo, nil
}

// Create 注册一个新的存储提供商。
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

// Update 修改已有存储提供商的配置信息。
func (s *StorageProviderService) Update(ctx context.Context, id int64, req dto.StorageProviderRequest) error {
	return s.repo.Update(ctx, id, repository.StorageProviderRequest{
		Name:         req.Name,
		ProviderType: req.ProviderType,
		ConfigJSON:   req.ConfigJSON,
		IsEnabled:    req.IsEnabled,
		Priority:     req.Priority,
	})
}

// Delete 永久删除指定存储提供商。
func (s *StorageProviderService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// SetDefault 将指定提供商标记为默认存储，并同时清除其他提供商的默认标记。
func (s *StorageProviderService) SetDefault(ctx context.Context, id int64) error {
	return s.repo.SetDefault(ctx, id)
}

// Test 验证存储提供商的连通性。
// 本地存储（LOCAL）直接返回成功；S3 兼容存储通过 HeadBucket 验证；
// 其他类型在配置可解析时视为有效。
// 错误场景：提供商不存在、配置解析失败、网络连接失败。
func (s *StorageProviderService) Test(ctx context.Context, id int64) (bool, string) {
	p, err := s.repo.FindByID(ctx, id)
	if err != nil || p == nil {
		return false, "提供商不存在"
	}
	// 本地存储无需网络验证，直接返回成功
	if p.ProviderType == "LOCAL" {
		return true, "本地存储连接正常"
	}
	// 尝试解析配置并创建存储实例以验证连通性
	store, err := storage.NewFromConfig(p.ProviderType, p.ConfigJSON)
	if err != nil {
		return false, "配置解析失败: " + err.Error()
	}
	// S3 兼容存储：通过 HeadBucket 验证连接
	if s3Store, ok := store.(*storage.S3Storage); ok {
		if err := s3Store.TestConnection(ctx); err != nil {
			return false, "连接失败: " + err.Error()
		}
		return true, "S3 存储连接正常"
	}
	return true, "存储配置有效"
}

// --- 内部辅助函数 ---

// toProviderVO 将 StorageProvider 模型转换为视图对象。
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

// toProviderVOs 批量将 StorageProvider 模型列表转换为视图对象列表。
func toProviderVOs(ps []model.StorageProvider) []dto.StorageProviderVO {
	vos := make([]dto.StorageProviderVO, len(ps))
	for i, p := range ps {
		vos[i] = toProviderVO(p)
	}
	return vos
}
