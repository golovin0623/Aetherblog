// Atlas — Phase 1 P1-02 PdfCarrierService
//
// 从 media_files 里的 PDF 创建 atlas_carriers，并通过 ai-service 抽取逐页文本层。

package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

const maxPDFCarrierBytes int64 = 20 * 1024 * 1024

// PdfMediaSnapshot 是 PdfCarrierService 需要的 media 子集字段。
type PdfMediaSnapshot struct {
	ID           int64
	Title        string
	OriginalName string
	FileURL      string
	FileSize     int64
	MimeType     string
	FileType     string
	OwnerID      *int64
}

// PdfMediaReader 是最小读接口，由 server.go 用 media service 适配。
type PdfMediaReader interface {
	GetPdfSnapshot(ctx context.Context, mediaFileID int64) (*PdfMediaSnapshot, error)
	DownloadBytes(ctx context.Context, mediaFileID int64, maxBytes int64) ([]byte, string, string, error)
}

// PDFTextPage 是抽取后的页级文本层。
type PDFTextPage struct {
	Page      int    `json:"page"`
	Text      string `json:"text"`
	CharStart int    `json:"char_start"`
	CharEnd   int    `json:"char_end"`
}

// PDFTextLayer 是 PDF 抽取器返回的完整文本层。
type PDFTextLayer struct {
	Text      string        `json:"text"`
	TextHash  string        `json:"text_hash"`
	PageCount int           `json:"page_count"`
	CharCount int           `json:"char_count"`
	Pages     []PDFTextPage `json:"pages"`
	Extractor string        `json:"extractor"`
}

// PDFTextExtractor 抽取 PDF 文本层；生产环境由 ai-service 适配器实现。
type PDFTextExtractor interface {
	ExtractPDFText(ctx context.Context, content []byte, mimeType string, filename string) (*PDFTextLayer, error)
}

// PdfCarrierService 处理 pdf 类型 carrier 的懒创建。
type PdfCarrierService struct {
	carriers  *repository.CarrierRepo
	media     PdfMediaReader
	extractor PDFTextExtractor
}

// NewPdfCarrierService 创建。
func NewPdfCarrierService(carriers *repository.CarrierRepo, media PdfMediaReader, extractor PDFTextExtractor) *PdfCarrierService {
	return &PdfCarrierService{carriers: carriers, media: media, extractor: extractor}
}

// GetOrCreateForMediaFile 把 media_files.id 包装为 atlas_carriers 行（幂等）。
func (s *PdfCarrierService) GetOrCreateForMediaFile(ctx context.Context, mediaFileID int64) (*model.Carrier, error) {
	return s.getOrCreateForMediaFile(ctx, mediaFileID, 0, true)
}

// GetOrCreateForMediaFileAs 懒创建/返回当前调用者可访问的 PDF carrier。
func (s *PdfCarrierService) GetOrCreateForMediaFileAs(ctx context.Context, mediaFileID int64, userID int64, canAdmin bool) (*model.Carrier, error) {
	return s.getOrCreateForMediaFile(ctx, mediaFileID, userID, canAdmin)
}

