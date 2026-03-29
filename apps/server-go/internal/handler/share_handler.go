package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type ShareHandler struct{ svc *service.ShareService }

func NewShareHandler(svc *service.ShareService) *ShareHandler {
	return &ShareHandler{svc: svc}
}

func (h *ShareHandler) Mount(g *echo.Group) {
	shares := g.Group("/shares")
	shares.POST("/file/:fileId", h.CreateFileShare)
	shares.POST("/folder/:folderId", h.CreateFolderShare)
	shares.GET("/file/:fileId", h.GetSharesByFile)
	shares.PUT("/:shareId", h.Update)
	shares.DELETE("/:shareId", h.Delete)
}

func (h *ShareHandler) CreateFileShare(c echo.Context) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	var req dto.CreateShareRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var createdBy *int64
	if lu != nil {
		createdBy = &lu.UserID
	}
	vo, err := h.svc.CreateFileShare(c.Request().Context(), fileID, req, createdBy)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

func (h *ShareHandler) CreateFolderShare(c echo.Context) error {
	folderID, err := strconv.ParseInt(c.Param("folderId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件夹ID")
	}
	var req dto.CreateShareRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var createdBy *int64
	if lu != nil {
		createdBy = &lu.UserID
	}
	vo, err := h.svc.CreateFolderShare(c.Request().Context(), folderID, req, createdBy)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

func (h *ShareHandler) GetSharesByFile(c echo.Context) error {
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	shares, err := h.svc.GetSharesByFile(c.Request().Context(), fileID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, shares)
}

func (h *ShareHandler) Update(c echo.Context) error {
	shareID, err := strconv.ParseInt(c.Param("shareId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的分享ID")
	}
	var req dto.UpdateShareRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	vo, err := h.svc.Update(c.Request().Context(), shareID, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "分享不存在")
	}
	return response.OK(c, vo)
}

func (h *ShareHandler) Delete(c echo.Context) error {
	shareID, err := strconv.ParseInt(c.Param("shareId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的分享ID")
	}
	if err := h.svc.Delete(c.Request().Context(), shareID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
