package service

import (
	"context"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// ActivityVO is the DTO returned to callers.
type ActivityVO struct {
	ID            int64      `json:"id"`
	EventType     string     `json:"eventType"`
	EventCategory *string    `json:"eventCategory,omitempty"`
	Title         string     `json:"title"`
	Description   *string    `json:"description,omitempty"`
	UserID        *int64     `json:"userId,omitempty"`
	IP            *string    `json:"ip,omitempty"`
	Status        *string    `json:"status,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
}

// ActivityService wraps the activity repository and exposes business logic.
type ActivityService struct {
	repo *repository.ActivityRepo
}

func NewActivityService(repo *repository.ActivityRepo) *ActivityService {
	return &ActivityService{repo: repo}
}

// GetRecent returns the latest 10 activity events.
func (s *ActivityService) GetRecent(ctx context.Context) ([]ActivityVO, error) {
	rows, err := s.repo.FindRecent(ctx, 10)
	if err != nil {
		return nil, err
	}
	return toActivityVOs(rows), nil
}

// GetForAdmin returns a paginated list of activity events with optional filters.
func (s *ActivityService) GetForAdmin(ctx context.Context, f repository.ActivityFilter) (*response.PageResult, error) {
	rows, total, err := s.repo.FindForAdmin(ctx, f)
	if err != nil {
		return nil, err
	}
	pr := response.NewPageResult(toActivityVOs(rows), total, f.Params.PageNum, f.Params.PageSize)
	return &pr, nil
}

// GetByUser returns paginated activity events for a specific user.
func (s *ActivityService) GetByUser(ctx context.Context, userID int64, p pagination.Params) (*response.PageResult, error) {
	rows, total, err := s.repo.FindByUser(ctx, userID, p)
	if err != nil {
		return nil, err
	}
	pr := response.NewPageResult(toActivityVOs(rows), total, p.PageNum, p.PageSize)
	return &pr, nil
}

// Create inserts a new activity event.
func (s *ActivityService) Create(ctx context.Context, a *model.ActivityEvent) error {
	return s.repo.Create(ctx, a)
}

// --- helpers ---

func toActivityVO(a model.ActivityEvent) ActivityVO {
	return ActivityVO{
		ID:            a.ID,
		EventType:     a.EventType,
		EventCategory: a.EventCategory,
		Title:         a.Title,
		Description:   a.Description,
		UserID:        a.UserID,
		IP:            a.IP,
		Status:        a.Status,
		CreatedAt:     a.CreatedAt,
	}
}

func toActivityVOs(rows []model.ActivityEvent) []ActivityVO {
	vos := make([]ActivityVO, len(rows))
	for i, r := range rows {
		vos[i] = toActivityVO(r)
	}
	return vos
}
