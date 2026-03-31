package service

import (
	"context"
	"errors"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// FriendLinkService manages blog friend links (blogroll).
type FriendLinkService struct{ repo *repository.FriendLinkRepo }

// NewFriendLinkService creates a FriendLinkService backed by the given repository.
func NewFriendLinkService(repo *repository.FriendLinkRepo) *FriendLinkService {
	return &FriendLinkService{repo: repo}
}

// ListAll returns all friend links (admin, including hidden ones).
func (s *FriendLinkService) ListAll(ctx context.Context) ([]dto.FriendLinkVO, error) {
	links, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return toLinkVOs(links), nil
}

// ListVisible returns only visible friend links (public endpoint).
func (s *FriendLinkService) ListVisible(ctx context.Context) ([]dto.FriendLinkVO, error) {
	links, err := s.repo.FindVisible(ctx)
	if err != nil {
		return nil, err
	}
	return toLinkVOs(links), nil
}

// Page returns a paginated list of all friend links.
func (s *FriendLinkService) Page(ctx context.Context, p pagination.Params) (*response.PageResult, error) {
	links, total, err := s.repo.FindPage(ctx, p)
	if err != nil {
		return nil, err
	}
	pr := response.NewPageResult(toLinkVOs(links), total, p.PageNum, p.PageSize)
	return &pr, nil
}

// GetByID returns a single friend link by primary key, or nil if not found.
func (s *FriendLinkService) GetByID(ctx context.Context, id int64) (*dto.FriendLinkVO, error) {
	fl, err := s.repo.FindByID(ctx, id)
	if err != nil || fl == nil {
		return nil, err
	}
	vo := linkVO(fl)
	return &vo, nil
}

// Create creates a new friend link. Defaults visible=true and themeColor="#6366f1" when absent.
func (s *FriendLinkService) Create(ctx context.Context, req dto.FriendLinkRequest) (*dto.FriendLinkVO, error) {
	visible := true
	if req.Visible != nil {
		visible = *req.Visible
	}
	themeColor := "#6366f1"
	if req.ThemeColor != nil {
		themeColor = *req.ThemeColor
	}
	m := &model.FriendLink{
		Name: req.Name, URL: req.URL, Logo: req.Logo, Description: req.Description,
		Email: req.Email, RSSUrl: req.RSSUrl, ThemeColor: &themeColor,
		IsOnline: req.IsOnline, SortOrder: req.SortOrder, Visible: visible,
	}
	out, err := s.repo.Create(ctx, m)
	if err != nil {
		return nil, err
	}
	vo := linkVO(out)
	return &vo, nil
}

// Update modifies an existing friend link. Returns an error if not found.
func (s *FriendLinkService) Update(ctx context.Context, id int64, req dto.FriendLinkRequest) (*dto.FriendLinkVO, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, errors.New("友链不存在")
	}
	visible := existing.Visible
	if req.Visible != nil {
		visible = *req.Visible
	}
	themeColor := "#6366f1"
	if existing.ThemeColor != nil {
		themeColor = *existing.ThemeColor
	}
	if req.ThemeColor != nil {
		themeColor = *req.ThemeColor
	}
	m := &model.FriendLink{
		Name: req.Name, URL: req.URL, Logo: req.Logo, Description: req.Description,
		Email: req.Email, RSSUrl: req.RSSUrl, ThemeColor: &themeColor,
		IsOnline: req.IsOnline, SortOrder: req.SortOrder, Visible: visible,
	}
	out, err := s.repo.Update(ctx, id, m)
	if err != nil {
		return nil, err
	}
	vo := linkVO(out)
	return &vo, nil
}

// Delete permanently removes a single friend link.
func (s *FriendLinkService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// DeleteBatch permanently removes multiple friend links in one query.
func (s *FriendLinkService) DeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.DeleteBatch(ctx, ids)
}

// ToggleVisible flips the visible flag and returns the updated record.
func (s *FriendLinkService) ToggleVisible(ctx context.Context, id int64) (*dto.FriendLinkVO, error) {
	out, err := s.repo.ToggleVisible(ctx, id)
	if err != nil {
		return nil, err
	}
	vo := linkVO(out)
	return &vo, nil
}

// Reorder assigns sort_order=index for each ID in the ordered slice.
func (s *FriendLinkService) Reorder(ctx context.Context, ids []int64) error {
	return s.repo.Reorder(ctx, ids)
}

func toLinkVOs(links []model.FriendLink) []dto.FriendLinkVO {
	vos := make([]dto.FriendLinkVO, len(links))
	for i, l := range links {
		vos[i] = linkVO(&l)
	}
	return vos
}

func linkVO(fl *model.FriendLink) dto.FriendLinkVO {
	return dto.FriendLinkVO{
		ID: fl.ID, Name: fl.Name, URL: fl.URL, Logo: fl.Logo,
		Description: fl.Description, Email: fl.Email, RSSUrl: fl.RSSUrl,
		ThemeColor: fl.ThemeColor, IsOnline: fl.IsOnline, LastCheckAt: fl.LastCheckAt,
		SortOrder: fl.SortOrder, Visible: fl.Visible,
		CreatedAt: fl.CreatedAt, UpdatedAt: fl.UpdatedAt,
	}
}
