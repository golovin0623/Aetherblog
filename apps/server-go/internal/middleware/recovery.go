package middleware

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// Recovery returns a middleware that recovers from panics and returns a 500 response.
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
						Timestamp:     0,
						ErrorCategory: "internal_error",
					})
				}
			}()
			return next(c)
		}
	}
}
