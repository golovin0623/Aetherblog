package handler

import (
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

type SystemHandler struct{}

func NewSystemHandler() *SystemHandler { return &SystemHandler{} }

func (h *SystemHandler) MountAdmin(g *echo.Group) {
	g.GET("/time", h.ServerTime)
}

// GET /api/v1/admin/system/time
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
