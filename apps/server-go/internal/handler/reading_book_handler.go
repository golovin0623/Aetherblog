package handler

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

const readerAccessCookiePath = "/reader"

// ReadingBookHandler 处理「拟真阅读」相关的 HTTP 接口：
//   - /admin/reading-books   后台管理（生成 / 列表 / 详情 / 删除）
//   - /public/reading-books  前台阅读器只读取
type ReadingBookHandler struct {
	svc         *service.ReadingBookService
	activitySvc *service.ActivityService
	cookieCfg   config.CookieConfig
}

// NewReadingBookHandler 创建 handler。
func NewReadingBookHandler(
	svc *service.ReadingBookService,
	activitySvc *service.ActivityService,
	cookieCfg config.CookieConfig,
) *ReadingBookHandler {
	return &ReadingBookHandler{svc: svc, activitySvc: activitySvc, cookieCfg: cookieCfg}
}

// MountAdmin 注册后台管理路由。
func (h *ReadingBookHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.AdminList)
	g.POST("/generate", h.Generate)
	g.GET("/reader/:slug", h.AdminReaderRedirect)
	g.GET("/slug/:slug", h.AdminGetBySlug)
	g.GET("/:id", h.AdminGet)
	g.DELETE("/:id", h.Delete)
}

// MountPublic 注册前台只读路由。
func (h *ReadingBookHandler) MountPublic(g *echo.Group) {
	g.GET("/:slug", h.PublicGet)
}

// AdminList 处理 GET /admin/reading-books。
func (h *ReadingBookHandler) AdminList(c echo.Context) error {
	f := repository.ReadingBookListFilter{
		Keyword:    c.QueryParam("keyword"),
		SourceType: c.QueryParam("sourceType"),
		Status:     c.QueryParam("status"),
		PageNum:    parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize:   parseIntDefault(c.QueryParam("pageSize"), 20),
	}
	if f.PageNum < 1 {
		f.PageNum = 1
	}
	if f.PageSize < 1 || f.PageSize > 100 {
		f.PageSize = 20
	}
	items, total, err := h.svc.List(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, response.NewPageResult(items, total, f.PageNum, f.PageSize))
}

// Generate 处理 POST /admin/reading-books/generate：导入来源并生成成书缓存。
func (h *ReadingBookHandler) Generate(c echo.Context) error {
	var req dto.GenerateReadingBookRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	lu := middleware.GetLoginUser(c)
	var userID int64
	if lu != nil {
		userID = lu.UserID
	}
	detail, err := h.svc.Generate(c.Request().Context(), req, userID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	h.recordActivity(c, detail.Title)
	return response.OK(c, detail)
}

// AdminGet 处理 GET /admin/reading-books/:id。
func (h *ReadingBookHandler) AdminGet(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	detail, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if detail == nil {
		return response.FailWith(c, response.NotFound, "拟真阅读不存在")
	}
	return response.OK(c, detail)
}

// AdminGetBySlug 处理 GET /admin/reading-books/slug/:slug。
func (h *ReadingBookHandler) AdminGetBySlug(c echo.Context) error {
	slug := c.Param("slug")
	detail, err := h.svc.GetBySlugForAdmin(c.Request().Context(), slug)
	if err != nil {
		return response.Error(c, err)
	}
	if detail == nil {
		return response.FailWith(c, response.NotFound, "拟真阅读不存在或尚未就绪")
	}
	return response.OK(c, detail)
}

// AdminReaderRedirect 先通过 /api 路径认证，再给 /reader SSR 写入短期访问 cookie。
func (h *ReadingBookHandler) AdminReaderRedirect(c echo.Context) error {
	slug := c.Param("slug")
	detail, err := h.svc.GetBySlugForAdmin(c.Request().Context(), slug)
	if err != nil {
		return response.Error(c, err)
	}
	if detail == nil {
		return response.FailWith(c, response.NotFound, "拟真阅读不存在或尚未就绪")
	}
	accessCookie, err := c.Cookie(middleware.AccessTokenCookie)
	if err != nil || accessCookie.Value == "" {
		return response.FailWith(c, response.Unauthorized, "未登录或Token已过期")
	}
	h.setReaderAccessCookie(c, accessCookie.Value)
	return c.Redirect(http.StatusFound, normalizeReaderRedirect(c.QueryParam("redirect"), slug))
}

// Delete 处理 DELETE /admin/reading-books/:id。
func (h *ReadingBookHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// PublicGet 处理 GET /public/reading-books/:slug，供前台 3D 阅读器读取缓存。
func (h *ReadingBookHandler) PublicGet(c echo.Context) error {
	slug := c.Param("slug")
	detail, err := h.svc.GetBySlug(c.Request().Context(), slug)
	if err != nil {
		return response.Error(c, err)
	}
	if detail == nil {
		return response.FailWith(c, response.NotFound, "拟真阅读不存在或尚未就绪")
	}
	return response.OK(c, detail)
}

func (h *ReadingBookHandler) setReaderAccessCookie(c echo.Context, token string) {
	cookie := &http.Cookie{
		Name:     middleware.AccessTokenCookie,
		Value:    token,
		Path:     readerAccessCookiePath,
		MaxAge:   300,
		HttpOnly: true,
		Secure:   h.cookieCfg.Secure,
		SameSite: parseCookieSameSite(h.cookieCfg.SameSite),
	}
	c.SetCookie(cookie)
}

func parseCookieSameSite(value string) http.SameSite {
	switch value {
	case "Strict":
		return http.SameSiteStrictMode
	case "Lax":
		return http.SameSiteLaxMode
	case "None":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteStrictMode
	}
}

func normalizeReaderRedirect(raw, slug string) string {
	fallback := "/reader/" + url.PathEscape(slug)
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.HasPrefix(raw, "//") {
		return fallback
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fallback
	}
	if u.IsAbs() {
		if u.Scheme != "http" && u.Scheme != "https" {
			return fallback
		}
		if !strings.HasPrefix(u.EscapedPath(), "/reader/") {
			return fallback
		}
		return u.String()
	}
	if strings.HasPrefix(u.EscapedPath(), "/reader/") {
		return u.String()
	}
	return fallback
}

// recordActivity 记录生成活动，失败仅告警不阻塞主流程。
func (h *ReadingBookHandler) recordActivity(c echo.Context, title string) {
	if h.activitySvc == nil {
		return
	}
	evtCat := "reading_book"
	evtStatus := "SUCCESS"
	desc := "生成拟真阅读: " + title
	var userID *int64
	if lu := middleware.GetLoginUser(c); lu != nil {
		userID = &lu.UserID
	}
	if err := h.activitySvc.Create(c.Request().Context(), &model.ActivityEvent{
		EventType:     "reading_book.generate",
		EventCategory: &evtCat,
		Title:         desc,
		Description:   &desc,
		UserID:        userID,
		Status:        &evtStatus,
	}); err != nil {
		log.Warn().Err(err).Msg("record reading_book activity failed")
	}
}
