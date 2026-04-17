package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// ShareHandler 处理媒体分享链接的创建与管理相关 HTTP 接口。
//
// mediaSvc 用于 VULN-044 ownership 校验（GetSharesByFile 必须验证调用者拥有
// 底层文件，否则任何登录用户可枚举他人文件的 share_token）。
type ShareHandler struct {
	svc      *service.ShareService
	mediaSvc *service.MediaService
}

// NewShareHandler 创建 ShareHandler 实例。
func NewShareHandler(svc *service.ShareService, mediaSvc *service.MediaService) *ShareHandler {
	return &ShareHandler{svc: svc, mediaSvc: mediaSvc}
}

// Mount 将分享管理路由注册到指定的管理员路由组。
func (h *ShareHandler) Mount(g *echo.Group) {
	shares := g.Group("/shares")
	shares.POST("/file/:fileId", h.CreateFileShare)
	shares.POST("/folder/:folderId", h.CreateFolderShare)
	shares.GET("/file/:fileId", h.GetSharesByFile)
	shares.PUT("/:shareId", h.Update)
	shares.DELETE("/:shareId", h.Delete)
}

// CreateFileShare 处理 POST /shares/file/:fileId 请求。
// 为指定文件创建分享链接；当前登录用户将作为创建人记录。
// 路径参数 fileId 为目标文件 ID，请求体为 CreateShareRequest。
func (h *ShareHandler) CreateFileShare(c echo.Context) error {
	// 解析路径参数中的文件 ID
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	var req dto.CreateShareRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	// 获取当前登录用户 ID 作为分享创建人
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

// CreateFolderShare 处理 POST /shares/folder/:folderId 请求。
// 为指定文件夹创建分享链接；当前登录用户将作为创建人记录。
// 路径参数 folderId 为目标文件夹 ID，请求体为 CreateShareRequest。
func (h *ShareHandler) CreateFolderShare(c echo.Context) error {
	// 解析路径参数中的文件夹 ID
	folderID, err := strconv.ParseInt(c.Param("folderId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件夹ID")
	}
	var req dto.CreateShareRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	// 获取当前登录用户 ID 作为分享创建人
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

// GetSharesByFile 处理 GET /shares/file/:fileId 请求。
// 查询并返回指定文件下的所有分享链接记录。
// 路径参数 fileId 为目标文件 ID。
func (h *ShareHandler) GetSharesByFile(c echo.Context) error {
	// 解析路径参数中的文件 ID
	fileID, err := strconv.ParseInt(c.Param("fileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	// SECURITY (VULN-044): 校验文件所有权，避免任意登录用户枚举他人文件 share_token。
	fileFound, uploaderID, err := h.mediaSvc.GetUploaderID(c.Request().Context(), fileID)
	if err != nil {
		return response.Error(c, err)
	}
	if !fileFound {
		return response.FailWith(c, response.NotFound, "文件不存在")
	}
	if err := middleware.AssertOwnership(c, uploaderID); err != nil {
		return err
	}
	shares, err := h.svc.GetSharesByFile(c.Request().Context(), fileID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, shares)
}

// Update 处理 PUT /shares/:shareId 请求。
// 更新已存在的分享链接配置（如有效期、访问密码等）。
// 路径参数 shareId 为目标分享记录 ID，请求体为 UpdateShareRequest。
func (h *ShareHandler) Update(c echo.Context) error {
	// 解析路径参数中的分享 ID
	shareID, err := strconv.ParseInt(c.Param("shareId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的分享ID")
	}
	// SECURITY (VULN-037): only the share creator or admin can update.
	found, createdBy, err := h.svc.GetCreatedBy(c.Request().Context(), shareID)
	if err != nil {
		return response.Error(c, err)
	}
	if !found {
		return response.FailWith(c, response.NotFound, "分享不存在")
	}
	if err := middleware.AssertOwnership(c, createdBy); err != nil {
		return err
	}
	var req dto.UpdateShareRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	vo, err := h.svc.Update(c.Request().Context(), shareID, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	// 分享记录不存在时返回 404
	if vo == nil {
		return response.FailWith(c, response.NotFound, "分享不存在")
	}
	return response.OK(c, vo)
}

// Delete 处理 DELETE /shares/:shareId 请求。
// 删除指定的分享链接记录，使该链接永久失效。
// 路径参数 shareId 为目标分享记录 ID。
func (h *ShareHandler) Delete(c echo.Context) error {
	// 解析路径参数中的分享 ID
	shareID, err := strconv.ParseInt(c.Param("shareId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的分享ID")
	}
	// SECURITY (VULN-037): only the share creator or admin can delete.
	found, createdBy, err := h.svc.GetCreatedBy(c.Request().Context(), shareID)
	if err != nil {
		return response.Error(c, err)
	}
	if !found {
		return response.FailWith(c, response.NotFound, "分享不存在")
	}
	if err := middleware.AssertOwnership(c, createdBy); err != nil {
		return err
	}
	if err := h.svc.Delete(c.Request().Context(), shareID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
