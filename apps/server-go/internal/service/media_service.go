package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/imgproc"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// maxThumbnailMemorySize 限制了"S3 模式下从 reader 读完整图片到内存生成缩略图"
// 的图片体积上限。超过该上限的图片只读 header 算 width/height,跳过缩略图生成,
// 避免高并发上传时 OOM。
const maxThumbnailMemorySize int64 = 20 * 1024 * 1024 // 20 MB
const publicBackupVerificationFreshness = 24 * time.Hour

// allowedMimeTypes 是允许上传的文件 MIME 类型白名单，拒绝 HTML、SVG、可执行文件等危险类型。
//
// SVG 三层防线（任一被破坏都会重新打开存储型 same-origin XSS）：
//  1. Upload() 入口按文件名硬拒 .svg/.svgz —— 覆盖嗅探到 text/xml 的绕过
//     （text/xml 是 application/xml 的合法 OOXML/订阅源载体，无法整体下白名单）。
//  2. guessMimeType 把 .svg/.svgz 显式映射到 image/svg+xml —— 覆盖嗅探退化为
//     application/octet-stream 时的扩展名兜底分支。
//  3. image/svg+xml 故意不在本白名单中 —— 保证 (2) 的兜底走到拒绝分支。
var allowedMimeTypes = map[string]bool{
	// 图片
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
	"image/tiff": true,
	"image/avif": true,
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
	"application/msword":            true, // .doc
	"application/vnd.ms-excel":      true, // .xls
	"application/vnd.ms-powerpoint": true, // .ppt
	// 其他文档
	"application/pdf":  true,
	"text/plain":       true, // .txt
	"text/csv":         true, // .csv
	"text/markdown":    true, // .md
	"application/json": true, // .json
	"application/xml":  true, // .xml
	"text/xml":         true, // .xml
	// 压缩包
	"application/zip":              true, // .zip
	"application/x-rar-compressed": true, // .rar
	"application/vnd.rar":          true, // .rar (新 MIME)
	"application/x-7z-compressed":  true, // .7z
	"application/gzip":             true, // .gz
	"application/x-tar":            true, // .tar
	"application/x-bzip2":          true, // .bz2
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
//
// 字段语义:
//   - localStore: 本地存储后端,作为 default 未配置或 default=LOCAL 时的兜底。
//   - providerRepo: 用于查 default provider / 按 ID 反查 provider 配置。
//   - uploadDir: 本地存储根目录,LOCAL 模式下用于读文件算尺寸 + 生成缩略图。
//   - storeCache: 解析过的非 LOCAL Storage 实例缓存(避免每次上传都重建 S3 client)。
//     key=providerID, 失效条件: 配置 update / delete (调用方需调 InvalidateProvider 清缓存)。
//
// folderLookup 抽出 *FolderRepo.FindByID 的能力,允许测试注入 mock。
type folderLookup interface {
	FindByID(ctx context.Context, id int64) (*model.MediaFolder, error)
}

// permLookup 抽出 *PermissionRepo.HasWriteAccess 的能力。
type permLookup interface {
	HasWriteAccess(ctx context.Context, folderID int64, userID int64) (bool, error)
}

// 旧的 (repo, store, uploadDir) 构造已被替换 — server.go 必须传 providerRepo。
type MediaService struct {
	repo         *repository.MediaRepo
	localStore   storage.Storage
	providerRepo *repository.StorageProviderRepo
	folderLookup folderLookup // 可空;为空时跳过 folder 权限校验
	permLookup   permLookup   // 可空;为空时跳过 folder_permissions 查询
	uploadDir    string

	storeCache   map[int64]storage.Storage
	storeCacheMu sync.RWMutex
}

// NewMediaService 创建 MediaService 实例。
//   - repo: media_files 仓储。
//   - localStore: 兜底用本地存储(始终存在)。
//   - providerRepo: storage_providers 仓储,用于按 default / 按 ID 解析后端。
//   - uploadDir: 本地上传根目录。
//
// 可选权限依赖通过 SetFolderAccess 注入(server.go),让 MediaService 在 Upload/Move
// 时校验目标文件夹的 owner 与显式授权。
func NewMediaService(repo *repository.MediaRepo, localStore storage.Storage, providerRepo *repository.StorageProviderRepo, uploadDir string) *MediaService {
	return &MediaService{
		repo:         repo,
		localStore:   localStore,
		providerRepo: providerRepo,
		uploadDir:    uploadDir,
		storeCache:   make(map[int64]storage.Storage),
	}
}

// SetFolderAccess 注入文件夹权限校验依赖。
// 调用方:server.go 在所有依赖 wire 完成后调用一次。
//
// @ref 云储存优化批次 2 — 媒体上传 folder 权限校验
func (s *MediaService) SetFolderAccess(folderRepo folderLookup, permRepo permLookup) {
	s.folderLookup = folderRepo
	s.permLookup = permRepo
}

// ErrFolderForbidden 表示用户对目标文件夹无写入权限。
// handler 层 errors.Is(err, ErrFolderForbidden) 将其映射为 HTTP 403。
//
// @ref PR #647 fix: chatgpt-codex-connector P2 — folder 拒绝错误不应回 500
var ErrFolderForbidden = errors.New("无权写入该文件夹")

// ErrFolderNotFound 表示前端提交的 folder_id 在 media_folders 表中不存在。
// handler 层 errors.Is(err, ErrFolderNotFound) 将其映射为 HTTP 400。
var ErrFolderNotFound = errors.New("目标文件夹不存在")

// ErrMediaNotFound 表示媒体文件不存在或已不可公开访问。
// 公共访问路由使用同一个错误隐藏"不存在"与"已删除"的差异,避免 ID 探测。
var ErrMediaNotFound = errors.New("媒体文件不存在")

// kbUploadContextKey 是 KB 上传通道在 ctx 中携带的标记键。
// 仅有这个标记的请求才允许写入 is_system=TRUE 的目录（如 /root/_system_kb/...）。
//
// 这套机制保证 admin 端常规媒体上传 / move 永远不会落到 _system_kb 子树，
// 哪怕前端伪造 folderId 也会被 assertFolderWritable 拒绝。
type kbUploadCtxKey struct{}

// WithKBUploadContext 在 ctx 上挂 KB 上传标记。KB 模块的 service 在调用 MediaService.Upload
// 前调用这个函数包装 ctx。
func WithKBUploadContext(ctx context.Context) context.Context {
	return context.WithValue(ctx, kbUploadCtxKey{}, true)
}

// isKBUploadContext 返回 ctx 是否带 KB 上传标记。
func isKBUploadContext(ctx context.Context) bool {
	v, _ := ctx.Value(kbUploadCtxKey{}).(bool)
	return v
}

// assertFolderWritable 验证 uploaderID 是否有权写入目标文件夹。
// 放行规则(自上而下短路):
//  1. folderID 为空 → 放行(根目录)
//  2. 依赖未注入(folderLookup/permLookup == nil) → 放行(向后兼容,server.go 必须显式 SetFolderAccess 才启用)
//  3. folder 不存在 → 拒绝 ErrFolderNotFound(防止前端伪造 ID)
//  4. folder.OwnerID 为空(系统文件夹) → 放行
//  5. uploaderID 等于 folder.OwnerID → 放行
//  6. uploaderID 在 folder_permissions 有 UPLOAD/EDIT/DELETE/ADMIN 权限且未过期 → 放行
//  7. 否则拒绝 ErrFolderForbidden
//
// 注意:visibility=public 的文件夹也走步骤 6,因为"公开可读"和"任何人可写"是不同语义。
func (s *MediaService) assertFolderWritable(ctx context.Context, folderID *int64, uploaderID *int64) error {
	if folderID == nil {
		return nil
	}
	if s.folderLookup == nil || s.permLookup == nil {
		return nil
	}
	folder, err := s.folderLookup.FindByID(ctx, *folderID)
	if err != nil {
		return fmt.Errorf("folder lookup failed: %w", err)
	}
	if folder == nil {
		return ErrFolderNotFound
	}
	// 系统目录（is_system=TRUE）必须通过 KB 上传通道写入，普通 media handler 一律拒绝。
	// 这里的 owner_id 可以为 NULL（_system_kb 系统根）或具体 KB owner（CUSTOM 库的归档子目录）。
	if folder.IsSystem {
		if !isKBUploadContext(ctx) {
			return ErrFolderForbidden
		}
		// KB 上传通道：跳过 owner / folder_permissions 校验，由上层 KB Service 自己负责 ACL。
		return nil
	}
	if folder.OwnerID == nil {
		return nil
	}
	if uploaderID != nil && *uploaderID == *folder.OwnerID {
		return nil
	}
	if uploaderID == nil {
		return ErrFolderForbidden
	}
	ok, err := s.permLookup.HasWriteAccess(ctx, *folderID, *uploaderID)
	if err != nil {
		return fmt.Errorf("permission lookup failed: %w", err)
	}
	if !ok {
		return ErrFolderForbidden
	}
	return nil
}

// InvalidateProvider 清除指定 provider 的 storage 解析缓存。
// 调用方:storage_provider_handler 在 Update/Delete 后必须调用,否则旧 client 仍在用旧凭证。
func (s *MediaService) InvalidateProvider(providerID int64) {
	s.storeCacheMu.Lock()
	defer s.storeCacheMu.Unlock()
	delete(s.storeCache, providerID)
}

// resolveStore 按需把 providerID 转成对应的 Storage 实例。
//   - providerID == nil  → 用 default provider(LOCAL → localStore;非 LOCAL → S3 client)。
//   - providerID != nil  → 按 ID 反查(用于历史记录的 PermanentDelete 删对应后端)。
//
// 同时返回该次解析对应的 provider 元数据,供调用方读取 ProviderType 写入 media_files。
// 若 providerID 指向 LOCAL provider 或为空且 default 是 LOCAL,会返回 (localStore, &p, nil),
// 其中 p.ProviderType="LOCAL"。providerID 指向不存在的记录时返回 (nil, nil, error)。
func (s *MediaService) resolveStore(ctx context.Context, providerID *int64) (storage.Storage, *model.StorageProvider, error) {
	if s.providerRepo == nil {
		// 缺 providerRepo (旧测试代码) 直接走 localStore
		return s.localStore, nil, nil
	}

	var p *model.StorageProvider
	var err error
	if providerID == nil {
		p, err = s.providerRepo.FindDefault(ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("find default provider: %w", err)
		}
		if p == nil {
			// 没有配置 default,回退到 localStore(向后兼容)
			return s.localStore, nil, nil
		}
	} else {
		p, err = s.providerRepo.FindByID(ctx, *providerID)
		if err != nil {
			return nil, nil, fmt.Errorf("find provider %d: %w", *providerID, err)
		}
		if p == nil {
			// 历史记录指向已删 provider — 文件孤儿,回退本地兜底
			log.Warn().Int64("provider_id", *providerID).Msg("storage provider not found, falling back to local store")
			return s.localStore, nil, nil
		}
	}

	if strings.EqualFold(p.ProviderType, "LOCAL") {
		return s.localStore, p, nil
	}

	// 非 LOCAL 走缓存
	s.storeCacheMu.RLock()
	cached, ok := s.storeCache[p.ID]
	s.storeCacheMu.RUnlock()
	if ok {
		return cached, p, nil
	}

	store, err := storage.NewFromConfig(p.ProviderType, p.ConfigJSON)
	if err != nil {
		return nil, p, fmt.Errorf("init storage backend (%s): %w", p.ProviderType, err)
	}

	s.storeCacheMu.Lock()
	s.storeCache[p.ID] = store
	s.storeCacheMu.Unlock()
	return store, p, nil
}

// resolveStoreForMedia 按 media 记录上的 storage_provider_id 反查对应 store。
// 历史 storage_provider_id IS NULL 的记录走 localStore(VULN-fix 安全升级:不影响存量数据)。
func (s *MediaService) resolveStoreForMedia(ctx context.Context, m *model.MediaFile) (storage.Storage, *model.StorageProvider, error) {
	return s.resolveStore(ctx, m.StorageProviderID)
}

// Upload 将 multipart 文件保存到 default storage provider 配置的后端,提取图片尺寸,并创建数据库记录。
// 存储键格式: {年}/{月}/{毫秒时间戳}_{安全文件名}。
//
// 行为变化(Phase 1):
//  1. 先 resolveStore(ctx, nil) 拿当前 default provider — 若 default=LOCAL 走 localStore,
//     否则走对应 S3/COS/OSS/MINIO/R2 client。
//  2. media_files 写入 storage_provider_id / storage_type / file_url(=key) / cdn_url(完整可访问 URL)。
//  3. 图片缩略图:LOCAL 模式按老逻辑读磁盘;非 LOCAL 模式 — 把上传 buffer 留一份在内存,
//     先算 width/height,再生成 thumb bytes 上传到同 provider 的 thumbnails/{key}。
//     体积 > maxThumbnailMemorySize 的图片只读 header 算尺寸,跳过 thumb(防 OOM)。
//
// 错误场景: 文件打开失败、存储上传失败、数据库记录创建失败。
func (s *MediaService) Upload(ctx context.Context, fh *multipart.FileHeader, uploaderID *int64, folderID *int64) (*dto.MediaFileVO, error) {
	// folder 权限校验:在打开文件前,任何对私有文件夹的越权写都会被拒。
	// @ref 云储存优化批次 2 — 防 VULN: 早期实现允许任意 admin 写入他人私有文件夹
	if err := s.assertFolderWritable(ctx, folderID, uploaderID); err != nil {
		return nil, err
	}

	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// 文件名层硬拒: 任何映射到 image/svg+xml 的扩展名(.svg / .svgz)直接拒收。
	// 这是 SVG 防 XSS 的最外层屏障 — 详见 resolveMimeForUpload 的注释。
	if err := rejectSVGByFilename(fh.Filename); err != nil {
		return nil, err
	}

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

	mimeType := resolveMimeWithFallback(detectedMime, fh.Filename)
	// 检查 MIME 类型是否在允许上传的白名单中。
	// KB 上传通道（context 标记 kbUpload=true）绕过白名单 —— KB 自有解析白名单
	// （txt/md/html/json 等文档型），且文件落到 _system_kb 隐藏子树不会被博客
	// 媒体页/缩略图链路渲染，HTML 注入风险不成立。
	if !allowedMimeTypes[mimeType] && !isKBUploadContext(ctx) {
		return nil, fmt.Errorf("不允许上传该文件类型: %s", mimeType)
	}

	fileType := classifyFileType(mimeType)

	// 解析 default provider — 决定本次上传去哪个后端
	store, provider, err := s.resolveStore(ctx, nil)
	if err != nil {
		return nil, err
	}

	// 构建存储键：{年}/{月}/{毫秒时间戳}_{安全文件名}
	now := time.Now()
	safeName := sanitizeFilename(fh.Filename)
	key := fmt.Sprintf("%d/%02d/%d_%s", now.Year(), now.Month(), now.UnixMilli(), safeName)

	// 非 LOCAL provider 在上传前先把图片 buffer 缓存一份到内存,
	// 用于 PutObject 之后 in-process 算 width/height + 生成 thumb,避免再 GetObject 拉回。
	// 体积 > maxThumbnailMemorySize 时退化为流式上传(算不出尺寸),由 IsImage 判定决定。
	var imgBuf []byte
	isImg := imgproc.IsImage(mimeType)
	storageType := store.Type()
	useReaderForImg := isImg && !strings.EqualFold(storageType, "LOCAL") && fh.Size > 0 && fh.Size <= maxThumbnailMemorySize
	var uploadBody io.Reader = f
	if useReaderForImg {
		buf, rerr := io.ReadAll(f)
		if rerr != nil {
			return nil, fmt.Errorf("read image into buffer: %w", rerr)
		}
		imgBuf = buf
		uploadBody = bytes.NewReader(buf)
	}

	publicURL, err := store.Upload(ctx, key, uploadBody, fh.Size, mimeType)
	if err != nil {
		return nil, err
	}

	m := &model.MediaFile{
		Filename:     safeName,
		OriginalName: fh.Filename,
		FilePath:     key,
		// file_url 存相对 key,后续切 provider 仍可用;cdn_url 存当前完整可访问 URL,前端永远读 cdn_url。
		FileURL:     key,
		FileSize:    fh.Size,
		MimeType:    &mimeType,
		FileType:    fileType,
		StorageType: storageType,
		UploaderID:  uploaderID,
		FolderID:    folderID,
		CdnURL:      &publicURL,
	}
	if provider != nil {
		pid := provider.ID
		m.StorageProviderID = &pid
	}

	// 提取尺寸 + 生成缩略图
	if isImg {
		if strings.EqualFold(storageType, "LOCAL") {
			// LOCAL 路径仍走老逻辑:读磁盘 + 异步落盘
			localPath := filepath.Join(s.uploadDir, key)
			if w, h, derr := imgproc.GetDimensions(localPath); derr == nil {
				m.Width = &w
				m.Height = &h
				go func() {
					thumbKey := "thumbnails/" + key
					thumbPath := filepath.Join(s.uploadDir, thumbKey)
					if terr := imgproc.GenerateThumbnail(localPath, thumbPath, 300); terr != nil {
						log.Warn().Err(terr).Str("key", key).Msg("local thumbnail generation failed")
					}
				}()
			}
		} else if useReaderForImg && len(imgBuf) > 0 {
			// 远程 provider:复用 imgBuf 算尺寸 + 生成 thumb 后上传到同 provider
			if w, h, derr := imgproc.GetDimensionsFromReader(bytes.NewReader(imgBuf)); derr == nil {
				m.Width = &w
				m.Height = &h
			} else {
				log.Warn().Err(derr).Str("key", key).Msg("remote image dimension probe failed")
			}
			s.uploadRemoteThumbnailAsync(store, key, mimeType, imgBuf, provider)
		}
	}

	if err := s.repo.Create(ctx, m); err != nil {
		return nil, err
	}

	vo := toMediaFileVO(*m)
	return &vo, nil
}

// UpdateContentParams 是 MediaService.UpdateContent 的参数集。
type UpdateContentParams struct {
	MediaID   int64
	NewBody   io.Reader // 新内容,UpdateContent 内部消费(可能读两次,如果是 Seeker)
	NewSize   int64
	Filename  string // 用于 MIME / extension 嗅探
	CreatedBy *int64
}

// UpdateContent 替换某条媒体的二进制内容(图片编辑器保存场景)。
//
// 行为:
//  1. 按 media.StorageProviderID 反查源 store(主文件所在 provider)。
//  2. 在同一 provider 上写新 key:{年}/{月}/{毫秒时间戳}_edited{ext}。
//  3. 更新 media_files 的 file_path/file_url/file_size/current_version + cdn_url
//     (cdn_url 末尾追加 ?v={current_version} 自动让 CDN 缓存失效)。
//  4. 旧 key 不立即删 — 保留给 version_history 服务做版本回滚。
//
// 缩略图: 远程 provider 模式下不重新生成(避免读取大文件回内存);LOCAL 模式同样跳过,
// 因为 thumbnails/* 是按主文件 key 命名的,新 key 与缩略图脱节,thumbnails 重生成
// 留到下个用户访问该图片时按需触发(目前未实装,本次仅修复主文件更新)。
func (s *MediaService) UpdateContent(ctx context.Context, params UpdateContentParams) (*dto.MediaFileVO, error) {
	// 文件名层硬拒(与 Upload 同步): .svg/.svgz 在任何入口都不能落盘,否则 nginx
	// 会按扩展名以 image/svg+xml 派发,触发存储型 same-origin XSS。早于 repo 查询
	// 失败既能省一次 DB IO,也保证 ownership 之外的攻击面也走同一条护栏。
	if err := rejectSVGByFilename(params.Filename); err != nil {
		return nil, err
	}

	media, err := s.repo.FindByID(ctx, params.MediaID)
	if err != nil {
		return nil, err
	}
	if media == nil {
		return nil, errors.New("media not found")
	}

	store, _, err := s.resolveStoreForMedia(ctx, media)
	if err != nil {
		return nil, err
	}

	// 嗅探 MIME (前 512 字节,适用于 image/jpeg 等)
	sniffBuf := make([]byte, 512)
	if seeker, ok := params.NewBody.(io.Seeker); ok {
		n, _ := io.ReadFull(params.NewBody, sniffBuf)
		_, _ = seeker.Seek(0, io.SeekStart)
		sniffBuf = sniffBuf[:n]
	}
	detectedMime := resolveMimeWithFallback(http.DetectContentType(sniffBuf), params.Filename)
	if !allowedMimeTypes[detectedMime] {
		return nil, fmt.Errorf("不允许上传该文件类型: %s", detectedMime)
	}

	// 构造新 key
	now := time.Now()
	ext := filepath.Ext(params.Filename)
	if ext == "" {
		ext = filepath.Ext(media.Filename)
	}
	newKey := fmt.Sprintf("%d/%02d/%d_edited%s", now.Year(), now.Month(), now.UnixMilli(), ext)

	// 写到同一 provider
	publicURL, err := store.Upload(ctx, newKey, params.NewBody, params.NewSize, detectedMime)
	if err != nil {
		return nil, fmt.Errorf("upload edited content: %w", err)
	}

	newVersion := media.CurrentVersion + 1
	// cdn_url 末尾追加 ?v={version} 让 CDN 缓存自动失效;若 publicURL 已含 query,改用 &
	cdnURL := publicURL
	if strings.Contains(cdnURL, "?") {
		cdnURL = fmt.Sprintf("%s&v=%d", cdnURL, newVersion)
	} else {
		cdnURL = fmt.Sprintf("%s?v=%d", cdnURL, newVersion)
	}

	if err := s.repo.UpdateFileContentV2(ctx, params.MediaID, newKey, newKey, params.NewSize, newVersion, cdnURL); err != nil {
		return nil, err
	}

	return s.GetByID(ctx, params.MediaID)
}

// uploadRemoteThumbnailAsync 异步把缩略图上传到 store 上 thumbnails/{key},
// 并写入 media_variants 表 (variant_type=THUMBNAIL,storage_provider_id 同主文件)。
//
// 失败只 log,不阻塞主流程也不让上传请求失败。
func (s *MediaService) uploadRemoteThumbnailAsync(store storage.Storage, mainKey, mimeType string, src []byte, provider *model.StorageProvider) {
	go func() {
		ctx := context.Background()
		thumbBytes, err := imgproc.GenerateThumbnailFromReader(bytes.NewReader(src), 300, imgproc.FormatFromMime(mimeType))
		if err != nil {
			log.Warn().Err(err).Str("key", mainKey).Msg("remote thumbnail generation failed")
			return
		}
		thumbKey := "thumbnails/" + mainKey
		thumbMime := "image/jpeg"
		if format := imgproc.FormatFromMime(mimeType); format != "jpeg" {
			thumbMime = "image/" + format
		}
		thumbURL, err := store.Upload(ctx, thumbKey, bytes.NewReader(thumbBytes), int64(len(thumbBytes)), thumbMime)
		if err != nil {
			log.Warn().Err(err).Str("thumb_key", thumbKey).Msg("remote thumbnail upload failed")
			return
		}
		// 记录到 media_variants 表(provider_id 与主文件一致)
		var providerID *int64
		if provider != nil {
			pid := provider.ID
			providerID = &pid
		}
		if err := s.repo.UpsertVariant(ctx, mainKey, thumbKey, thumbURL, int64(len(thumbBytes)), providerID); err != nil {
			log.Warn().Err(err).Str("thumb_key", thumbKey).Msg("media_variants insert failed")
		}
	}()
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

// DownloadBytes 读取媒体文件原始字节，附带 mime / 原始文件名。
// maxBytes>0 时强制限制读取上限，超出报错。
//
// 主要给 KB 向量化使用：从存储后端拉文件后送进 ai-service 解析 + 切片 + embed。
// 大文件场景（>10MB）会在 service 层就拒绝 —— 防止 OOM。
func (s *MediaService) DownloadBytes(ctx context.Context, mediaID int64, maxBytes int64) ([]byte, string, string, error) {
	m, err := s.repo.FindByID(ctx, mediaID)
	if err != nil {
		return nil, "", "", err
	}
	if m == nil || m.Deleted {
		return nil, "", "", ErrMediaNotFound
	}
	store, _, err := s.resolveStoreForMedia(ctx, m)
	if err != nil {
		return nil, "", "", fmt.Errorf("resolve store: %w", err)
	}
	rc, size, mime, err := store.Get(ctx, m.FilePath)
	if err != nil {
		return nil, "", "", fmt.Errorf("storage get: %w", err)
	}
	defer rc.Close()
	if maxBytes > 0 && size > maxBytes {
		return nil, "", "", fmt.Errorf("文件超出限制 (%d > %d)", size, maxBytes)
	}
	limited := rc
	if maxBytes > 0 {
		limited = readCloser{Reader: io.LimitReader(rc, maxBytes+1), Closer: rc}
	}
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, "", "", fmt.Errorf("read all: %w", err)
	}
	if maxBytes > 0 && int64(len(data)) > maxBytes {
		return nil, "", "", fmt.Errorf("文件超出限制 (%d > %d)", len(data), maxBytes)
	}
	if mime == "" && m.MimeType != nil {
		mime = *m.MimeType
	}
	return data, mime, m.OriginalName, nil
}

// readCloser 把 io.Reader + io.Closer 组合为 io.ReadCloser（io.LimitReader 不实现 Closer）。
type readCloser struct {
	io.Reader
	io.Closer
}

// PublicAccessURL 返回媒体文件的稳定公共访问路由最终应跳转到的地址。
//
// 解析顺序:
//  1. LOCAL 主文件且备份已 SYNCED 时,仅在备份最近校验有效或本次确认存在后返回 backup_url;
//  2. 若备份指针失效或无法确认,回退到 cdn_url,这是当前主存储的公开 URL;
//  3. 再兼容历史 file_url 中已经存成 URL/路径的记录;
//  4. 最后按 storage_provider_id 反查 store,用 file_path 重新生成公开 URL。
//
// 这样文章内容只需要保存 /api/v1/public/media/{id} 这类稳定地址,后续主存储或备份
// 状态变化不需要重写 Markdown。
func (s *MediaService) PublicAccessURL(ctx context.Context, id int64) (string, error) {
	m, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return "", err
	}
	if m == nil || m.Deleted {
		return "", ErrMediaNotFound
	}
	return s.publicAccessURLForMedia(ctx, m)
}

