package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/imgproc"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

type MediaService struct {
	repo      *repository.MediaRepo
	store     storage.Storage
	uploadDir string // local base path for reading back files after upload (for thumbnail gen)
}

func NewMediaService(repo *repository.MediaRepo, store storage.Storage, uploadDir string) *MediaService {
	return &MediaService{repo: repo, store: store, uploadDir: uploadDir}
}

func (s *MediaService) Upload(ctx context.Context, fh *multipart.FileHeader, uploaderID *int64, folderID *int64) (*dto.MediaFileVO, error) {
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()

	mimeType := fh.Header.Get("Content-Type")
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = guessMimeType(fh.Filename)
	}
	fileType := classifyFileType(mimeType)

	// Build storage key: {year}/{month}/{timestamp}_{filename}
	now := time.Now()
	safeName := sanitizeFilename(fh.Filename)
	key := fmt.Sprintf("%d/%02d/%d_%s", now.Year(), now.Month(), now.UnixMilli(), safeName)

	url, err := s.store.Upload(ctx, key, f, fh.Size, mimeType)
	if err != nil {
		return nil, err
	}

	m := &model.MediaFile{
		Filename:          safeName,
		OriginalName:      fh.Filename,
		FilePath:          key,
		FileURL:           url,
		FileSize:          fh.Size,
		MimeType:          &mimeType,
		FileType:          fileType,
		StorageType:       s.store.Type(),
		UploaderID:        uploaderID,
		FolderID:          folderID,
	}

	// Extract image dimensions
	if imgproc.IsImage(mimeType) {
		if localStore, ok := s.store.(*storage.LocalStorage); ok {
			_ = localStore // use uploadDir for dimension reading
			localPath := filepath.Join(s.uploadDir, key)
			if w, h, err := imgproc.GetDimensions(localPath); err == nil {
				m.Width = &w
				m.Height = &h
				// Generate thumbnail asynchronously
				go func() {
					thumbKey := "thumbnails/" + key
					thumbPath := filepath.Join(s.uploadDir, thumbKey)
					_ = imgproc.GenerateThumbnail(localPath, thumbPath, 300)
				}()
			}
		}
	}

	if err := s.repo.Create(ctx, m); err != nil {
		return nil, err
	}

	vo := toMediaFileVO(*m)
	return &vo, nil
}

func (s *MediaService) GetForAdmin(ctx context.Context, f repository.MediaFilter) (*response.PageResult, error) {
	ms, total, err := s.repo.FindForAdmin(ctx, f)
	if err != nil {
		return nil, err
	}
	vos := make([]dto.MediaFileVO, len(ms))
	for i, m := range ms {
		vos[i] = toMediaFileVO(m)
	}
	pr := response.NewPageResult(vos, total, f.PageNum, f.PageSize)
	return &pr, nil
}

func (s *MediaService) GetStats(ctx context.Context) (*dto.MediaStatsVO, error) {
	st, err := s.repo.GetStats(ctx)
	if err != nil {
		return nil, err
	}
	return &dto.MediaStatsVO{
		TotalFiles:    st.TotalCount,
		TotalSize:     st.TotalSize,
		ImageCount:    st.ImageCount,
		VideoCount:    st.VideoCount,
		AudioCount:    st.AudioCount,
		DocumentCount: st.DocCount,
		OtherCount:    st.OtherCount,
	}, nil
}

func (s *MediaService) GetByID(ctx context.Context, id int64) (*dto.MediaFileVO, error) {
	m, err := s.repo.FindByID(ctx, id)
	if err != nil || m == nil {
		return nil, err
	}
	vo := toMediaFileVO(*m)
	return &vo, nil
}

func (s *MediaService) Update(ctx context.Context, id int64, req dto.UpdateMediaRequest) (*dto.MediaFileVO, error) {
	if err := s.repo.Update(ctx, id, req.AltText, req.FolderID); err != nil {
		return nil, err
	}
	return s.GetByID(ctx, id)
}

func (s *MediaService) Move(ctx context.Context, id int64, folderID *int64) error {
	return s.repo.MoveBatch(ctx, []int64{id}, folderID)
}

func (s *MediaService) MoveBatch(ctx context.Context, ids []int64, folderID *int64) error {
	return s.repo.MoveBatch(ctx, ids, folderID)
}

func (s *MediaService) Delete(ctx context.Context, id int64) error {
	return s.repo.SoftDelete(ctx, id)
}

func (s *MediaService) DeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.SoftDeleteBatch(ctx, ids)
}

func (s *MediaService) Restore(ctx context.Context, id int64) error {
	return s.repo.Restore(ctx, id)
}

func (s *MediaService) RestoreBatch(ctx context.Context, ids []int64) error {
	return s.repo.RestoreBatch(ctx, ids)
}

func (s *MediaService) PermanentDelete(ctx context.Context, id int64) error {
	m, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if m == nil {
		return errors.New("文件不存在")
	}
	// Delete from storage backend
	_ = s.store.Delete(ctx, m.FilePath)
	return s.repo.PermanentDelete(ctx, id)
}

func (s *MediaService) PermanentDeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.PermanentDeleteBatch(ctx, ids)
}

func (s *MediaService) EmptyTrash(ctx context.Context) error {
	return s.repo.EmptyTrash(ctx)
}

func (s *MediaService) GetTrashCount(ctx context.Context) (int64, error) {
	return s.repo.CountTrash(ctx)
}

// --- Helpers ---

func toMediaFileVO(m model.MediaFile) dto.MediaFileVO {
	return dto.MediaFileVO{
		ID:           m.ID,
		Filename:     m.Filename,
		OriginalName: m.OriginalName,
		FileURL:      m.FileURL,
		FileSize:     m.FileSize,
		MimeType:     m.MimeType,
		FileType:     m.FileType,
		StorageType:  m.StorageType,
		Width:        m.Width,
		Height:       m.Height,
		AltText:      m.AltText,
		FolderID:     m.FolderID,
		Deleted:      m.Deleted,
		CreatedAt:    m.CreatedAt,
	}
}

func classifyFileType(mime string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "IMAGE"
	case strings.HasPrefix(mime, "video/"):
		return "VIDEO"
	case strings.HasPrefix(mime, "audio/"):
		return "AUDIO"
	case mime == "application/pdf" || strings.Contains(mime, "word") || strings.Contains(mime, "document"):
		return "DOCUMENT"
	default:
		return "OTHER"
	}
}

func guessMimeType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".mp4":
		return "video/mp4"
	case ".mp3":
		return "audio/mpeg"
	case ".pdf":
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}

func sanitizeFilename(name string) string {
	base := filepath.Base(name)
	// Replace problematic characters
	safe := strings.NewReplacer(" ", "_", "/", "_", "\\", "_").Replace(base)
	if safe == "" {
		safe = "file"
	}
	return safe
}

// Ensure io is used (for future reference)
var _ io.Reader
