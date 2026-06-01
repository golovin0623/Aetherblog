package handler

import (
	"context"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	appmodel "github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

type atlasActivityRecorder interface {
	Create(ctx context.Context, a *appmodel.ActivityEvent) error
}

var allowedAtlasTelemetryEvents = map[string]bool{
	"atlas.search":                    true,
	"atlas.graph_search":              true,
	"atlas.aetherhub_atlas_answer":    true,
	"atlas.aetherhub_answer_citation": true,
}

type recordAtlasEventRequest struct {
	EventType   string  `json:"eventType"`
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Status      *string `json:"status,omitempty"`
}

type AtlasEventHandler struct {
	activity atlasActivityRecorder
}

func NewAtlasEventHandler(activity atlasActivityRecorder) *AtlasEventHandler {
	return &AtlasEventHandler{activity: activity}
}

func (h *AtlasEventHandler) Mount(g *echo.Group, write echo.MiddlewareFunc) {
	if write != nil {
		g.POST("/events", h.Record, write)
		return
	}
	g.POST("/events", h.Record)
}

func (h *AtlasEventHandler) Record(c echo.Context) error {
	var req recordAtlasEventRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if !allowedAtlasTelemetryEvents[req.EventType] {
		return response.FailWith(c, response.BadRequest, "无效的 Atlas 事件类型")
	}
	title := "Atlas event"
	if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
		title = strings.TrimSpace(*req.Title)
	}
	description := ""
	if req.Description != nil {
		description = strings.TrimSpace(*req.Description)
	}
	status := "INFO"
	if req.Status != nil {
		status = atlasActivityStatus(*req.Status)
	}
	recordAtlasActivity(h.activity, c, req.EventType, title, description, status)
	return response.OKEmpty(c)
}

func recordAtlasActivity(
	activity atlasActivityRecorder,
	c echo.Context,
	eventType string,
	title string,
	description string,
	status string,
) {
	if activity == nil {
		return
	}
	category := "system"
	desc := truncateActivityText(description, 512)
	st := atlasActivityStatus(status)
	ip := c.RealIP()
	if ip == "" {
		ip = "-"
	}
	err := activity.Create(c.Request().Context(), &appmodel.ActivityEvent{
		EventType:     eventType,
		EventCategory: &category,
		Title:         truncateActivityText(title, 160),
		Description:   &desc,
		UserID:        currentAtlasUserID(c),
		IP:            &ip,
		Status:        &st,
	})
	if err != nil {
		log.Warn().Err(err).Str("event_type", eventType).Msg("atlas activity record failed")
	}
}

func atlasActivityStatus(status string) string {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "SUCCESS":
		return "SUCCESS"
	case "WARNING", "WARN":
		return "WARNING"
	case "ERROR":
		return "ERROR"
	default:
		return "INFO"
	}
}

func truncateActivityText(s string, max int) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}

func atlasInt64PtrText(v *int64) string {
	if v == nil {
		return "null"
	}
	return strconv.FormatInt(*v, 10)
}
