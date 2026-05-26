// Atlas — Phase 1 P1-02 PdfCarrierService (skeleton)
//
// 范围（本 session 完成）:
//   * 从一个已存在的 media_files 行（用户已通过 admin 媒体库上传 PDF）创建 atlas_carriers 行
//   * source_uri 约定: media://{media_file_id}
//   * 文本抽取（pdf.js / pypdf）在 Phase 1 后期单独完成；本骨架不抽文本，
//     content_hash 暂用 mediaID + size 的 sha256 占位
//
// Phase 1 后期任务（P1-02 production）:
//   * pdfjs 文本层 + 页面 bbox 提取 → 写入 carrier metadata
//   * 文本流（按页拼接）作为标注锚定的 rootText 持久化到 carrier_versions.storage_uri

package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// PdfMediaSnapshot 是 PdfCarrierService 需要的 media 子集字段。
type PdfMediaSnapshot struct {
	ID       int64
	Title    string
	FileURL  string
	FileSize int64
	OwnerID  *int64
}

// PdfMediaReader 是最小读接口，由 server.go 用 media service 适配。
type PdfMediaReader interface {
	GetPdfSnapshot(ctx context.Context, mediaFileID int64) (*PdfMediaSnapshot, error)
}

// PdfCarrierService 处理 pdf 类型 carrier 的懒创建。
type PdfCarrierService struct {
	carriers *repository.CarrierRepo
	media    PdfMediaReader
}

// NewPdfCarrierService 创建。
func NewPdfCarrierService(carriers *repository.CarrierRepo, media PdfMediaReader) *PdfCarrierService {
	return &PdfCarrierService{carriers: carriers, media: media}
}

// GetOrCreateForMediaFile 把 media_files.id 包装为 atlas_carriers 行（幂等）。
func (s *PdfCarrierService) GetOrCreateForMediaFile(ctx context.Context, mediaFileID int64) (*model.Carrier, error) {
	if mediaFileID <= 0 {
		return nil, errors.New("invalid media_file id")
	}
	if s.media == nil {
		return nil, errors.New("media reader not configured")
	}
	uri := PdfSourceURI(mediaFileID)

	existing, err := s.carriers.FindBySourceURI(ctx, uri)
	if err != nil {
		return nil, fmt.Errorf("find carrier: %w", err)
	}

	media, err := s.media.GetPdfSnapshot(ctx, mediaFileID)
	if err != nil {
		return nil, fmt.Errorf("load media %d: %w", mediaFileID, err)
	}
	if media == nil {
		return nil, fmt.Errorf("media file %d not found", mediaFileID)
	}
	// 占位指纹：mediaID + size。Phase 1 后期换为对文件字节流计算的真 sha256。
	hash := contentSHA256(fmt.Sprintf("media://%d:size=%d", media.ID, media.FileSize))
	metadata := []byte(fmt.Sprintf(`{"fileUrl":%q,"fileSize":%d}`, media.FileURL, media.FileSize))

	// PR #725 review fix (Gemini medium, pdf_carrier.go:78): 文件重新上传导致 size 变化时，
	// existing.ContentHash 不再匹配。过去直接返回 existing 会让 carrier hash + metadata 永久 stale
	// 且无法触发版本迁移。现在镜像 MarkdownCarrierService 行为：检测 hash 变化 → UpdateContent bump v_n。
	if existing != nil {
		if existing.ContentHash != hash {
			diff := []byte(`{"reason":"pdf_reuploaded"}`)
			if err := s.carriers.UpdateContent(ctx, existing.ID, hash, uri, "reupload", diff); err != nil {
				return nil, fmt.Errorf("bump pdf carrier version: %w", err)
			}
			existing.ContentHash = hash
			existing.Metadata = metadata
			// 注：PDF 标注的版本迁移与 markdown 不同——pdf.js 抽取的文本与 markdown→plaintext
			// 不在同一空间，Phase 1 后期 PDF Reader 上线时再补 MigrateAnnotations 集成。
		}
		return existing, nil
	}

	c := &model.Carrier{
		Type:        "pdf",
		SourceURI:   uri,
		ContentHash: hash,
		Title:       firstNonEmpty(media.Title, fmt.Sprintf("pdf-%d", media.ID)),
		Metadata:    metadata,
		OwnerID:     media.OwnerID,
		// Phase 1 骨架：状态先标 ingesting，真正抽取完成后由 worker 转 ready。
		Status:        "ingesting",
		StatusMessage: ptrStr("等待 pdfjs 文本抽取（Phase 1 后期）"),
	}
	created, err := s.carriers.Create(ctx, c, uri)
	if err != nil {
		return nil, fmt.Errorf("create pdf carrier: %w", err)
	}
	return created, nil
}

// PdfSourceURI 构造 pdf carrier 的 source_uri。
func PdfSourceURI(mediaID int64) string {
	return fmt.Sprintf("media://%d", mediaID)
}

func ptrStr(s string) *string { return &s }

// 复用 contentSHA256 + firstNonEmpty（在 markdown_carrier.go 中已定义）。
// 这里再写一份本地 alias 仅是为了在单测 / mock 时方便替换；当前直接共享。
var _ = sha256.Size // 让 go vet 高兴；hex pkg 也已被 markdown_carrier 引入
var _ = hex.EncodedLen
