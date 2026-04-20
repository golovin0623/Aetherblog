package handler

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// PostHandler 处理博客文章相关的所有 HTTP 接口，
// 涵盖 /admin/posts（管理端）和 /public/posts（公开端）两组路由。
type PostHandler struct {
	svc         *service.PostService
	activitySvc *service.ActivityService
}

// NewPostHandler 创建由指定 PostService 驱动的 PostHandler 实例。
func NewPostHandler(svc *service.PostService, activitySvc *service.ActivityService) *PostHandler {
	return &PostHandler{svc: svc, activitySvc: activitySvc}
}

// MountAdmin 将需要身份验证的管理端 CRUD 路由注册到路由组 g。
func (h *PostHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.AdminList)
	g.GET("/:id", h.AdminGet)
	g.POST("", h.Create)
	g.PUT("/:id", h.Update)
	g.PATCH("/:id/properties", h.UpdateProperties)
	g.POST("/:id/auto-save", h.AutoSave)
	g.DELETE("/:id", h.Delete)
	g.PATCH("/:id/publish", h.Publish)
}

// MountPublic 将无需身份验证的公开只读路由注册到路由组 g。
func (h *PostHandler) MountPublic(g *echo.Group) {
	g.GET("", h.PublicList)
	g.GET("/category/:categoryId", h.ByCategory)
	g.GET("/tag/:tagId", h.ByTag)
	g.GET("/:slug/adjacent", h.Adjacent)
	g.GET("/:slug", h.PublicGet)
	// verify-password 路由在 server.go 中单独注册（附带限流中间件）
}

// --- 管理端接口 ---

