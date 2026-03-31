package service

import (
	"context"
	"errors"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// TagService 管理博客文章标签。
type TagService struct{ repo *repository.TagRepo }

// NewTagService 创建一个由给定仓储支持的 TagService 实例。
func NewTagService(repo *repository.TagRepo) *TagService { return &TagService{repo: repo} }

// List 返回所有标签，按名称升序排列。
func (s *TagService) List(ctx context.Context) ([]dto.TagVO, error) {
	tags, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	vos := make([]dto.TagVO, len(tags))
	for i, t := range tags {
		vos[i] = tagVO(&t)
	}
	return vos, nil
}

// GetByID 按主键返回单个标签，不存在时返回 nil。
func (s *TagService) GetByID(ctx context.Context, id int64) (*dto.TagVO, error) {
	t, err := s.repo.FindByID(ctx, id)
	if err != nil || t == nil {
		return nil, err
	}
	vo := tagVO(t)
	return &vo, nil
}

// Create 创建新标签。
// 业务规则：
//   - 未提供 slug 时，从名称自动生成；
//   - 未提供颜色时，默认为 "#6366f1"（靛蓝色）；
//   - slug 已存在时返回错误。
func (s *TagService) Create(ctx context.Context, req dto.TagRequest) (*dto.TagVO, error) {
	if req.Slug == "" {
		req.Slug = generateTagSlug(req.Name)
	}
	// 检查 slug 唯一性
	if existing, _ := s.repo.FindBySlug(ctx, req.Slug); existing != nil {
		return nil, errors.New("标签 slug 已存在")
	}
	color := req.Color
	if color == "" {
		color = "#6366f1"
	}
	m := &model.Tag{Name: req.Name, Slug: req.Slug, Description: req.Description, Color: color}
	out, err := s.repo.Create(ctx, m)
	if err != nil {
		return nil, err
	}
	vo := tagVO(out)
	return &vo, nil
}

// Update 更新已有标签的信息。
// 业务规则：
//   - 标签不存在时返回错误；
//   - 未提供 slug 时，从名称自动生成；
//   - 新 slug 被其他标签占用时返回错误；
//   - 未提供颜色时，保留原有颜色。
func (s *TagService) Update(ctx context.Context, id int64, req dto.TagRequest) (*dto.TagVO, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("标签不存在")
	}
	if req.Slug == "" {
		req.Slug = generateTagSlug(req.Name)
	}
	// 检查新 slug 是否被其他标签占用
	if slugOwner, _ := s.repo.FindBySlug(ctx, req.Slug); slugOwner != nil && slugOwner.ID != id {
		return nil, errors.New("标签 slug 已被其他标签使用")
	}
	color := req.Color
	if color == "" {
		color = existing.Color // 保留原有颜色
	}
	m := &model.Tag{Name: req.Name, Slug: req.Slug, Description: req.Description, Color: color}
	out, err := s.repo.Update(ctx, id, m)
	if err != nil {
		return nil, err
	}
	vo := tagVO(out)
	return &vo, nil
}

// Delete 删除标签及其与文章的所有关联（通过级联删除实现）。
func (s *TagService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// generateTagSlug 从标签名称生成 URL 友好的 slug。
// 转小写后将空格替换为连字符；结果为空时返回 "tag"。
func generateTagSlug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	if s == "" {
		s = "tag"
	}
	return s
}

// tagVO 将 Tag 模型转换为视图对象。
func tagVO(t *model.Tag) dto.TagVO {
	return dto.TagVO{
		ID: t.ID, Name: t.Name, Slug: t.Slug, Description: t.Description,
		Color: t.Color, PostCount: t.PostCount,
		CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
}
