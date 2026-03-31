package handler

import (
	"encoding/json"
	"io"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// SiteSettingHandler 处理站点设置的管理端 CRUD 接口。
type SiteSettingHandler struct{ svc *service.SiteSettingService }

// NewSiteSettingHandler 创建 SiteSettingHandler 实例。
func NewSiteSettingHandler(svc *service.SiteSettingService) *SiteSettingHandler {
	return &SiteSettingHandler{svc: svc}
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
	return response.OKEmpty(c)
}

// BatchUpdate 处理 PATCH /admin/settings/batch 请求。
// 批量更新多个站点配置项，请求体为键值对映射 map[string]string。
func (h *SiteSettingHandler) BatchUpdate(c echo.Context) error {
	var kv map[string]string
	if err := c.Bind(&kv); err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}
	if err := h.svc.SetBatch(c.Request().Context(), kv); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}
