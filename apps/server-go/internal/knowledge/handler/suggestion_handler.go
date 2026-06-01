// Atlas Phase 3 — Suggestion REST handler
//
// 路径 (/v1/admin/atlas, RBAC + AtlasScopeMiddleware):
//   POST   /suggestions                  创建（由 ai-service 回调或 admin demo UI）
//   GET    /suggestions                  列表（kind / status / carrier_id 过滤）
//   GET    /suggestions/:id              读
//   POST   /suggestions/:id/accept       接受 → 落到 KP/Relation + provenance=ai_suggested
//   POST   /suggestions/:id/reject       拒绝 + 写入忽略列表

package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/pkg/anchoring"
	atlasrepo "github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	coresvc "github.com/golovin0623/aetherblog-server/internal/service"
)

type atlasAISyncClient interface {
	DoSync(ctx context.Context, method, path string, body io.Reader, headers map[string]string) (io.ReadCloser, int, error)
}

// SuggestionHandler 处理 /suggestions/*。
type SuggestionHandler struct {
	svc           *atlassvc.AISuggestionService
	kp            *atlassvc.KnowledgePointService
	ann           *atlassvc.AnnotationService
	atlas         *atlassvc.AtlasService
	ai            atlasAISyncClient
	internalToken string
	activity      atlasActivityRecorder
}

// NewSuggestionHandler 创建。
func NewSuggestionHandler(
	svc *atlassvc.AISuggestionService,
	kp *atlassvc.KnowledgePointService,
	ann *atlassvc.AnnotationService,
	atlas *atlassvc.AtlasService,
	ai *coresvc.AIClient,
	internalToken string,
	activity atlasActivityRecorder,
) *SuggestionHandler {
	return &SuggestionHandler{
		svc:           svc,
		kp:            kp,
		ann:           ann,
		atlas:         atlas,
		ai:            ai,
		internalToken: internalToken,
		activity:      activity,
	}
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
	g.POST("/carriers/:id/suggestions/preview", h.PreviewCarrierSuggestions, write)
	g.POST("/carriers/:id/suggestions", h.GenerateCarrierSuggestions, write)
	g.POST("/annotations/:id/suggestions", h.GenerateAnnotationSuggestions, write)
	g.POST("/knowledge-points/:id/relation-suggestions", h.GenerateRelationSuggestion, write)
}

