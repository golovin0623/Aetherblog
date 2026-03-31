package handler

import (
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// SiteHandler 提供公开的站点信息接口，包括站点元数据、统计数据和作者信息。
type SiteHandler struct {
	settings *service.SiteSettingService
	userRepo *repository.UserRepo
	catRepo  *repository.CategoryRepo
	tagRepo  *repository.TagRepo
	postRepo *repository.PostRepo
}

// NewSiteHandler 创建 SiteHandler 实例。
func NewSiteHandler(
	settings *service.SiteSettingService,
	userRepo *repository.UserRepo,
	catRepo *repository.CategoryRepo,
	tagRepo *repository.TagRepo,
	postRepo *repository.PostRepo,
) *SiteHandler {
	return &SiteHandler{settings: settings, userRepo: userRepo, catRepo: catRepo, tagRepo: tagRepo, postRepo: postRepo}
}

// Mount 将站点信息路由注册到指定的公开路由组。
func (h *SiteHandler) Mount(g *echo.Group) {
	g.GET("/info", h.Info)
	g.GET("/stats", h.Stats)
	g.GET("/author", h.Author)
}

// Info 处理 GET /info 请求。
// 返回站点配置信息，并将管理员用户的个人资料（昵称、头像、简介）合并注入到响应中。
// 本地上传的 Logo 路径会自动添加 /api 前缀以供前端直接访问。
func (h *SiteHandler) Info(c echo.Context) error {
	ctx := c.Request().Context()
	m, err := h.settings.GetAll(ctx)
	if err != nil {
		return response.Error(c, err)
	}
	// 从管理员用户记录中注入作者信息
	if admin, _ := h.userRepo.FindByUsername(ctx, "admin"); admin != nil {
		m["authorName"] = strPtrVal(admin.Nickname)
		m["authorAvatar"] = prefixLocal(strPtrVal(admin.Avatar))
		m["authorBio"] = strPtrVal(admin.Bio)
	}
	m["version"] = "0.1.0"
	// 为本地上传的 Logo 路径添加 /api 前缀
	if logo, ok := m["site_logo"].(string); ok {
		m["site_logo"] = prefixLocal(logo)
	}
	return response.OK(c, m)
}

// Stats 处理 GET /stats 请求。
// 返回站点聚合统计数据，包括分类数量、标签数量和已发布文章总数。
// 评论数和浏览量当前固定返回 0（待后续实现）。
func (h *SiteHandler) Stats(c echo.Context) error {
	ctx := c.Request().Context()
	// 并行查询各统计项（忽略查询错误，降级为 0）
	cats, _ := h.catRepo.FindAll(ctx)
	tags, _ := h.tagRepo.FindAll(ctx)
	postCount, _ := h.postRepo.CountPublished(ctx)
	return response.OK(c, map[string]any{
		"posts":      postCount,
		"categories": len(cats),
		"tags":       len(tags),
		"comments":   0, // 评论功能待实现
		"views":      0, // 总浏览量待实现
	})
}

// Author 处理 GET /author 请求。
// 返回 author 分组的站点配置，并将管理员用户的个人资料合并注入到响应中。
func (h *SiteHandler) Author(c echo.Context) error {
	ctx := c.Request().Context()
	m, err := h.settings.GetByGroup(ctx, "author")
	if err != nil {
		return response.Error(c, err)
	}
	// 从管理员用户记录中注入作者信息
	if admin, _ := h.userRepo.FindByUsername(ctx, "admin"); admin != nil {
		m["authorName"] = strPtrVal(admin.Nickname)
		m["authorAvatar"] = prefixLocal(strPtrVal(admin.Avatar))
		m["authorBio"] = strPtrVal(admin.Bio)
	}
	return response.OK(c, m)
}

// strPtrVal 安全地解引用字符串指针，nil 时返回空字符串。
func strPtrVal(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// prefixLocal 为以 /uploads 开头的本地路径添加 /api 前缀，
// 使前端可以通过统一的 API 网关地址访问本地上传资源。
// 非本地路径（如外部 URL）保持不变直接返回。
func prefixLocal(s string) string {
	if s != "" && strings.HasPrefix(s, "/uploads") {
		return "/api" + s
	}
	return s
}
