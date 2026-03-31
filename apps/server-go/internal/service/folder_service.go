package service

import (
	"context"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// FolderService 管理媒体文件夹的业务逻辑。
type FolderService struct {
	repo *repository.FolderRepo
}

// NewFolderService 使用给定的仓储创建 FolderService 实例。
func NewFolderService(repo *repository.FolderRepo) *FolderService {
	return &FolderService{repo: repo}
}

// GetTree 返回所有文件夹，并组装为父子嵌套树形结构。
func (s *FolderService) GetTree(ctx context.Context) ([]dto.MediaFolderVO, error) {
	folders, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return buildFolderTree(toFolderVOs(folders)), nil
}

// GetByID 通过主键查询单个文件夹，不存在时返回 nil, nil。
func (s *FolderService) GetByID(ctx context.Context, id int64) (*dto.MediaFolderVO, error) {
	f, err := s.repo.FindByID(ctx, id)
	if err != nil || f == nil {
		return nil, err
	}
	vo := toFolderVO(*f)
	return &vo, nil
}

// GetChildren 返回指定文件夹的直接子文件夹列表（平铺，不递归）。
func (s *FolderService) GetChildren(ctx context.Context, id int64) ([]dto.MediaFolderVO, error) {
	fs, err := s.repo.FindChildren(ctx, id)
	if err != nil {
		return nil, err
	}
	return toFolderVOs(fs), nil
}

// Create 创建新文件夹。
// 业务规则：未指定可见性时默认设为 PRIVATE。
func (s *FolderService) Create(ctx context.Context, req dto.FolderRequest, ownerID *int64) (*dto.MediaFolderVO, error) {
	vis := req.Visibility
	if vis == "" {
		vis = "PRIVATE" // 可见性默认为私有
	}
	f, err := s.repo.Create(ctx, repository.FolderRequest{
		Name:        req.Name,
		Description: req.Description,
		ParentID:    req.ParentID,
		Color:       req.Color,
		Icon:        req.Icon,
		Visibility:  vis,
		OwnerID:     ownerID,
	})
	if err != nil {
		return nil, err
	}
	vo := toFolderVO(*f)
	return &vo, nil
}

// Update 修改文件夹的展示属性（名称、描述、颜色、图标、可见性）。
// 未指定可见性时默认设为 PRIVATE。
func (s *FolderService) Update(ctx context.Context, id int64, req dto.FolderRequest, ownerID *int64) error {
	vis := req.Visibility
	if vis == "" {
		vis = "PRIVATE"
	}
	return s.repo.Update(ctx, id, repository.FolderRequest{
		Name:        req.Name,
		Description: req.Description,
		Color:       req.Color,
		Icon:        req.Icon,
		Visibility:  vis,
		OwnerID:     ownerID,
	})
}

// Delete 永久删除指定文件夹。
func (s *FolderService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// Move 将文件夹重新挂载到 newParentID 下；newParentID 为 nil 表示移至根级别。
func (s *FolderService) Move(ctx context.Context, id int64, newParentID *int64, updatedBy *int64) error {
	return s.repo.Move(ctx, id, newParentID, updatedBy)
}

// --- 内部辅助函数 ---

// toFolderVO 将单个 model.MediaFolder 转换为 dto.MediaFolderVO。
func toFolderVO(f model.MediaFolder) dto.MediaFolderVO {
	return dto.MediaFolderVO{
		ID:          f.ID,
		Name:        f.Name,
		Slug:        f.Slug,
		Description: f.Description,
		ParentID:    f.ParentID,
		Path:        f.Path,
		Depth:       f.Depth,
		Color:       f.Color,
		Icon:        f.Icon,
		Visibility:  f.Visibility,
		FileCount:   f.FileCount,
		TotalSize:   f.TotalSize,
		CreatedAt:   f.CreatedAt,
	}
}

// toFolderVOs 将 model.MediaFolder 切片批量转换为 dto.MediaFolderVO 切片。
func toFolderVOs(fs []model.MediaFolder) []dto.MediaFolderVO {
	vos := make([]dto.MediaFolderVO, len(fs))
	for i, f := range fs {
		vos[i] = toFolderVO(f)
	}
	return vos
}

// buildFolderTree 将平铺的文件夹 VO 列表按 parent_id 构建为嵌套树形结构。
// 使用两轮遍历：第一轮通过指针将子节点挂载到父节点；第二轮收集根节点。
func buildFolderTree(vos []dto.MediaFolderVO) []dto.MediaFolderVO {
	byID := make(map[int64]*dto.MediaFolderVO, len(vos))
	for i := range vos {
		byID[vos[i].ID] = &vos[i]
	}
	// 第一轮：将有父节点的文件夹挂载到对应父节点的 Children 列表（通过指针修改原始数据）
	for i := range vos {
		if vos[i].ParentID != nil {
			if parent, ok := byID[*vos[i].ParentID]; ok {
				parent.Children = append(parent.Children, vos[i])
			}
		}
	}
	// 第二轮：收集根节点（必须重新从 byID 读取以获取已挂载子节点的完整数据）
	var roots []dto.MediaFolderVO
	for i := range vos {
		if vos[i].ParentID == nil {
			roots = append(roots, *byID[vos[i].ID])
		}
	}
	return roots
}