func (h *SuggestionHandler) Create(c echo.Context) error {
	var req atlasdto.CreateSuggestionRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if err := h.assertSuggestionSourceScope(c, req.CarrierID, req.AnnotationID, req.FromKPID, req.ToKPID); err != nil {
		return writeAtlasError(c, err)
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
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	f := atlasrepo.SuggestionFilter{}
	authorID, err := scope.authorFilter(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	f.AuthorID = authorID
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
		return err
	}
	if s == nil {
		return response.FailWith(c, response.NotFound, "建议不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if !scope.canAccessAuthor(s.AuthorID) {
		return response.FailWith(c, response.Forbidden, "无权访问该建议")
	}
	return response.OK(c, toSuggestionResponse(s))
}

func (h *SuggestionHandler) Accept(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if err := h.assertSuggestionScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	userID := currentAtlasUserID(c)
	out, err := h.svc.Accept(c.Request().Context(), id, userID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if out == nil {
		return response.FailWith(c, response.NotFound, "建议不存在")
	}
	if out.ResolvedKPID != nil {
		h.kp.ScheduleEmbedding(c.Request().Context(), *out.ResolvedKPID, userID, "suggestion_accept")
	}
	recordAtlasActivity(
		h.activity,
		c,
		"atlas.suggestion_accept",
		"接受 Atlas AI 建议",
		fmt.Sprintf("suggestion_id=%d kind=%s resolved_kp_id=%s resolved_relation_id=%s", out.ID, out.Kind, atlasInt64PtrText(out.ResolvedKPID), atlasInt64PtrText(out.ResolvedRelationID)),
		"SUCCESS",
	)
	return response.OK(c, toSuggestionResponse(out))
}

func (h *SuggestionHandler) Reject(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if err := h.assertSuggestionScope(c, id); err != nil {
		return writeAtlasError(c, err)
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
	recordAtlasActivity(
		h.activity,
		c,
		"atlas.suggestion_reject",
		"拒绝 Atlas AI 建议",
		fmt.Sprintf("suggestion_id=%d kind=%s", out.ID, out.Kind),
		"SUCCESS",
	)
	return response.OK(c, toSuggestionResponse(out))
}

func (h *SuggestionHandler) GenerateAnnotationSuggestions(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的标注 ID")
	}
	var req atlasdto.GenerateAnnotationSuggestionsRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if req.MaxCandidates <= 0 {
		req.MaxCandidates = 3
	}
	if req.MaxCandidates > 10 {
		req.MaxCandidates = 10
	}
	if err := h.assertAnnotationScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	annotation, err := h.ann.Get(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if annotation == nil {
		return response.FailWith(c, response.NotFound, "标注不存在")
	}
	text := annotationTextForSuggestion(annotation)
	if len([]rune(text)) < 10 {
		return response.FailWith(c, response.BadRequest, "标注文本过短，无法生成 AI 建议")
	}

	var aiOut atlasExtractClaimsResponse
	if err := h.callAtlasAI(c, "/api/v1/atlas/claims/extract", map[string]any{
		"carrier_id":     annotation.CarrierID,
		"text":           truncateRunes(text, 4000),
		"max_candidates": req.MaxCandidates,
		"model_id":       req.ModelID,
		"user_id":        currentAtlasUserID(c),
	}, &aiOut); err != nil {
		return response.FailWith(c, response.InternalError, err.Error())
	}

	authorID := currentAtlasUserID(c)
	out := make([]atlasdto.SuggestionResponse, 0, len(aiOut.Candidates))
	for _, candidate := range aiOut.Candidates {
		title := strings.TrimSpace(candidate.ProposedTitle)
		if title == "" {
			continue
		}
		body := stringPtrOrNil(candidate.ProposedBody)
		kpType := stringPtrOrNil(candidate.ProposedKPType)
		rationale := stringPtrOrNil(candidate.Rationale)
		modelID := stringPtrOrNil(aiOut.ModelID)
		created, err := h.svc.Create(c.Request().Context(), atlassvc.CreateSuggestionInput{
			Kind:               "kp",
			CarrierID:          &annotation.CarrierID,
			AnnotationID:       &annotation.ID,
			ProposedTitle:      &title,
			ProposedBody:       body,
			ProposedKPType:     kpType,
			ProposedConfidence: candidate.ProposedConfidence,
			Rationale:          rationale,
			ModelID:            modelID,
			TokensIn:           candidate.TokensIn,
			TokensOut:          candidate.TokensOut,
			CostUSD:            candidate.CostUSD,
			AuthorID:           authorID,
		})
		if err != nil {
			if errors.Is(err, atlassvc.ErrSuggestionIgnored) {
				continue
			}
			return response.FailWith(c, response.BadRequest, err.Error())
		}
		out = append(out, toSuggestionResponse(created))
	}
	recordAtlasActivity(
		h.activity,
		c,
		"atlas.suggestion_generate",
		"生成 Atlas KP 建议",
		fmt.Sprintf("annotation_id=%d count=%d model=%s structured=%t", annotation.ID, len(out), aiOut.ModelID, aiOut.Structured),
		"SUCCESS",
	)
	return response.OK(c, out)
}

func (h *SuggestionHandler) GenerateCarrierSuggestions(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的载体 ID")
	}
	var req atlasdto.GenerateCarrierSuggestionsRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	maxCandidates, maxChars := normalizeCarrierSuggestionRequest(&req)
	if req.MaxCostUSD != nil && *req.MaxCostUSD < 0 {
		return response.FailWith(c, response.BadRequest, "maxCostUsd 不能为负数")
	}
	if err := h.assertCarrierScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	if h.atlas == nil || h.atlas.Carriers() == nil {
		return response.FailWith(c, response.InternalError, "Atlas carrier 服务未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	carrier, err := h.atlas.Carriers().FindByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if carrier == nil {
		return response.FailWith(c, response.NotFound, "载体不存在")
	}
	text, err := h.carrierTextForSuggestion(c.Request().Context(), scope, carrier)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if len([]rune(text)) < 10 {
		return response.FailWith(c, response.BadRequest, "载体文本过短，无法生成 AI 建议")
	}

	truncated := truncateRunes(text, maxChars)
	var aiOut atlasExtractClaimsResponse
	if err := h.callAtlasAI(c, "/api/v1/atlas/claims/extract", carrierSuggestionAIPayload(carrier.ID, truncated, maxCandidates, currentAtlasUserID(c), &req), &aiOut); err != nil {
		if isAtlasAIBudgetError(err) {
			return response.FailWith(c, response.BadRequest, "预算阈值不足，已阻止本次 AI 建议生成")
		}
		return response.FailWith(c, response.InternalError, err.Error())
	}

	authorID := currentAtlasUserID(c)
	out := make([]atlasdto.SuggestionResponse, 0, len(aiOut.Candidates))
	for _, candidate := range aiOut.Candidates {
		title := strings.TrimSpace(candidate.ProposedTitle)
		if title == "" {
			continue
		}
		created, err := h.svc.Create(c.Request().Context(), atlassvc.CreateSuggestionInput{
			Kind:               "kp",
			CarrierID:          &carrier.ID,
			ProposedTitle:      &title,
			ProposedBody:       stringPtrOrNil(candidate.ProposedBody),
			ProposedKPType:     stringPtrOrNil(candidate.ProposedKPType),
			ProposedConfidence: candidate.ProposedConfidence,
			Rationale:          stringPtrOrNil(candidate.Rationale),
			ModelID:            stringPtrOrNil(aiOut.ModelID),
			TokensIn:           candidate.TokensIn,
			TokensOut:          candidate.TokensOut,
			CostUSD:            candidate.CostUSD,
			AuthorID:           authorID,
		})
		if err != nil {
			if errors.Is(err, atlassvc.ErrSuggestionIgnored) {
				continue
			}
			return response.FailWith(c, response.BadRequest, err.Error())
		}
		out = append(out, toSuggestionResponse(created))
	}
	recordAtlasActivity(
		h.activity,
		c,
		"atlas.suggestion_generate",
		"从 Atlas 载体生成 KP 建议",
		fmt.Sprintf("carrier_id=%d type=%s count=%d model=%s structured=%t chars=%d/%d", carrier.ID, carrier.Type, len(out), aiOut.ModelID, aiOut.Structured, len([]rune(truncated)), len([]rune(text))),
		"SUCCESS",
	)
	return response.OK(c, out)
}

func (h *SuggestionHandler) PreviewCarrierSuggestions(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的载体 ID")
	}
	var req atlasdto.GenerateCarrierSuggestionsRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	maxCandidates, maxChars := normalizeCarrierSuggestionRequest(&req)
	if req.MaxCostUSD != nil && *req.MaxCostUSD < 0 {
		return response.FailWith(c, response.BadRequest, "maxCostUsd 不能为负数")
	}
	if err := h.assertCarrierScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	if h.atlas == nil || h.atlas.Carriers() == nil {
		return response.FailWith(c, response.InternalError, "Atlas carrier 服务未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	carrier, err := h.atlas.Carriers().FindByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if carrier == nil {
		return response.FailWith(c, response.NotFound, "载体不存在")
	}
	text, err := h.carrierTextForSuggestion(c.Request().Context(), scope, carrier)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if len([]rune(text)) < 10 {
		return response.FailWith(c, response.BadRequest, "载体文本过短，无法预估 AI 建议成本")
	}

	truncated := truncateRunes(text, maxChars)
	var aiOut atlasClaimExtractionCostPreviewResponse
	if err := h.callAtlasAI(c, "/api/v1/atlas/claims/preview", carrierSuggestionPreviewAIPayload(truncated, maxCandidates, currentAtlasUserID(c), &req), &aiOut); err != nil {
		return response.FailWith(c, response.InternalError, err.Error())
	}
	return response.OK(c, atlasdto.CarrierSuggestionCostPreviewResponse{
		CarrierID:          carrier.ID,
		ModelID:            aiOut.ModelID,
		MaxCandidates:      maxCandidates,
		MaxChars:           maxChars,
		SourceChars:        len([]rune(text)),
		TruncatedChars:     len([]rune(truncated)),
		EstimatedTokensIn:  aiOut.EstimatedTokensIn,
		EstimatedTokensOut: aiOut.EstimatedTokensOut,
		EstimatedCostUSD:   aiOut.EstimatedCostUSD,
		MaxCostUSD:         aiOut.MaxCostUSD,
		BudgetExceeded:     aiOut.BudgetExceeded,
		PricingMissing:     aiOut.PricingMissing,
	})
}

func (h *SuggestionHandler) GenerateRelationSuggestion(c echo.Context) error {
	fromID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 KP ID")
	}
	var req atlasdto.GenerateRelationSuggestionRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if req.ToKPID <= 0 {
		return response.FailWith(c, response.BadRequest, "toKpId 不能为空")
	}
	if fromID == req.ToKPID {
		return response.FailWith(c, response.BadRequest, "不允许为同一 KP 生成关系建议")
	}
	if err := h.assertKPScope(c, fromID); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.assertKPScope(c, req.ToKPID); err != nil {
		return writeAtlasError(c, err)
	}
	fromKP, err := h.kp.Get(c.Request().Context(), fromID)
	if err != nil {
		return response.Error(c, err)
	}
	toKP, err := h.kp.Get(c.Request().Context(), req.ToKPID)
	if err != nil {
		return response.Error(c, err)
	}
	if fromKP == nil || toKP == nil {
		return response.FailWith(c, response.NotFound, "KP 不存在")
	}

	var aiOut atlasRelationSuggestionResponse
	if err := h.callAtlasAI(c, "/api/v1/atlas/relations/suggest", map[string]any{
		"from_kp_id": fromKP.ID,
		"to_kp_id":   toKP.ID,
		"from_text":  truncateRunes(kpTextForSuggestion(fromKP), 3000),
		"to_text":    truncateRunes(kpTextForSuggestion(toKP), 3000),
		"model_id":   req.ModelID,
		"user_id":    currentAtlasUserID(c),
	}, &aiOut); err != nil {
		return response.FailWith(c, response.InternalError, err.Error())
	}

	relationType := strings.TrimSpace(aiOut.RelationType)
	created, err := h.svc.Create(c.Request().Context(), atlassvc.CreateSuggestionInput{
		Kind:                 "relation",
		FromKPID:             &fromKP.ID,
		ToKPID:               &toKP.ID,
		ProposedRelationType: &relationType,
		ProposedStrength:     aiOut.Strength,
		Rationale:            stringPtrOrNil(aiOut.Rationale),
		ModelID:              stringPtrOrNil(aiOut.ModelID),
		TokensIn:             aiOut.TokensIn,
		TokensOut:            aiOut.TokensOut,
		CostUSD:              aiOut.CostUSD,
		AuthorID:             currentAtlasUserID(c),
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	recordAtlasActivity(
		h.activity,
		c,
		"atlas.suggestion_generate",
		"生成 Atlas Relation 建议",
		fmt.Sprintf("from_kp_id=%d to_kp_id=%d relation=%s model=%s", fromKP.ID, toKP.ID, relationType, aiOut.ModelID),
		"SUCCESS",
	)
	return response.OK(c, toSuggestionResponse(created))
}

func normalizeCarrierSuggestionRequest(req *atlasdto.GenerateCarrierSuggestionsRequest) (int, int) {
	if req == nil {
		return 8, 12000
	}
	maxCandidates := req.MaxCandidates
	if maxCandidates <= 0 {
		maxCandidates = 8
	}
	if maxCandidates > 20 {
		maxCandidates = 20
	}
	maxChars := req.MaxChars
	if maxChars <= 0 {
		maxChars = 12000
	}
	if maxChars > 40000 {
		maxChars = 40000
	}
	return maxCandidates, maxChars
}

func (h *SuggestionHandler) carrierTextForSuggestion(ctx context.Context, scope *atlasScope, carrier *atlasmodel.Carrier) (string, error) {
	if carrier == nil {
		return "", atlasError(response.NotFound, "载体不存在")
	}
	switch strings.ToLower(strings.TrimSpace(carrier.Type)) {
	case "markdown":
		if h.atlas == nil || h.atlas.Markdown() == nil {
			return "", atlasError(response.InternalError, "Markdown carrier 服务未配置")
		}
		noteID, ok := markdownNoteIDFromCarrierSource(carrier.SourceURI)
		if !ok {
			return "", atlasError(response.BadRequest, "Markdown carrier source_uri 无法解析")
		}
		note, err := h.atlas.Markdown().GetNoteSourceAs(ctx, noteID, scope.UserID, scope.CanAdmin)
		if errors.Is(err, atlassvc.ErrAtlasForbidden) {
			return "", atlasError(response.Forbidden, "无权访问该 Markdown 来源")
		}
		if err != nil {
			return "", err
		}
		text := anchoring.MarkdownToPlaintext(note.Content)
		if strings.TrimSpace(note.Title) != "" {
			text = note.Title + "\n\n" + text
		}
		return strings.TrimSpace(text), nil
	case "pdf":
		if h.atlas == nil || h.atlas.Carriers() == nil {
			return "", atlasError(response.InternalError, "Atlas carrier 服务未配置")
		}
		layer, err := h.atlas.Carriers().FindTextLayerByCarrierAndHash(ctx, carrier.ID, carrier.ContentHash)
		if err != nil {
			return "", err
		}
		if layer == nil || strings.TrimSpace(layer.TextContent) == "" {
			return "", atlasError(response.BadRequest, "PDF 文本层不存在，请先完成文本抽取")
		}
		return strings.TrimSpace(layer.TextContent), nil
	case "blog_post":
		if h.atlas == nil || h.atlas.BlogPosts() == nil {
			return "", atlasError(response.InternalError, "Blog post carrier 服务未配置")
		}
		postID, ok := blogPostIDFromCarrierSource(carrier.SourceURI)
		if !ok {
			return "", atlasError(response.BadRequest, "Blog post carrier source_uri 无法解析")
		}
		post, err := h.atlas.BlogPosts().GetPostSourceAs(ctx, postID, scope.UserID, scope.CanAdmin)
		if errors.Is(err, atlassvc.ErrAtlasForbidden) {
			return "", atlasError(response.Forbidden, "无权访问该文章来源")
		}
		if err != nil {
			return "", err
		}
		return atlassvc.BlogPostText(post), nil
	case "web", "video", "audio", "image":
		if h.atlas == nil || h.atlas.Carriers() == nil {
			return "", atlasError(response.InternalError, "Atlas carrier 服务未配置")
		}
		layer, err := h.atlas.Carriers().FindTextLayerByCarrierAndHash(ctx, carrier.ID, carrier.ContentHash)
		if err != nil {
			return "", err
		}
		if layer == nil || strings.TrimSpace(layer.TextContent) == "" {
			if strings.EqualFold(carrier.Type, "web") {
				return "", atlasError(response.BadRequest, "Web clip 文本层不存在，请先保存网页正文快照")
			}
			if strings.EqualFold(carrier.Type, "image") {
				return "", atlasError(response.BadRequest, "图片描述文本层不存在，请先保存图片描述")
			}
			return "", atlasError(response.BadRequest, "转录文本层不存在，请先保存转录文本")
		}
		return strings.TrimSpace(layer.TextContent), nil
	default:
		return "", atlasError(response.BadRequest, fmt.Sprintf("暂不支持从 %s 载体生成 AI 建议", carrier.Type))
	}
}

func markdownNoteIDFromCarrierSource(sourceURI string) (int64, bool) {
	trimmed := strings.TrimSpace(sourceURI)
	raw := strings.TrimPrefix(trimmed, "notes://")
	if raw == trimmed || strings.TrimSpace(raw) == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func blogPostIDFromCarrierSource(sourceURI string) (int64, bool) {
	trimmed := strings.TrimSpace(sourceURI)
	raw := strings.TrimPrefix(trimmed, "posts://")
	if raw == trimmed || strings.TrimSpace(raw) == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func (h *SuggestionHandler) assertSuggestionScope(c echo.Context, id int64) error {
	s, err := h.svc.Get(c.Request().Context(), id)
	if err != nil {
		return err
	}
	if s == nil {
		return atlasError(response.NotFound, "建议不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return err
	}
	if !scope.canAccessAuthor(s.AuthorID) {
		return atlasError(response.Forbidden, "无权访问该建议")
	}
	return h.assertSuggestionSourceScope(c, s.CarrierID, s.AnnotationID, s.FromKPID, s.ToKPID)
}

func (h *SuggestionHandler) assertSuggestionSourceScope(
	c echo.Context,
	carrierID *int64,
	annotationID *int64,
	fromKPID *int64,
	toKPID *int64,
) error {
	if carrierID != nil {
		if err := h.assertCarrierScope(c, *carrierID); err != nil {
			return err
		}
	}
	if annotationID != nil {
		if err := h.assertAnnotationScope(c, *annotationID); err != nil {
			return err
		}
	}
	if fromKPID != nil {
		if err := h.assertKPScope(c, *fromKPID); err != nil {
			return err
		}
	}
	if toKPID != nil {
		if err := h.assertKPScope(c, *toKPID); err != nil {
			return err
		}
	}
	return nil
}

func (h *SuggestionHandler) assertCarrierScope(c echo.Context, id int64) error {
	if h.atlas == nil || h.atlas.Carriers() == nil {
		return nil
	}
	carrier, err := h.atlas.Carriers().FindByID(c.Request().Context(), id)
	if err != nil {
		return err
	}
	if carrier == nil {
		return atlasError(response.NotFound, "载体不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return err
	}
	if !scope.canAccessOwner(carrier.OwnerID) {
		return atlasError(response.Forbidden, "无权访问该载体")
	}
	return nil
}

func (h *SuggestionHandler) assertAnnotationScope(c echo.Context, id int64) error {
	if h.ann == nil {
		return nil
	}
	a, err := h.ann.Get(c.Request().Context(), id)
	if err != nil {
		return err
	}
	if a == nil {
		return atlasError(response.NotFound, "标注不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return err
	}
	if !scope.canAccessAuthor(a.AuthorID) {
		return atlasError(response.Forbidden, "无权访问该标注")
	}
	return nil
}

func (h *SuggestionHandler) assertKPScope(c echo.Context, id int64) error {
	if h.kp == nil {
		return nil
	}
	k, err := h.kp.Get(c.Request().Context(), id)
	if err != nil {
		return err
	}
	if k == nil {
		return atlasError(response.NotFound, "知识点不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return err
	}
	if !scope.canAccessAuthor(k.AuthorID) {
		return atlasError(response.Forbidden, "无权访问该知识点")
	}
	return nil
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
		Fingerprint:          s.Fingerprint,
		Status:               s.Status,
		ResolvedKPID:         s.ResolvedKPID,
		ResolvedRelationID:   s.ResolvedRelationID,
		AuthorID:             s.AuthorID,
		CreatedAt:            s.CreatedAt,
		UpdatedAt:            s.UpdatedAt,
	}
}

type atlasExtractClaimsResponse struct {
	Candidates []atlasAIClaimCandidate `json:"candidates"`
	ModelID    string                  `json:"model_id"`
	Stub       bool                    `json:"stub"`
	Structured bool                    `json:"structured"`
	Attempts   int                     `json:"attempts"`
}

type atlasClaimExtractionCostPreviewResponse struct {
	ModelID            string   `json:"model_id"`
	EstimatedTokensIn  int      `json:"estimated_tokens_in"`
	EstimatedTokensOut int      `json:"estimated_tokens_out"`
	EstimatedCostUSD   *float64 `json:"estimated_cost_usd"`
	MaxCostUSD         *float64 `json:"max_cost_usd"`
	BudgetExceeded     bool     `json:"budget_exceeded"`
	PricingMissing     bool     `json:"pricing_missing"`
}

type atlasAIClaimCandidate struct {
	ProposedTitle      string   `json:"proposed_title"`
	ProposedBody       string   `json:"proposed_body"`
	ProposedKPType     string   `json:"proposed_kp_type"`
	ProposedConfidence *float32 `json:"proposed_confidence"`
	Rationale          string   `json:"rationale"`
	TokensIn           *int     `json:"tokens_in"`
	TokensOut          *int     `json:"tokens_out"`
	CostUSD            *float64 `json:"cost_usd"`
}

type atlasRelationSuggestionResponse struct {
	RelationType string   `json:"relation_type"`
	Strength     *float32 `json:"strength"`
	Rationale    string   `json:"rationale"`
	TokensIn     *int     `json:"tokens_in"`
	TokensOut    *int     `json:"tokens_out"`
	CostUSD      *float64 `json:"cost_usd"`
	ModelID      string   `json:"model_id"`
	Structured   bool     `json:"structured"`
	Attempts     int      `json:"attempts"`
}

func carrierSuggestionAIPayload(carrierID int64, text string, maxCandidates int, userID *int64, req *atlasdto.GenerateCarrierSuggestionsRequest) map[string]any {
	payload := map[string]any{
		"carrier_id":     carrierID,
		"text":           text,
		"max_candidates": maxCandidates,
		"user_id":        userID,
	}
	if req != nil {
		payload["model_id"] = req.ModelID
		if req.MaxCostUSD != nil {
			payload["max_cost_usd"] = *req.MaxCostUSD
		}
	}
	return payload
}

func carrierSuggestionPreviewAIPayload(text string, maxCandidates int, userID *int64, req *atlasdto.GenerateCarrierSuggestionsRequest) map[string]any {
	payload := map[string]any{
		"text":           text,
		"max_candidates": maxCandidates,
		"user_id":        userID,
	}
	if req != nil {
		payload["model_id"] = req.ModelID
		if req.MaxCostUSD != nil {
			payload["max_cost_usd"] = *req.MaxCostUSD
		}
	}
	return payload
}

func isAtlasAIBudgetError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "budget exceeded") && strings.Contains(message, "maxcost")
}

func (h *SuggestionHandler) callAtlasAI(c echo.Context, path string, payload any, out any) error {
	if h.ai == nil {
		return errors.New("AI 服务客户端未配置")
	}
	if strings.TrimSpace(h.internalToken) == "" {
		return errors.New("AI 内部服务 token 未配置")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("序列化 AI 请求失败: %w", err)
	}
	respBody, statusCode, err := h.ai.DoSync(
		c.Request().Context(),
		http.MethodPost,
		path,
		bytes.NewReader(body),
		map[string]string{
			"X-Internal-Service":  h.internalToken,
			"X-Request-ID":        ctxutil.TraceID(c),
			"X-Forwarded-User-ID": atlasForwardedUserID(c),
		},
	)
	if err != nil {
		return fmt.Errorf("AI 服务不可用: %w", err)
	}
	defer respBody.Close()
	data, err := io.ReadAll(respBody)
	if err != nil {
		return fmt.Errorf("读取 AI 响应失败: %w", err)
	}
	if statusCode >= http.StatusBadRequest {
		return fmt.Errorf("AI 服务返回 %d: %s", statusCode, truncateRunes(string(data), 240))
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("解析 AI 响应失败: %w", err)
	}
	return nil
}

func atlasForwardedUserID(c echo.Context) string {
	userID := currentAtlasUserID(c)
	if userID == nil {
		return ""
	}
	return strconv.FormatInt(*userID, 10)
}

func annotationTextForSuggestion(a *atlasmodel.Annotation) string {
	if a == nil {
		return ""
	}
	if a.BodyText != nil && strings.TrimSpace(*a.BodyText) != "" {
		return strings.TrimSpace(*a.BodyText)
	}
	var selectors []struct {
		Type  string `json:"type"`
		Exact string `json:"exact"`
	}
	if err := json.Unmarshal(a.Selectors, &selectors); err != nil {
		return ""
	}
	for _, selector := range selectors {
		if selector.Type == "TextQuoteSelector" && strings.TrimSpace(selector.Exact) != "" {
			return strings.TrimSpace(selector.Exact)
		}
	}
	return ""
}

func kpTextForSuggestion(kp *atlasmodel.KnowledgePoint) string {
	if kp == nil {
		return ""
	}
	body := strings.TrimSpace(kp.BodyMarkdown)
	if body == "" {
		return strings.TrimSpace(kp.Title)
	}
	return strings.TrimSpace(kp.Title + "\n\n" + body)
}

func stringPtrOrNil(v string) *string {
	s := strings.TrimSpace(v)
	if s == "" {
		return nil
	}
	return &s
}

func truncateRunes(s string, max int) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if max <= 0 || len(runes) <= max {
		return s
	}
	return string(runes[:max])
}
