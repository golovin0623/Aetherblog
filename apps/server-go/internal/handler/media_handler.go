package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type MediaHandler struct{ svc *service.MediaService }

func NewMediaHandler(svc *service.MediaService) *MediaHandler { return &MediaHandler{svc: svc} }

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
	g.DELETE("/:id/permanent", h.PermanentDelete)
}

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

func (h *MediaHandler) Stats(c echo.Context) error {
	st, err := h.svc.GetStats(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, st)
}

func (h *MediaHandler) BatchMove(c echo.Context) error {
	var req dto.BatchMoveRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.MoveBatch(c.Request().Context(), req.IDs, req.FolderID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *MediaHandler) DeleteBatch(c echo.Context) error {
	var req dto.BatchIDsRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.DeleteBatch(c.Request().Context(), req.IDs); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

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

func (h *MediaHandler) TrashCount(c echo.Context) error {
	n, err := h.svc.GetTrashCount(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, map[string]int64{"count": n})
}

func (h *MediaHandler) BatchRestore(c echo.Context) error {
	var req dto.BatchIDsRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.RestoreBatch(c.Request().Context(), req.IDs); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *MediaHandler) PermanentDeleteBatch(c echo.Context) error {
	var req dto.BatchIDsRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.PermanentDeleteBatch(c.Request().Context(), req.IDs); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *MediaHandler) EmptyTrash(c echo.Context) error {
	if err := h.svc.EmptyTrash(c.Request().Context()); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

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

func (h *MediaHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.UpdateMediaRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	vo, err := h.svc.Update(c.Request().Context(), id, req)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

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

func (h *MediaHandler) Move(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.BatchMoveRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if err := h.svc.Move(c.Request().Context(), id, req.FolderID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

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
