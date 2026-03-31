package handler

import (
	"encoding/json"
	"fmt"
	"io"
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

// MediaHandler manages media file uploads, listing, trash, and version management.
// The version-related dependencies (versionSvc, store, mediaRepo) are optional and must
// be injected via SetVersionDeps before the UploadContent endpoint is used.
type MediaHandler struct {
	svc        *service.MediaService
	versionSvc *service.VersionService // optional; required for UploadContent
	store      storage.Storage          // optional; required for UploadContent
	uploadDir  string                   // local upload base directory
	mediaRepo  *repository.MediaRepo    // optional; required for UploadContent
}

// NewMediaHandler creates a MediaHandler with the core MediaService.
// Call SetVersionDeps to enable file-content replacement with versioning.
func NewMediaHandler(svc *service.MediaService) *MediaHandler { return &MediaHandler{svc: svc} }

// SetVersionDeps sets the optional version-related dependencies for content upload.
func (h *MediaHandler) SetVersionDeps(versionSvc *service.VersionService, store storage.Storage, uploadDir string, mediaRepo *repository.MediaRepo) {
	h.versionSvc = versionSvc
	h.store = store
	h.uploadDir = uploadDir
	h.mediaRepo = mediaRepo
}

// Mount registers all media management routes on g.
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

// Upload handles POST /admin/media/upload. Accepts a single multipart file upload.
// Optional query param: folderId — places the file in the specified folder.
func (h *MediaHandler) Upload(c echo.Context) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "未找到文件")
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

// UploadBatch handles POST /admin/media/upload/batch. Accepts multiple files under the "files" form field.
// Returns a mixed array — successful uploads as MediaFileVO, failed ones as {"error": "...", "filename": "..."}.
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

// List handles GET /admin/media. Returns paginated non-deleted media files with optional
// keyword, fileType, and folderId filters.
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

// Stats handles GET /admin/media/stats. Returns storage usage statistics (file counts and sizes by type).
func (h *MediaHandler) Stats(c echo.Context) error {
	st, err := h.svc.GetStats(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, st)
}

func (h *MediaHandler) BatchMove(c echo.Context) error {
	// Frontend sends {"fileIds":[...], "folderId": N} — accept both fileIds and ids
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

// Trash handles GET /admin/media/trash. Returns paginated soft-deleted (trashed) media files.
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

// TrashCount handles GET /admin/media/trash/count. Returns the number of soft-deleted files.
func (h *MediaHandler) TrashCount(c echo.Context) error {
	n, err := h.svc.GetTrashCount(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, n)
}

// BatchRestore handles POST /admin/media/trash/batch-restore. Restores multiple trashed files.
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

// EmptyTrash handles DELETE /admin/media/trash/empty. Permanently deletes all trashed files.
func (h *MediaHandler) EmptyTrash(c echo.Context) error {
	if err := h.svc.EmptyTrash(c.Request().Context()); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Get handles GET /admin/media/:id. Returns full metadata for a single media file.
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

// Update handles PUT /admin/media/:id. Updates metadata (altText, originalName, folderId).
// Accepts values as both query parameters and JSON body; body takes precedence.
func (h *MediaHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// Java accepts altText/originalName as query params; also accept JSON body
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
	// Also try JSON body (overrides query params if present)
	_ = c.Bind(&req)
	vo, err := h.svc.Update(c.Request().Context(), id, req)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

// Delete handles DELETE /admin/media/:id. Soft-deletes (trashes) a single file.
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

// Move handles POST /admin/media/:id/move. Moves a file to another folder (nil = root).
// Accepts folderId as query param or JSON body.
func (h *MediaHandler) Move(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// Java accepts folderId as query param; also accept JSON body
	var folderID *int64
	if v := c.QueryParam("folderId"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			folderID = &n
		}
	}
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

// Restore handles POST /admin/media/:id/restore. Restores a single trashed file.
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

// PermanentDelete handles DELETE /admin/media/:id/permanent. Irreversibly removes a file.
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

// UploadContent handles POST /admin/media/:id/content.
// Replaces the file's binary content: saves a version snapshot of the current file,
// uploads the new content to storage, then updates the DB record with the new path/URL/size/version.
// Requires SetVersionDeps to have been called.
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

	ctx := c.Request().Context()

	// Get current file record
	existing, err := h.mediaRepo.FindByID(ctx, id)
	if err != nil {
		return response.Error(c, err)
	}
	if existing == nil {
		return response.FailWith(c, response.NotFound, "文件不存在")
	}

	// Save current version before replacing
	lu := middleware.GetLoginUser(c)
	var createdBy *int64
	if lu != nil {
		createdBy = &lu.UserID
	}
	desc := "编辑前自动保存"
	if err := h.versionSvc.CreateVersionFromFile(ctx, existing, desc, createdBy); err != nil {
		return response.Error(c, err)
	}

	// Upload the new file content
	f, err := fh.Open()
	if err != nil {
		return response.Error(c, err)
	}
	defer f.Close()

	now := time.Now()
	ext := filepath.Ext(fh.Filename)
	if ext == "" {
		ext = filepath.Ext(existing.Filename)
	}
	key := fmt.Sprintf("%d/%02d/%d_edited%s", now.Year(), now.Month(), now.UnixMilli(), ext)

	url, err := h.store.Upload(ctx, key, f, fh.Size, fh.Header.Get("Content-Type"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "文件上传失败: "+err.Error())
	}

	// Update file record with new content
	newVersion := existing.CurrentVersion + 1
	if err := h.mediaRepo.UpdateFileContent(ctx, id, key, url, fh.Size, newVersion); err != nil {
		return response.Error(c, err)
	}

	// Return updated file
	vo, err := h.svc.GetByID(ctx, id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}
