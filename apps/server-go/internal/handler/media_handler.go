package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// MediaHandler 负责处理媒体文件的上传、列表、回收站及版本管理接口。
// 版本相关依赖（versionSvc、store、mediaRepo）为可选项，
// 使用 UploadContent 接口前须先调用 SetVersionDeps 进行注入。
type MediaHandler struct {
	svc        *service.MediaService
	versionSvc *service.VersionService // 可选；UploadContent 接口所必需
	store      storage.Storage          // 可选；UploadContent 接口所必需
	uploadDir  string                   // 本地上传根目录
	mediaRepo  *repository.MediaRepo    // 可选；UploadContent 接口所必需
}

// NewMediaHandler 创建一个仅含核心 MediaService 的 MediaHandler 实例。
// 如需启用带版本控制的文件内容替换功能，请调用 SetVersionDeps 注入相关依赖。
func NewMediaHandler(svc *service.MediaService) *MediaHandler { return &MediaHandler{svc: svc} }

// SetVersionDeps 注入版本相关的可选依赖，以启用文件内容上传功能。
func (h *MediaHandler) SetVersionDeps(versionSvc *service.VersionService, store storage.Storage, uploadDir string, mediaRepo *repository.MediaRepo) {
	h.versionSvc = versionSvc
	h.store = store
	h.uploadDir = uploadDir
	h.mediaRepo = mediaRepo
}

// Mount 在指定路由组上注册所有媒体管理路由。
func (h *MediaHandler) Mount(g *echo.Group) {
	g.POST("/upload", h.Upload)
	g.POST("/upload/batch", h.UploadBatch)
	g.GET("", h.List)
	g.GET("/stats", h.Stats)
	g.POST("/batch-move", h.BatchMove)
	g.DELETE("/batch", h.DeleteBatch)
	g.GET("/trash", h.Trash)
	g.GET("/trash/count", h.TrashCount)
	g.POST("/trash/batch-restore", h.BatchRestore)
	g.DELETE("/trash/batch-permanent", h.PermanentDeleteBatch)
	g.DELETE("/trash/empty", h.EmptyTrash)
	g.GET("/:id", h.Get)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.POST("/:id/move", h.Move)
	g.POST("/:id/restore", h.Restore)
	g.POST("/:id/content", h.UploadContent)
	g.DELETE("/:id/permanent", h.PermanentDelete)
}

// Upload 处理 POST /admin/media/upload 请求，接受单个 multipart 文件上传。
// 可选查询参数：folderId — 将文件放入指定文件夹。
func (h *MediaHandler) Upload(c echo.Context) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "未找到文件")
	}
	const maxUploadSize = 100 * 1024 * 1024 // 100 MB
	if fh.Size > maxUploadSize {
		return response.FailWith(c, response.BadRequest, fmt.Sprintf("文件大小超过限制 (最大 %d MB)", maxUploadSize/(1024*1024)))
	}
	lu := middleware.GetLoginUser(c)
	var uploaderID *int64
	if lu != nil {
		uploaderID = &lu.UserID
	}
	var folderID *int64
	if v := c.FormValue("folderId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			folderID = &id
		}
	}
	vo, err := h.svc.Upload(c.Request().Context(), fh, uploaderID, folderID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

// UploadBatch 处理 POST /admin/media/upload/batch 请求，接受 "files" 表单字段下的多个文件。
// 返回混合结果数组：成功的文件返回 MediaFileVO，失败的返回 {"error": "...", "filename": "..."}。
func (h *MediaHandler) UploadBatch(c echo.Context) error {
	form, err := c.MultipartForm()
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的表单")
	}
	lu := middleware.GetLoginUser(c)
	var uploaderID *int64
	if lu != nil {
		uploaderID = &lu.UserID
	}
	var folderID *int64
	if v := c.FormValue("folderId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			folderID = &id
		}
	}

	files := form.File["files"]
	if len(files) == 0 {
		return response.FailWith(c, response.BadRequest, "未找到文件")
	}

	// 逐个上传，失败的文件不中断整体流程
	var results []interface{}
	for _, fh := range files {
		vo, err := h.svc.Upload(c.Request().Context(), fh, uploaderID, folderID)
		if err != nil {
			results = append(results, map[string]interface{}{"error": err.Error(), "filename": fh.Filename})
		} else {
			results = append(results, vo)
		}
	}
	return response.OK(c, results)
}

