package handler

import (
	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type ArchiveHandler struct{ svc *service.PostService }

func NewArchiveHandler(svc *service.PostService) *ArchiveHandler { return &ArchiveHandler{svc: svc} }

func (h *ArchiveHandler) Mount(g *echo.Group) {
	g.GET("", h.List)
	g.GET("/stats", h.Stats)
}

// GET /api/v1/public/archives
func (h *ArchiveHandler) List(c echo.Context) error {
	archives, err := h.svc.GetArchives(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, archives)
}

// GET /api/v1/public/archives/stats
func (h *ArchiveHandler) Stats(c echo.Context) error {
	stats, err := h.svc.GetArchiveStats(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, stats)
}
