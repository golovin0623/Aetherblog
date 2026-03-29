package handler

import (
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type SiteHandler struct {
	settings *service.SiteSettingService
	userRepo *repository.UserRepo
	catRepo  *repository.CategoryRepo
	tagRepo  *repository.TagRepo
	postRepo *repository.PostRepo
}

func NewSiteHandler(
	settings *service.SiteSettingService,
	userRepo *repository.UserRepo,
	catRepo *repository.CategoryRepo,
	tagRepo *repository.TagRepo,
	postRepo *repository.PostRepo,
) *SiteHandler {
	return &SiteHandler{settings: settings, userRepo: userRepo, catRepo: catRepo, tagRepo: tagRepo, postRepo: postRepo}
}

func (h *SiteHandler) Mount(g *echo.Group) {
	g.GET("/info", h.Info)
	g.GET("/stats", h.Stats)
	g.GET("/author", h.Author)
}

func (h *SiteHandler) Info(c echo.Context) error {
	ctx := c.Request().Context()
	m, err := h.settings.GetAll(ctx)
	if err != nil {
		return response.Error(c, err)
	}
	// Inject author info from admin user
	if admin, _ := h.userRepo.FindByUsername(ctx, "admin"); admin != nil {
		m["authorName"] = strPtrVal(admin.Nickname)
		m["authorAvatar"] = prefixLocal(strPtrVal(admin.Avatar))
		m["authorBio"] = strPtrVal(admin.Bio)
	}
	m["version"] = "0.1.0"
	// Prefix local logo paths
	if logo, ok := m["site_logo"].(string); ok {
		m["site_logo"] = prefixLocal(logo)
	}
	return response.OK(c, m)
}

func (h *SiteHandler) Stats(c echo.Context) error {
	ctx := c.Request().Context()
	cats, _ := h.catRepo.FindAll(ctx)
	tags, _ := h.tagRepo.FindAll(ctx)
	postCount, _ := h.postRepo.CountPublished(ctx)
	return response.OK(c, map[string]any{
		"posts":      postCount,
		"categories": len(cats),
		"tags":       len(tags),
		"comments":   0,
		"views":      0,
	})
}

func (h *SiteHandler) Author(c echo.Context) error {
	ctx := c.Request().Context()
	m, err := h.settings.GetByGroup(ctx, "author")
	if err != nil {
		return response.Error(c, err)
	}
	if admin, _ := h.userRepo.FindByUsername(ctx, "admin"); admin != nil {
		m["authorName"] = strPtrVal(admin.Nickname)
		m["authorAvatar"] = prefixLocal(strPtrVal(admin.Avatar))
		m["authorBio"] = strPtrVal(admin.Bio)
	}
	return response.OK(c, m)
}

func strPtrVal(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func prefixLocal(s string) string {
	if s != "" && strings.HasPrefix(s, "/uploads") {
		return "/api" + s
	}
	return s
}