// PublicAccessURLByPath 通过 file_path 反查媒体记录并返回当前最佳访问地址。
// 这是历史 /api/uploads/{key} 内容的兼容层:旧文章不用立即重写 Markdown,也能在
// 备份成功或迁移到云端后获得新的访问路径。
func (s *MediaService) PublicAccessURLByPath(ctx context.Context, filePath string) (string, error) {
	filePath = strings.Trim(strings.TrimSpace(filePath), "/")
	if filePath == "" {
		return "", ErrMediaNotFound
	}
	m, err := s.repo.FindByPath(ctx, filePath)
	if err != nil {
		return "", err
	}
	if m == nil || m.Deleted {
		return "", ErrMediaNotFound
	}
	return s.publicAccessURLForMedia(ctx, m)
}

func (s *MediaService) publicAccessURLForMedia(ctx context.Context, m *model.MediaFile) (string, error) {
	if backupURL, ok := s.verifiedBackupAccessURL(ctx, m); ok {
		return backupURL, nil
	}

	if m.CdnURL != nil && strings.TrimSpace(*m.CdnURL) != "" {
		return strings.TrimSpace(*m.CdnURL), nil
	}

	if url := normalizePersistedMediaURL(m.FileURL); url != "" {
		return url, nil
	}

	store, _, err := s.resolveStoreForMedia(ctx, m)
	if err != nil {
		return "", err
	}
	return store.GetURL(m.FilePath), nil
}

