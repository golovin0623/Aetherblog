package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// MediaHandler 负责处理媒体文件的上传、列表、回收站及版本管理接口。
//
// versionSvc / mediaRepo 为可选项,UploadContent 端点用来在保存编辑前先做版本快照。
// 不再需要直接持有 storage.Storage 字段(早期实现的字段 — UploadContent 写死 localStore
// 在 S3 模式下会失效);现走 service.MediaService.UpdateContent 自动按 provider 解析。
type MediaHandler struct {
	svc         *service.MediaService
	versionSvc  *service.VersionService // 可选;UploadContent 用来写版本快照(没注入时不写快照仍可保存)
	mediaRepo   *repository.MediaRepo   // 可选;UploadContent 用来读旧记录给版本快照
	activitySvc *service.ActivityService
}

// NewMediaHandler 创建一个仅含核心 MediaService 的 MediaHandler 实例。
func NewMediaHandler(svc *service.MediaService, activitySvc *service.ActivityService) *MediaHandler {
	return &MediaHandler{svc: svc, activitySvc: activitySvc}
}

// assertMediaOwnership 在 handler 层验证调用者拥有指定媒体文件。
// SECURITY (VULN-040/041/042): 读取 uploader_id 后委托给 middleware.AssertOwnership。
// 语义：
//   - 文件不存在 → 404
//   - 匿名上传 (uploader_id IS NULL) → 仅 admin 可操作
//   - 指定上传者 → admin 放行；否则须调用者 user_id 匹配
func (h *MediaHandler) assertMediaOwnership(c echo.Context, mediaID int64) error {
	found, uploaderID, err := h.svc.GetUploaderID(c.Request().Context(), mediaID)
	if err != nil {
		return response.Error(c, err)
	}
	if !found {
		return response.FailWith(c, response.NotFound, "文件不存在")
	}
	return middleware.AssertOwnership(c, uploaderID)
}

