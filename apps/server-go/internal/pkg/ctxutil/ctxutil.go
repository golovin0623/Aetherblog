// Package ctxutil 提供对 Echo 请求上下文中通用字段的存取工具函数。
package ctxutil

import "github.com/labstack/echo/v4"

// TraceIDKey 是在 Echo 上下文中存储链路追踪 ID 的键名。
const TraceIDKey = "traceId"

// TraceID 从 Echo 上下文中提取链路追踪 ID（traceId）。
// 若上下文中未设置该值，则返回空字符串。
func TraceID(c echo.Context) string {
	if v := c.Get(TraceIDKey); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
