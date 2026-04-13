package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
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

// MediaService 管理媒体文件上传和生命周期（软删除/恢复/彻底删除）的业务逻辑。
type MediaService struct {
	repo      *repository.MediaRepo
	store     storage.Storage
	uploadDir string // 本地存储根路径，用于上传后读取文件以生成缩略图
}

// NewMediaService 使用给定的仓储、存储后端和本地上传目录创建 MediaService 实例。
func NewMediaService(repo *repository.MediaRepo, store storage.Storage, uploadDir string) *MediaService {
	return &MediaService{repo: repo, store: store, uploadDir: uploadDir}
}

// Upload 将 multipart 文件保存到存储后端，提取图片尺寸，并创建数据库记录。
// 存储键格式：{年}/{月}/{毫秒时间戳}_{安全文件名}。
// 对于图片文件（本地存储模式）：同步提取宽高，异步生成 300px 宽缩略图。
// 错误场景：文件打开失败、存储上传失败、数据库记录创建失败。
func (s *MediaService) Upload(ctx context.Context, fh *multipart.FileHeader, uploaderID *int64, folderID *int64) (*dto.MediaFileVO, error) {
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// 确定 MIME 类型：通过文件内容嗅探（magic bytes）验证，防止扩展名欺骗
	sniffBuf := make([]byte, 512)
	n, err := io.ReadAtLeast(f, sniffBuf, 1)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil, fmt.Errorf("failed to read file header for MIME detection: %w", err)
	}
	detectedMime := http.DetectContentType(sniffBuf[:n])

	// 重置读取位置；multipart.File 应当支持 seek，若不支持则返回错误
	seeker, ok := f.(io.Seeker)
	if !ok {
		return nil, fmt.Errorf("failed to reset file reader: multipart file is not seekable")
	}
	if _, err := seeker.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("failed to reset file reader: %w", err)
	}

	// 优先使用内容嗅探结果；仅当嗅探为通用类型时回退到扩展名猜测，
	// 不信任客户端提供的 Content-Type 请求头，避免可伪造的 MIME 分类。
	mimeType := detectedMime
	if mimeType == "application/octet-stream" || strings.HasPrefix(mimeType, "text/plain") {
		mimeType = guessMimeType(fh.Filename)
	}
	fileType := classifyFileType(mimeType)

	// 构建存储键：{年}/{月}/{毫秒时间戳}_{安全文件名}
	now := time.Now()
	safeName := sanitizeFilename(fh.Filename)
	key := fmt.Sprintf("%d/%02d/%d_%s", now.Year(), now.Month(), now.UnixMilli(), safeName)

	url, err := s.store.Upload(ctx, key, f, fh.Size, mimeType)
	if err != nil {
		return nil, err
	}

	m := &model.MediaFile{
		Filename:     safeName,
		OriginalName: fh.Filename,
		FilePath:     key,
		FileURL:      url,
		FileSize:     fh.Size,
		MimeType:     &mimeType,
		FileType:     fileType,
		StorageType:  s.store.Type(),
		UploaderID:   uploaderID,
		FolderID:     folderID,
	}

	// 仅对本地存储模式下的图片文件提取尺寸并生成缩略图
	if imgproc.IsImage(mimeType) {
		if localStore, ok := s.store.(*storage.LocalStorage); ok {
			_ = localStore // 仅作类型断言，实际通过 uploadDir 路径访问文件
			localPath := filepath.Join(s.uploadDir, key)
			if w, h, err := imgproc.GetDimensions(localPath); err == nil {
				m.Width = &w
				m.Height = &h
				// 异步生成缩略图，避免阻塞上传响应
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

// GetForAdmin 返回支持多条件过滤的分页媒体文件列表，供管理后台媒体管理页使用。
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

// GetStats 返回按文件类型分组的文件数量和总体积统计信息。
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

// GetByID 通过主键查询单个媒体文件，不存在时返回 nil, nil。
func (s *MediaService) GetByID(ctx context.Context, id int64) (*dto.MediaFileVO, error) {
	m, err := s.repo.FindByID(ctx, id)
	if err != nil || m == nil {
		return nil, err
	}
	vo := toMediaFileVO(*m)
	return &vo, nil
}

// Update 修改媒体文件的 alt_text 和所属文件夹 folder_id。
func (s *MediaService) Update(ctx context.Context, id int64, req dto.UpdateMediaRequest) (*dto.MediaFileVO, error) {
	if err := s.repo.Update(ctx, id, req.AltText, req.FolderID); err != nil {
		return nil, err
	}
	return s.GetByID(ctx, id)
}

// Move 将单个媒体文件移动到指定文件夹（folderID 为 nil 表示移至根目录）。
func (s *MediaService) Move(ctx context.Context, id int64, folderID *int64) error {
	return s.repo.MoveBatch(ctx, []int64{id}, folderID)
}

// MoveBatch 在一次数据库查询中将多个媒体文件移动到指定文件夹。
func (s *MediaService) MoveBatch(ctx context.Context, ids []int64, folderID *int64) error {
	return s.repo.MoveBatch(ctx, ids, folderID)
}

// Delete 软删除单个媒体文件（移入回收站），数据库行保留。
func (s *MediaService) Delete(ctx context.Context, id int64) error {
	return s.repo.SoftDelete(ctx, id)
}

// DeleteBatch 批量软删除多个媒体文件（移入回收站）。
func (s *MediaService) DeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.SoftDeleteBatch(ctx, ids)
}

// Restore 将单个软删除的媒体文件从回收站恢复。
func (s *MediaService) Restore(ctx context.Context, id int64) error {
	return s.repo.Restore(ctx, id)
}

// RestoreBatch 批量从回收站恢复多个软删除的媒体文件。
func (s *MediaService) RestoreBatch(ctx context.Context, ids []int64) error {
	return s.repo.RestoreBatch(ctx, ids)
}

// PermanentDelete 从存储后端删除文件，并彻底移除数据库记录，不可恢复。
// 错误场景：文件记录不存在。存储删除失败时静默忽略，仍删除数据库记录。
func (s *MediaService) PermanentDelete(ctx context.Context, id int64) error {
	m, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if m == nil {
		return errors.New("文件不存在")
	}
	// 先删除存储后端文件（失败时静默忽略，保证数据库记录被清除）
	_ = s.store.Delete(ctx, m.FilePath)
	return s.repo.PermanentDelete(ctx, id)
}

// PermanentDeleteBatch 批量彻底删除多个媒体文件的数据库记录（不删除存储后端文件）。
func (s *MediaService) PermanentDeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.PermanentDeleteBatch(ctx, ids)
}

// EmptyTrash 永久删除所有软删除（回收站中）的媒体文件数据库记录。
func (s *MediaService) EmptyTrash(ctx context.Context) error {
	return s.repo.EmptyTrash(ctx)
}

// GetTrashCount 返回当前回收站中软删除媒体文件的数量。
func (s *MediaService) GetTrashCount(ctx context.Context) (int64, error) {
	return s.repo.CountTrash(ctx)
}

// --- 内部辅助函数 ---

// toMediaFileVO 将单个 model.MediaFile 转换为 dto.MediaFileVO。
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

// classifyFileType 根据 MIME 类型将文件归类为 IMAGE/VIDEO/AUDIO/DOCUMENT/OTHER。
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

// guessMimeType 根据文件扩展名猜测 MIME 类型，用于请求头未提供或为通用二进制类型时的兜底处理。
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

// detectMimeType 读取文件前 512 字节，利用 http.DetectContentType 检测实际 MIME 类型，
// 并与扩展名推断的类型交叉校验：若扩展名声称是图片但内容并非图片，则拒绝上传。
// application/octet-stream 是 Go 内置检测器的兜底结果，不视为冲突（WebP/AVIF 等格式可能无法识别）。
func detectMimeType(file multipart.File, filename string) (string, error) {
	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil && err != io.EOF {
		return "", err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}

	detected := http.DetectContentType(buf[:n])
	guessed := guessMimeType(filename)

	// 交叉校验：扩展名声称是图片，但内容检测不是图片且不是兜底类型时，拒绝上传
	if strings.HasPrefix(guessed, "image/") && !strings.HasPrefix(detected, "image/") && detected != "application/octet-stream" {
		return "", fmt.Errorf("file content type (%s) does not match extension type (%s)", detected, guessed)
	}

	// 优先返回内容检测结果；若为兜底类型则使用扩展名推断
	if detected == "application/octet-stream" && guessed != "application/octet-stream" {
		return guessed, nil
	}
	return detected, nil
}

// sanitizeFilename 对文件名进行安全处理：取 Base 部分并将空格、斜杠替换为下划线。
// 若处理结果为空，返回默认名 "file"。
func sanitizeFilename(name string) string {
	base := filepath.Base(name)
	// 替换可能引起路径问题的特殊字符
	safe := strings.NewReplacer(" ", "_", "/", "_", "\\", "_").Replace(base)
	if safe == "" {
		safe = "file"
	}
	return safe
}
