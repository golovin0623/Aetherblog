package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/imgproc"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// allowedMimeTypes 是允许上传的文件 MIME 类型白名单，拒绝 HTML、SVG、可执行文件等危险类型。
var allowedMimeTypes = map[string]bool{
	// 图片
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
	"image/tiff": true,
	"image/avif": true,
	"image/svg+xml": true,
	// 视频
	"video/mp4":        true,
	"video/webm":       true,
	"video/quicktime":  true,
	"video/x-msvideo":  true, // .avi
	"video/x-matroska": true, // .mkv
	// 音频
	"audio/mpeg":  true,
	"audio/wav":   true,
	"audio/ogg":   true,
	"audio/mp4":   true,
	"audio/flac":  true,
	"audio/x-m4a": true,
	// Office 文档 (OOXML)
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true, // .docx
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true, // .xlsx
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true, // .pptx
	// Office 文档 (旧版)
	"application/msword":                  true, // .doc
	"application/vnd.ms-excel":            true, // .xls
	"application/vnd.ms-powerpoint":       true, // .ppt
	// 其他文档
	"application/pdf":             true,
	"text/plain":                  true, // .txt
	"text/csv":                    true, // .csv
	"text/markdown":               true, // .md
	"application/json":            true, // .json
	"application/xml":             true, // .xml
	"text/xml":                    true, // .xml
	// 压缩包
	"application/zip":                  true, // .zip
	"application/x-rar-compressed":     true, // .rar
	"application/vnd.rar":              true, // .rar (新 MIME)
	"application/x-7z-compressed":      true, // .7z
	"application/gzip":                 true, // .gz
	"application/x-tar":                true, // .tar
	"application/x-bzip2":              true, // .bz2
	// 字体
	"font/woff":              true,
	"font/woff2":             true,
	"font/ttf":               true,
	"font/otf":               true,
	"application/font-woff":  true,
	"application/font-woff2": true,
	// 兜底
	"application/octet-stream": true,
}

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
	// application/zip 也需要回退：DOCX/XLSX/PPTX 等 OOXML 格式的 magic bytes 与 ZIP 相同，
	// 必须通过扩展名区分具体的 Office 文档类型。
	mimeType := detectedMime
	if mimeType == "application/octet-stream" || mimeType == "application/zip" || strings.HasPrefix(mimeType, "text/plain") {
		if guessed := guessMimeType(fh.Filename); guessed != "application/octet-stream" {
			mimeType = guessed
		}
	}
	// 检查 MIME 类型是否在允许上传的白名单中
	if !allowedMimeTypes[mimeType] {
		return nil, fmt.Errorf("不允许上传该文件类型: %s", mimeType)
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
	// 图片
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".tiff", ".tif":
		return "image/tiff"
	case ".avif":
		return "image/avif"
	case ".svg":
		return "image/svg+xml"
	// 视频
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".avi":
		return "video/x-msvideo"
	case ".mkv":
		return "video/x-matroska"
	// 音频
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".m4a":
		return "audio/x-m4a"
	case ".flac":
		return "audio/flac"
	// Office 文档 (OOXML — magic bytes 为 ZIP，必须靠扩展名区分)
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	// Office 文档 (旧版)
	case ".doc":
		return "application/msword"
	case ".xls":
		return "application/vnd.ms-excel"
	case ".ppt":
		return "application/vnd.ms-powerpoint"
	// 其他文档
	case ".pdf":
		return "application/pdf"
	case ".txt":
		return "text/plain"
	case ".csv":
		return "text/csv"
	case ".md":
		return "text/markdown"
	case ".json":
		return "application/json"
	case ".xml":
		return "application/xml"
	// 压缩包
	case ".zip":
		return "application/zip"
	case ".rar":
		return "application/vnd.rar"
	case ".7z":
		return "application/x-7z-compressed"
	case ".gz":
		return "application/gzip"
	case ".tar":
		return "application/x-tar"
	case ".bz2":
		return "application/x-bzip2"
	// 字体
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
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

	// 优先返回内容检测结果；若为兜底类型或 ZIP（OOXML 文档）则使用扩展名推断
	if (detected == "application/octet-stream" || detected == "application/zip") && guessed != "application/octet-stream" {
		return guessed, nil
	}
	return detected, nil
}

// sanitizeFilename 对文件名进行安全处理：取 Base 部分，移除危险字符，仅保留安全字符集。
// 若处理结果为空或为 "." / ".."，返回默认名 "file"。
func sanitizeFilename(name string) string {
	base := filepath.Base(name)
	// Remove null bytes and Unicode control characters
	base = strings.Map(func(r rune) rune {
		if r == 0 || r == 0x202E || r == 0x200F || r == 0x200E { // null, RTL override, RLM, LRM
			return -1
		}
		return r
	}, base)
	// Replace all non-safe characters
	reg := regexp.MustCompile(`[^a-zA-Z0-9._-]`)
	safe := reg.ReplaceAllString(base, "_")
	if safe == "" || safe == "." || safe == ".." {
		safe = "file"
	}
	return safe
}
