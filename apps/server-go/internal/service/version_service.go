package service

import (
	"context"
	"fmt"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

type VersionService struct {
	repo      *repository.VersionRepo
	mediaRepo *repository.MediaRepo
}

func NewVersionService(repo *repository.VersionRepo, mediaRepo *repository.MediaRepo) *VersionService {
	return &VersionService{repo: repo, mediaRepo: mediaRepo}
}

func (s *VersionService) GetHistory(ctx context.Context, fileID int64) ([]dto.MediaVersionVO, error) {
	versions, err := s.repo.FindByFileID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	return toVersionVOs(versions), nil
}

func (s *VersionService) Restore(ctx context.Context, fileID int64, versionNumber int) error {
	version, err := s.repo.FindByFileAndVersion(ctx, fileID, versionNumber)
	if err != nil {
		return err
	}
	if version == nil {
		return fmt.Errorf("版本不存在")
	}

	// Get current file to save as a new version before restoring
	file, err := s.mediaRepo.FindByID(ctx, fileID)
	if err != nil {
		return err
	}
	if file == nil {
		return fmt.Errorf("文件不存在")
	}

	// Save current state as a new version
	maxVer, err := s.repo.GetMaxVersionNumber(ctx, fileID)
	if err != nil {
		return err
	}
	desc := fmt.Sprintf("恢复前自动保存 (v%d)", file.CurrentVersion)
	newVersion := &model.MediaVersion{
		MediaFileID:       fileID,
		VersionNumber:     maxVer + 1,
		FilePath:          file.FilePath,
		FileURL:           file.FileURL,
		FileSize:          file.FileSize,
		ChangeDescription: &desc,
	}
	if err := s.repo.Create(ctx, newVersion); err != nil {
		return err
	}

	// Restore file to the selected version
	if err := s.mediaRepo.UpdateFileContent(ctx, fileID, version.FilePath, version.FileURL, version.FileSize, maxVer+2); err != nil {
		return err
	}

	return nil
}

func (s *VersionService) Delete(ctx context.Context, versionID int64) error {
	return s.repo.Delete(ctx, versionID)
}

// CreateVersionFromFile saves the current file state as a version entry.
func (s *VersionService) CreateVersionFromFile(ctx context.Context, file *model.MediaFile, description string, createdBy *int64) error {
	maxVer, err := s.repo.GetMaxVersionNumber(ctx, file.ID)
	if err != nil {
		return err
	}
	v := &model.MediaVersion{
		MediaFileID:       file.ID,
		VersionNumber:     maxVer + 1,
		FilePath:          file.FilePath,
		FileURL:           file.FileURL,
		FileSize:          file.FileSize,
		ChangeDescription: &description,
		CreatedBy:         createdBy,
	}
	return s.repo.Create(ctx, v)
}

// --- Helpers ---

func toVersionVO(v model.MediaVersion) dto.MediaVersionVO {
	return dto.MediaVersionVO{
		ID:                v.ID,
		MediaFileID:       v.MediaFileID,
		VersionNumber:     v.VersionNumber,
		FilePath:          v.FilePath,
		FileURL:           v.FileURL,
		FileSize:          v.FileSize,
		ChangeDescription: v.ChangeDescription,
		CreatedBy:         v.CreatedBy,
		CreatedAt:         v.CreatedAt,
	}
}

func toVersionVOs(versions []model.MediaVersion) []dto.MediaVersionVO {
	vos := make([]dto.MediaVersionVO, len(versions))
	for i, v := range versions {
		vos[i] = toVersionVO(v)
	}
	return vos
}
