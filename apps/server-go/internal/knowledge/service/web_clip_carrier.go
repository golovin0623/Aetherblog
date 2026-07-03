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

// WebClipInput 是调用者提供的网页快照。
type WebClipInput struct {
	SourceURL       string
	Title           string
	ContentMarkdown string
	Author          *string
	Language        *string
}

// WebClipCarrierService 将网页存储为 Atlas 载体。
type WebClipCarrierService struct {
	carriers   *repository.CarrierRepo
	versioning *CarrierVersioningService
	fetcher    *WebClipFetcher
}

// NewWebClipCarrierService 创建 Web 剪辑载体服务。
func NewWebClipCarrierService(carriers *repository.CarrierRepo) *WebClipCarrierService {
	return &WebClipCarrierService{carriers: carriers, fetcher: DefaultWebClipFetcher()}
}

// AttachVersioning 为已编辑的 Web 剪辑注入注释迁移。
func (s *WebClipCarrierService) AttachVersioning(v *CarrierVersioningService) {
	s.versioning = v
}

// AttachFetcher 注入一个有界的 Web fetcher，主要用于测试。
func (s *WebClipCarrierService) AttachFetcher(fetcher *WebClipFetcher) {
	s.fetcher = fetcher
}

// FetchSnapshot 获取公共网页并提取可读的 Markdown 草稿。
func (s *WebClipCarrierService) FetchSnapshot(ctx context.Context, sourceURL string) (*WebClipSnapshot, error) {
	fetcher := s.fetcher
	if fetcher == nil {
		fetcher = DefaultWebClipFetcher()
	}
	return fetcher.Fetch(ctx, sourceURL)
}

// CreateOrUpdateWebClipAs 存储为当前用户提供的网页快照。
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

// NormalizeWebClipSourceURI 返回不带片段的稳定 http(s) URL。
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

// WebTextLayerStorageURI 为 Web 快照构造不可变的 rootText 存储 URI。
func WebTextLayerStorageURI(ownerID int64, sourceURL string, hash string) string {
	return fmt.Sprintf("atlas-text-layer://web/%d/%s/%s", ownerID, contentSHA256(sourceURL), hash)
}

// WebClipText构建了用于AI建议和注释迁移的稳定文本空间。
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