func (s *MediaService) verifiedBackupAccessURL(ctx context.Context, m *model.MediaFile) (string, bool) {
	backupURL, ok := freshVerifiedBackupURL(m)
	if !ok {
		return "", false
	}
	if m.BackupProviderID == nil {
		return backupURL, true
	}
	// 保持此读取路径无远程 I/O: resolveStore 在第一次
	// 提供商查找后被缓存，且 KeyFromURL/GetURL 仅规范化字符串。
	// 这避免了在下一次验证过程之前泄漏旧的提供商域名。
	store, _, err := s.resolveStore(ctx, m.BackupProviderID)
	if err != nil {
		return backupURL, true
	}
	resolver, ok := store.(storage.PublicURLKeyResolver)
	if !ok {
		return backupURL, true
	}
	key, err := resolver.KeyFromURL(backupURL)
	if err != nil {
		return backupURL, true
	}
	currentURL := strings.TrimSpace(store.GetURL(key))
	if currentURL == "" {
		return backupURL, true
	}
	return currentURL, true
}

func freshVerifiedBackupURL(m *model.MediaFile) (string, bool) {
	if m == nil ||
		!strings.EqualFold(m.StorageType, "LOCAL") ||
		!strings.EqualFold(m.SyncStatus, "SYNCED") ||
		m.BackupURL == nil {
		return "", false
	}
	backupURL := strings.TrimSpace(*m.BackupURL)
	if backupURL == "" {
		return "", false
	}
	// 保持公共 URL 的生成为只读且快速。新鲜度由
	// 验证 worker/手动验证 API 维护，它们执行云端 HEAD 和数据库
	// 状态写入，处于高流量读取路径之外。
	if m.LastVerifiedAt != nil && time.Since(*m.LastVerifiedAt) < publicBackupVerificationFreshness {
		return backupURL, true
	}
	return "", false
}

