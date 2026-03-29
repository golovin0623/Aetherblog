package middleware

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// Recovery returns a middleware that recovers from panics and returns a 500 response
// conforming to the unified R{} contract (with timestamp and traceId).
func Recovery() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			defer func() {
				if r := recover(); r != nil {
					log.Error().
						Interface("panic", r).
						Str("method", c.Request().Method).
						Str("path", c.Request().URL.Path).
						Msg("panic recovered")

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
