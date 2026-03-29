package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type MediaTagHandler struct{ svc *service.MediaTagService }

func NewMediaTagHandler(svc *service.MediaTagService) *MediaTagHandler {
	return &MediaTagHandler{svc: svc}
}

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

func (h *MediaTagHandler) GetAll(c echo.Context) error {
	tags, err := h.svc.GetAll(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

func (h *MediaTagHandler) GetPopular(c echo.Context) error {
	limit := parseIntDefault(c.QueryParam("limit"), 20)
	tags, err := h.svc.GetPopular(c.Request().Context(), limit)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

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

func (h *MediaTagHandler) TagFile(c echo.Context) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
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

func (h *MediaTagHandler) UntagFile(c echo.Context) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
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