// GetUploaderID 返回指定媒体文件的 uploader_id，用于 handler 层 ownership 校验。
// 返回值：found=false 表示文件不存在；found=true 且 uploaderID=nil 表示匿名上传。
func (s *MediaService) GetUploaderID(ctx context.Context, id int64) (found bool, uploaderID *int64, err error) {
	m, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return false, nil, err
	}
	if m == nil {
		return false, nil, nil
	}
	return true, m.UploaderID, nil
}

// Update 修改媒体文件的 alt_text 和所属文件夹 folder_id。
func (s *MediaService) Update(ctx context.Context, id int64, req dto.UpdateMediaRequest) (*dto.MediaFileVO, error) {
	if err := s.repo.Update(ctx, id, req.AltText, req.FolderID); err != nil {
		return nil, err
	}
	return s.GetByID(ctx, id)
}

// Move 将单个媒体文件移动到指定文件夹(folderID 为 nil 表示移至根目录)。
//
// 写入目标文件夹同样要校验 folder 权限 —— 否则用户可以把自己的文件 Move
// 到他人的私有文件夹,绕过 Upload 路径的校验。
//
// @ref PR #647 fix: gemini-code-assist medium — Move 路径补 folder 校验
func (s *MediaService) Move(ctx context.Context, id int64, uploaderID *int64, folderID *int64) error {
	if err := s.assertFolderWritable(ctx, folderID, uploaderID); err != nil {
		return err
	}
	return s.repo.MoveBatch(ctx, []int64{id}, folderID)
}

