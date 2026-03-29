package ctxutil

import "github.com/labstack/echo/v4"

const TraceIDKey = "traceId"

// TraceID extracts the traceId from the echo context.
// Returns empty string if not set.
func TraceID(c echo.Context) string {
	if v := c.Get(TraceIDKey); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
