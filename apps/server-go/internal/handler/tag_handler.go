package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// TagHandler 处理博客文章标签的 CRUD 操作相关 HTTP 接口。
type TagHandler struct{ svc *service.TagService }

// NewTagHandler 创建由指定 TagService 驱动的 TagHandler 实例。
func NewTagHandler(svc *service.TagService) *TagHandler { return &TagHandler{svc: svc} }

// MountAdmin 将管理端 CRUD 路由（列表、详情、创建、更新、删除）注册到路由组 g。
func (h *TagHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/:id", h.Get)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
}

// List 处理 GET /admin/tags 请求。
// 返回所有标签列表，按名称排序。
func (h *TagHandler) List(c echo.Context) error {
	tags, err := h.svc.List(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, tags)
}

// Get 处理 GET /admin/tags/:id 请求。
// 根据 ID 返回单个标签的详细信息。
// 路径参数 id 为标签数字 ID。
func (h *TagHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	tag, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	// 标签不存在时返回 404
	if tag == nil {
		return response.FailWith(c, response.NotFound, "标签不存在")
	}
	return response.OK(c, tag)
}

// Create 处理 POST /admin/tags 请求。
// 创建新标签；服务层会自动生成 URL slug 并将颜色默认设置为 indigo。
// 请求体为 TagRequest。
func (h *TagHandler) Create(c echo.Context) error {
	var req dto.TagRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	tag, err := h.svc.Create(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, tag)
}

// Update 处理 PUT /admin/tags/:id 请求。
// 更新标签的名称、URL slug、描述和颜色。
// 路径参数 id 为标签 ID，请求体为 TagRequest。
func (h *TagHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.TagRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	tag, err := h.svc.Update(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, tag)
}

// Delete 处理 DELETE /admin/tags/:id 请求。
// 删除指定标签及其所有文章-标签关联记录。
// 路径参数 id 为标签 ID。
func (h *TagHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