// MoveBatch 在一次数据库查询中将多个媒体文件移动到指定文件夹。
// 同样校验目标文件夹权限,见 Move 注释。
func (s *MediaService) MoveBatch(ctx context.Context, ids []int64, uploaderID *int64, folderID *int64) error {
	if err := s.assertFolderWritable(ctx, folderID, uploaderID); err != nil {
		return err
	}
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
// Phase 1 修复:按 m.StorageProviderID 反查对应 store 删除(原实现写死 s.store 在 S3
// 模式下永远删本地不存在的路径,留下大量孤儿文件)。
//
// 错误场景: 文件记录不存在;存储删除失败时返回错误并保留 DB 行,避免 catalog/后端
// 状态分裂(老实现的"静默忽略"被刻意改成"必须显式忽略" — 上层若想跳过云端删除应走
// PermanentDeleteWithOptions(deleteCloud=false))。
func (s *MediaService) PermanentDelete(ctx context.Context, id int64) error {
	return s.PermanentDeleteWithOptions(ctx, id, true)
}

// PermanentDeleteWithOptions 是 PermanentDelete 的可控版本: deleteCloud=false 仅清 DB
// 行(后端文件保留),用于"管理员只想擦 catalog 但保留云端原件"的场景。
func (s *MediaService) PermanentDeleteWithOptions(ctx context.Context, id int64, deleteCloud bool) error {
	m, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if m == nil {
		return errors.New("文件不存在")
	}
	if deleteCloud {
		store, _, rerr := s.resolveStoreForMedia(ctx, m)
		if rerr != nil {
			return fmt.Errorf("resolve storage: %w", rerr)
		} else if store != nil {
			if derr := store.Delete(ctx, m.FilePath); derr != nil {
				// 单文件删除没有 failedIds 通道;返回错误并保留 DB 行,让管理员可重试或显式 deleteCloud=false。
				return fmt.Errorf("backend delete failed: %w", derr)
			}
			// 同步删除缩略图 variant
			s.deleteVariantsBackend(ctx, store, id)
		}
	}
	return s.repo.PermanentDelete(ctx, id)
}

// PermanentDeleteBatch 批量彻底删除媒体文件。
// Phase 1 安全修复(VULN):
//  1. 在 service 层做 ownership 校验 — 把每条记录按 uploader_id 与 actor 对照,
//     非 admin 又非 owner 的记录直接拒绝(整批失败,避免攻击者构造 ID 列表越权)。
//  2. 按 storage_provider_id 分组,逐 provider 删后端,清掉孤儿文件。
//  3. 删除失败的 ID 仍在 failedIDs 中,但成功的部分已落库(返回错误时调用方可读 failed)。
//
// actor=nil 表示绕过 ownership 校验(供后台/系统任务使用)。
func (s *MediaService) PermanentDeleteBatch(ctx context.Context, ids []int64, actor *middleware.LoginUserSnapshot) ([]int64, error) {
	return s.PermanentDeleteBatchWithOptions(ctx, ids, actor, true)
}

// PermanentDeleteBatchWithOptions 是 PermanentDeleteBatch 的可控版本,deleteCloud=false 时
// 跳过对存储后端的删除调用(只清 catalog)。
//
// 返回 (failedIDs, err):
//   - err != nil 表示整批被中止(典型: ownership 失败)。
//   - err == nil 但 failedIDs 非空 → 部分文件后端删除失败,DB 已清理。
func (s *MediaService) PermanentDeleteBatchWithOptions(ctx context.Context, ids []int64, actor *middleware.LoginUserSnapshot, deleteCloud bool) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	records, err := s.repo.FindManyByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}

	// ownership 校验 — non-admin 必须是每条 record 的 owner;匿名上传只允许 admin 处理。
	if actor != nil && !actor.IsAdmin {
		for _, id := range ids {
			m, ok := records[id]
			if !ok {
				// 不存在的 ID,直接返回 forbidden 防止 ID 探测
				return nil, errors.New("无权操作他人资源")
			}
			if m.UploaderID == nil || *m.UploaderID != actor.UserID {
				return nil, errors.New("无权操作他人资源")
			}
		}
	}

	failed := make([]int64, 0)
	if deleteCloud {
		// 按 provider 分组,逐 provider 删后端
		byProvider := make(map[int64][]model.MediaFile) // 0 = local/unset
		for _, m := range records {
			pid := int64(0)
			if m.StorageProviderID != nil {
				pid = *m.StorageProviderID
			}
			byProvider[pid] = append(byProvider[pid], m)
		}

		for pid, group := range byProvider {
			var store storage.Storage
			var resolveErr error
			if pid == 0 {
				store = s.localStore
			} else {
				p := pid
				store, _, resolveErr = s.resolveStore(ctx, &p)
			}
			if resolveErr != nil {
				log.Warn().Err(resolveErr).Int64("provider_id", pid).Msg("batch delete: resolve store failed, recording all as failed")
				for _, m := range group {
					failed = append(failed, m.ID)
				}
				continue
			}
			for _, m := range group {
				if derr := store.Delete(ctx, m.FilePath); derr != nil {
					log.Warn().Err(derr).Int64("id", m.ID).Msg("batch delete: backend delete failed")
					failed = append(failed, m.ID)
				}
				s.deleteVariantsBackend(ctx, store, m.ID)
			}
		}
	}

	if err := s.repo.PermanentDeleteBatch(ctx, ids); err != nil {
		return failed, err
	}
	return failed, nil
}

