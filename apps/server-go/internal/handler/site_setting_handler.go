package handler

import (
	"encoding/json"
	"io"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// allowedSettingKeys 定义允许通过 API 读写的站点配置键白名单。
// 新增配置项时需在此处同步添加对应的键名。
var allowedSettingKeys = map[string]bool{
	// general
	"site_name": true, "site_description": true, "site_url": true,
	"site_logo": true, "site_favicon": true, "site_keywords": true,
	"footer_text": true, "footer_signature": true,
	"icp_number": true,
	"welcome_enabled": true, "welcome_title": true, "welcome_subtitle": true,
	// author
	"author_name": true, "author_avatar": true, "author_bio": true,
	"author_github": true, "author_twitter": true, "author_email": true,
	"social_links": true,
	// comment
	"comment_enabled": true, "comment_audit": true,
	// storage
	"storage_type": true,
	// ai
	"ai_enabled": true, "ai_provider": true,
	// appearance
	"theme_primary_color": true, "enable_dark_mode": true,
	"show_banner": true, "post_page_size": true, "custom_css": true,
	"font_family": true, "theme_primary_color_light": true, "theme_primary_color_dark": true,
	// seo
	"seo_robots": true, "enable_sitemap": true,
	"baidu_analytics_id": true, "google_analytics_id": true,
	// social
	"social_github": true, "social_twitter": true,
	"social_linkedin": true, "social_weibo": true,
	// advanced
	"enable_registrations": true, "upload_max_size": true,
}

// SiteSettingHandler 处理站点设置的管理端 CRUD 接口。
type SiteSettingHandler struct {
	svc         *service.SiteSettingService
	activitySvc *service.ActivityService
}

// NewSiteSettingHandler 创建 SiteSettingHandler 实例。
func NewSiteSettingHandler(svc *service.SiteSettingService, activitySvc *service.ActivityService) *SiteSettingHandler {
	return &SiteSettingHandler{svc: svc, activitySvc: activitySvc}
}

// Mount 将站点设置路由注册到指定的管理员路由组。
func (h *SiteSettingHandler) Mount(g *echo.Group) {
	g.GET("", h.GetAll)
	g.GET("/group/:group", h.GetByGroup)
	g.PATCH("/batch", h.BatchUpdate)
	g.GET("/:key", h.GetByKey)
	g.PUT("/:key", h.UpdateByKey)
}

// GetAll 处理 GET /admin/settings 请求。
// 返回所有站点配置项的键值映射。
func (h *SiteSettingHandler) GetAll(c echo.Context) error {
	m, err := h.svc.GetAll(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, m)
}

// GetByGroup 处理 GET /admin/settings/group/:group 请求。
// 返回指定分组（如 "author"、"seo" 等）下的所有配置项。
// 路径参数 group 为配置分组名称。
func (h *SiteSettingHandler) GetByGroup(c echo.Context) error {
	group := c.Param("group")
	m, err := h.svc.GetByGroup(c.Request().Context(), group)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, m)
}

// GetByKey 处理 GET /admin/settings/:key 请求。
// 返回指定 key 对应的单个配置值。
// 路径参数 key 为配置项的键名。
func (h *SiteSettingHandler) GetByKey(c echo.Context) error {
	key := c.Param("key")
	if !allowedSettingKeys[key] {
		return response.FailWith(c, response.BadRequest, "无效的设置键")
	}
	val, err := h.svc.GetValue(c.Request().Context(), key)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, val)
}

// UpdateByKey 处理 PUT /admin/settings/:key 请求。
// 更新指定 key 对应的配置值。
// 请求体兼容两种格式：
//   - 纯 JSON 字符串：  "some value"
//   - JSON 对象：       {"value": "some value"}
func (h *SiteSettingHandler) UpdateByKey(c echo.Context) error {
	key := c.Param("key")
	if !allowedSettingKeys[key] {
		return response.FailWith(c, response.BadRequest, "无效的设置键")
	}

	// 读取原始请求体以支持多种传参格式
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}

	var val string
	// 优先尝试解析为纯 JSON 字符串格式："some value"
	if err := json.Unmarshal(body, &val); err != nil {
		// 降级尝试解析为 JSON 对象格式：{"value": "some value"}
		var obj map[string]string
		if err2 := json.Unmarshal(body, &obj); err2 != nil {
			return response.FailWith(c, response.BadRequest, "请求格式错误")
		}
		val = obj["value"]
	}

	if err := h.svc.SetValue(c.Request().Context(), key, val); err != nil {
		return response.Error(c, err)
	}

	// 记录更新设置活动
	h.recordSettingActivity(c, "更新系统设置: "+key)

	return response.OKEmpty(c)
}

// BatchUpdate 处理 PATCH /admin/settings/batch 请求。
// 批量更新多个站点配置项，请求体为键值对映射 map[string]string。
func (h *SiteSettingHandler) BatchUpdate(c echo.Context) error {
	var kv map[string]string
	if err := c.Bind(&kv); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	// 过滤掉不在白名单中的键
	for k := range kv {
		if !allowedSettingKeys[k] {
			delete(kv, k)
		}
	}
	if err := h.svc.SetBatch(c.Request().Context(), kv); err != nil {
		return response.Error(c, err)
	}

	// 记录批量更新设置活动
	h.recordSettingActivity(c, "批量更新系统设置")

	return response.OKEmpty(c)
}

// recordSettingActivity 记录系统设置相关活动事件，失败时仅记录日志不阻塞主流程。
func (h *SiteSettingHandler) recordSettingActivity(c echo.Context, title string) {
	if h.activitySvc == nil {
		return
	}
	evtCat := "system"
	evtStatus := "SUCCESS"
	var userID *int64
	if lu := middleware.GetLoginUser(c); lu != nil {
		userID = &lu.UserID
	}
	if err := h.activitySvc.Create(c.Request().Context(), &model.ActivityEvent{
		EventType:     "system.setting_update",
		EventCategory: &evtCat,
		Title:         title,
		UserID:        userID,
		Status:        &evtStatus,
	}); err != nil {
		log.Warn().Err(err).Msg("record activity failed")
	}
}
