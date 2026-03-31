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

// ShareService manages shareable links for media files and folders.
type ShareService struct {
	repo *repository.ShareRepo
}

// NewShareService creates a ShareService backed by the given repository.
func NewShareService(repo *repository.ShareRepo) *ShareService {
	return &ShareService{repo: repo}
}

// CreateFileShare creates a share token for a single media file.
// Optionally hashes the password with bcrypt when a password is specified.
func (s *ShareService) CreateFileShare(ctx context.Context, fileID int64, req dto.CreateShareRequest, createdBy *int64) (*dto.MediaShareVO, error) {
	token, err := generateShareToken()
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	share := &model.MediaShare{
		ShareToken:     token,
		MediaFileID:    &fileID,
		ShareType:      "FILE",
		AccessType:     req.AccessType,
		CreatedBy:      createdBy,
		MaxAccessCount: req.MaxAccessCount,
	}

	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err == nil {
			share.ExpiresAt = &t
		}
	}
	if req.Password != nil && *req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("hash password: %w", err)
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

// CreateFolderShare creates a share token for a media folder.
func (s *ShareService) CreateFolderShare(ctx context.Context, folderID int64, req dto.CreateShareRequest, createdBy *int64) (*dto.MediaShareVO, error) {
	token, err := generateShareToken()
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	share := &model.MediaShare{
		ShareToken:     token,
		FolderID:       &folderID,
		ShareType:      "FOLDER",
		AccessType:     req.AccessType,
		CreatedBy:      createdBy,
		MaxAccessCount: req.MaxAccessCount,
	}

	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err == nil {
			share.ExpiresAt = &t
		}
	}
	if req.Password != nil && *req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("hash password: %w", err)
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

// GetSharesByFile returns all share records for a media file.
func (s *ShareService) GetSharesByFile(ctx context.Context, fileID int64) ([]dto.MediaShareVO, error) {
	shares, err := s.repo.FindByFileID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	return toShareVOs(shares), nil
}

// Update modifies access settings of an existing share.
// Passing an empty password string removes the password requirement.
func (s *ShareService) Update(ctx context.Context, shareID int64, req dto.UpdateShareRequest) (*dto.MediaShareVO, error) {
	existing, err := s.repo.FindByID(ctx, shareID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, fmt.Errorf("分享不存在")
	}

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

	passwordHash := existing.PasswordHash
	if req.Password != nil {
		if *req.Password == "" {
			passwordHash = nil
		} else {
			hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
			if err != nil {
				return nil, fmt.Errorf("hash password: %w", err)
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

// Delete revokes and permanently removes a share record.
func (s *ShareService) Delete(ctx context.Context, shareID int64) error {
	return s.repo.Delete(ctx, shareID)
}

// --- Helpers ---

func generateShareToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

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

func toShareVOs(shares []model.MediaShare) []dto.MediaShareVO {
	vos := make([]dto.MediaShareVO, len(shares))
	for i, s := range shares {
		vos[i] = toShareVO(s)
	}
	return vos
}
