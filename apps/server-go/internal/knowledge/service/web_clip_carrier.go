package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/pkg/anchoring"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// WebClipInput is the caller-supplied snapshot for a web page.
type WebClipInput struct {
	SourceURL       string
	Title           string
	ContentMarkdown string
	Author          *string
	Language        *string
}

// WebClipCarrierService stores web pages as Atlas carriers.
type WebClipCarrierService struct {
	carriers   *repository.CarrierRepo
	versioning *CarrierVersioningService
	fetcher    *WebClipFetcher
}

// NewWebClipCarrierService creates a web clip carrier service.
func NewWebClipCarrierService(carriers *repository.CarrierRepo) *WebClipCarrierService {
	return &WebClipCarrierService{carriers: carriers, fetcher: DefaultWebClipFetcher()}
}

// AttachVersioning injects annotation migration for edited web clips.
func (s *WebClipCarrierService) AttachVersioning(v *CarrierVersioningService) {
	s.versioning = v
}

// AttachFetcher injects a bounded web fetcher, primarily for tests.
func (s *WebClipCarrierService) AttachFetcher(fetcher *WebClipFetcher) {
	s.fetcher = fetcher
}

// FetchSnapshot fetches a public web page and extracts a readable Markdown draft.
func (s *WebClipCarrierService) FetchSnapshot(ctx context.Context, sourceURL string) (*WebClipSnapshot, error) {
	fetcher := s.fetcher
	if fetcher == nil {
		fetcher = DefaultWebClipFetcher()
	}
	return fetcher.Fetch(ctx, sourceURL)
}

// CreateOrUpdateWebClipAs stores the supplied web page snapshot for the current user.
func (s *WebClipCarrierService) CreateOrUpdateWebClipAs(ctx context.Context, in WebClipInput, userID int64) (*model.Carrier, error) {
	if s.carriers == nil {
		return nil, errors.New("carrier repo not configured")
	}
	uri, err := NormalizeWebClipSourceURI(in.SourceURL)
	if err != nil {
		return nil, err
	}
	text := WebClipText(in)
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("contentMarkdown 不能为空")
	}
	hash := contentSHA256(text)
	ownerID := userID
	storageURI := WebTextLayerStorageURI(ownerID, uri, hash)
	metadata, err := webClipMetadata(uri, text, storageURI)
	if err != nil {
		return nil, err
	}
	candidate := &model.Carrier{
		Type:        "web",
		SourceURI:   uri,
		ContentHash: hash,
		Title:       firstNonEmpty(in.Title, uri),
		Author:      trimmedStringPtr(in.Author),
		Language:    trimmedStringPtr(in.Language),
		Metadata:    metadata,
		OwnerID:     &ownerID,
		Status:      "ready",
	}
	carrier, justCreated, err := s.carriers.UpsertBySourceURI(ctx, candidate, storageURI)
	if err != nil {
		return nil, fmt.Errorf("upsert web carrier: %w", err)
	}
	if !justCreated && carrier.ContentHash != hash {
		if s.versioning != nil {
			if _, err := s.versioning.MigrateAnnotations(ctx, carrier.ID, text); err != nil {
				return nil, fmt.Errorf("migrate web annotations before hash bump: %w", err)
			}
		}
		if err := s.persistTextLayer(ctx, carrier.ID, hash, storageURI, text); err != nil {
			return nil, err
		}
		diff := []byte(`{"reason":"web_clip_updated"}`)
		if err := s.carriers.UpdateContent(ctx, carrier.ID, hash, storageURI, "web_clip_update", diff); err != nil {
			return nil, fmt.Errorf("update web carrier content after migration: %w", err)
		}
		if err := s.carriers.UpdateDisplayAndIngestState(ctx, carrier.ID, candidate.Title, candidate.Author, candidate.Language, metadata, "ready", nil); err != nil {
			return nil, fmt.Errorf("update web carrier metadata after content change: %w", err)
		}
		carrier.ContentHash = hash
		carrier.Title = candidate.Title
		carrier.Author = candidate.Author
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
			return nil, fmt.Errorf("refresh web carrier metadata: %w", err)
		}
		carrier.Title = candidate.Title
		carrier.Author = candidate.Author
		carrier.Language = candidate.Language
		carrier.Metadata = metadata
		carrier.Status = "ready"
		carrier.StatusMessage = nil
	}
	return carrier, nil
}

// NormalizeWebClipSourceURI returns a stable http(s) URL without fragment.
func NormalizeWebClipSourceURI(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("sourceUrl 不能为空")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("sourceUrl 必须是完整的 http(s) URL")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", errors.New("sourceUrl 仅支持 http(s)")
	}
	parsed.Scheme = scheme
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.User = nil
	parsed.Fragment = ""
	return parsed.String(), nil
}

// WebTextLayerStorageURI constructs the immutable rootText storage URI for a web snapshot.
func WebTextLayerStorageURI(ownerID int64, sourceURL string, hash string) string {
	return fmt.Sprintf("atlas-text-layer://web/%d/%s/%s", ownerID, contentSHA256(sourceURL), hash)
}

// WebClipText builds the stable text space used for AI suggestions and annotation migration.
func WebClipText(in WebClipInput) string {
	parts := make([]string, 0, 2)
	if title := strings.TrimSpace(in.Title); title != "" {
		parts = append(parts, title)
	}
	if content := strings.TrimSpace(anchoring.MarkdownToPlaintext(in.ContentMarkdown)); content != "" {
		parts = append(parts, content)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func (s *WebClipCarrierService) persistTextLayer(ctx context.Context, carrierID int64, hash, storageURI, text string) error {
	charCount := textLayerCharCount(text)
	pages, err := json.Marshal([]map[string]any{{
		"page":       1,
		"text":       text,
		"char_start": 0,
		"char_end":   charCount,
	}})
	if err != nil {
		return fmt.Errorf("marshal web text page: %w", err)
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
		return fmt.Errorf("persist web text layer: %w", err)
	}
	return nil
}

func webClipMetadata(sourceURL string, text string, storageURI string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"sourceUrl":     sourceURL,
		"textLayerURI":  storageURI,
		"contentFormat": "markdown",
		"charCount":     textLayerCharCount(text),
		"capturedAt":    time.Now().UTC().Format(time.RFC3339),
	})
}

func trimmedStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