// SetVersionDeps 注入版本相关的可选依赖,启用 UploadContent 写快照能力。
//
// 不传也能用 UploadContent — 但保存前的版本快照会被跳过。
func (h *MediaHandler) SetVersionDeps(versionSvc *service.VersionService, mediaRepo *repository.MediaRepo) {
	h.versionSvc = versionSvc
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

	// 记录上传文件活动
	h.recordMediaActivity(c, "media.upload", "上传文件: "+fh.Filename, fmt.Sprintf("文件 %s 已上传", fh.Filename))

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
//
// SECURITY (VULN, Phase 1): 在 service 层做 ownership 校验,非 admin 用户只能批量
// 永久删除自己上传的文件。failedIDs 表示后端删除失败但 DB 已清理的文件,前端可在
// "管理员手动清理"流程里据此告警。
//
// Phase 3 query: ?deleteCloud=false → 仅清 DB 行(后端文件保留)。
func (h *MediaHandler) PermanentDeleteBatch(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	deleteCloud := c.QueryParam("deleteCloud") != "false"
	actor := middleware.SnapshotFromContext(c)
	failed, err := h.svc.PermanentDeleteBatchWithOptions(c.Request().Context(), ids, actor, deleteCloud)
	if err != nil {
		return response.FailWith(c, response.Forbidden, err.Error())
	}
	if len(failed) > 0 {
		return response.OK(c, map[string]any{"failedIds": failed})
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
	// SECURITY (VULN-040): 元数据更新前先校验所有权。
	if err := h.assertMediaOwnership(c, id); err != nil {
		return err
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
	// SECURITY (VULN-040): 软删除（移入回收站）前先校验所有权。
	if err := h.assertMediaOwnership(c, id); err != nil {
		return err
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}

	// 记录删除文件活动
	h.recordMediaActivity(c, "media.delete", fmt.Sprintf("删除文件 #%d", id), fmt.Sprintf("文件 #%d 已移入回收站", id))

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
	// SECURITY (VULN-040): 移动前先校验所有权。
	if err := h.assertMediaOwnership(c, id); err != nil {
		return err
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
	// SECURITY (VULN-040): 从回收站恢复前先校验所有权。
	if err := h.assertMediaOwnership(c, id); err != nil {
		return err
	}
	if err := h.svc.Restore(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// PermanentDelete 处理 DELETE /admin/media/:id/permanent 请求，
// 不可逆地彻底删除单个文件。
//
// Phase 3 query: ?deleteCloud=false → 仅清 DB 行,后端文件保留(适合"先抢救云端原件"流程)。
// 默认 true (与历史行为一致 — 后端 + DB 一并清除)。
func (h *MediaHandler) PermanentDelete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// SECURITY (VULN-040): 不可逆删除前先校验所有权。
	if err := h.assertMediaOwnership(c, id); err != nil {
		return err
	}
	deleteCloud := c.QueryParam("deleteCloud") != "false"
	if err := h.svc.PermanentDeleteWithOptions(c.Request().Context(), id, deleteCloud); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}

// recordMediaActivity 记录媒体相关活动事件，失败时仅记录日志不阻塞主流程。
func (h *MediaHandler) recordMediaActivity(c echo.Context, eventType, title, description string) {
	if h.activitySvc == nil {
		return
	}
	evtCat := "media"
	evtStatus := "SUCCESS"
	var userID *int64
	if lu := middleware.GetLoginUser(c); lu != nil {
		userID = &lu.UserID
	}
	if err := h.activitySvc.Create(c.Request().Context(), &model.ActivityEvent{
		EventType:     eventType,
		EventCategory: &evtCat,
		Title:         title,
		Description:   &description,
		UserID:        userID,
		Status:        &evtStatus,
	}); err != nil {
		log.Warn().Err(err).Msg("record activity failed")
	}
}

// UploadContent 处理 POST /admin/media/:id/content 请求。
//
// 替换文件的二进制内容(图片编辑器保存场景):
//   1. 校验 ownership;
//   2. 若 versionSvc 已注入,先把当前版本快照写入 media_versions(用于版本回滚);
//   3. 调 MediaService.UpdateContent 走对应 provider 上传新内容 + 更新 catalog。
//
// 关键修复(遗留 4):原实现写死 h.store(只在 LOCAL 可用,云模式静默失效),且
// h.store 一直未被 server.go 注入 → 端点之前一直返回 "版本服务未配置"。
// 现走 svc.UpdateContent 自动按 storage_provider_id 解析。
func (h *MediaHandler) UploadContent(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// SECURITY (VULN-040): 覆盖文件二进制内容是最危险的操作之一，必须 ownership 校验。
	if err := h.assertMediaOwnership(c, id); err != nil {
		return err
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

	// 写版本快照(可选 — versionSvc 没注入时跳过)
	if h.versionSvc != nil && h.mediaRepo != nil {
		existing, err := h.mediaRepo.FindByID(ctx, id)
		if err != nil {
			return response.Error(c, err)
		}
		if existing == nil {
			return response.FailWith(c, response.NotFound, "文件不存在")
		}
		lu := middleware.GetLoginUser(c)
		var createdBy *int64
		if lu != nil {
			createdBy = &lu.UserID
		}
		desc := "编辑前自动保存"
		if err := h.versionSvc.CreateVersionFromFile(ctx, existing, desc, createdBy); err != nil {
			return response.Error(c, err)
		}
	}

	f, err := fh.Open()
	if err != nil {
		return response.Error(c, err)
	}
	defer f.Close()

	lu := middleware.GetLoginUser(c)
	var createdBy *int64
	if lu != nil {
		createdBy = &lu.UserID
	}

	vo, err := h.svc.UpdateContent(ctx, service.UpdateContentParams{
		MediaID:   id,
		NewBody:   f,
		NewSize:   fh.Size,
		Filename:  fh.Filename,
		CreatedBy: createdBy,
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, "文件上传失败: "+err.Error())
	}
	return response.OK(c, vo)
}
