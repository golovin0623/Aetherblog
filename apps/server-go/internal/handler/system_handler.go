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
		"timestamp":   now.UnixMilli(),
		"datetime":    now.Format(time.RFC3339),
		"timezone":    now.Location().String(),
		"offsetHours": offsetSec / 3600,
	})
}
