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

// GetOwnerID 返回指定文件夹的 owner_id，用于 handler 层 ownership 校验。
// 文件夹不存在时返回 (nil, nil)。
func (s *FolderService) GetOwnerID(ctx context.Context, id int64) (*int64, error) {
	f, err := s.repo.FindByID(ctx, id)
	if err != nil || f == nil {
		return nil, err
	}
	return f.OwnerID, nil
}

// GetChildren 返回指定文件夹的直接子文件夹列表（平铺，不递归）。
func (s *FolderService) GetChildren(ctx context.Context, id int64) ([]dto.MediaFolderVO, error) {
	fs, err := s.repo.FindChildren(ctx, id)
	if err != nil {
		return nil, err
	}
	return toFolderVOs(fs), nil
}

// EnsureFolderByPath 是 KB 等内部模块用的目录确保入口。详见 FolderRepo.EnsureFolderByPath。
// 返回叶子目录的 VO；segments 不包含 "root"。
func (s *FolderService) EnsureFolderByPath(ctx context.Context, segments []string, ownerID *int64, isSystem, undeletable bool) (*dto.MediaFolderVO, error) {
	leaf, err := s.repo.EnsureFolderByPath(ctx, segments, ownerID, isSystem, undeletable)
	if err != nil {
		return nil, err
	}
	if leaf == nil {
		return nil, nil
	}
	vo := toFolderVO(*leaf)
	return &vo, nil
}

// FindByPath 按物化路径查询单个目录（含系统目录）。
func (s *FolderService) FindByPath(ctx context.Context, path string) (*dto.MediaFolderVO, error) {
	f, err := s.repo.FindByPath(ctx, path)
	if err != nil || f == nil {
		return nil, err
	}
	vo := toFolderVO(*f)
	return &vo, nil
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
		IsSystem:    f.IsSystem,
		Undeletable: f.Undeletable,
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
// 使用 O(N) 一次遍历哈希表分组，然后自顶向下递归组装。
// 原两轮指针挂载方案在值拷贝场景下会丢失孙级及更深层级的嵌套数据（先挂载后拷贝的根节点
// 不含后续才挂上的子节点），此处统一为"先分组、后递归"的安全模式修复。
// ref: PR#713 —— 修复深层嵌套丢失 + O(N) 优化 + 为 map 预分配容量。
func buildFolderTree(vos []dto.MediaFolderVO) []dto.MediaFolderVO {
	if len(vos) == 0 {
		return nil
	}

	var roots []dto.MediaFolderVO
	byParent := make(map[int64][]dto.MediaFolderVO, len(vos))

	for i := range vos {
		if vos[i].ParentID == nil {
			roots = append(roots, vos[i])
		} else {
			pid := *vos[i].ParentID
			byParent[pid] = append(byParent[pid], vos[i])
		}
	}

	var build func(nodes []dto.MediaFolderVO) []dto.MediaFolderVO
	build = func(nodes []dto.MediaFolderVO) []dto.MediaFolderVO {
		for i := range nodes {
			if children, ok := byParent[nodes[i].ID]; ok {
				nodes[i].Children = build(children)
			}
		}
		return nodes
	}

	return build(roots)
}
