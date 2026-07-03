package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// StorageProviderHandler 处理存储提供商配置的管理端 HTTP 接口。
type StorageProviderHandler struct{ svc *service.StorageProviderService }

// NewStorageProviderHandler 创建 StorageProviderHandler 实例。
func NewStorageProviderHandler(svc *service.StorageProviderService) *StorageProviderHandler {
	return &StorageProviderHandler{svc: svc}
}

// Mount 将存储提供商管理路由注册到指定的管理员路由组。
func (h *StorageProviderHandler) Mount(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/default", h.Default)
	// 配置导入/导出 — 注意必须放在 /:id 之前,否则 echo 会把 "export"/"import" 当作 ID
	g.GET("/export", h.Export)
	g.POST("/import", h.Import)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.POST("/:id/set-default", h.SetDefault)
	g.POST("/:id/test", h.Test)

	// Phase 5: 云端浏览 + 反向导入
	g.GET("/:id/objects", h.ListObjects)
	g.POST("/:id/import", h.ImportObjects)
	g.DELETE("/:id/objects", h.DeleteObjects)
}

// List 处理 GET /admin/storage-providers 请求。
// 返回所有已配置的存储提供商列表。
func (h *StorageProviderHandler) List(c echo.Context) error {
	vos, err := h.svc.List(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vos)
}

// Default 处理 GET /admin/storage-providers/default 请求。
// 返回当前活跃的默认存储提供商配置。
func (h *StorageProviderHandler) Default(c echo.Context) error {
	vo, err := h.svc.GetDefault(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

// Get 处理 GET /admin/storage-providers/:id 请求。
// 根据 ID 返回单个存储提供商的详细配置。
// 路径参数 id 为存储提供商数字 ID。
func (h *StorageProviderHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	vo, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	// 存储提供商不存在时返回 404
	if vo == nil {
		return response.FailWith(c, response.NotFound, "存储提供商不存在")
	}
	return response.OK(c, vo)
}

// Create 处理 POST /admin/storage-providers 请求。
// 创建一个新的存储提供商配置（如本地存储、S3、OSS 等）。
// 请求体为 StorageProviderRequest。
func (h *StorageProviderHandler) Create(c echo.Context) error {
	var req dto.StorageProviderRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.Create(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

// Update 处理 PUT /admin/storage-providers/:id 请求。
// 更新已存在的存储提供商配置信息。
// 路径参数 id 为存储提供商数字 ID，请求体为 StorageProviderRequest。
func (h *StorageProviderHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.StorageProviderRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.Update(c.Request().Context(), id, req); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Delete 处理 DELETE /admin/storage-providers/:id 请求。
// 删除指定的存储提供商配置记录。
// 路径参数 id 为存储提供商数字 ID。
func (h *StorageProviderHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// SetDefault 处理 POST /admin/storage-providers/:id/set-default 请求。
// 将指定存储提供商设为默认，并自动清除其他提供商的默认标记。
// 路径参数 id 为目标存储提供商 ID。
func (h *StorageProviderHandler) SetDefault(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.SetDefault(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Test 处理 POST /admin/storage-providers/:id/test 请求。
// 测试指定存储提供商的连通性，返回测试结果（success 和 message）。
// 路径参数 id 为目标存储提供商 ID。
func (h *StorageProviderHandler) Test(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	ok, msg := h.svc.Test(c.Request().Context(), id)
	return response.OK(c, map[string]interface{}{"success": ok, "message": msg})
}

// Export 处理 GET /admin/storage/providers/export 请求。
// 返回所有 provider 的明文 configJson,供运维跨实例迁移。
//
// SECURITY: 响应内容包含 accessKey/secretKey 等明文凭证 — 前端 UI 在触发前
// 必须给用户醒目警告(参考 StorageProviderSettings.tsx 的导出按钮 confirm 流程)。
func (h *StorageProviderHandler) Export(c echo.Context) error {
	payload, err := h.svc.Export(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, payload)
}

// Import 处理 POST /admin/storage/providers/import 请求。
// 接受导出文件(StorageProviderExportPayload),按 name 去重 skip,逐条创建。
// 若导入项中有 IsDefault=true 且实际被新建,则在最后调用 SetDefault 切换默认 provider。
func (h *StorageProviderHandler) Import(c echo.Context) error {
	var payload dto.StorageProviderExportPayload
	if err := c.Bind(&payload); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	result, err := h.svc.Import(c.Request().Context(), payload)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, result)
}

// ListObjects 处理 GET /admin/storage/providers/:id/objects?prefix=&token=&limit=
// 返回该 provider 上 prefix 下的对象 + 是否在 catalog (Phase 5)。
func (h *StorageProviderHandler) ListObjects(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	prefix := c.QueryParam("prefix")
	token := c.QueryParam("token")
	limit := 100
	if v := c.QueryParam("limit"); v != "" {
		if n, _ := strconv.Atoi(v); n > 0 {
			limit = n
		}
	}
	res, err := h.svc.ListObjects(c.Request().Context(), id, prefix, token, limit)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, res)
}

// importObjectsReq POST 正文
type importObjectsReq struct {
	Keys []string `json:"keys" validate:"required,min=1,max=200"`
}

// ImportObjects 处理 POST /admin/storage/providers/:id/import {keys: [...]}
// 把云端孤儿对象写入 media_files catalog (Phase 5)。
//
// uploaderID 从 JWT 中的当前 actor 取,导入的文件归属于触发该操作的 admin。
func (h *StorageProviderHandler) ImportObjects(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req importObjectsReq
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if len(req.Keys) == 0 {
		return response.FailWith(c, response.BadRequest, "keys 为空")
	}
	var uploaderID *int64
	if lu := middleware.GetLoginUser(c); lu != nil {
		uid := lu.UserID
		uploaderID = &uid
	}
	imported, skipped, err := h.svc.ImportObjects(c.Request().Context(), id, req.Keys, uploaderID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, map[string]any{
		"imported":    imported,
		"skippedKeys": skipped,
	})
}

// deleteObjectsReq 删除正文
type deleteObjectsReq struct {
	Keys []string `json:"keys"`
}

// DeleteObjects 处理 DELETE /admin/storage/providers/:id/objects {keys: [...]}
// 删除云端 ORPHAN 对象 (Phase 5);catalog 中已存在的 key 拒绝删,必须走 media 删除路径。
func (h *StorageProviderHandler) DeleteObjects(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req deleteObjectsReq
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if len(req.Keys) == 0 {
		return response.FailWith(c, response.BadRequest, "keys 为空")
	}
	deleted, refused, err := h.svc.DeleteObjects(c.Request().Context(), id, req.Keys)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, map[string]any{
		"deleted":     deleted,
		"refusedKeys": refused,
	})
}
