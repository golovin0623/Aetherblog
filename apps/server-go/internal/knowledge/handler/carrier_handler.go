// Atlas — carrier_handler
//
// 路径 (admin.Group("/atlas")):
//   POST /carriers/markdown       懒创建/返回 markdown 类型 carrier
//   GET  /carriers/:id            读 carrier 详情

package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// CarrierHandler 处理 /carriers/*。
type CarrierHandler struct {
	atlas *atlassvc.AtlasService
}

// NewCarrierHandler 创建。
func NewCarrierHandler(svc *atlassvc.AtlasService) *CarrierHandler {
	return &CarrierHandler{atlas: svc}
}

// Mount 挂载到 /atlas 子组。
// 红线 RBAC (PR #724 review fix): POST 需 content.atlas.write，由 server.go 传入。
func (h *CarrierHandler) Mount(g *echo.Group, write echo.MiddlewareFunc) {
	g.POST("/carriers/markdown", h.EnsureMarkdown, write)
	g.GET("/carriers/:id", h.Get)
}

// EnsureMarkdown 懒创建 / 返回 markdown 类型 carrier。
func (h *CarrierHandler) EnsureMarkdown(c echo.Context) error {
	var req atlasdto.EnsureMarkdownCarrierRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	md := h.atlas.Markdown()
	if md == nil {
		return response.FailWith(c, response.InternalError, "markdown carrier service 未配置")
	}
	carrier, err := md.GetOrCreateForNote(c.Request().Context(), req.NoteID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toCarrierResponse(carrier))
}

// Get 返回 carrier 详情。
func (h *CarrierHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	carrier, err := h.atlas.Carriers().FindByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if carrier == nil {
		return response.FailWith(c, response.NotFound, "载体不存在")
	}
	return response.OK(c, toCarrierResponse(carrier))
}

func toCarrierResponse(c *atlasmodel.Carrier) atlasdto.CarrierResponse {
	return atlasdto.CarrierResponse{
		ID:            c.ID,
		Type:          c.Type,
		SourceURI:     c.SourceURI,
		ContentHash:   c.ContentHash,
		Title:         c.Title,
		Author:        c.Author,
		Language:      c.Language,
		Metadata:      c.Metadata,
		OwnerID:       c.OwnerID,
		Status:        c.Status,
		StatusMessage: c.StatusMessage,
		CreatedAt:     c.CreatedAt,
		UpdatedAt:     c.UpdatedAt,
	}
}