func (s *PdfCarrierService) getOrCreateForMediaFile(ctx context.Context, mediaFileID int64, userID int64, canAdmin bool) (*model.Carrier, error) {
	if mediaFileID <= 0 {
		return nil, errors.New("invalid media_file id")
	}
	if s.media == nil {
		return nil, errors.New("media reader not configured")
	}
	if s.extractor == nil {
		return nil, errors.New("pdf text extractor not configured")
	}
	uri := PdfSourceURI(mediaFileID)

	media, err := s.media.GetPdfSnapshot(ctx, mediaFileID)
	if err != nil {
		return nil, fmt.Errorf("load media %d: %w", mediaFileID, err)
	}
	if media == nil {
		return nil, fmt.Errorf("media file %d not found", mediaFileID)
	}
	if !canAdmin && (media.OwnerID == nil || *media.OwnerID != userID) {
		return nil, ErrAtlasForbidden
	}
	if !isPDFMedia(media) {
		return nil, fmt.Errorf("media file %d is not a PDF", mediaFileID)
	}

	content, mimeType, filename, err := s.media.DownloadBytes(ctx, mediaFileID, maxPDFCarrierBytes)
	if err != nil {
		return nil, fmt.Errorf("download pdf media %d: %w", mediaFileID, err)
	}
	mimeType = firstNonEmpty(mimeType, media.MimeType)
	filename = firstNonEmpty(filename, media.OriginalName, media.Title)
	layer, err := s.extractor.ExtractPDFText(ctx, content, mimeType, filename)
	if err != nil {
		return nil, fmt.Errorf("extract pdf text layer: %w", err)
	}
	if layer == nil {
		return nil, errors.New("pdf text extractor returned empty layer")
	}
	hash := strings.TrimSpace(layer.TextHash)
	if hash == "" {
		hash = contentSHA256(layer.Text)
	}
	storageURI := PdfTextLayerStorageURI(media.ID, hash)
	metadata, err := pdfMetadata(media, layer, storageURI)
	if err != nil {
		return nil, fmt.Errorf("build pdf metadata: %w", err)
	}

	existing, err := s.carriers.FindBySourceURIForOwner(ctx, uri, media.OwnerID)
	if err != nil {
		return nil, fmt.Errorf("find carrier: %w", err)
	}

	// 文件重新上传导致文本 hash 变化时，先持久化新文本层，再推进 carrier version。
	// 这样 UpdateContent 失败时可安全重试，不会丢失 rootText 证据。
	if existing != nil {
		if err := s.persistTextLayer(ctx, existing.ID, hash, storageURI, layer); err != nil {
			return nil, err
		}
		if existing.ContentHash != hash {
			diff, _ := json.Marshal(map[string]any{
				"reason":     "pdf_reuploaded",
				"pageCount":  layer.PageCount,
				"charCount":  layer.CharCount,
				"storageUri": storageURI,
			})
			if err := s.carriers.UpdateContent(ctx, existing.ID, hash, storageURI, "reupload", diff); err != nil {
				return nil, fmt.Errorf("bump pdf carrier version: %w", err)
			}
			existing.ContentHash = hash
		}
		if err := s.carriers.UpdateIngestState(ctx, existing.ID, metadata, "ready", nil); err != nil {
			return nil, fmt.Errorf("update pdf carrier ingest state: %w", err)
		}
		existing.Metadata = metadata
		existing.Status = "ready"
		existing.StatusMessage = nil
		return existing, nil
	}

	c := &model.Carrier{
		Type:        "pdf",
		SourceURI:   uri,
		ContentHash: hash,
		Title:       firstNonEmpty(media.Title, fmt.Sprintf("pdf-%d", media.ID)),
		Metadata:    metadata,
		OwnerID:     media.OwnerID,
		Status:      "ready",
	}
	created, _, err := s.carriers.UpsertBySourceURI(ctx, c, storageURI)
	if err != nil {
		return nil, fmt.Errorf("create pdf carrier: %w", err)
	}
	if err := s.persistTextLayer(ctx, created.ID, hash, storageURI, layer); err != nil {
		return nil, err
	}
	return created, nil
}

// PdfSourceURI 构造 pdf carrier 的 source_uri。
func PdfSourceURI(mediaID int64) string {
	return fmt.Sprintf("media://%d", mediaID)
}

// PdfTextLayerStorageURI constructs the immutable rootText storage URI referenced by carrier_versions.
func PdfTextLayerStorageURI(mediaID int64, hash string) string {
	return fmt.Sprintf("atlas-text-layer://pdf/%d/%s", mediaID, hash)
}

func (s *PdfCarrierService) persistTextLayer(ctx context.Context, carrierID int64, hash, storageURI string, layer *PDFTextLayer) error {
	pages, err := json.Marshal(layer.Pages)
	if err != nil {
		return fmt.Errorf("marshal pdf text pages: %w", err)
	}
	if err := s.carriers.UpsertTextLayer(ctx, &model.CarrierTextLayer{
		CarrierID:   carrierID,
		ContentHash: hash,
		StorageURI:  storageURI,
		PageCount:   layer.PageCount,
		CharCount:   layer.CharCount,
		TextContent: layer.Text,
		Pages:       pages,
	}); err != nil {
		return fmt.Errorf("persist pdf text layer: %w", err)
	}
	return nil
}

func pdfMetadata(media *PdfMediaSnapshot, layer *PDFTextLayer, storageURI string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"fileUrl":             media.FileURL,
		"fileSize":            media.FileSize,
		"mimeType":            media.MimeType,
		"originalName":        media.OriginalName,
		"textLayerStorageUri": storageURI,
		"pageCount":           layer.PageCount,
		"charCount":           layer.CharCount,
		"extractor":           firstNonEmpty(layer.Extractor, "ai-service/pypdf"),
	})
}

func isPDFMedia(media *PdfMediaSnapshot) bool {
	mimeType := strings.ToLower(strings.TrimSpace(media.MimeType))
	originalName := strings.ToLower(strings.TrimSpace(media.OriginalName))
	title := strings.ToLower(strings.TrimSpace(media.Title))
	return mimeType == "application/pdf" || strings.HasSuffix(originalName, ".pdf") || strings.HasSuffix(title, ".pdf")
}
