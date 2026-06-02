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

// TranscriptMediaSnapshot is the media subset needed to create a video/audio transcript carrier.
type TranscriptMediaSnapshot struct {
	ID           int64
	Title        string
	OriginalName string
	FileURL      string
	FileSize     int64
	MimeType     string
	FileType     string
	OwnerID      *int64
}

// TranscriptMediaReader is implemented by the server media adapter.
type TranscriptMediaReader interface {
	GetTranscriptMediaSnapshot(ctx context.Context, mediaFileID int64) (*TranscriptMediaSnapshot, error)
}

// TranscriptCarrierInput is a caller-supplied transcript for a video/audio media file.
type TranscriptCarrierInput struct {
	MediaFileID        int64
	TranscriptMarkdown string
	Language           *string
}

// TranscriptCarrierService stores user-supplied video/audio transcripts as Atlas carriers.
type TranscriptCarrierService struct {
	carriers   *repository.CarrierRepo
	media      TranscriptMediaReader
	versioning *CarrierVersioningService
}

// NewTranscriptCarrierService creates the transcript carrier service.
func NewTranscriptCarrierService(carriers *repository.CarrierRepo, media TranscriptMediaReader) *TranscriptCarrierService {
	return &TranscriptCarrierService{carriers: carriers, media: media}
}

// AttachVersioning injects annotation migration for transcript text edits.
func (s *TranscriptCarrierService) AttachVersioning(v *CarrierVersioningService) {
	s.versioning = v
}

// CreateOrUpdateForMediaAs creates or refreshes a video/audio transcript carrier under the caller scope.
func (s *TranscriptCarrierService) CreateOrUpdateForMediaAs(ctx context.Context, in TranscriptCarrierInput, userID int64, canAdmin bool) (*model.Carrier, error) {
	if in.MediaFileID <= 0 {
		return nil, errors.New("invalid media_file id")
	}
	if s.carriers == nil {
		return nil, errors.New("carrier repo not configured")
	}
	if s.media == nil {
		return nil, errors.New("media reader not configured")
	}
	media, err := s.media.GetTranscriptMediaSnapshot(ctx, in.MediaFileID)
	if err != nil {
		return nil, fmt.Errorf("load media %d: %w", in.MediaFileID, err)
	}
	if media == nil {
		return nil, fmt.Errorf("media file %d not found", in.MediaFileID)
	}
	if !canAdmin && (media.OwnerID == nil || *media.OwnerID != userID) {
		return nil, ErrAtlasForbidden
	}
	carrierType, ok := transcriptCarrierType(media)
	if !ok {
		return nil, fmt.Errorf("media file %d is not video/audio", in.MediaFileID)
	}
	text := TranscriptCarrierText(in)
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("transcriptMarkdown 不能为空")
	}

	hash := contentSHA256(text)
	storageURI := TranscriptTextLayerStorageURI(carrierType, media.ID, hash)
	metadata, err := transcriptCarrierMetadata(media, carrierType, storageURI, text)
	if err != nil {
		return nil, fmt.Errorf("marshal transcript metadata: %w", err)
	}
	candidate := &model.Carrier{
		Type:        carrierType,
		SourceURI:   MediaSourceURI(media.ID),
		ContentHash: hash,
		Title:       firstNonEmpty(media.Title, media.OriginalName, fmt.Sprintf("%s-%d", carrierType, media.ID)),
		Language:    trimmedStringPtr(in.Language),
		Metadata:    metadata,
		OwnerID:     media.OwnerID,
		Status:      "ready",
	}
	carrier, justCreated, err := s.carriers.UpsertBySourceURI(ctx, candidate, storageURI)
	if err != nil {
		return nil, fmt.Errorf("upsert transcript carrier: %w", err)
	}
	if !justCreated && carrier.ContentHash != hash {
		if s.versioning != nil {
			if _, err := s.versioning.MigrateAnnotations(ctx, carrier.ID, text); err != nil {
				return nil, fmt.Errorf("migrate transcript annotations before hash bump: %w", err)
			}
		}
		if err := s.persistTextLayer(ctx, carrier.ID, hash, storageURI, text); err != nil {
			return nil, err
		}
		diff := []byte(`{"reason":"transcript_updated"}`)
		if err := s.carriers.UpdateContent(ctx, carrier.ID, hash, storageURI, "transcript_update", diff); err != nil {
			return nil, fmt.Errorf("update transcript carrier content after migration: %w", err)
		}
		if err := s.carriers.UpdateDisplayAndIngestState(ctx, carrier.ID, candidate.Title, candidate.Author, candidate.Language, metadata, "ready", nil); err != nil {
			return nil, fmt.Errorf("update transcript carrier metadata after content change: %w", err)
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
		if err := s.carriers.UpdateDisplayAndIngestState(ctx, carrier.ID, candidate.Title, candidate.Author, candidate.Language, metadata, "ready", nil); err != nil {
			return nil, fmt.Errorf("refresh transcript carrier metadata: %w", err)
		}
		carrier.Type = carrierType
		carrier.Title = candidate.Title
		carrier.Language = candidate.Language
		carrier.Metadata = metadata
		carrier.Status = "ready"
	}
	return carrier, nil
}

// MediaSourceURI constructs a stable media-backed Atlas source URI.
func MediaSourceURI(mediaID int64) string {
	return fmt.Sprintf("media://%d", mediaID)
}

// TranscriptTextLayerStorageURI constructs the immutable rootText storage URI for a transcript snapshot.
func TranscriptTextLayerStorageURI(carrierType string, mediaID int64, hash string) string {
	return fmt.Sprintf("atlas-text-layer://%s-transcript/%d/%s", carrierType, mediaID, hash)
}

// TranscriptCarrierText builds the stable text space for transcript annotations and AI suggestions.
func TranscriptCarrierText(in TranscriptCarrierInput) string {
	parts := make([]string, 0, 1)
	if content := strings.TrimSpace(anchoring.MarkdownToPlaintext(in.TranscriptMarkdown)); content != "" {
		parts = append(parts, content)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func (s *TranscriptCarrierService) persistTextLayer(ctx context.Context, carrierID int64, hash, storageURI string, text string) error {
	charCount := textLayerCharCount(text)
	pages, err := json.Marshal([]map[string]any{{
		"page":       1,
		"text":       text,
		"char_start": 0,
		"char_end":   charCount,
	}})
	if err != nil {
		return fmt.Errorf("marshal transcript text page: %w", err)
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
		return fmt.Errorf("persist transcript text layer: %w", err)
	}
	return nil
}

func transcriptCarrierMetadata(media *TranscriptMediaSnapshot, carrierType string, storageURI string, text string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"fileUrl":            media.FileURL,
		"fileSize":           media.FileSize,
		"mimeType":           media.MimeType,
		"originalName":       media.OriginalName,
		"mediaType":          carrierType,
		"textLayerURI":       storageURI,
		"contentFormat":      "transcript",
		"timestampFormat":    "inline",
		"timestampSelectors": true,
		"charCount":          textLayerCharCount(text),
	})
}

func transcriptCarrierType(media *TranscriptMediaSnapshot) (string, bool) {
	fileType := strings.ToUpper(strings.TrimSpace(media.FileType))
	mimeType := strings.ToLower(strings.TrimSpace(media.MimeType))
	switch {
	case fileType == "VIDEO" || strings.HasPrefix(mimeType, "video/"):
		return "video", true
	case fileType == "AUDIO" || strings.HasPrefix(mimeType, "audio/"):
		return "audio", true
	default:
		return "", false
	}
}
