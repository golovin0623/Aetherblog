package service

import (
	"context"
	"fmt"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// VersionService 管理媒体文件的版本历史（编辑前快照与版本回滚）。
type VersionService struct {
	repo      *repository.VersionRepo
	mediaRepo *repository.MediaRepo
}

// NewVersionService 创建一个由给定仓储支持的 VersionService 实例。
func NewVersionService(repo *repository.VersionRepo, mediaRepo *repository.MediaRepo) *VersionService {
	return &VersionService{repo: repo, mediaRepo: mediaRepo}
}

// GetHistory 返回指定媒体文件的所有版本记录，最新版本排在最前。
func (s *VersionService) GetHistory(ctx context.Context, fileID int64) ([]dto.MediaVersionVO, error) {
	versions, err := s.repo.FindByFileID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	return toVersionVOs(versions), nil
}

// Restore 将媒体文件回滚到指定版本号的历史状态。
// 业务规则：
//  1. 先将文件当前状态保存为新版本快照（版本号 = maxVer + 1），防止回滚前内容丢失；
//  2. 再将文件内容覆写为目标版本的路径、URL 和大小（版本号 = maxVer + 2）。
//
// 错误场景：目标版本不存在、文件不存在。
func (s *VersionService) Restore(ctx context.Context, fileID int64, versionNumber int) error {
	// 查找目标历史版本
	version, err := s.repo.FindByFileAndVersion(ctx, fileID, versionNumber)
	if err != nil {
		return err
	}
	if version == nil {
		return fmt.Errorf("版本不存在")
	}

	// 获取文件当前状态，以便在覆写前保存快照
	file, err := s.mediaRepo.FindByID(ctx, fileID)
	if err != nil {
		return err
	}
	if file == nil {
		return fmt.Errorf("文件不存在")
	}

	// 将当前状态保存为新版本快照（回滚前自动备份）
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

	// 将文件内容覆写为目标版本的数据
	if err := s.mediaRepo.UpdateFileContent(ctx, fileID, version.FilePath, version.FileURL, version.FileSize, maxVer+2); err != nil {
		return err
	}

	return nil
}

// Delete 永久删除单条版本记录。
func (s *VersionService) Delete(ctx context.Context, versionID int64) error {
	return s.repo.Delete(ctx, versionID)
}

// GetFileID 返回指定版本记录所关联的 media_file_id，用于 handler 层 ownership
// 校验（caller 必须是底层文件的 uploader 或 admin 才能删除版本）。
// 版本不存在时返回 (0, false, nil)。
func (s *VersionService) GetFileID(ctx context.Context, versionID int64) (fileID int64, found bool, err error) {
	v, err := s.repo.FindByID(ctx, versionID)
	if err != nil {
		return 0, false, err
	}
	if v == nil {
		return 0, false, nil
	}
	return v.MediaFileID, true, nil
}

// CreateVersionFromFile 将文件当前状态作为新版本快照保存。
// 通常在文件内容被修改前调用，用于留存可回滚的历史记录。
func (s *VersionService) CreateVersionFromFile(ctx context.Context, file *model.MediaFile, description string, createdBy *int64) error {
	// 获取当前最大版本号，新版本号在此基础上递增
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

// --- 内部辅助函数 ---

// toVersionVO 将 MediaVersion 模型转换为视图对象。
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

// toVersionVOs 批量将 MediaVersion 模型列表转换为视图对象列表。
func toVersionVOs(versions []model.MediaVersion) []dto.MediaVersionVO {
	vos := make([]dto.MediaVersionVO, len(versions))
	for i, v := range versions {
		vos[i] = toVersionVO(v)
	}
	return vos
}
