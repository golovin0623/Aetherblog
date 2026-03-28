package service

import (
	"context"
	"errors"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

type TagService struct{ repo *repository.TagRepo }

func NewTagService(repo *repository.TagRepo) *TagService { return &TagService{repo: repo} }

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

func (s *TagService) GetByID(ctx context.Context, id int64) (*dto.TagVO, error) {
	t, err := s.repo.FindByID(ctx, id)
	if err != nil || t == nil {
		return nil, err
	}
	vo := tagVO(t)
	return &vo, nil
}

func (s *TagService) Create(ctx context.Context, req dto.TagRequest) (*dto.TagVO, error) {
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

func (s *TagService) Update(ctx context.Context, id int64, req dto.TagRequest) (*dto.TagVO, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil || existing == nil {
		return nil, errors.New("标签不存在")
	}
	if slugOwner, _ := s.repo.FindBySlug(ctx, req.Slug); slugOwner != nil && slugOwner.ID != id {
		return nil, errors.New("标签 slug 已被其他标签使用")
	}
	color := req.Color
	if color == "" {
		color = existing.Color
	}
	m := &model.Tag{Name: req.Name, Slug: req.Slug, Description: req.Description, Color: color}
	out, err := s.repo.Update(ctx, id, m)
	if err != nil {
		return nil, err
	}
	vo := tagVO(out)
	return &vo, nil
}

func (s *TagService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

func tagVO(t *model.Tag) dto.TagVO {
	return dto.TagVO{
		ID: t.ID, Name: t.Name, Slug: t.Slug, Description: t.Description,
		Color: t.Color, PostCount: t.PostCount,
		CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
}
