package handler

import (
	"encoding/json"
	"io"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type SiteSettingHandler struct{ svc *service.SiteSettingService }

func NewSiteSettingHandler(svc *service.SiteSettingService) *SiteSettingHandler {
	return &SiteSettingHandler{svc: svc}
}

func (h *SiteSettingHandler) Mount(g *echo.Group) {
	g.GET("", h.GetAll)
	g.GET("/group/:group", h.GetByGroup)
	g.PATCH("/batch", h.BatchUpdate)
	g.GET("/:key", h.GetByKey)
	g.PUT("/:key", h.UpdateByKey)
}

func (h *SiteSettingHandler) GetAll(c echo.Context) error {
	m, err := h.svc.GetAll(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, m)
}

func (h *SiteSettingHandler) GetByGroup(c echo.Context) error {
	group := c.Param("group")
	m, err := h.svc.GetByGroup(c.Request().Context(), group)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, m)
}

func (h *SiteSettingHandler) GetByKey(c echo.Context) error {
	key := c.Param("key")
	val, err := h.svc.GetValue(c.Request().Context(), key)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, val)
}

func (h *SiteSettingHandler) UpdateByKey(c echo.Context) error {
	key := c.Param("key")

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "请求格式错误")
	}

	var val string
	// Try as plain JSON string first: "some value"
	if err := json.Unmarshal(body, &val); err != nil {
		// Try as JSON object: {"value": "some value"}
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
