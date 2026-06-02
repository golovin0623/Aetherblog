package server

import (
	"context"
	"strings"

	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	coresvc "github.com/golovin0623/aetherblog-server/internal/service"
)

type atlasPDFMediaReader struct {
	media *coresvc.MediaService
}

type atlasTranscriptMediaReader struct {
	media *coresvc.MediaService
}

type atlasImageMediaReader struct {
	media *coresvc.MediaService
}

func (r atlasPDFMediaReader) GetPdfSnapshot(ctx context.Context, mediaFileID int64) (*atlassvc.PdfMediaSnapshot, error) {
	if r.media == nil {
		return nil, nil
	}
	vo, err := r.media.GetByID(ctx, mediaFileID)
	if err != nil || vo == nil {
		return nil, err
	}
	if vo.Deleted {
		return nil, nil
	}
	_, ownerID, err := r.media.GetUploaderID(ctx, mediaFileID)
	if err != nil {
		return nil, err
	}
	mimeType := ""
	if vo.MimeType != nil {
		mimeType = *vo.MimeType
	}
	return &atlassvc.PdfMediaSnapshot{
		ID:           vo.ID,
		Title:        firstNonEmptyServer(vo.OriginalName, vo.Filename),
		OriginalName: vo.OriginalName,
		FileURL:      firstNonEmptyServer(vo.PublicURL, vo.CdnURL, vo.FileURL),
		FileSize:     vo.FileSize,
		MimeType:     mimeType,
		FileType:     vo.FileType,
		OwnerID:      ownerID,
	}, nil
}

func (r atlasPDFMediaReader) DownloadBytes(ctx context.Context, mediaFileID int64, maxBytes int64) ([]byte, string, string, error) {
	return r.media.DownloadBytes(ctx, mediaFileID, maxBytes)
}

func (r atlasTranscriptMediaReader) GetTranscriptMediaSnapshot(ctx context.Context, mediaFileID int64) (*atlassvc.TranscriptMediaSnapshot, error) {
	if r.media == nil {
		return nil, nil
	}
	vo, err := r.media.GetByID(ctx, mediaFileID)
	if err != nil || vo == nil {
		return nil, err
	}
	if vo.Deleted {
		return nil, nil
	}
	_, ownerID, err := r.media.GetUploaderID(ctx, mediaFileID)
	if err != nil {
		return nil, err
	}
	mimeType := ""
	if vo.MimeType != nil {
		mimeType = *vo.MimeType
	}
	return &atlassvc.TranscriptMediaSnapshot{
		ID:           vo.ID,
		Title:        firstNonEmptyServer(vo.OriginalName, vo.Filename),
		OriginalName: vo.OriginalName,
		FileURL:      firstNonEmptyServer(vo.PublicURL, vo.CdnURL, vo.FileURL),
		FileSize:     vo.FileSize,
		MimeType:     mimeType,
		FileType:     vo.FileType,
		OwnerID:      ownerID,
	}, nil
}

func (r atlasImageMediaReader) GetImageMediaSnapshot(ctx context.Context, mediaFileID int64) (*atlassvc.ImageMediaSnapshot, error) {
	if r.media == nil {
		return nil, nil
	}
	vo, err := r.media.GetByID(ctx, mediaFileID)
	if err != nil || vo == nil {
		return nil, err
	}
	if vo.Deleted {
		return nil, nil
	}
	_, ownerID, err := r.media.GetUploaderID(ctx, mediaFileID)
	if err != nil {
		return nil, err
	}
	mimeType := ""
	if vo.MimeType != nil {
		mimeType = *vo.MimeType
	}
	return &atlassvc.ImageMediaSnapshot{
		ID:           vo.ID,
		Title:        firstNonEmptyServer(vo.OriginalName, vo.Filename),
		OriginalName: vo.OriginalName,
		FileURL:      firstNonEmptyServer(vo.PublicURL, vo.CdnURL, vo.FileURL),
		FileSize:     vo.FileSize,
		MimeType:     mimeType,
		FileType:     vo.FileType,
		Width:        optionalIntServer(vo.Width),
		Height:       optionalIntServer(vo.Height),
		OwnerID:      ownerID,
	}, nil
}

func firstNonEmptyServer(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func optionalIntServer(value *int) *int {
	if value == nil || *value <= 0 {
		return nil
	}
	return value
}
