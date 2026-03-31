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
	ID            int64            `json:"id"`
	EventType     string           `json:"eventType"`
	EventCategory *string          `json:"eventCategory,omitempty"`
	Title         string           `json:"title"`
	Description   *string          `json:"description,omitempty"`
	UserID        *int64           `json:"userId,omitempty"`
	IP            *string          `json:"ip,omitempty"`
	Status        *string          `json:"status,omitempty"`
	CreatedAt     time.Time        `json:"createdAt"`
	User          *ActivityUserRef `json:"user,omitempty"`
}

// ActivityUserRef is a nested user object in activity responses.
type ActivityUserRef struct {
	ID       int64   `json:"id"`
	Username string  `json:"username"`
	Nickname *string `json:"nickname,omitempty"`
	Avatar   *string `json:"avatar,omitempty"`
}

// ActivityService wraps the activity repository and exposes business logic.
type ActivityService struct {
	repo     *repository.ActivityRepo
	userRepo *repository.UserRepo
}

// NewActivityService creates an ActivityService backed by the given repositories.
func NewActivityService(repo *repository.ActivityRepo, userRepo *repository.UserRepo) *ActivityService {
	return &ActivityService{repo: repo, userRepo: userRepo}
}

// GetRecent returns the latest 10 activity events.
func (s *ActivityService) GetRecent(ctx context.Context) ([]ActivityVO, error) {
	rows, err := s.repo.FindRecent(ctx, 10)
	if err != nil {
		return nil, err
	}
	vos := toActivityVOs(rows)
	s.enrichUserRefs(ctx, rows, vos)
	return vos, nil
}

// GetForAdmin returns a paginated list of activity events with optional filters.
func (s *ActivityService) GetForAdmin(ctx context.Context, f repository.ActivityFilter) (*response.PageResult, error) {
	rows, total, err := s.repo.FindForAdmin(ctx, f)
	if err != nil {
		return nil, err
	}
	vos := toActivityVOs(rows)
	s.enrichUserRefs(ctx, rows, vos)
	pr := response.NewPageResult(vos, total, f.Params.PageNum, f.Params.PageSize)
	return &pr, nil
}

// GetByUser returns paginated activity events for a specific user.
func (s *ActivityService) GetByUser(ctx context.Context, userID int64, p pagination.Params) (*response.PageResult, error) {
	rows, total, err := s.repo.FindByUser(ctx, userID, p)
	if err != nil {
		return nil, err
	}
	vos := toActivityVOs(rows)
	s.enrichUserRefs(ctx, rows, vos)
	pr := response.NewPageResult(vos, total, p.PageNum, p.PageSize)
	return &pr, nil
}

// Create inserts a new activity event.
func (s *ActivityService) Create(ctx context.Context, a *model.ActivityEvent) error {
	return s.repo.Create(ctx, a)
}

// enrichUserRefs batch-fetches user info and populates the User field on each VO.
func (s *ActivityService) enrichUserRefs(ctx context.Context, rows []model.ActivityEvent, vos []ActivityVO) {
	if s.userRepo == nil {
		return
	}
	// Collect unique user IDs
	userIDSet := make(map[int64]struct{})
	for _, r := range rows {
		if r.UserID != nil {
			userIDSet[*r.UserID] = struct{}{}
		}
	}
	if len(userIDSet) == 0 {
		return
	}
	// Fetch users
	userMap := make(map[int64]*ActivityUserRef)
	for uid := range userIDSet {
		if u, err := s.userRepo.FindByID(ctx, uid); err == nil && u != nil {
			userMap[uid] = &ActivityUserRef{
				ID:       u.ID,
				Username: u.Username,
				Nickname: u.Nickname,
				Avatar:   u.Avatar,
			}
		}
	}
	// Populate
	for i, r := range rows {
		if r.UserID != nil {
			if ref, ok := userMap[*r.UserID]; ok {
				vos[i].User = ref
			}
		}
	}
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
