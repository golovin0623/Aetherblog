package service

import (
	"context"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// MediaTagService manages media tags and the file-tag associations.
type MediaTagService struct {
	repo *repository.MediaTagRepo
}

// NewMediaTagService creates a MediaTagService backed by the given repository.
func NewMediaTagService(repo *repository.MediaTagRepo) *MediaTagService {
	return &MediaTagService{repo: repo}
}

// GetAll returns all media tags ordered by usage count.
func (s *MediaTagService) GetAll(ctx context.Context) ([]dto.MediaTagVO, error) {
	tags, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	return toMediaTagVOs(tags), nil
}

// GetPopular returns the top N most-used tags. Defaults limit to 20 when <= 0.
func (s *MediaTagService) GetPopular(ctx context.Context, limit int) ([]dto.MediaTagVO, error) {
	if limit <= 0 {
		limit = 20
	}
	tags, err := s.repo.FindPopular(ctx, limit)
	if err != nil {
		return nil, err
	}
	return toMediaTagVOs(tags), nil
}

// Search returns tags whose name or slug contains keyword (case-insensitive).
func (s *MediaTagService) Search(ctx context.Context, keyword string) ([]dto.MediaTagVO, error) {
	tags, err := s.repo.Search(ctx, keyword)
	if err != nil {
		return nil, err
	}
	return toMediaTagVOs(tags), nil
}

// Create creates a new media tag with auto-generated slug from name.
// Defaults color to "#6366f1" and category to "CUSTOM" when absent.
func (s *MediaTagService) Create(ctx context.Context, req dto.CreateMediaTagRequest) (*dto.MediaTagVO, error) {
	color := "#6366f1"
	if req.Color != nil {
		color = *req.Color
	}
	category := "CUSTOM"
	if req.Category != nil {
		category = *req.Category
	}

	t := &model.MediaTag{
		Name:        req.Name,
		Slug:        slugify(req.Name),
		Description: req.Description,
		Color:       color,
		Category:    category,
	}
	if err := s.repo.Create(ctx, t); err != nil {
		return nil, err
	}
	vo := toMediaTagVO(*t)
	return &vo, nil
}

// Delete permanently removes a media tag.
func (s *MediaTagService) Delete(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// GetFileTags returns all tags assigned to a media file.
func (s *MediaTagService) GetFileTags(ctx context.Context, fileID int64) ([]dto.MediaTagVO, error) {
	tags, err := s.repo.FindTagsByFileID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	return toMediaTagVOs(tags), nil
}

// TagFile associates multiple tags with a media file, skipping already-present tags.
// Increments usage_count for each newly added tag.
func (s *MediaTagService) TagFile(ctx context.Context, fileID int64, tagIDs []int64, taggedBy *int64) error {
	for _, tagID := range tagIDs {
		// Check if already tagged
		n, err := s.repo.CountFileTag(ctx, fileID, tagID)
		if err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if err := s.repo.TagFile(ctx, fileID, tagID, taggedBy); err != nil {
			return err
		}
		if err := s.repo.IncrementUsageCount(ctx, tagID, 1); err != nil {
			return err
		}
	}
	return nil
}

// UntagFile removes a tag from a media file and decrements usage_count.
func (s *MediaTagService) UntagFile(ctx context.Context, fileID int64, tagID int64) error {
	// Check if tag exists on file
	n, err := s.repo.CountFileTag(ctx, fileID, tagID)
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	if err := s.repo.UntagFile(ctx, fileID, tagID); err != nil {
		return err
	}
	return s.repo.IncrementUsageCount(ctx, tagID, -1)
}

// BatchTag associates a single tag with multiple files, skipping already-tagged files.
func (s *MediaTagService) BatchTag(ctx context.Context, fileIDs []int64, tagID int64, taggedBy *int64) error {
	for _, fileID := range fileIDs {
		n, err := s.repo.CountFileTag(ctx, fileID, tagID)
		if err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if err := s.repo.TagFile(ctx, fileID, tagID, taggedBy); err != nil {
			return err
		}
		if err := s.repo.IncrementUsageCount(ctx, tagID, 1); err != nil {
			return err
		}
	}
	return nil
}

// --- Helpers ---

func toMediaTagVO(t model.MediaTag) dto.MediaTagVO {
	return dto.MediaTagVO{
		ID:          t.ID,
		Name:        t.Name,
		Slug:        t.Slug,
		Description: t.Description,
		Color:       t.Color,
		Category:    t.Category,
		UsageCount:  t.UsageCount,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
	}
}

func toMediaTagVOs(tags []model.MediaTag) []dto.MediaTagVO {
	vos := make([]dto.MediaTagVO, len(tags))
	for i, t := range tags {
		vos[i] = toMediaTagVO(t)
	}
	return vos
}

func slugify(s string) string {
	s = strings.ToLower(s)
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r > 127 {
			sb.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '_' {
			sb.WriteRune('-')
		}
	}
	result := strings.Trim(sb.String(), "-")
	if result == "" {
		result = "tag"
	}
	return result
}