// List 处理 GET /admin/media 请求，
// 返回分页的未删除媒体文件列表，支持关键词、文件类型、文件夹 ID 过滤。
func (h *MediaHandler) List(c echo.Context) error {
	f := repository.MediaFilter{
		Keyword:  c.QueryParam("keyword"),
		FileType: c.QueryParam("fileType"),
		PageNum:  parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize: parseIntDefault(c.QueryParam("pageSize"), 20),
		Deleted:  false,
	}
	if v := c.QueryParam("folderId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.FolderID = &id
		}
	}
	pr, err := h.svc.GetForAdmin(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// Stats 处理 GET /admin/media/stats 请求，
// 返回存储使用统计信息（按类型分类的文件数量和大小）。
func (h *MediaHandler) Stats(c echo.Context) error {
	st, err := h.svc.GetStats(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, st)
}

// BatchMove 处理 POST /admin/media/batch-move 请求，
// 将多个文件批量移动至指定文件夹。
// 前端发送 {"fileIds":[...], "folderId": N}，同时兼容 ids 字段名。
func (h *MediaHandler) BatchMove(c echo.Context) error {
	// 前端发送 {"fileIds":[...], "folderId": N}，同时兼容 ids 和 fileIds 两种字段名
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	var req struct {
		FileIDs  []int64 `json:"fileIds"`
		IDs      []int64 `json:"ids"`
		FolderID *int64  `json:"folderId"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	// 优先使用 fileIds，回退到 ids
	ids := req.FileIDs
	if len(ids) == 0 {
		ids = req.IDs
	}
	if len(ids) == 0 {
		return response.FailWith(c, response.BadRequest, "缺少文件ID列表")
	}
	if err := h.svc.MoveBatch(c.Request().Context(), ids, req.FolderID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// DeleteBatch 处理 DELETE /admin/media/batch 请求，
// 根据 ID 列表批量软删除（移入回收站）媒体文件。
func (h *MediaHandler) DeleteBatch(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.DeleteBatch(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Trash 处理 GET /admin/media/trash 请求，
// 返回分页的已软删除（回收站中）媒体文件列表。
func (h *MediaHandler) Trash(c echo.Context) error {
	f := repository.MediaFilter{
		Keyword:  c.QueryParam("keyword"),
		PageNum:  parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize: parseIntDefault(c.QueryParam("pageSize"), 20),
		Deleted:  true,
	}
	pr, err := h.svc.GetForAdmin(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// TrashCount 处理 GET /admin/media/trash/count 请求，
// 返回回收站中软删除文件的数量。
func (h *MediaHandler) TrashCount(c echo.Context) error {
	n, err := h.svc.GetTrashCount(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, n)
}

// BatchRestore 处理 POST /admin/media/trash/batch-restore 请求，
// 批量恢复回收站中的多个文件。
func (h *MediaHandler) BatchRestore(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.RestoreBatch(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// PermanentDeleteBatch 处理 DELETE /admin/media/trash/batch-permanent 请求，
// 不可逆地彻底删除回收站中的多个文件。
func (h *MediaHandler) PermanentDeleteBatch(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.PermanentDeleteBatch(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// EmptyTrash 处理 DELETE /admin/media/trash/empty 请求，
// 永久清空回收站中的所有文件。
func (h *MediaHandler) EmptyTrash(c echo.Context) error {
	if err := h.svc.EmptyTrash(c.Request().Context()); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Get 处理 GET /admin/media/:id 请求，
// 返回单个媒体文件的完整元数据信息。
func (h *MediaHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	vo, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "文件不存在")
	}
	return response.OK(c, vo)
}

// Update 处理 PUT /admin/media/:id 请求，
// 更新媒体文件元数据（altText、originalName、folderId）。
// 同时接受查询参数和 JSON 请求体，请求体优先级更高。
func (h *MediaHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// 同时支持通过查询参数传递 altText/originalName（兼容旧版调用方式）
	var req dto.UpdateMediaRequest
	if alt := c.QueryParam("altText"); alt != "" {
		req.AltText = &alt
	}
	if orig := c.QueryParam("originalName"); orig != "" {
		req.OriginalName = &orig
	}
	if fid := c.QueryParam("folderId"); fid != "" {
		if n, err := strconv.ParseInt(fid, 10, 64); err == nil {
			req.FolderID = &n
		}
	}
	// 尝试绑定 JSON 请求体（若存在则覆盖查询参数）
	_ = c.Bind(&req)
	vo, err := h.svc.Update(c.Request().Context(), id, req)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

// Delete 处理 DELETE /admin/media/:id 请求，
// 软删除（移入回收站）单个文件。
func (h *MediaHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Move 处理 POST /admin/media/:id/move 请求，
// 将文件移动至另一个文件夹（nil 表示移至根目录）。
// 同时支持通过查询参数或 JSON 请求体传递 folderId。
func (h *MediaHandler) Move(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// 优先从查询参数获取 folderId（兼容旧版调用方式）
	var folderID *int64
	if v := c.QueryParam("folderId"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			folderID = &n
		}
	}
	// 若查询参数中无 folderId，则尝试从 JSON 请求体获取
	if folderID == nil {
		var req struct {
			FolderID *int64 `json:"folderId"`
		}
		_ = c.Bind(&req)
		folderID = req.FolderID
	}
	if err := h.svc.Move(c.Request().Context(), id, folderID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Restore 处理 POST /admin/media/:id/restore 请求，
// 将单个回收站文件恢复至正常状态。
func (h *MediaHandler) Restore(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Restore(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// PermanentDelete 处理 DELETE /admin/media/:id/permanent 请求，
// 不可逆地彻底删除单个文件。
func (h *MediaHandler) PermanentDelete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.PermanentDelete(c.Request().Context(), id); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}

// UploadContent 处理 POST /admin/media/:id/content 请求。
// 替换文件的二进制内容：先对当前文件生成版本快照，
// 再将新内容上传至存储，最后更新数据库中的路径、URL、大小和版本号。
// 使用前需确保已调用 SetVersionDeps 注入相关依赖。
func (h *MediaHandler) UploadContent(c echo.Context) error {
	if h.versionSvc == nil || h.store == nil || h.mediaRepo == nil {
		return response.FailWith(c, response.InternalError, "版本服务未配置")
	}

	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}

	fh, err := c.FormFile("file")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "未找到文件")
	}
	const maxUploadSize = 100 * 1024 * 1024 // 100 MB
	if fh.Size > maxUploadSize {
		return response.FailWith(c, response.BadRequest, fmt.Sprintf("文件大小超过限制 (最大 %d MB)", maxUploadSize/(1024*1024)))
	}

	ctx := c.Request().Context()

	// 获取当前文件记录
	existing, err := h.mediaRepo.FindByID(ctx, id)
	if err != nil {
		return response.Error(c, err)
	}
	if existing == nil {
		return response.FailWith(c, response.NotFound, "文件不存在")
	}

	// 替换前先保存当前版本快照
	lu := middleware.GetLoginUser(c)
	var createdBy *int64
	if lu != nil {
		createdBy = &lu.UserID
	}
	desc := "编辑前自动保存"
	if err := h.versionSvc.CreateVersionFromFile(ctx, existing, desc, createdBy); err != nil {
		return response.Error(c, err)
	}

	// 上传新文件内容
	f, err := fh.Open()
	if err != nil {
		return response.Error(c, err)
	}
	defer f.Close()

	// Sniff MIME type to prevent uploading dangerous file types
	sniffBuf := make([]byte, 512)
	n, sniffErr := io.ReadAtLeast(f, sniffBuf, 1)
	if sniffErr != nil && sniffErr != io.ErrUnexpectedEOF {
		return response.Error(c, sniffErr)
	}
	detectedMime := http.DetectContentType(sniffBuf[:n])
	if seeker, ok := f.(io.Seeker); ok {
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return response.Error(c, fmt.Errorf("failed to reset file reader after MIME detection: %w", err))
		}
	}

	now := time.Now()
	ext := filepath.Ext(fh.Filename)
	if ext == "" {
		// 若新文件无扩展名，则沿用原文件扩展名
		ext = filepath.Ext(existing.Filename)
	}
	key := fmt.Sprintf("%d/%02d/%d_edited%s", now.Year(), now.Month(), now.UnixMilli(), ext)

	url, err := h.store.Upload(ctx, key, f, fh.Size, detectedMime)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "文件上传失败: "+err.Error())
	}

	// 更新数据库文件记录（路径、URL、大小、版本号）
	newVersion := existing.CurrentVersion + 1
	if err := h.mediaRepo.UpdateFileContent(ctx, id, key, url, fh.Size, newVersion); err != nil {
		return response.Error(c, err)
	}

	// 返回更新后的文件信息
	vo, err := h.svc.GetByID(ctx, id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}
