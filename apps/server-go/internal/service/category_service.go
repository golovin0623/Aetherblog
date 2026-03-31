package service

import (
	"context"
	"errors"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// CategoryService 管理博客文章分类的业务逻辑。
type CategoryService struct{ repo *repository.CategoryRepo }

// NewCategoryService 使用给定的仓储创建 CategoryService 实例。
func NewCategoryService(repo *repository.CategoryRepo) *CategoryService {
	return &CategoryService{repo: repo}
}

// ListTree 返回所有分类，并组装为父子嵌套树形结构。
func (s *CategoryService) ListTree(ctx context.Context) ([]dto.CategoryVO, error) {
	cats, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return buildTree(cats, nil), nil
}

// GetByID 通过主键查询单个分类，不存在时返回 nil, nil。
func (s *CategoryService) GetByID(ctx context.Context, id int64) (*dto.CategoryVO, error) {
	c, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, nil
	}
	vo := categoryVO(c)
	return &vo, nil
}

// Create 创建新分类。
// 业务规则：当 req.Slug 为空时自动根据名称生成；slug 在全局范围内必须唯一。
// 错误场景：slug 已被其他分类占用。
func (s *CategoryService) Create(ctx context.Context, req dto.CategoryRequest) (*dto.CategoryVO, error) {
	// 未提供 slug 时根据名称自动生成
	if req.Slug == "" {
		req.Slug = generateSlugFromName(req.Name)
	}
	// 检查 slug 唯一性
	if existing, _ := s.repo.FindBySlug(ctx, req.Slug); existing != nil {
		return nil, errors.New("分类 slug 已存在")
	}
	m := &model.Category{
		Name: req.Name, Slug: req.Slug, Description: req.Description,
		CoverImage: req.CoverImage, Icon: req.Icon,
		ParentID: req.ParentID, SortOrder: req.SortOrder,
	}
	out, err := s.repo.Create(ctx, m)
	if err != nil {
		return nil, err
	}
	vo := categoryVO(out)
	return &vo, nil
}

// Update 更新已有分类的信息。
// 业务规则：slug 不能与其他分类重复（但可以与自身相同）。
// 错误场景：分类不存在、slug 已被其他分类占用。
func (s *CategoryService) Update(ctx context.Context, id int64, req dto.CategoryRequest) (*dto.CategoryVO, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("分类不存在")
	}
	// 未提供 slug 时根据名称自动生成
	if req.Slug == "" {
		req.Slug = generateSlugFromName(req.Name)
	}
	// 检查 slug 是否被其他分类占用（排除自身）
	if slugOwner, _ := s.repo.FindBySlug(ctx, req.Slug); slugOwner != nil && slugOwner.ID != id {
		return nil, errors.New("分类 slug 已被其他分类使用")
	}
	m := &model.Category{
		Name: req.Name, Slug: req.Slug, Description: req.Description,
		CoverImage: req.CoverImage, Icon: req.Icon,
		ParentID: req.ParentID, SortOrder: req.SortOrder,
	}
	out, err := s.repo.Update(ctx, id, m)
	if err != nil {
		return nil, err
	}
	vo := categoryVO(out)
	return &vo, nil
}

// Delete 删除指定分类。
// 业务规则：分类下存在关联文章时禁止删除，需先迁移或解除文章关联。
// 错误场景：分类下仍有关联文章。
func (s *CategoryService) Delete(ctx context.Context, id int64) error {
	// 检查分类下是否存在关联文章
	hasPosts, err := s.repo.ExistsPostsInCategory(ctx, id)
	if err != nil {
		return err
	}
	if hasPosts {
		return errors.New("该分类下存在文章，无法删除")
	}
	return s.repo.Delete(ctx, id)
}

// ListFlat 返回所有分类的平铺列表（不构建树形结构），供公开接口使用。
func (s *CategoryService) ListFlat(ctx context.Context) ([]dto.CategoryVO, error) {
	cats, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	vos := make([]dto.CategoryVO, len(cats))
	for i, c := range cats {
		vos[i] = categoryVO(&c)
	}
	return vos, nil
}

// categoryVO 将 model.Category 转换为 dto.CategoryVO。
func categoryVO(c *model.Category) dto.CategoryVO {
	return dto.CategoryVO{
		ID: c.ID, Name: c.Name, Slug: c.Slug, Description: c.Description,
		CoverImage: c.CoverImage, Icon: c.Icon, ParentID: c.ParentID,
		SortOrder: c.SortOrder, PostCount: c.PostCount,
		CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

// generateSlugFromName 将分类名称转换为 URL 友好的 slug。
// 规则：转小写、去首尾空格，空格替换为连字符；若结果为空则返回 "item"。
func generateSlugFromName(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	if s == "" {
		s = "item"
	}
	return s
}

// buildTree 递归地将平铺分类列表组装为树形结构。
// parentID 为 nil 表示收集顶级分类（无父节点）。
func buildTree(all []model.Category, parentID *int64) []dto.CategoryVO {
	var result []dto.CategoryVO
	for _, c := range all {
		c := c
		var matches bool
		if parentID == nil {
			matches = c.ParentID == nil
		} else {
			matches = c.ParentID != nil && *c.ParentID == *parentID
		}
		if matches {
			vo := categoryVO(&c)
			// 递归构建子树
			vo.Children = buildTree(all, &c.ID)
			result = append(result, vo)
		}
	}
	return result
}
