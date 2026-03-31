package service

import (
	"context"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// ActivityVO 是返回给调用方的活动事件数据传输对象（DTO）。
// 包含事件的基本信息及可选的关联用户引用。
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

// ActivityUserRef 是活动响应中嵌套的用户对象，
// 仅包含前端展示所需的最小用户信息字段。
type ActivityUserRef struct {
	ID       int64   `json:"id"`
	Username string  `json:"username"`
	Nickname *string `json:"nickname,omitempty"`
	Avatar   *string `json:"avatar,omitempty"`
}

// ActivityService 封装活动事件仓储层，对外暴露业务逻辑方法。
type ActivityService struct {
	repo     *repository.ActivityRepo
	userRepo *repository.UserRepo
}

// NewActivityService 使用给定的仓储依赖创建 ActivityService 实例。
func NewActivityService(repo *repository.ActivityRepo, userRepo *repository.UserRepo) *ActivityService {
	return &ActivityService{repo: repo, userRepo: userRepo}
}

// GetRecent 返回最新的 10 条活动事件，并批量填充关联用户信息。
func (s *ActivityService) GetRecent(ctx context.Context) ([]ActivityVO, error) {
	rows, err := s.repo.FindRecent(ctx, 10)
	if err != nil {
		return nil, err
	}
	vos := toActivityVOs(rows)
	s.enrichUserRefs(ctx, rows, vos)
	return vos, nil
}

// GetForAdmin 返回带可选过滤条件的分页活动事件列表，供管理后台使用。
// 通过 ActivityFilter 支持按事件类型、用户等维度过滤。
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

// GetByUser 返回指定用户的分页活动事件列表。
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

// Create 向数据库插入一条新的活动事件记录。
func (s *ActivityService) Create(ctx context.Context, a *model.ActivityEvent) error {
	return s.repo.Create(ctx, a)
}

// enrichUserRefs 批量获取用户信息并填充到每个 VO 的 User 字段中。
// 当 userRepo 为 nil 时直接返回，不执行查询。
func (s *ActivityService) enrichUserRefs(ctx context.Context, rows []model.ActivityEvent, vos []ActivityVO) {
	if s.userRepo == nil {
		return
	}
	// 收集所有不重复的用户 ID
	userIDSet := make(map[int64]struct{})
	for _, r := range rows {
		if r.UserID != nil {
			userIDSet[*r.UserID] = struct{}{}
		}
	}
	if len(userIDSet) == 0 {
		return
	}
	// 逐个查询用户信息并构建映射表
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
	// 将用户信息回填到对应的 VO 中
	for i, r := range rows {
		if r.UserID != nil {
			if ref, ok := userMap[*r.UserID]; ok {
				vos[i].User = ref
			}
		}
	}
}

// --- 内部辅助函数 ---

// toActivityVO 将单个 model.ActivityEvent 转换为 ActivityVO。
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

// toActivityVOs 将 model.ActivityEvent 切片批量转换为 ActivityVO 切片。
func toActivityVOs(rows []model.ActivityEvent) []ActivityVO {
	vos := make([]ActivityVO, len(rows))
	for i, r := range rows {
		vos[i] = toActivityVO(r)
	}
	return vos
}
