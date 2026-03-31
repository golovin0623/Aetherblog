package handler

import (
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// SystemHandler 提供管理后台的杂项系统信息接口。
type SystemHandler struct{}

// NewSystemHandler 创建 SystemHandler 实例。
func NewSystemHandler() *SystemHandler { return &SystemHandler{} }

// MountAdmin 将管理端系统信息路由注册到路由组 g。
func (h *SystemHandler) MountAdmin(g *echo.Group) {
	g.GET("/time", h.ServerTime)
}

// ServerTime 处理 GET /admin/system/time 请求。
// 返回服务端当前时间的多种格式，包括：
//   - timestamp：ISO-8601 纳秒精度字符串（兼容 Java 格式）
//   - datetime：RFC3339 格式时间字符串
//   - timezone：服务器时区名称
//   - offsetSeconds：UTC 偏移秒数（兼容 Java 格式）
//   - offsetHours：UTC 偏移小时数
func (h *SystemHandler) ServerTime(c echo.Context) error {
	now := time.Now()
	_, offsetSec := now.Zone()
	return response.OK(c, map[string]any{
		"timestamp":     now.Format(time.RFC3339Nano), // ISO-8601 纳秒精度，兼容 Java 端格式
		"datetime":      now.Format(time.RFC3339),
		"timezone":      now.Location().String(),
		"offsetSeconds": offsetSec,    // 偏移秒数，兼容 Java 端 offsetSeconds 字段
		"offsetHours":   offsetSec / 3600,
	})
}