// EmptyTrash 永久删除所有软删除(回收站中)的媒体文件,先按 provider 分组删后端,再清表。
// Phase 1 修复:原实现只清 DB 行,导致回收站清空后云端文件成孤儿。
func (s *MediaService) EmptyTrash(ctx context.Context) error {
	all, err := s.repo.FindAllInTrash(ctx)
	if err != nil {
		return err
	}
	if len(all) == 0 {
		return s.repo.EmptyTrash(ctx)
	}
	// 按 provider 分组
	byProvider := make(map[int64][]model.MediaFile)
	for _, m := range all {
		pid := int64(0)
		if m.StorageProviderID != nil {
			pid = *m.StorageProviderID
		}
		byProvider[pid] = append(byProvider[pid], m)
	}
	for pid, group := range byProvider {
		var store storage.Storage
		if pid == 0 {
			store = s.localStore
		} else {
			p := pid
			st, _, rerr := s.resolveStore(ctx, &p)
			if rerr != nil {
				log.Warn().Err(rerr).Int64("provider_id", pid).Msg("empty trash: resolve store failed")
				continue
			}
			store = st
		}
		for _, m := range group {
			if derr := store.Delete(ctx, m.FilePath); derr != nil {
				log.Warn().Err(derr).Int64("id", m.ID).Msg("empty trash: backend delete failed")
			}
			s.deleteVariantsBackend(ctx, store, m.ID)
		}
	}
	return s.repo.EmptyTrash(ctx)
}

