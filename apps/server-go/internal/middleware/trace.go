package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
)

// isHealthProbePath 判断 URL 是否属于高频健康探活 / 自检路径。
// 这类请求在正常状态下没有排查价值，默认降为 Debug 级别；
// 一旦 4xx/5xx 上面的判断会盖过去，仍然走 Warn/Error 写访问日志。
func isHealthProbePath(p string) bool {
	switch p {
	case "/api/actuator/health",
		"/api/v1/admin/system/health",
		"/api/v1/admin/system/metrics":
		return true
	}
	// 兜底：命中 /health / /ready 结尾的探活路径（AI 代理自身、子服务回探等）
	return strings.HasSuffix(p, "/health") || strings.HasSuffix(p, "/ready")
}

// Trace 返回一个请求追踪中间件。
//
// 该中间件负责以下工作：
//  1. 从请求头 X-Request-ID 读取追踪 ID；若不存在，则生成一个 16 字节的随机十六进制字符串。
//  2. 将追踪 ID 存入 Echo 上下文，供后续处理链通过 ctxutil.TraceID(c) 读取。
//  3. 将追踪 ID 写入响应头 X-Request-ID，便于客户端关联请求与响应。
//  4. 请求完成后，以结构化日志记录追踪 ID、HTTP 方法、路径、状态码、耗时（毫秒）及客户端 IP。
//     日志级别根据响应状态码自动调整：5xx 为 Error，4xx 为 Warn，其余为 Info。
func Trace() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// 优先使用客户端传入的 X-Request-ID 以支持跨服务链路追踪
			traceId := c.Request().Header.Get("X-Request-ID")
			if traceId == "" {
				// 未提供时自动生成 16 字节随机 ID（32 位十六进制字符串）
				b := make([]byte, 16)
				_, _ = rand.Read(b)
				traceId = hex.EncodeToString(b)
			}

			// 将追踪 ID 注入 Echo 上下文，供下游处理器和日志使用
			c.Set(ctxutil.TraceIDKey, traceId)
			// 将追踪 ID 写入响应头，方便客户端及 API 网关做链路关联
			c.Response().Header().Set("X-Request-ID", traceId)

			// 记录请求开始时间，用于计算处理耗时
			start := time.Now()
			err := next(c)
			latency := time.Since(start)

			req := c.Request()
			res := c.Response()

			// 根据 HTTP 状态码选择日志级别：5xx 错误、4xx 警告、其余信息。
			// 健康探活 / liveness 路径（docker healthcheck 每 3s 调一次、
			// SystemMonitor 巡检 /api/v1/admin/system/health 等）量级非常大，
			// 成功时降到 Debug 避免把正常业务日志淹没；失败仍按状态码正常告警。
			event := log.Info()
			if res.Status >= 500 {
				event = log.Error()
			} else if res.Status >= 400 {
				event = log.Warn()
			} else if isHealthProbePath(req.URL.Path) {
				event = log.Debug()
			}

			// 输出结构化访问日志，包含追踪 ID、方法、路径、状态码、耗时和客户端 IP
			event.
				Str("traceId", traceId).
				Str("method", req.Method).
				Str("path", req.URL.Path).
				Int("status", res.Status).
				Int64("latency_ms", latency.Milliseconds()).
				Str("ip", c.RealIP()).
				Msg("request")

			return err
		}
	}
}
