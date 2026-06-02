package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/pkg/anchoring"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// ImageMediaSnapshot is the media subset needed to create an image carrier.
type ImageMediaSnapshot struct {
	ID           int64
	Title        string
	OriginalName string
	FileURL      string
	FileSize     int64
	MimeType     string
	FileType     string
	Width        *int
	Height       *int
	OwnerID      *int64
}

// ImageMediaReader is implemented by the server media adapter.
type ImageMediaReader interface {
	GetImageMediaSnapshot(ctx context.Context, mediaFileID int64) (*ImageMediaSnapshot, error)
}

// ImageCarrierInput is a caller-supplied image description/OCR note for Atlas.
type ImageCarrierInput struct {
	MediaFileID         int64
	DescriptionMarkdown string
	Language            *string
}

// ImageCarrierService stores user-supplied image descriptions as Atlas carriers.
type ImageCarrierService struct {
	carriers   *repository.CarrierRepo
	media      ImageMediaReader
	versioning *CarrierVersioningService
}

// NewImageCarrierService creates the image carrier service.
func NewImageCarrierService(carriers *repository.CarrierRepo, media ImageMediaReader) *ImageCarrierService {
	return &ImageCarrierService{carriers: carriers, media: media}
}

// AttachVersioning injects annotation migration for image description edits.
func (s *ImageCarrierService) AttachVersioning(v *CarrierVersioningService) {
	s.versioning = v
}

// CreateOrUpdateForMediaAs creates or refreshes an image carrier under the caller scope.
func (s *ImageCarrierService) CreateOrUpdateForMediaAs(ctx context.Context, in ImageCarrierInput, userID int64, canAdmin bool) (*model.Carrier, error) {
	if in.MediaFileID <= 0 {
		return nil, errors.New("invalid media_file id")
	}
	if s.carriers == nil {
		return nil, errors.New("carrier repo not configured")
	}
	if s.media == nil {
		return nil, errors.New("media reader not configured")
	}
	media, err := s.media.GetImageMediaSnapshot(ctx, in.MediaFileID)
	if err != nil {
		return nil, fmt.Errorf("load media %d: %w", in.MediaFileID, err)
	}
	if media == nil {
		return nil, fmt.Errorf("media file %d not found", in.MediaFileID)
	}
	if !canAdmin && (media.OwnerID == nil || *media.OwnerID != userID) {
		return nil, ErrAtlasForbidden
	}
	carrierType, ok := imageCarrierType(media)
	if !ok {
		return nil, fmt.Errorf("media file %d is not image", in.MediaFileID)
	}
	text := ImageCarrierText(in)
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("descriptionMarkdown 不能为空")
	}

	hash := contentSHA256(text)
	storageURI := ImageTextLayerStorageURI(media.ID, hash)
	metadata, err := imageCarrierMetadata(media, storageURI, text)
	if err != nil {
		return nil, fmt.Errorf("marshal image metadata: %w", err)
	}
	candidate := &model.Carrier{
		Type:        carrierType,
		SourceURI:   MediaSourceURI(media.ID),
		ContentHash: hash,
		Title:       firstNonEmpty(media.Title, media.OriginalName, fmt.Sprintf("image-%d", media.ID)),
		Language:    trimmedStringPtr(in.Language),
		Metadata:    metadata,
		OwnerID:     media.OwnerID,
		Status:      "ready",
	}
	carrier, justCreated, err := s.carriers.UpsertBySourceURI(ctx, candidate, storageURI)
	if err != nil {
		return nil, fmt.Errorf("upsert image carrier: %w", err)
	}
	if !justCreated && carrier.ContentHash != hash {
		if s.versioning != nil {
			if _, err := s.versioning.MigrateAnnotations(ctx, carrier.ID, text); err != nil {
				return nil, fmt.Errorf("migrate image annotations before hash bump: %w", err)
			}
		}
		if err := s.persistTextLayer(ctx, carrier.ID, hash, storageURI, text); err != nil {
			return nil, err
		}
		diff := []byte(`{"reason":"image_description_updated"}`)
		if err := s.carriers.UpdateContent(ctx, carrier.ID, hash, storageURI, "image_description_update", diff); err != nil {
			return nil, fmt.Errorf("update image carrier content after migration: %w", err)
		}
		if err := s.carriers.UpdateDisplayAndIngestState(ctx, carrier.ID, candidate.Title, nil, candidate.Language, metadata, "ready", nil); err != nil {
			return nil, fmt.Errorf("update image carrier metadata after content change: %w", err)
		}
		carrier.Type = carrierType
		carrier.ContentHash = hash
		carrier.Title = candidate.Title
		carrier.Language = candidate.Language
		carrier.Metadata = metadata
		carrier.Status = "ready"
		carrier.StatusMessage = nil
		return carrier, nil
	}
	if err := s.persistTextLayer(ctx, carrier.ID, hash, storageURI, text); err != nil {
		return nil, err
	}
	if !justCreated {
		if err := s.carriers.UpdateDisplayAndIngestState(ctx, carrier.ID, candidate.Title, nil, candidate.Language, metadata, "ready", nil); err != nil {
			return nil, fmt.Errorf("refresh image carrier metadata: %w", err)
		}
		carrier.Type = carrierType
		carrier.Title = candidate.Title
		carrier.Language = candidate.Language
		carrier.Metadata = metadata
		carrier.Status = "ready"
	}
	return carrier, nil
}

// ImageTextLayerStorageURI constructs the immutable rootText storage URI for an image description.
func ImageTextLayerStorageURI(mediaID int64, hash string) string {
	return fmt.Sprintf("atlas-text-layer://image/%d/%s", mediaID, hash)
}

// ImageCarrierText builds the stable text space for image annotations and AI suggestions.
func ImageCarrierText(in ImageCarrierInput) string {
	parts := make([]string, 0, 1)
	if content := strings.TrimSpace(anchoring.MarkdownToPlaintext(in.DescriptionMarkdown)); content != "" {
		parts = append(parts, content)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func (s *ImageCarrierService) persistTextLayer(ctx context.Context, carrierID int64, hash, storageURI string, text string) error {
	charCount := textLayerCharCount(text)
	pages, err := json.Marshal([]map[string]any{{
		"page":       1,
		"text":       text,
		"char_start": 0,
		"char_end":   charCount,
	}})
	if err != nil {
		return fmt.Errorf("marshal image text page: %w", err)
	}
	if err := s.carriers.UpsertTextLayer(ctx, &model.CarrierTextLayer{
		CarrierID:   carrierID,
		ContentHash: hash,
		StorageURI:  storageURI,
		PageCount:   1,
		CharCount:   charCount,
		TextContent: text,
		Pages:       pages,
	}); err != nil {
		return fmt.Errorf("persist image text layer: %w", err)
	}
	return nil
}

func imageCarrierMetadata(media *ImageMediaSnapshot, storageURI string, text string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"fileUrl":       media.FileURL,
		"fileSize":      media.FileSize,
		"mimeType":      media.MimeType,
		"originalName":  media.OriginalName,
		"mediaType":     "image",
		"textLayerURI":  storageURI,
		"contentFormat": "image_description",
		"width":         media.Width,
		"height":        media.Height,
		"charCount":     textLayerCharCount(text),
	})
}

func imageCarrierType(media *ImageMediaSnapshot) (string, bool) {
	fileType := strings.ToUpper(strings.TrimSpace(media.FileType))
	mimeType := strings.ToLower(strings.TrimSpace(media.MimeType))
	switch {
	case fileType == "IMAGE" || strings.HasPrefix(mimeType, "image/"):
		return "image", true
	default:
		return "", false
	}
}