// deleteVariantsBackend 清掉指定 mediaID 的所有 variants 在后端的对应文件,以及 media_variants 行。
// 用 store 是因为 variants 与主文件存在同一 provider(Phase 1 约束),不需要再反查 provider。
func (s *MediaService) deleteVariantsBackend(ctx context.Context, store storage.Storage, mediaID int64) {
	variants, err := s.repo.ListVariants(ctx, mediaID)
	if err != nil {
		log.Warn().Err(err).Int64("media_id", mediaID).Msg("list variants failed")
		return
	}
	for _, v := range variants {
		if derr := store.Delete(ctx, v.FilePath); derr != nil {
			log.Warn().Err(derr).Int64("media_id", mediaID).Str("variant_path", v.FilePath).Msg("variant backend delete failed")
		}
	}
	if derr := s.repo.DeleteVariantsByMediaID(ctx, mediaID); derr != nil {
		log.Warn().Err(derr).Int64("media_id", mediaID).Msg("variant rows delete failed")
	}
}

// GetTrashCount 返回当前回收站中软删除媒体文件的数量。
func (s *MediaService) GetTrashCount(ctx context.Context) (int64, error) {
	return s.repo.CountTrash(ctx)
}

// --- 内部辅助函数 ---

// toMediaFileVO 将单个 model.MediaFile 转换为 dto.MediaFileVO。
//
// Phase 1 增补:除原字段外,把 storage_provider_id / cdn_url 暴露给前端。前端 mediaService.ts
// 的 getMediaUrl 优先读 cdnUrl,空时回落 fileUrl(LOCAL 仍走 /api/uploads/前缀)。
//
// Phase 4 增补:暴露 sync_status / backup_* 字段。
func toMediaFileVO(m model.MediaFile) dto.MediaFileVO {
	vo := dto.MediaFileVO{
		ID:                m.ID,
		Filename:          m.Filename,
		OriginalName:      m.OriginalName,
		FileURL:           m.FileURL,
		PublicURL:         publicMediaURL(m.ID),
		FileSize:          m.FileSize,
		MimeType:          m.MimeType,
		FileType:          m.FileType,
		StorageType:       m.StorageType,
		Width:             m.Width,
		Height:            m.Height,
		AltText:           m.AltText,
		FolderID:          m.FolderID,
		Deleted:           m.Deleted,
		CreatedAt:         m.CreatedAt,
		StorageProviderID: m.StorageProviderID,
		SyncStatus:        m.SyncStatus,
		BackupProviderID:  m.BackupProviderID,
		BackupAt:          m.BackupAt,
	}
	if m.CdnURL != nil {
		vo.CdnURL = *m.CdnURL
	}
	if m.BackupURL != nil {
		vo.BackupURL = *m.BackupURL
	}
	return vo
}

