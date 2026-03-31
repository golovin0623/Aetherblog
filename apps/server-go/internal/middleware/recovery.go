package middleware

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// Recovery 返回一个 panic 恢复中间件。
//
// 当请求处理链中发生 panic 时，该中间件会捕获异常、记录结构化错误日志，
// 并向客户端返回符合统一 R{} 响应契约的 500 内部服务器错误（包含 timestamp 和 traceId）。
// 使用该中间件可避免单个请求的 panic 导致整个服务进程崩溃。
func Recovery() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// 使用 defer + recover 捕获后续处理链中的所有 panic
			defer func() {
				if r := recover(); r != nil {
					// 记录包含 panic 值、HTTP 方法和请求路径的结构化错误日志
					log.Error().
						Interface("panic", r).
						Str("method", c.Request().Method).
						Str("path", c.Request().URL.Path).
						Msg("panic recovered")

					// 返回统一格式的 500 响应，包含时间戳和追踪 ID 以便排查问题
					_ = c.JSON(http.StatusInternalServerError, response.R{
						Code:          500,
						Message:       "服务器内部错误",
						Timestamp:     time.Now().UnixMilli(),
						TraceID:       ctxutil.TraceID(c),
						ErrorCategory: "internal_error",
					})
				}
			}()
			return next(c)
		}
	}
}
