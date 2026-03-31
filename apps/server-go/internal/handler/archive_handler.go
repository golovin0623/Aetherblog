package handler

import (
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// ArchiveHandler serves the public archive endpoints (posts grouped by month).
type ArchiveHandler struct{ svc *service.PostService }

// NewArchiveHandler creates an ArchiveHandler backed by the post service.
func NewArchiveHandler(svc *service.PostService) *ArchiveHandler { return &ArchiveHandler{svc: svc} }

// Mount registers the archive routes under the given public route group.
func (h *ArchiveHandler) Mount(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/stats", h.Stats)
}

// List handles GET /api/v1/public/archives — returns posts grouped by year-month.
func (h *ArchiveHandler) List(c echo.Context) error {
	archives, err := h.svc.GetArchives(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, archives)
}

// Stats handles GET /api/v1/public/archives/stats — returns monthly post counts.
func (h *ArchiveHandler) Stats(c echo.Context) error {
	stats, err := h.svc.GetArchiveStats(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, stats)
}
