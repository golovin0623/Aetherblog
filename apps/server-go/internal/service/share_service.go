package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"

	"golang.org/x/crypto/bcrypt"
)

// ShareService 管理媒体文件和文件夹的可分享链接。
type ShareService struct {
	repo *repository.ShareRepo
}

// NewShareService 创建一个由给定仓储支持的 ShareService 实例。
func NewShareService(repo *repository.ShareRepo) *ShareService {
	return &ShareService{repo: repo}
}

// CreateFileShare 为单个媒体文件创建分享令牌。
// 若请求中包含密码，则使用 bcrypt 加密后存储；
// 若请求中包含 ExpiresAt（RFC3339 格式），则解析为过期时间，解析失败时忽略。
func (s *ShareService) CreateFileShare(ctx context.Context, fileID int64, req dto.CreateShareRequest, createdBy *int64) (*dto.MediaShareVO, error) {
	token, err := generateShareToken()
	if err != nil {
		return nil, fmt.Errorf("生成分享令牌失败: %w", err)
	}

	share := &model.MediaShare{
		ShareToken:     token,
		MediaFileID:    &fileID,
		ShareType:      "FILE",
		AccessType:     req.AccessType,
		CreatedBy:      createdBy,
		MaxAccessCount: req.MaxAccessCount,
	}

	// 解析可选的过期时间
	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err == nil {
			share.ExpiresAt = &t
		}
	}
	// 对密码进行 bcrypt 加密后存储
	if req.Password != nil && *req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("密码加密失败: %w", err)
		}
		h := string(hash)
		share.PasswordHash = &h
	}

	if err := s.repo.Create(ctx, share); err != nil {
		return nil, err
	}
	vo := toShareVO(*share)
	return &vo, nil
}

// CreateFolderShare 为媒体文件夹创建分享令牌。
// 密码和过期时间处理规则与 CreateFileShare 相同。
func (s *ShareService) CreateFolderShare(ctx context.Context, folderID int64, req dto.CreateShareRequest, createdBy *int64) (*dto.MediaShareVO, error) {
	token, err := generateShareToken()
	if err != nil {
		return nil, fmt.Errorf("生成分享令牌失败: %w", err)
	}

	share := &model.MediaShare{
		ShareToken:     token,
		FolderID:       &folderID,
		ShareType:      "FOLDER",
		AccessType:     req.AccessType,
		CreatedBy:      createdBy,
		MaxAccessCount: req.MaxAccessCount,
	}

	// 解析可选的过期时间
	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err == nil {
			share.ExpiresAt = &t
		}
	}
	// 对密码进行 bcrypt 加密后存储
	if req.Password != nil && *req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("密码加密失败: %w", err)
		}
		h := string(hash)
		share.PasswordHash = &h
	}

	if err := s.repo.Create(ctx, share); err != nil {
		return nil, err
	}
	vo := toShareVO(*share)
	return &vo, nil
}

// GetSharesByFile 返回指定媒体文件的所有分享记录。
func (s *ShareService) GetSharesByFile(ctx context.Context, fileID int64) ([]dto.MediaShareVO, error) {
	shares, err := s.repo.FindByFileID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	return toShareVOs(shares), nil
}

// Update 修改已有分享记录的访问设置。
// 业务规则：
//   - 传入空密码字符串表示移除密码保护；
//   - 传入非空密码则重新进行 bcrypt 加密并更新；
//   - 未提供的字段保持原值不变。
//
// 错误场景：分享记录不存在时返回错误。
func (s *ShareService) Update(ctx context.Context, shareID int64, req dto.UpdateShareRequest) (*dto.MediaShareVO, error) {
	existing, err := s.repo.FindByID(ctx, shareID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, fmt.Errorf("分享不存在")
	}

	// 未提供字段时保留原值
	accessType := existing.AccessType
	if req.AccessType != nil {
		accessType = *req.AccessType
	}

	var expiresAt *string
	if req.ExpiresAt != nil {
		expiresAt = req.ExpiresAt
	}

	maxAccessCount := existing.MaxAccessCount
	if req.MaxAccessCount != nil {
		maxAccessCount = req.MaxAccessCount
	}

	// 处理密码更新逻辑
	passwordHash := existing.PasswordHash
	if req.Password != nil {
		if *req.Password == "" {
			// 空字符串表示清除密码保护
			passwordHash = nil
		} else {
			// 重新加密新密码
			hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
			if err != nil {
				return nil, fmt.Errorf("密码加密失败: %w", err)
			}
			h := string(hash)
			passwordHash = &h
		}
	}

	if err := s.repo.Update(ctx, shareID, accessType, expiresAt, maxAccessCount, passwordHash); err != nil {
		return nil, err
	}

	updated, err := s.repo.FindByID(ctx, shareID)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, nil
	}
	vo := toShareVO(*updated)
	return &vo, nil
}

// Delete 撤销并永久删除指定分享记录。
func (s *ShareService) Delete(ctx context.Context, shareID int64) error {
	return s.repo.Delete(ctx, shareID)
}

// GetCreatedBy 返回指定分享记录的 created_by 字段（可为空），用于 handler 层
// ownership 校验。分享不存在时返回 (nil, nil) —— 调用方需要自行区分 nil
// (记录不存在) 与 *int64==nil (匿名分享) 的语义。
func (s *ShareService) GetCreatedBy(ctx context.Context, shareID int64) (found bool, ownerID *int64, err error) {
	existing, err := s.repo.FindByID(ctx, shareID)
	if err != nil {
		return false, nil, err
	}
	if existing == nil {
		return false, nil, nil
	}
	return true, existing.CreatedBy, nil
}

// --- 内部辅助函数 ---

// generateShareToken 生成 32 字节的密码学安全随机令牌，以十六进制字符串形式返回（64 字符）。
func generateShareToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// toShareVO 将 MediaShare 模型转换为视图对象，拼接分享访问 URL。
func toShareVO(s model.MediaShare) dto.MediaShareVO {
	return dto.MediaShareVO{
		ID:             s.ID,
		ShareToken:     s.ShareToken,
		ShareURL:       "/share/" + s.ShareToken,
		MediaFileID:    s.MediaFileID,
		FolderID:       s.FolderID,
		ShareType:      s.ShareType,
		AccessType:     s.AccessType,
		CreatedBy:      s.CreatedBy,
		CreatedAt:      s.CreatedAt,
		ExpiresAt:      s.ExpiresAt,
		AccessCount:    s.AccessCount,
		MaxAccessCount: s.MaxAccessCount,
	}
}

// toShareVOs 批量将 MediaShare 模型列表转换为视图对象列表。
func toShareVOs(shares []model.MediaShare) []dto.MediaShareVO {
	vos := make([]dto.MediaShareVO, len(shares))
	for i, s := range shares {
		vos[i] = toShareVO(s)
	}
	return vos
}
