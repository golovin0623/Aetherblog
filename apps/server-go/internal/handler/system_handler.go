package handler

import (
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// SystemHandler serves miscellaneous system-info endpoints for the admin dashboard.
type SystemHandler struct{}

// NewSystemHandler creates a SystemHandler.
func NewSystemHandler() *SystemHandler { return &SystemHandler{} }

// MountAdmin registers admin system endpoints on g.
func (h *SystemHandler) MountAdmin(g *echo.Group) {
	g.GET("/time", h.ServerTime)
}

// ServerTime handles GET /admin/system/time.
// Returns the server's current time in multiple formats (ISO-8601, RFC3339, timezone, offset).
func (h *SystemHandler) ServerTime(c echo.Context) error {
	now := time.Now()
	_, offsetSec := now.Zone()
	return response.OK(c, map[string]any{
		"timestamp":     now.Format(time.RFC3339Nano), // Java returns ISO-8601 string
		"datetime":      now.Format(time.RFC3339),
		"timezone":      now.Location().String(),
		"offsetSeconds": offsetSec, // Java returns offsetSeconds, not offsetHours
		"offsetHours":   offsetSec / 3600,
	})
}
