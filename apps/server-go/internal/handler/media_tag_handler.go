package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// MediaTagHandler 负责处理媒体标签管理及文件与标签关联相关接口。
//
// mediaSvc 用于 VULN-041 ownership 校验（附加/移除文件-标签关联必须由文件
// uploader 或 admin 操作）。
type MediaTagHandler struct {
	svc      *service.MediaTagService
	mediaSvc *service.MediaService
}

// NewMediaTagHandler 创建一个 MediaTagHandler 实例。
func NewMediaTagHandler(svc *service.MediaTagService, mediaSvc *service.MediaService) *MediaTagHandler {
	return &MediaTagHandler{svc: svc, mediaSvc: mediaSvc}
}

// assertFileOwnership 封装按 fileID 做 ownership 校验的样板逻辑。
func (h *MediaTagHandler) assertFileOwnership(c echo.Context, fileID int64) error {
	found, uploaderID, err := h.mediaSvc.GetUploaderID(c.Request().Context(), fileID)
	if err != nil {
		return response.Error(c, err)
	}
	if !found {
		return response.FailWith(c, response.NotFound, "文件不存在")
	}
	return middleware.AssertOwnership(c, uploaderID)
}

// Mount 在指定的管理员路由组下注册标签管理和文件-标签关联路由。
func (h *MediaTagHandler) Mount(g *echo.Group) {
	tags := g.Group("/tags")
	tags.GET("", h.GetAll)
	tags.GET("/popular", h.GetPopular)
	tags.GET("/search", h.Search)
	tags.POST("", h.Create)
	tags.DELETE("/:id", h.Delete)
	tags.POST("/batch", h.BatchTag)

	files := g.Group("/files")
	files.GET("/:fileId/tags", h.GetFileTags)
	files.POST("/:fileId/tags", h.TagFile)
	files.DELETE("/:fileId/tags/:tagId", h.UntagFile)
}

// GetAll 处理 GET /media/tags 请求，返回所有媒体标签列表。
func (h *MediaTagHandler) GetAll(c echo.Context) error {
	tags, err := h.svc.GetAll(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

// GetPopular 处理 GET /media/tags/popular 请求，
// 返回使用频率最高的标签列表，可通过 limit 查询参数控制数量（默认 20）。
func (h *MediaTagHandler) GetPopular(c echo.Context) error {
	limit := parseIntDefault(c.QueryParam("limit"), 20)
	tags, err := h.svc.GetPopular(c.Request().Context(), limit)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

// Search 处理 GET /media/tags/search?keyword= 请求，
// 根据关键词搜索匹配的媒体标签。
func (h *MediaTagHandler) Search(c echo.Context) error {
	keyword := c.QueryParam("keyword")
	if keyword == "" {
		return response.FailWith(c, response.BadRequest, "缺少搜索关键词")
	}
	tags, err := h.svc.Search(c.Request().Context(), keyword)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

// Create 处理 POST /media/tags 请求，创建新的媒体标签。
func (h *MediaTagHandler) Create(c echo.Context) error {
	var req dto.CreateMediaTagRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.Create(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

// Delete 处理 DELETE /media/tags/:id 请求，删除指定 ID 的媒体标签。
func (h *MediaTagHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// GetFileTags 处理 GET /media/files/:fileId/tags 请求，
// 返回指定文件关联的所有标签列表。
func (h *MediaTagHandler) GetFileTags(c echo.Context) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	tags, err := h.svc.GetFileTags(c.Request().Context(), fileID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

// TagFile 处理 POST /media/files/:fileId/tags 请求，
// 为指定文件添加标签关联，并记录操作用户。
func (h *MediaTagHandler) TagFile(c echo.Context) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	// SECURITY (VULN-041): only file uploader / admin may attach tags.
	if err := h.assertFileOwnership(c, fileID); err != nil {
		return err
	}
	var req dto.TagFileRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var taggedBy *int64
	if lu != nil {
		taggedBy = &lu.UserID
	}
	if err := h.svc.TagFile(c.Request().Context(), fileID, req.TagIDs, taggedBy); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// UntagFile 处理 DELETE /media/files/:fileId/tags/:tagId 请求，
// 移除指定文件与指定标签的关联关系。
func (h *MediaTagHandler) UntagFile(c echo.Context) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	// SECURITY (VULN-041): only file uploader / admin may detach tags.
	if err := h.assertFileOwnership(c, fileID); err != nil {
		return err
	}
	tagID, err := strconv.ParseInt(c.Param("tagId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的标签ID")
	}
	if err := h.svc.UntagFile(c.Request().Context(), fileID, tagID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// BatchTag 处理 POST /media/tags/batch 请求，
// 将指定标签批量关联到多个文件，并记录操作用户。
func (h *MediaTagHandler) BatchTag(c echo.Context) error {
	var req dto.BatchTagRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var taggedBy *int64
	if lu != nil {
		taggedBy = &lu.UserID
	}
	if err := h.svc.BatchTag(c.Request().Context(), req.FileIDs, req.TagID, taggedBy); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
