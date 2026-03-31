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

// FriendLinkService 管理博客友情链接（Blogroll）的业务逻辑。
type FriendLinkService struct{ repo *repository.FriendLinkRepo }

// NewFriendLinkService 使用给定的仓储创建 FriendLinkService 实例。
func NewFriendLinkService(repo *repository.FriendLinkRepo) *FriendLinkService {
	return &FriendLinkService{repo: repo}
}

// ListAll 返回所有友链（含隐藏的），供管理端使用。
func (s *FriendLinkService) ListAll(ctx context.Context) ([]dto.FriendLinkVO, error) {
	links, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return toLinkVOs(links), nil
}

// ListVisible 仅返回可见（visible=true）的友链，供公开接口使用。
func (s *FriendLinkService) ListVisible(ctx context.Context) ([]dto.FriendLinkVO, error) {
	links, err := s.repo.FindVisible(ctx)
	if err != nil {
		return nil, err
	}
	return toLinkVOs(links), nil
}

// Page 返回分页的全量友链列表（含隐藏的），供管理端列表页使用。
func (s *FriendLinkService) Page(ctx context.Context, p pagination.Params) (*response.PageResult, error) {
	links, total, err := s.repo.FindPage(ctx, p)
	if err != nil {
		return nil, err
	}
	pr := response.NewPageResult(toLinkVOs(links), total, p.PageNum, p.PageSize)
	return &pr, nil
}

// GetByID 通过主键查询单条友链，不存在时返回 nil, nil。
func (s *FriendLinkService) GetByID(ctx context.Context, id int64) (*dto.FriendLinkVO, error) {
	fl, err := s.repo.FindByID(ctx, id)
	if err != nil || fl == nil {
		return nil, err
	}
	vo := linkVO(fl)
	return &vo, nil
}

// Create 创建新友链。
// 业务规则：visible 默认为 true；themeColor 默认为 "#6366f1"（Aether 品牌色）。
func (s *FriendLinkService) Create(ctx context.Context, req dto.FriendLinkRequest) (*dto.FriendLinkVO, error) {
	// 可见性默认开启
	visible := true
	if req.Visible != nil {
		visible = *req.Visible
	}
	// 主题色默认使用品牌色
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

// Update 修改已有友链信息。
// 业务规则：visible 和 themeColor 若请求中未提供，则保留现有值；
// themeColor 现有值为 nil 时回退到默认品牌色 "#6366f1"。
// 错误场景：友链不存在。
func (s *FriendLinkService) Update(ctx context.Context, id int64, req dto.FriendLinkRequest) (*dto.FriendLinkVO, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, errors.New("友链不存在")
	}
	// 保留原有可见性，请求中有值时覆盖
	visible := existing.Visible
	if req.Visible != nil {
		visible = *req.Visible
	}
	// 保留原有主题色，优先使用请求值，其次保留现有值，最后回退到默认色
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

// Delete 永久删除单条友链。
func (s *FriendLinkService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// DeleteBatch 在一次数据库查询中永久删除多条友链。
func (s *FriendLinkService) DeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.DeleteBatch(ctx, ids)
}

// ToggleVisible 切换指定友链的可见状态（true↔false），并返回更新后的记录。
func (s *FriendLinkService) ToggleVisible(ctx context.Context, id int64) (*dto.FriendLinkVO, error) {
	out, err := s.repo.ToggleVisible(ctx, id)
	if err != nil {
		return nil, err
	}
	vo := linkVO(out)
	return &vo, nil
}

// Reorder 按给定 ID 顺序重新分配各友链的 sort_order 值（索引即顺序）。
func (s *FriendLinkService) Reorder(ctx context.Context, ids []int64) error {
	return s.repo.Reorder(ctx, ids)
}

// toLinkVOs 将 model.FriendLink 切片批量转换为 dto.FriendLinkVO 切片。
func toLinkVOs(links []model.FriendLink) []dto.FriendLinkVO {
	vos := make([]dto.FriendLinkVO, len(links))
	for i, l := range links {
		vos[i] = linkVO(&l)
	}
	return vos
}

// linkVO 将单个 model.FriendLink 转换为 dto.FriendLinkVO。
func linkVO(fl *model.FriendLink) dto.FriendLinkVO {
	return dto.FriendLinkVO{
		ID: fl.ID, Name: fl.Name, URL: fl.URL, Logo: fl.Logo,
		Description: fl.Description, Email: fl.Email, RSSUrl: fl.RSSUrl,
		ThemeColor: fl.ThemeColor, IsOnline: fl.IsOnline, LastCheckAt: fl.LastCheckAt,
		SortOrder: fl.SortOrder, Visible: fl.Visible,
		CreatedAt: fl.CreatedAt, UpdatedAt: fl.UpdatedAt,
	}
}
