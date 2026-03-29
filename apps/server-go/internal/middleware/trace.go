package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
)

// Trace returns a middleware that propagates a traceId through request/response
// and logs request completion with structured fields.
func Trace() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			traceId := c.Request().Header.Get("X-Request-ID")
			if traceId == "" {
				b := make([]byte, 16)
				_, _ = rand.Read(b)
				traceId = hex.EncodeToString(b)
			}

			c.Set(ctxutil.TraceIDKey, traceId)
			c.Response().Header().Set("X-Request-ID", traceId)

			start := time.Now()
			err := next(c)
			latency := time.Since(start)

			req := c.Request()
			res := c.Response()

			event := log.Info()
			if res.Status >= 500 {
				event = log.Error()
			} else if res.Status >= 400 {
				event = log.Warn()
			}

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