func publicMediaURL(id int64) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("/api/v1/public/media/%d", id)
}

func normalizePersistedMediaURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	if strings.HasPrefix(raw, "/api/uploads/") {
		return raw
	}
	if strings.HasPrefix(raw, "/uploads/") {
		return "/api" + raw
	}
	if strings.HasPrefix(raw, "/") {
		return raw
	}
	return ""
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

// rejectSVGByFilename 是 SVG 防 XSS 三层防线的最外层入口护栏:
// 任何映射到 image/svg+xml 的扩展名(.svg / .svgz)直接拒收。即便:
//
//	(a) http.DetectContentType 把带 <?xml 头的 SVG 嗅探为 text/xml(在白名单内),或
//	(b) 嗅探退化为 application/octet-stream / text/plain 命中扩展名兜底,
//
// 只要保留 .svg/.svgz 文件名落盘,nginx 都会按扩展名以 image/svg+xml 派发,
// 触发存储型 same-origin XSS。因此判定基准选用扩展名而非内容嗅探结果。
//
// 所有写入媒体二进制的入口(Upload / UpdateContent / 后续新增端点)必须共用此函数,
// 不要在调用方重新实现 — 见 PR #615 review 反馈。
func rejectSVGByFilename(filename string) error {
	if guessMimeType(filename) == "image/svg+xml" {
		return fmt.Errorf("不允许上传该文件类型: %s", "image/svg+xml")
	}
	return nil
}

// resolveMimeWithFallback 是 Upload / UpdateContent 共用的 MIME 解析器:
// 优先用内容嗅探(防伪造的 Content-Type),仅当嗅探退化为通用类型时回退到扩展名猜测。
//
// 触发回退的三种通用类型:
//  1. application/octet-stream — 嗅探完全失败的兜底。
//  2. application/zip          — DOCX/XLSX/PPTX 等 OOXML 格式 magic bytes 与 ZIP 相同,
//     必须用扩展名区分具体类型。
//  3. text/plain 前缀          — 常见 <svg ...> 载荷会被嗅探成 "text/plain; charset=utf-8",
//     必须用扩展名抬升为 image/svg+xml 配合白名单拒收。
//     注意是 HasPrefix 而非 == — 嗅探结果通常带 charset 后缀。
//
// guessMimeType 返回 application/octet-stream 表示扩展名也无法识别,此时保留嗅探结果。
//
// 抽出来的目的:
//   - 避免 Upload / UpdateContent 之间漂移(PR #615 Gemini review 指出原 UpdateContent
//     缺 text/plain 前缀分支,留下与 Upload 不一致的防御缝隙)。
//   - 便于直接对资源的 fallback 行为做单元测试,而不是在测试里复制 production 表达式
//     (PR #615 Codex review 指出原测试只验证了 guessMimeType 的输出,从未真正驱动
//     production 的 HasPrefix 条件)。
func resolveMimeWithFallback(detected, filename string) string {
	mime := detected
	if mime == "application/octet-stream" || mime == "application/zip" || strings.HasPrefix(mime, "text/plain") {
		if guessed := guessMimeType(filename); guessed != "application/octet-stream" {
			mime = guessed
		}
	}
	return mime
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
	// SVG 故意保留映射: 不在 allowedMimeTypes 中,这里返回 image/svg+xml 让两条防线生效:
	//  1. Upload() 入口的文件名硬拒(覆盖 text/xml 嗅探绕过)。
	//  2. 内容嗅探退化为 application/octet-stream 时,扩展名兜底命中白名单拒绝。
	// .svgz 是 gzip 压缩的 SVG,浏览器同样按 image/svg+xml 渲染,必须一并拦截。
	// 任何一条 case 被移除都会重新打开存储型 same-origin XSS。
	case ".svg", ".svgz":
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
	// 移除空字节和 Unicode 控制字符
	base = strings.Map(func(r rune) rune {
		if r == 0 || r == 0x202E || r == 0x200F || r == 0x200E { // null、RTL override、RLM、LRM
			return -1
		}
		return r
	}, base)
	// 替换所有非安全字符
	reg := regexp.MustCompile(`[^a-zA-Z0-9._-]`)
	safe := reg.ReplaceAllString(base, "_")
	if safe == "" || safe == "." || safe == ".." {
		safe = "file"
	}
	return safe
}
