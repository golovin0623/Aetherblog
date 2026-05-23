package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// NoteHandler 处理后台智能笔记接口。它只挂载管理端路由, 不提供公开路由。
type NoteHandler struct {
	svc *service.NoteService
}

// NewNoteHandler 创建 NoteHandler。
func NewNoteHandler(svc *service.NoteService) *NoteHandler {
	return &NoteHandler{svc: svc}
}

// MountAdmin 注册 /v1/admin/notes 路由。
func (h *NoteHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.AdminList)
	g.POST("", h.Create)
	g.GET("/:id", h.AdminGet)
	g.PUT("/:id", h.Update)
	g.PATCH("/:id/properties", h.UpdateProperties)
	g.POST("/:id/auto-save", h.AutoSave)
	g.DELETE("/:id", h.Delete)
	g.POST("/:id/duplicate", h.Duplicate)
	g.GET("/:id/backlinks", h.BackLinks)
}

// MountFolders 注册 /v1/admin/note-folders 路由。
func (h *NoteHandler) MountFolders(g *echo.Group) {
	g.GET("", h.ListFolders)
	g.POST("", h.CreateFolder)
}

// MountTags 注册 /v1/admin/note-tags 路由。
func (h *NoteHandler) MountTags(g *echo.Group) {
	g.GET("", h.ListTags)
}

// AdminList 处理后台笔记列表。
func (h *NoteHandler) AdminList(c echo.Context) error {
	pageNum := parseIntDefault(c.QueryParam("pageNum"), 1)
	pageSize := parseIntDefault(c.QueryParam("pageSize"), 10)
	if pageNum < 1 {
		return response.FailWith(c, response.BadRequest, "pageNum 必须大于 0")
	}
	if pageSize < 1 || pageSize > 100 {
		return response.FailWith(c, response.BadRequest, "pageSize 必须在 1 到 100 之间")
	}
	f := dto.NoteFilter{
		Keyword:    c.QueryParam("keyword"),
		View:       c.QueryParam("view"),
		Tag:        c.QueryParam("tag"),
		SourceType: c.QueryParam("sourceType"),
		PageNum:    pageNum,
		PageSize:   pageSize,
	}
	if v := c.QueryParam("folderId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.FolderID = &id
		}
	}
	if v := c.QueryParam("archived"); v != "" {
		b := v == "true"
		f.Archived = &b
	}
	pr, err := h.svc.GetForAdmin(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// AdminGet 处理后台笔记详情。
func (h *NoteHandler) AdminGet(c echo.Context) error {
	id, err := parseNoteID(c)
	if err != nil {
		return err
	}
	note, err := h.svc.GetByID(c.Request().Context(), id, currentNoteUserID(c))
	if err != nil {
		return response.Error(c, err)
	}
	if note == nil {
		return response.FailWith(c, response.NotFound, "笔记不存在")
	}
	return response.OK(c, note)
}

// Create 创建笔记。
func (h *NoteHandler) Create(c echo.Context) error {
	var req dto.CreateNoteRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	authorID := currentNoteUserID(c)
	note, err := h.svc.Create(c.Request().Context(), req, authorID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, note)
}

// Update 保存笔记主体内容。
func (h *NoteHandler) Update(c echo.Context) error {
	id, err := h.checkNoteOwnership(c)
	if err != nil {
		return err
	}
	var req dto.CreateNoteRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	note, err := h.svc.Update(c.Request().Context(), id, req, currentNoteUserID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, note)
}

// UpdateProperties 局部更新笔记属性。
func (h *NoteHandler) UpdateProperties(c echo.Context) error {
	id, err := h.checkNoteOwnership(c)
	if err != nil {
		return err
	}
	var req dto.UpdateNotePropertiesRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	note, err := h.svc.UpdateProperties(c.Request().Context(), id, req, currentNoteUserID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, note)
}

// AutoSave 保存笔记草稿到 Redis。
func (h *NoteHandler) AutoSave(c echo.Context) error {
	id, err := h.checkNoteOwnership(c)
	if err != nil {
		return err
	}
	var req dto.AutoSaveNoteRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.AutoSave(c.Request().Context(), id, currentNoteUserID(c), req); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Delete 软删除笔记。
func (h *NoteHandler) Delete(c echo.Context) error {
	id, err := h.checkNoteOwnership(c)
	if err != nil {
		return err
	}
	if err := h.svc.Delete(c.Request().Context(), id, currentNoteUserID(c)); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Duplicate 复制笔记。
func (h *NoteHandler) Duplicate(c echo.Context) error {
	id, err := h.checkNoteOwnership(c)
	if err != nil {
		return err
	}
	authorID := currentNoteUserID(c)
	note, err := h.svc.Duplicate(c.Request().Context(), id, authorID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, note)
}

// BackLinks 返回笔记反向链接。
func (h *NoteHandler) BackLinks(c echo.Context) error {
	id, err := h.checkNoteOwnership(c)
	if err != nil {
		return err
	}
	links, err := h.svc.BackLinks(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, links)
}

// ListFolders 返回笔记文件夹。
func (h *NoteHandler) ListFolders(c echo.Context) error {
	folders, err := h.svc.ListFolders(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, folders)
}

// CreateFolder 创建笔记文件夹。
func (h *NoteHandler) CreateFolder(c echo.Context) error {
	var req dto.CreateNoteFolderRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	folder, err := h.svc.CreateFolder(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, folder)
}

// ListTags 返回笔记标签。
func (h *NoteHandler) ListTags(c echo.Context) error {
	tags, err := h.svc.ListTags(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

func (h *NoteHandler) checkNoteOwnership(c echo.Context) (int64, error) {
	id, err := parseNoteID(c)
	if err != nil {
		return 0, err
	}
	exists, ownerID, err := h.svc.GetOwnership(c.Request().Context(), id)
	if err != nil {
		return 0, response.Error(c, err)
	}
	if !exists {
		return 0, response.FailWith(c, response.NotFound, "笔记不存在")
	}
	if err := middleware.AssertOwnership(c, ownerID); err != nil {
		return 0, err
	}
	return id, nil
}

func parseNoteID(c echo.Context) (int64, error) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return 0, response.FailWith(c, response.BadRequest, "无效的ID")
	}
	return id, nil
}

func currentNoteUserID(c echo.Context) int64 {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return 0
	}
	return lu.UserID
}
