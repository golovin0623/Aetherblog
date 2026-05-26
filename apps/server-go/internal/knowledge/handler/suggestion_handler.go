// Atlas Phase 3 — Suggestion REST handler
//
// 路径 (admin.Group("/atlas")):
//   POST   /suggestions                  创建（由 ai-service 回调或 admin demo UI）
//   GET    /suggestions                  列表（kind / status / carrier_id 过滤）
//   GET    /suggestions/:id              读
//   POST   /suggestions/:id/accept       接受 → 落到 KP/Relation + provenance=ai_suggested
//   POST   /suggestions/:id/reject       拒绝 + 写入忽略列表

package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	atlasrepo "github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// SuggestionHandler 处理 /suggestions/*。
type SuggestionHandler struct {
	svc *atlassvc.AISuggestionService
}

// NewSuggestionHandler 创建。
func NewSuggestionHandler(svc *atlassvc.AISuggestionService) *SuggestionHandler {
	return &SuggestionHandler{svc: svc}
}

// Mount 挂到 /atlas 子组。
// 红线 RBAC (PR #724 review fix): mutating routes 套 content.atlas.write。
// accept / reject 也算写操作（会创建 KP/Relation 或写入 ignored 列表）。
func (h *SuggestionHandler) Mount(g *echo.Group, write echo.MiddlewareFunc) {
	g.POST("/suggestions", h.Create, write)
	g.GET("/suggestions", h.List)
	g.GET("/suggestions/:id", h.Get)
	g.POST("/suggestions/:id/accept", h.Accept, write)
	g.POST("/suggestions/:id/reject", h.Reject, write)
}

func (h *SuggestionHandler) Create(c echo.Context) error {
	var req atlasdto.CreateSuggestionRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	authorID := currentAtlasUserID(c)
	out, err := h.svc.Create(c.Request().Context(), atlassvc.CreateSuggestionInput{
		Kind:                 req.Kind,
		CarrierID:            req.CarrierID,
		AnnotationID:         req.AnnotationID,
		FromKPID:             req.FromKPID,
		ToKPID:               req.ToKPID,
		ProposedTitle:        req.ProposedTitle,
		ProposedBody:         req.ProposedBody,
		ProposedKPType:       req.ProposedKPType,
		ProposedRelationType: req.ProposedRelationType,
		ProposedStrength:     req.ProposedStrength,
		ProposedConfidence:   req.ProposedConfidence,
		Rationale:            req.Rationale,
		ModelID:              req.ModelID,
		TokensIn:             req.TokensIn,
		TokensOut:            req.TokensOut,
		CostUSD:              req.CostUSD,
		AuthorID:             authorID,
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toSuggestionResponse(out))
}

func (h *SuggestionHandler) List(c echo.Context) error {
	f := atlasrepo.SuggestionFilter{}
	if v := c.QueryParam("kind"); v != "" {
		f.Kind = &v
	}
	if v := c.QueryParam("status"); v != "" {
		f.Status = &v
	}
	if v := c.QueryParam("carrierId"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.CarrierID = &n
		}
	}
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Limit = n
		}
	}
	list, err := h.svc.List(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	out := make([]atlasdto.SuggestionResponse, len(list))
	for i := range list {
		out[i] = toSuggestionResponse(&list[i])
	}
	return response.OK(c, out)
}

func (h *SuggestionHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	s, err := h.svc.Get(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if s == nil {
		return response.FailWith(c, response.NotFound, "建议不存在")
	}
	return response.OK(c, toSuggestionResponse(s))
}

func (h *SuggestionHandler) Accept(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	userID := currentAtlasUserID(c)
	out, err := h.svc.Accept(c.Request().Context(), id, userID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if out == nil {
		return response.FailWith(c, response.NotFound, "建议不存在")
	}
	return response.OK(c, toSuggestionResponse(out))
}

func (h *SuggestionHandler) Reject(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	lu := middleware.GetLoginUser(c)
	var uid int64
	if lu != nil {
		uid = lu.UserID
	}
	out, err := h.svc.Reject(c.Request().Context(), id, uid)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if out == nil {
		return response.FailWith(c, response.NotFound, "建议不存在")
	}
	return response.OK(c, toSuggestionResponse(out))
}

func toSuggestionResponse(s *atlasmodel.AISuggestion) atlasdto.SuggestionResponse {
	return atlasdto.SuggestionResponse{
		ID:                   s.ID,
		Kind:                 s.Kind,
		CarrierID:            s.CarrierID,
		AnnotationID:         s.AnnotationID,
		FromKPID:             s.FromKPID,
		ToKPID:               s.ToKPID,
		ProposedTitle:        s.ProposedTitle,
		ProposedBody:         s.ProposedBody,
		ProposedKPType:       s.ProposedKPType,
		ProposedRelationType: s.ProposedRelationType,
		ProposedStrength:     s.ProposedStrength,
		ProposedConfidence:   s.ProposedConfidence,
		Rationale:            s.Rationale,
		ModelID:              s.ModelID,
		TokensIn:             s.TokensIn,
		TokensOut:            s.TokensOut,
		CostUSD:              s.CostUSD,
		Status:               s.Status,
		ResolvedKPID:         s.ResolvedKPID,
		ResolvedRelationID:   s.ResolvedRelationID,
		CreatedAt:            s.CreatedAt,
		UpdatedAt:            s.UpdatedAt,
	}
}