// AdminList 处理 GET /admin/posts 请求。
// 支持多维度过滤查询参数：status（状态）、keyword（关键词）、categoryId（分类ID）、
// tagId（标签ID）、minViewCount/maxViewCount（浏览量范围）、startDate/endDate（发布日期范围）、hidden（是否隐藏）。
func (h *PostHandler) AdminList(c echo.Context) error {
	// 构建过滤条件，解析各查询参数
	f := dto.PostFilter{
		Status:   c.QueryParam("status"),
		Keyword:  c.QueryParam("keyword"),
		PageNum:  parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize: parseIntDefault(c.QueryParam("pageSize"), 10),
	}
	// 解析可选的分类 ID 过滤条件
	if v := c.QueryParam("categoryId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.CategoryID = &id
		}
	}
	// 解析可选的标签 ID 过滤条件
	if v := c.QueryParam("tagId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.TagID = &id
		}
	}
	// 解析浏览量最小值过滤条件
	if v := c.QueryParam("minViewCount"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.MinViewCount = &n
		}
	}
	// 解析浏览量最大值过滤条件
	if v := c.QueryParam("maxViewCount"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.MaxViewCount = &n
		}
	}
	// 解析发布开始日期过滤条件（支持多种时间格式）
	if v := c.QueryParam("startDate"); v != "" {
		if t := parseFlexibleTime(v); t != nil {
			f.StartDate = t
		}
	}
	// 解析发布结束日期过滤条件（支持多种时间格式）
	if v := c.QueryParam("endDate"); v != "" {
		if t := parseFlexibleTime(v); t != nil {
			f.EndDate = t
		}
	}
	// 解析隐藏状态过滤条件
	if v := c.QueryParam("hidden"); v != "" {
		b := v == "true"
		f.Hidden = &b
	}

	pr, err := h.svc.GetForAdmin(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// AdminGet 处理 GET /admin/posts/:id 请求。
// 返回文章完整详情，包含 Redis 中缓存的草稿内容。
// 路径参数 id 为文章数字 ID。
func (h *PostHandler) AdminGet(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	post, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if post == nil {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	return response.OK(c, post)
}

// Create 处理 POST /admin/posts 请求。
// 以当前登录用户为作者创建新文章。
// 请求体为 CreatePostRequest。
func (h *PostHandler) Create(c echo.Context) error {
	var req dto.CreatePostRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	// 从 JWT 上下文中获取当前登录用户 ID 作为作者
	lu := middleware.GetLoginUser(c)
	var authorID int64
	if lu != nil {
		authorID = lu.UserID
	}
	post, err := h.svc.Create(c.Request().Context(), req, authorID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}

	// 记录发布文章活动
	h.recordPostActivity(c, "post.create", "发布文章: "+req.Title, fmt.Sprintf("文章 #%d 已创建", post.ID))

	return response.OK(c, post)
}

// Update 处理 PUT /admin/posts/:id 请求。
// 替换文章全量内容；同时清除 Redis 中对应的草稿缓存。
// 路径参数 id 为文章 ID，请求体为 CreatePostRequest。
func (h *PostHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// SECURITY (VULN-029): verify caller owns the post (admin bypasses).
	exists, ownerID, err := h.svc.GetOwnership(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if !exists {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	// 允许 ownerID == nil（VanBlog 导入的遗留文章 author_id 为 NULL）：
	// 由 AssertOwnership 决定——admin 放行，非 admin 返回 403。
	if err := middleware.AssertOwnership(c, ownerID); err != nil {
		return err
	}
	var req dto.CreatePostRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	// 从 JWT 上下文中获取当前登录用户 ID
	lu := middleware.GetLoginUser(c)
	var authorID int64
	if lu != nil {
		authorID = lu.UserID
	}
	post, err := h.svc.Update(c.Request().Context(), id, req, authorID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}

	// 记录更新文章活动
	h.recordPostActivity(c, "post.update", "更新文章: "+req.Title, fmt.Sprintf("文章 #%d 已更新", id))

	return response.OK(c, post)
}

// UpdateProperties 处理 PATCH /admin/posts/:id/properties 请求。
// 接受局部更新载荷，仅更新请求中包含的字段（如 status、isPinned 等），
// 其余字段保持不变。
// 路径参数 id 为文章 ID，请求体为 UpdatePostPropertiesRequest。
func (h *PostHandler) UpdateProperties(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// SECURITY (VULN-029): ownership gate before property patch.
	exists, ownerID, err := h.svc.GetOwnership(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if !exists {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	// 允许 ownerID == nil（VanBlog 导入的遗留文章 author_id 为 NULL）：
	// 由 AssertOwnership 决定——admin 放行，非 admin 返回 403。
	if err := middleware.AssertOwnership(c, ownerID); err != nil {
		return err
	}
	var req dto.UpdatePostPropertiesRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	post, err := h.svc.UpdateProperties(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, post)
}

// AutoSave 处理 POST /admin/posts/:id/auto-save 请求。
// 将编辑器内容作为草稿持久化至 Redis，不更新数据库中的正式记录，
// 用于编辑器页面的崩溃恢复功能。
// 路径参数 id 为文章 ID，请求体为 CreatePostRequest。
func (h *PostHandler) AutoSave(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// SECURITY (VULN-029): auto-save must not be writable by non-owners.
	exists, ownerID, err := h.svc.GetOwnership(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if !exists {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	// 允许 ownerID == nil（VanBlog 导入的遗留文章 author_id 为 NULL）：
	// 由 AssertOwnership 决定——admin 放行，非 admin 返回 403。
	if err := middleware.AssertOwnership(c, ownerID); err != nil {
		return err
	}
	var req dto.CreatePostRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if err := h.svc.AutoSave(c.Request().Context(), id, req); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// Delete 处理 DELETE /admin/posts/:id 请求。
// 软删除文章并清除其对应的 Redis 草稿缓存。
// 路径参数 id 为文章 ID。
func (h *PostHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// SECURITY (VULN-029): ownership gate before soft delete.
	exists, ownerID, err := h.svc.GetOwnership(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if !exists {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	// 允许 ownerID == nil（VanBlog 导入的遗留文章 author_id 为 NULL）：
	// 由 AssertOwnership 决定——admin 放行，非 admin 返回 403。
	if err := middleware.AssertOwnership(c, ownerID); err != nil {
		return err
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}

	// 记录删除文章活动
	h.recordPostActivity(c, "post.delete", fmt.Sprintf("删除文章 #%d", id), fmt.Sprintf("文章 #%d 已删除", id))

	return response.OKEmpty(c)
}

// Publish 处理 PATCH /admin/posts/:id/publish 请求。
// 将文章状态设置为 PUBLISHED 并记录发布时间。
// 路径参数 id 为文章 ID。
func (h *PostHandler) Publish(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	// SECURITY (VULN-029): ownership gate before publish.
	exists, ownerID, err := h.svc.GetOwnership(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if !exists {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	// 允许 ownerID == nil（VanBlog 导入的遗留文章 author_id 为 NULL）：
	// 由 AssertOwnership 决定——admin 放行，非 admin 返回 403。
	if err := middleware.AssertOwnership(c, ownerID); err != nil {
		return err
	}
	if err := h.svc.Publish(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}

	// 记录发布文章活动
	h.recordPostActivity(c, "post.publish", fmt.Sprintf("发布文章 #%d", id), fmt.Sprintf("文章 #%d 已发布", id))

	return response.OKEmpty(c)
}

// recordPostActivity 记录文章相关活动事件，失败时仅记录日志不阻塞主流程。
func (h *PostHandler) recordPostActivity(c echo.Context, eventType, title, description string) {
	if h.activitySvc == nil {
		return
	}
	evtCat := "post"
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

// --- 公开端接口 ---

// PublicList 处理 GET /public/posts 请求。
// 返回分页的已发布且可见文章列表，按置顶优先级和发布时间降序排列。
func (h *PostHandler) PublicList(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.GetPublished(c.Request().Context(), p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// PublicGet 处理 GET /public/posts/:slug 请求。
// 返回文章详情并异步递增浏览计数。
// 若文章设有密码保护，则返回不含正文内容的占位响应（passwordRequired=true）。
// 路径参数 slug 为文章 URL 别名。
func (h *PostHandler) PublicGet(c echo.Context) error {
	slug := c.Param("slug")
	post, err := h.svc.GetPublicBySlug(c.Request().Context(), slug, "")
	if err != nil {
		return response.Error(c, err)
	}
	if post == nil {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	// 仅对无密码保护的文章异步递增浏览量，避免阻塞响应
	if !post.PasswordRequired {
		go h.svc.IncrementViewCount(context.Background(), post.ID)
	}
	return response.OK(c, post)
}

// VerifyPassword 处理 POST /public/posts/:slug/verify-password 请求。
// 验证密码保护文章提交的密码，校验通过后返回完整文章内容。
// 路径参数 slug 为文章别名，请求体为 PostPasswordRequest（含 password 字段）。
func (h *PostHandler) VerifyPassword(c echo.Context) error {
	slug := c.Param("slug")
	var req dto.PostPasswordRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	post, err := h.svc.GetPublicBySlug(c.Request().Context(), slug, req.Password)
	if err != nil {
		return response.Error(c, err)
	}
	if post == nil {
		return response.FailWith(c, response.NotFound, "文章不存在")
	}
	// 密码验证失败时 service 返回 PasswordRequired=true
	if post.PasswordRequired {
		return response.FailWith(c, response.Forbidden, "密码错误")
	}
	// 密码正确，异步递增浏览量
	go h.svc.IncrementViewCount(context.Background(), post.ID)
	return response.OK(c, post)
}

// ByCategory 处理 GET /public/posts/category/:categoryId 请求。
// 返回指定分类下的分页文章列表。
// 路径参数 categoryId 为分类数字 ID。
func (h *PostHandler) ByCategory(c echo.Context) error {
	catID, err := strconv.ParseInt(c.Param("categoryId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的分类ID")
	}
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.GetByCategory(c.Request().Context(), catID, p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// ByTag 处理 GET /public/posts/tag/:tagId 请求。
// 返回包含指定标签的分页文章列表。
// 路径参数 tagId 为标签数字 ID。
func (h *PostHandler) ByTag(c echo.Context) error {
	tagID, err := strconv.ParseInt(c.Param("tagId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的标签ID")
	}
	p := pagination.ParseWithDefaults(c, 1, 10)
	pr, err := h.svc.GetByTag(c.Request().Context(), tagID, p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// Adjacent 处理 GET /public/posts/:slug/adjacent 请求。
// 按发布时间返回当前文章的上一篇和下一篇已发布文章，用于前端导航链接渲染。
// 路径参数 slug 为文章别名。
func (h *PostHandler) Adjacent(c echo.Context) error {
	slug := c.Param("slug")
	adj, err := h.svc.GetAdjacentPosts(c.Request().Context(), slug)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, adj)
}

// parseIntDefault 将字符串解析为整数，解析失败时返回默认值 def。
func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// parseFlexibleTime 兼容前端传入的多种日期时间格式，返回对应的 time.Time 指针。
// 支持以下格式：
//   - RFC3339：      "2024-03-15T00:00:00Z" 或 "2024-03-15T00:00:00+08:00"
//   - 无时区 ISO：   "2024-03-15T00:00:00"
//   - 纯日期：       "2024-03-15"
func parseFlexibleTime(s string) *time.Time {
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return &t
		}
	}
	return nil
}
