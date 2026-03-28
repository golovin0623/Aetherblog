package service

import (
	"context"
	"errors"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

type CategoryService struct{ repo *repository.CategoryRepo }

func NewCategoryService(repo *repository.CategoryRepo) *CategoryService {
	return &CategoryService{repo: repo}
}

// ListTree returns all categories assembled into a parent-child tree.
func (s *CategoryService) ListTree(ctx context.Context) ([]dto.CategoryVO, error) {
	cats, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return buildTree(cats, nil), nil
}

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

func (s *CategoryService) Create(ctx context.Context, req dto.CategoryRequest) (*dto.CategoryVO, error) {
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

func (s *CategoryService) Update(ctx context.Context, id int64, req dto.CategoryRequest) (*dto.CategoryVO, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("分类不存在")
	}
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

func (s *CategoryService) Delete(ctx context.Context, id int64) error {
	hasPosts, err := s.repo.ExistsPostsInCategory(ctx, id)
	if err != nil {
		return err
	}
	if hasPosts {
		return errors.New("该分类下存在文章，无法删除")
	}
	return s.repo.Delete(ctx, id)
}

// ListFlat returns all categories without tree nesting (for public endpoint).
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

func categoryVO(c *model.Category) dto.CategoryVO {
	return dto.CategoryVO{
		ID: c.ID, Name: c.Name, Slug: c.Slug, Description: c.Description,
		CoverImage: c.CoverImage, Icon: c.Icon, ParentID: c.ParentID,
		SortOrder: c.SortOrder, PostCount: c.PostCount,
		CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

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
			vo.Children = buildTree(all, &c.ID)
			result = append(result, vo)
		}
	}
	return result
}
