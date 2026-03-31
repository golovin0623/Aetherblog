package service

import (
	"context"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// MediaTagService 管理媒体标签及文件与标签之间的关联关系。
type MediaTagService struct {
	repo *repository.MediaTagRepo
}

// NewMediaTagService 创建一个由给定仓储支持的 MediaTagService 实例。
func NewMediaTagService(repo *repository.MediaTagRepo) *MediaTagService {
	return &MediaTagService{repo: repo}
}

// GetAll 返回所有媒体标签，按使用次数降序排列。
func (s *MediaTagService) GetAll(ctx context.Context) ([]dto.MediaTagVO, error) {
	tags, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return toMediaTagVOs(tags), nil
}

// GetPopular 返回使用频率最高的前 N 个标签。
// 当 limit <= 0 时，默认取 20 个。
func (s *MediaTagService) GetPopular(ctx context.Context, limit int) ([]dto.MediaTagVO, error) {
	if limit <= 0 {
		limit = 20
	}
	tags, err := s.repo.FindPopular(ctx, limit)
	if err != nil {
		return nil, err
	}
	return toMediaTagVOs(tags), nil
}

// Search 返回名称或 slug 中包含关键词的标签（大小写不敏感）。
func (s *MediaTagService) Search(ctx context.Context, keyword string) ([]dto.MediaTagVO, error) {
	tags, err := s.repo.Search(ctx, keyword)
	if err != nil {
		return nil, err
	}
	return toMediaTagVOs(tags), nil
}

// Create 创建一个新的媒体标签，slug 由名称自动生成。
// 当颜色或分类缺省时，分别默认为 "#6366f1" 和 "CUSTOM"。
func (s *MediaTagService) Create(ctx context.Context, req dto.CreateMediaTagRequest) (*dto.MediaTagVO, error) {
	// 设置默认颜色
	color := "#6366f1"
	if req.Color != nil {
		color = *req.Color
	}
	// 设置默认分类
	category := "CUSTOM"
	if req.Category != nil {
		category = *req.Category
	}

	t := &model.MediaTag{
		Name:        req.Name,
		Slug:        slugify(req.Name),
		Description: req.Description,
		Color:       color,
		Category:    category,
	}
	if err := s.repo.Create(ctx, t); err != nil {
		return nil, err
	}
	vo := toMediaTagVO(*t)
	return &vo, nil
}

// Delete 永久删除指定媒体标签。
func (s *MediaTagService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// GetFileTags 返回媒体文件上挂载的所有标签。
func (s *MediaTagService) GetFileTags(ctx context.Context, fileID int64) ([]dto.MediaTagVO, error) {
	tags, err := s.repo.FindTagsByFileID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	return toMediaTagVOs(tags), nil
}

// TagFile 将多个标签关联到指定媒体文件，已存在的关联会被跳过。
// 每次成功新增关联时，对应标签的 usage_count 会加 1。
func (s *MediaTagService) TagFile(ctx context.Context, fileID int64, tagIDs []int64, taggedBy *int64) error {
	for _, tagID := range tagIDs {
		// 检查关联是否已存在，避免重复打标
		n, err := s.repo.CountFileTag(ctx, fileID, tagID)
		if err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if err := s.repo.TagFile(ctx, fileID, tagID, taggedBy); err != nil {
			return err
		}
		// 递增该标签的使用计数
		if err := s.repo.IncrementUsageCount(ctx, tagID, 1); err != nil {
			return err
		}
	}
	return nil
}

// UntagFile 从媒体文件上移除指定标签，并将该标签的 usage_count 减 1。
func (s *MediaTagService) UntagFile(ctx context.Context, fileID int64, tagID int64) error {
	// 先确认关联存在
	n, err := s.repo.CountFileTag(ctx, fileID, tagID)
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	if err := s.repo.UntagFile(ctx, fileID, tagID); err != nil {
		return err
	}
	// 递减该标签的使用计数
	return s.repo.IncrementUsageCount(ctx, tagID, -1)
}

// BatchTag 将单个标签批量关联到多个媒体文件，已存在的关联会被跳过。
func (s *MediaTagService) BatchTag(ctx context.Context, fileIDs []int64, tagID int64, taggedBy *int64) error {
	for _, fileID := range fileIDs {
		// 检查关联是否已存在
		n, err := s.repo.CountFileTag(ctx, fileID, tagID)
		if err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if err := s.repo.TagFile(ctx, fileID, tagID, taggedBy); err != nil {
			return err
		}
		// 递增使用计数
		if err := s.repo.IncrementUsageCount(ctx, tagID, 1); err != nil {
			return err
		}
	}
	return nil
}

// --- 内部辅助函数 ---

// toMediaTagVO 将 MediaTag 模型转换为视图对象。
func toMediaTagVO(t model.MediaTag) dto.MediaTagVO {
	return dto.MediaTagVO{
		ID:          t.ID,
		Name:        t.Name,
		Slug:        t.Slug,
		Description: t.Description,
		Color:       t.Color,
		Category:    t.Category,
		UsageCount:  t.UsageCount,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
	}
}

// toMediaTagVOs 批量将 MediaTag 模型列表转换为视图对象列表。
func toMediaTagVOs(tags []model.MediaTag) []dto.MediaTagVO {
	vos := make([]dto.MediaTagVO, len(tags))
	for i, t := range tags {
		vos[i] = toMediaTagVO(t)
	}
	return vos
}

// slugify 将任意字符串转换为 URL 友好的 slug。
// 保留英文字母、数字、多字节字符（如中文）以及连字符；
// 空格和下划线替换为连字符；首尾连字符被裁除；空字符串时返回 "tag"。
func slugify(s string) string {
	s = strings.ToLower(s)
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r > 127 {
			sb.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '_' {
			sb.WriteRune('-')
		}
	}
	result := strings.Trim(sb.String(), "-")
	if result == "" {
		result = "tag"
	}
	return result
}
