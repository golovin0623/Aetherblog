package service

import (
	"context"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// FolderService manages media folder operations.
type FolderService struct {
	repo *repository.FolderRepo
}

// NewFolderService creates a FolderService backed by the given repository.
func NewFolderService(repo *repository.FolderRepo) *FolderService {
	return &FolderService{repo: repo}
}

// GetTree returns all folders assembled into a parent-child tree.
func (s *FolderService) GetTree(ctx context.Context) ([]dto.MediaFolderVO, error) {
	folders, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return buildFolderTree(toFolderVOs(folders)), nil
}

// GetByID returns a single folder by primary key, or nil if not found.
func (s *FolderService) GetByID(ctx context.Context, id int64) (*dto.MediaFolderVO, error) {
	f, err := s.repo.FindByID(ctx, id)
	if err != nil || f == nil {
		return nil, err
	}
	vo := toFolderVO(*f)
	return &vo, nil
}

// GetChildren returns the direct children of a folder (flat list, no recursion).
func (s *FolderService) GetChildren(ctx context.Context, id int64) ([]dto.MediaFolderVO, error) {
	fs, err := s.repo.FindChildren(ctx, id)
	if err != nil {
		return nil, err
	}
	return toFolderVOs(fs), nil
}

// Create creates a new folder. Defaults visibility to PRIVATE when not specified.
func (s *FolderService) Create(ctx context.Context, req dto.FolderRequest, ownerID *int64) (*dto.MediaFolderVO, error) {
	vis := req.Visibility
	if vis == "" {
		vis = "PRIVATE"
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

// Update modifies a folder's display properties.
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

// Delete permanently removes a folder.
func (s *FolderService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// Move re-parents a folder under newParentID (nil = root level).
func (s *FolderService) Move(ctx context.Context, id int64, newParentID *int64, updatedBy *int64) error {
	return s.repo.Move(ctx, id, newParentID, updatedBy)
}

// --- Helpers ---

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

func toFolderVOs(fs []model.MediaFolder) []dto.MediaFolderVO {
	vos := make([]dto.MediaFolderVO, len(fs))
	for i, f := range fs {
		vos[i] = toFolderVO(f)
	}
	return vos
}

func buildFolderTree(vos []dto.MediaFolderVO) []dto.MediaFolderVO {
	byID := make(map[int64]*dto.MediaFolderVO, len(vos))
	for i := range vos {
		byID[vos[i].ID] = &vos[i]
	}
	// First pass: link children to parents (modify the originals in byID).
	for i := range vos {
		if vos[i].ParentID != nil {
			if parent, ok := byID[*vos[i].ParentID]; ok {
				parent.Children = append(parent.Children, vos[i])
			}
		}
	}
	// Second pass: collect roots (after children have been attached to parent pointers).
	// We must re-read from byID since the slice elements were modified via pointer.
	var roots []dto.MediaFolderVO
	for i := range vos {
		if vos[i].ParentID == nil {
			roots = append(roots, *byID[vos[i].ID])
		}
	}
	return roots
}
