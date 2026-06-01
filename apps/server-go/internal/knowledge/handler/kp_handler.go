// Atlas Phase 2 — KP + Relation + Graph 路由
//
// 路径 (/v1/admin/atlas, RBAC + AtlasScopeMiddleware):
//   POST   /knowledge-points                       创建
//   GET    /knowledge-points                       列表（含 type/status/provenance/evidence/keyword 筛选）
//   GET    /knowledge-points/:id                   读
//   PATCH  /knowledge-points/:id                   部分更新
//   DELETE /knowledge-points/:id                   软删
//   POST   /knowledge-points/:id/annotations       挂载一条 evidence 标注
//   GET    /knowledge-points/:id/evidence          列出 evidence 标注 IDs
//   GET    /knowledge-points/:id/relations         列出该 KP 的关系
//   GET    /annotations/:id/knowledge-points       列出某标注支撑的 KP IDs（双向投影）
//
//   POST   /relations                              创建（9 种类型 + 不自环）
//   GET    /relations/:id                          读
//   POST   /relations/:id/evidence                 挂载一条 relation evidence 标注
//   GET    /relations/:id/evidence                 列出 relation evidence
//   DELETE /relations/:id/evidence/:annotationId   删除 relation evidence
//   DELETE /relations/:id                          软删
//
//   GET    /graph                                  图谱 JSON（nodes + edges）
//   GET    /graph/health                           图谱健康指标

package handler

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	atlasrepo "github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// KPHandler 处理 /knowledge-points/* + /relations/* + /graph。
type KPHandler struct {
	kp       *atlassvc.KnowledgePointService
	rel      *atlassvc.RelationService
	ann      *atlassvc.AnnotationService
	atlas    *atlassvc.AtlasService
	semantic *atlassvc.AtlasSemanticSearchClient
	activity atlasActivityRecorder
}

// NewKPHandler 创建。
func NewKPHandler(
	kp *atlassvc.KnowledgePointService,
	rel *atlassvc.RelationService,
	ann *atlassvc.AnnotationService,
	atlas *atlassvc.AtlasService,
	semantic *atlassvc.AtlasSemanticSearchClient,
	activity atlasActivityRecorder,
) *KPHandler {
	return &KPHandler{kp: kp, rel: rel, ann: ann, atlas: atlas, semantic: semantic, activity: activity}
}

// Mount 挂到 /atlas 子组。
// 红线 RBAC (PR #724 review fix): mutating routes 套 content.atlas.write。
func (h *KPHandler) Mount(g *echo.Group, write echo.MiddlewareFunc) {
	g.POST("/knowledge-points", h.CreateKP, write)
	g.GET("/knowledge-points", h.ListKP)
	g.GET("/knowledge-points/:id", h.GetKP)
	g.PATCH("/knowledge-points/:id", h.UpdateKP, write)
	g.DELETE("/knowledge-points/:id", h.DeleteKP, write)
	g.POST("/knowledge-points/:id/annotations", h.LinkAnnotation, write)
	g.GET("/knowledge-points/:id/evidence", h.ListEvidence)
	g.GET("/knowledge-points/:id/relations", h.ListKPRelations)
	g.GET("/annotations/:id/knowledge-points", h.ListKPsForAnnotation)

	g.POST("/relations", h.CreateRelation, write)
	g.POST("/relations/:id/evidence", h.LinkRelationEvidence, write)
	g.GET("/relations/:id/evidence", h.ListRelationEvidence)
	g.DELETE("/relations/:id/evidence/:annotationId", h.DeleteRelationEvidence, write)
	g.GET("/relations/:id", h.GetRelation)
	g.DELETE("/relations/:id", h.DeleteRelation, write)

	g.GET("/graph", h.Graph)
	g.GET("/graph/health", h.GraphHealth)
	g.GET("/export", h.ExportGraph)
	g.POST("/import", h.ImportGraph, write)
	g.GET("/search", h.Search)
}

// ---------- KP ----------

func (h *KPHandler) CreateKP(c echo.Context) error {
	var req atlasdto.CreateKnowledgePointRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	for _, annotationID := range req.EvidenceAnnotationIDs {
		if err := h.assertAnnotationScope(c, annotationID); err != nil {
			return writeAtlasError(c, err)
		}
	}
	authorID := currentAtlasUserID(c)
	out, err := h.kp.Create(c.Request().Context(), atlassvc.CreateKPInput{
		Title:                 req.Title,
		BodyMarkdown:          req.BodyMarkdown,
		Type:                  req.Type,
		Confidence:            req.Confidence,
		Status:                req.Status,
		Provenance:            req.Provenance,
		AISuggestionID:        req.AISuggestionID,
		EvidenceAnnotationIDs: req.EvidenceAnnotationIDs,
		AuthorID:              authorID,
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	h.kp.ScheduleEmbedding(c.Request().Context(), out.ID, authorID, "create")
	return response.OK(c, toKPResponse(out))
}

func (h *KPHandler) ListKP(c echo.Context) error {
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	f := atlasrepo.KPListFilter{}
	authorID, err := scope.authorFilter(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	f.AuthorID = authorID
	if v := c.QueryParam("type"); v != "" {
		f.Type = &v
	}
	if v := c.QueryParam("status"); v != "" {
		f.Status = &v
	}
	if v := c.QueryParam("provenance"); v != "" {
		f.Provenance = &v
	}
	if v := c.QueryParam("evidence"); v != "" {
		switch v {
		case "with", "true", "has":
			hasEvidence := true
			f.HasEvidence = &hasEvidence
		case "without", "false", "missing":
			hasEvidence := false
			f.HasEvidence = &hasEvidence
		default:
			return response.FailWith(c, response.BadRequest, "无效的 evidence 筛选")
		}
	}
	if v := c.QueryParam("keyword"); v != "" {
		f.Keyword = &v
	}
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Limit = n
		}
	}
	list, err := h.kp.List(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	out := make([]atlasdto.KnowledgePointResponse, len(list))
	for i := range list {
		out[i] = toKPResponse(&list[i])
	}
	return response.OK(c, out)
}

func (h *KPHandler) GetKP(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	k, err := h.kp.Get(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if k == nil {
		return response.FailWith(c, response.NotFound, "知识点不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if !scope.canAccessAuthor(k.AuthorID) {
		return response.FailWith(c, response.Forbidden, "无权访问该知识点")
	}
	return response.OK(c, toKPResponse(k))
}

func (h *KPHandler) UpdateKP(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	var req atlasdto.UpdateKnowledgePointRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if _, err := h.assertKPScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	out, err := h.kp.Update(c.Request().Context(), id, atlassvc.UpdateKPInput{
		Title:        req.Title,
		BodyMarkdown: req.BodyMarkdown,
		Type:         req.Type,
		Status:       req.Status,
		Confidence:   req.Confidence,
		Archived:     req.Archived,
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if out == nil {
		return response.FailWith(c, response.NotFound, "知识点不存在")
	}
	h.kp.ScheduleEmbedding(c.Request().Context(), out.ID, currentAtlasUserID(c), "update")
	return response.OK(c, toKPResponse(out))
}

func (h *KPHandler) DeleteKP(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if _, err := h.assertKPScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.kp.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *KPHandler) LinkAnnotation(c echo.Context) error {
	kpID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	var req atlasdto.LinkAnnotationRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if _, err := h.assertKPScope(c, kpID); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.assertAnnotationScope(c, req.AnnotationID); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.kp.LinkAnnotation(c.Request().Context(), kpID, req.AnnotationID, req.Role); err != nil {
		return response.Error(c, err)
	}
	h.kp.ScheduleEmbedding(c.Request().Context(), kpID, currentAtlasUserID(c), "link_annotation")
	recordAtlasActivity(
		h.activity,
		c,
		"atlas.kp_from_annotation",
		"标注提炼为 KP",
		fmt.Sprintf("kp_id=%d annotation_id=%d role=%s", kpID, req.AnnotationID, req.Role),
		"SUCCESS",
	)
	return response.OKEmpty(c)
}

func (h *KPHandler) ListEvidence(c echo.Context) error {
	kpID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if _, err := h.assertKPScope(c, kpID); err != nil {
		return writeAtlasError(c, err)
	}
	list, err := h.kp.ListEvidence(c.Request().Context(), kpID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, list)
}

func (h *KPHandler) ListKPsForAnnotation(c echo.Context) error {
	annID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if err := h.assertAnnotationScope(c, annID); err != nil {
		return writeAtlasError(c, err)
	}
	ids, err := h.kp.ListKPsForAnnotation(c.Request().Context(), annID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, ids)
}

func (h *KPHandler) ListKPRelations(c echo.Context) error {
	kpID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	authorID, err := scope.authorFilter(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if _, err := h.assertKPScope(c, kpID); err != nil {
		return writeAtlasError(c, err)
	}
	dir := c.QueryParam("dir")
	list, err := h.rel.ListForKP(c.Request().Context(), kpID, dir, authorID)
	if err != nil {
		return response.Error(c, err)
	}
	out := make([]atlasdto.TypedRelationResponse, len(list))
	for i := range list {
		out[i] = toRelationResponse(&list[i])
	}
	return response.OK(c, out)
}

// ---------- Relation ----------

func (h *KPHandler) CreateRelation(c echo.Context) error {
	var req atlasdto.CreateRelationRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if _, err := h.assertKPScope(c, req.FromKPID); err != nil {
		return writeAtlasError(c, err)
	}
	if _, err := h.assertKPScope(c, req.ToKPID); err != nil {
		return writeAtlasError(c, err)
	}
	for _, annotationID := range req.EvidenceAnnotationIDs {
		if err := h.assertAnnotationScope(c, annotationID); err != nil {
			return writeAtlasError(c, err)
		}
	}
	authorID := currentAtlasUserID(c)
	out, err := h.rel.Create(c.Request().Context(), atlassvc.CreateRelationInput{
		FromKPID:              req.FromKPID,
		ToKPID:                req.ToKPID,
		Type:                  req.Type,
		Strength:              req.Strength,
		BodyMarkdown:          req.BodyMarkdown,
		Provenance:            req.Provenance,
		AISuggestionID:        req.AISuggestionID,
		AuthorID:              authorID,
		EvidenceAnnotationIDs: req.EvidenceAnnotationIDs,
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toRelationResponse(out))
}

func (h *KPHandler) LinkRelationEvidence(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	var req atlasdto.LinkRelationEvidenceRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if _, err := h.assertRelationScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.assertAnnotationScope(c, req.AnnotationID); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.rel.LinkEvidence(c.Request().Context(), id, req.AnnotationID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *KPHandler) ListRelationEvidence(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if _, err := h.assertRelationScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	list, err := h.rel.ListEvidence(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	out := make([]atlasdto.RelationEvidenceResponse, len(list))
	for i := range list {
		out[i] = atlasdto.RelationEvidenceResponse{
			RelationID:   list[i].RelationID,
			AnnotationID: list[i].AnnotationID,
			CreatedAt:    list[i].CreatedAt,
		}
	}
	return response.OK(c, out)
}

func (h *KPHandler) DeleteRelationEvidence(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	annotationID, err := strconv.ParseInt(c.Param("annotationId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 annotation ID")
	}
	if _, err := h.assertRelationScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.assertAnnotationScope(c, annotationID); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.rel.DeleteEvidence(c.Request().Context(), id, annotationID); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *KPHandler) GetRelation(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	t, err := h.rel.Get(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if t == nil {
		return response.FailWith(c, response.NotFound, "关系不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if !scope.canAccessAuthor(t.AuthorID) {
		return response.FailWith(c, response.Forbidden, "无权访问该关系")
	}
	return response.OK(c, toRelationResponse(t))
}

func (h *KPHandler) DeleteRelation(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if _, err := h.assertRelationScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.rel.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// ---------- Graph ----------

func (h *KPHandler) Graph(c echo.Context) error {
	graph, _, err := h.graphResponseForRequest(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	return response.OK(c, graph)
}

func (h *KPHandler) graphResponseForRequest(c echo.Context) (atlasdto.GraphResponse, string, error) {
	scope, err := currentAtlasScope(c)
	if err != nil {
		return atlasdto.GraphResponse{}, "", err
	}
	authorID, err := scope.authorFilter(c)
	if err != nil {
		return atlasdto.GraphResponse{}, "", err
	}
	limit := 5000
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	kps, err := h.kp.List(c.Request().Context(), atlasrepo.KPListFilter{Limit: limit, AuthorID: authorID})
	if err != nil {
		return atlasdto.GraphResponse{}, "", err
	}
	nodes := make([]atlasdto.KnowledgePointResponse, len(kps))
	nodeIDs := make([]int64, len(kps))
	for i := range kps {
		nodes[i] = toKPResponse(&kps[i])
		nodeIDs[i] = kps[i].ID
	}
	kpEvidenceCounts, err := h.kp.CountEvidenceByKPIDs(c.Request().Context(), nodeIDs)
	if err != nil {
		return atlasdto.GraphResponse{}, "", err
	}
	rels, err := h.rel.ListForNodeIDs(c.Request().Context(), nodeIDs, limit, authorID)
	if err != nil {
		return atlasdto.GraphResponse{}, "", err
	}
	edges := make([]atlasdto.TypedRelationResponse, len(rels))
	relationIDs := make([]int64, len(rels))
	for i := range rels {
		edges[i] = toRelationResponse(&rels[i])
		relationIDs[i] = rels[i].ID
	}
	relationEvidenceCounts, err := h.rel.CountEvidenceByRelationIDs(c.Request().Context(), relationIDs)
	if err != nil {
		return atlasdto.GraphResponse{}, "", err
	}
	kpEvidencePreviews, err := h.attachGraphKPEvidencePreviews(c.Request().Context(), nodeIDs, authorID)
	if err != nil {
		return atlasdto.GraphResponse{}, "", err
	}
	relationEvidencePreviews, err := h.attachGraphRelationEvidencePreviews(c.Request().Context(), relationIDs, authorID)
	if err != nil {
		return atlasdto.GraphResponse{}, "", err
	}
	return atlasdto.GraphResponse{
		Nodes:                    nodes,
		Edges:                    edges,
		KPEvidenceCounts:         kpEvidenceCounts,
		RelationEvidenceCounts:   relationEvidenceCounts,
		KPEvidencePreviews:       kpEvidencePreviews,
		RelationEvidencePreviews: relationEvidencePreviews,
	}, atlasExportScopeLabel(scope, authorID), nil
}

// ExportGraph returns a scoped Atlas graph snapshot as JSON or GraphML.
func (h *KPHandler) ExportGraph(c echo.Context) error {
	graph, scopeLabel, err := h.graphResponseForRequest(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	format := strings.ToLower(strings.TrimSpace(c.QueryParam("format")))
	if format == "" {
		format = "json"
	}
	generatedAt := time.Now().UTC()
	switch format {
	case "json":
		c.Response().Header().Set(echo.HeaderContentDisposition, `attachment; filename="aether-atlas.json"`)
		return c.JSON(http.StatusOK, atlasdto.GraphExportResponse{
			Format:                 "json",
			Version:                1,
			GeneratedAt:            generatedAt,
			Scope:                  scopeLabel,
			Nodes:                  graph.Nodes,
			Edges:                  graph.Edges,
			KPEvidenceCounts:       graph.KPEvidenceCounts,
			RelationEvidenceCounts: graph.RelationEvidenceCounts,
		})
	case "graphml":
		c.Response().Header().Set(echo.HeaderContentDisposition, `attachment; filename="aether-atlas.graphml"`)
		return c.Blob(http.StatusOK, "application/graphml+xml; charset=utf-8", []byte(buildAtlasGraphML(graph, scopeLabel, generatedAt)))
	case "markdown", "md":
		c.Response().Header().Set(echo.HeaderContentDisposition, `attachment; filename="aether-atlas.md"`)
		return c.Blob(http.StatusOK, "text/markdown; charset=utf-8", []byte(buildAtlasMarkdown(graph, scopeLabel, generatedAt)))
	default:
		return response.FailWith(c, response.BadRequest, "不支持的导出格式")
	}
}

// ImportGraph imports a user supplied Atlas-compatible graph source.
func (h *KPHandler) ImportGraph(c echo.Context) error {
	var req atlasdto.GraphImportRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}

	format := normalizeAtlasImportFormat(req.Format)
	if format == "" {
		return response.FailWith(c, response.BadRequest, "不支持的导入格式")
	}
	content := normalizeMarkdownImportContent(req.Content)
	parsed := parseAtlasGraphImport(format, content, req.DefaultType)
	sourceTitle := atlasImportSourceTitle(req.SourceTitle, parsed)
	out := atlasImportResponseFromParsed(format, req.DryRun, sourceTitle, parsed)
	if len(parsed.KnowledgePoints) == 0 {
		return response.FailWith(c, response.BadRequest, "未解析到可导入的知识点")
	}
	if req.DryRun {
		return response.OK(c, out)
	}

	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if h.kp == nil || h.rel == nil || h.ann == nil || h.atlas == nil || h.atlas.Markdown() == nil {
		return response.FailWith(c, response.InternalError, "Atlas 导入服务未完整配置")
	}
	authorID := scope.UserID
	authorPtr := &authorID
	md := h.atlas.Markdown()
	sourceMarkdown := parsed.SourceMarkdown
	if sourceMarkdown == "" {
		sourceMarkdown = content
	}
	sourceMarkdown = normalizeMarkdownImportContent(sourceMarkdown)
	note, err := md.CreateNoteSourceAs(c.Request().Context(), sourceTitle, sourceMarkdown, scope.UserID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	carrier, err := md.GetOrCreateForNoteAs(c.Request().Context(), note.ID, scope.UserID, scope.CanAdmin)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	out.CarrierID = &carrier.ID

	kpIDs := make([]int64, len(parsed.KnowledgePoints))
	annotationIDs := make([]int64, len(parsed.KnowledgePoints))
	for i, kp := range parsed.KnowledgePoints {
		annotation, err := h.createAtlasImportAnnotation(c, carrier.ID, sourceMarkdown, format, sourceTitle, kp, authorPtr)
		if err != nil {
			return response.FailWith(c, response.BadRequest, err.Error())
		}
		annotationIDs[i] = annotation.ID
		confidence := float32(0.6)
		status := "seed"
		provenance := "imported"
		created, err := h.kp.Create(c.Request().Context(), atlassvc.CreateKPInput{
			Title:                 kp.Title,
			BodyMarkdown:          kp.BodyMarkdown,
			Type:                  kp.Type,
			Confidence:            &confidence,
			Status:                &status,
			Provenance:            &provenance,
			AuthorID:              authorPtr,
			EvidenceAnnotationIDs: []int64{annotation.ID},
		})
		if err != nil {
			return response.FailWith(c, response.BadRequest, err.Error())
		}
		kpIDs[i] = created.ID
		out.KnowledgePoints[i].ID = created.ID
		out.KnowledgePoints[i].EvidenceAnnotationID = annotation.ID
		out.CreatedKPCount++
		h.kp.ScheduleEmbedding(c.Request().Context(), created.ID, authorPtr, "import")
	}

	for i, rel := range parsed.Relations {
		if rel.FromIndex < 0 || rel.FromIndex >= len(kpIDs) || rel.ToIndex < 0 || rel.ToIndex >= len(kpIDs) {
			continue
		}
		strength := rel.Strength
		provenance := "imported"
		body := rel.BodyMarkdown
		evidenceIDs := []int64{}
		if annotationIDs[rel.FromIndex] > 0 {
			evidenceIDs = append(evidenceIDs, annotationIDs[rel.FromIndex])
		}
		created, err := h.rel.Create(c.Request().Context(), atlassvc.CreateRelationInput{
			FromKPID:              kpIDs[rel.FromIndex],
			ToKPID:                kpIDs[rel.ToIndex],
			Type:                  rel.Type,
			Strength:              &strength,
			BodyMarkdown:          &body,
			Provenance:            &provenance,
			AuthorID:              authorPtr,
			EvidenceAnnotationIDs: evidenceIDs,
		})
		if err != nil {
			return response.FailWith(c, response.BadRequest, err.Error())
		}
		out.Relations[i].ID = created.ID
		out.Relations[i].FromKPID = created.FromKPID
		out.Relations[i].ToKPID = created.ToKPID
		out.CreatedRelationCount++
	}

	return response.OK(c, out)
}

func (h *KPHandler) createAtlasImportAnnotation(
	c echo.Context,
	carrierID int64,
	content string,
	format string,
	sourceTitle string,
	kp parsedImportKnowledgePoint,
	authorID *int64,
) (*atlasmodel.Annotation, error) {
	bodyText := kp.Title
	metaBytes, _ := json.Marshal(map[string]any{
		"format":      format,
		"sourceTitle": sourceTitle,
		"kpTitle":     kp.Title,
	})
	return h.ann.Create(c.Request().Context(), atlassvc.CreateAnnotationInput{
		CarrierID:   carrierID,
		Selectors:   obsidianImportSelectors(content, kp),
		BodyType:    "note",
		BodyText:    &bodyText,
		BodyMeta:    metaBytes,
		AnchorState: strPtr("anchored"),
		AnchorScore: float32Ptr(1),
		AuthorID:    authorID,
	})
}

type parsedObsidianMarkdownImport struct {
	SourceMarkdown  string
	KnowledgePoints []parsedImportKnowledgePoint
	Relations       []parsedImportRelation
	Warnings        []string
}

type parsedImportKnowledgePoint struct {
	Title        string
	BodyMarkdown string
	Type         string
	StartOffset  int
	EndOffset    int
}

type parsedImportRelation struct {
	FromIndex    int
	ToIndex      int
	FromTitle    string
	ToTitle      string
	Type         string
	Strength     float32
	BodyMarkdown string
}

var (
	markdownHeadingPattern = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*#*\s*$`)
	wikiLinkPattern        = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
)

func normalizeAtlasImportFormat(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", "markdown", "md", "obsidian", "obsidian-markdown":
		return "obsidian-markdown"
	case "csv", "readwise", "readwise-csv":
		return "readwise-csv"
	default:
		return ""
	}
}

func normalizeMarkdownImportContent(content string) string {
	return strings.ReplaceAll(strings.TrimSpace(strings.ReplaceAll(content, "\r\n", "\n")), "\r", "\n")
}

func parseAtlasGraphImport(format string, content string, defaultType string) parsedObsidianMarkdownImport {
	switch format {
	case "readwise-csv":
		return parseReadwiseCSVImport(content, defaultType)
	default:
		return parseObsidianMarkdownImport(content, defaultType)
	}
}

func parseObsidianMarkdownImport(content string, defaultType string) parsedObsidianMarkdownImport {
	content = normalizeMarkdownImportContent(content)
	kpType := normalizeImportKPType(defaultType)
	parsed := parsedObsidianMarkdownImport{}
	parsed.SourceMarkdown = content
	if content == "" {
		return parsed
	}

	type heading struct {
		title     string
		lineStart int
		bodyStart int
		end       int
	}
	headings := make([]heading, 0)
	for offset := 0; offset < len(content); {
		lineStart := offset
		lineEnd := strings.IndexByte(content[offset:], '\n')
		nextOffset := len(content)
		if lineEnd >= 0 {
			nextOffset = offset + lineEnd + 1
			lineEnd = offset + lineEnd
		} else {
			lineEnd = len(content)
		}
		line := content[lineStart:lineEnd]
		if match := markdownHeadingPattern.FindStringSubmatch(line); match != nil {
			title := cleanMarkdownHeadingTitle(match[2])
			if title != "" {
				headings = append(headings, heading{
					title:     title,
					lineStart: lineStart,
					bodyStart: nextOffset,
					end:       len(content),
				})
			}
		}
		offset = nextOffset
	}

	if len(headings) == 0 {
		parsed.KnowledgePoints = append(parsed.KnowledgePoints, parsedImportKnowledgePoint{
			Title:        "Imported Markdown",
			BodyMarkdown: strings.TrimSpace(content),
			Type:         kpType,
			StartOffset:  0,
			EndOffset:    len(content),
		})
		return parsed
	}

	for i := range headings {
		if i+1 < len(headings) {
			headings[i].end = headings[i+1].lineStart
		}
		body := ""
		if headings[i].bodyStart <= headings[i].end {
			body = strings.TrimSpace(content[headings[i].bodyStart:headings[i].end])
		}
		parsed.KnowledgePoints = append(parsed.KnowledgePoints, parsedImportKnowledgePoint{
			Title:        headings[i].title,
			BodyMarkdown: body,
			Type:         kpType,
			StartOffset:  headings[i].lineStart,
			EndOffset:    headings[i].end,
		})
	}

	titleToIndex := make(map[string]int, len(parsed.KnowledgePoints))
	for i, kp := range parsed.KnowledgePoints {
		key := normalizeWikiTitle(kp.Title)
		if existing, ok := titleToIndex[key]; ok {
			parsed.Warnings = append(parsed.Warnings, fmt.Sprintf("重复标题 %q，wiki-link 将指向第 %d 个同名知识点", kp.Title, existing+1))
			continue
		}
		titleToIndex[key] = i
	}
	seenRelations := map[string]bool{}
	for fromIndex, kp := range parsed.KnowledgePoints {
		for _, match := range wikiLinkPattern.FindAllStringSubmatch(kp.BodyMarkdown, -1) {
			targetTitle := normalizeWikiLinkTarget(match[1])
			if targetTitle == "" {
				continue
			}
			toIndex, ok := titleToIndex[normalizeWikiTitle(targetTitle)]
			if !ok {
				parsed.Warnings = append(parsed.Warnings, fmt.Sprintf("未找到 wiki-link 目标 %q", targetTitle))
				continue
			}
			if fromIndex == toIndex {
				continue
			}
			key := fmt.Sprintf("%d:%d:cites", fromIndex, toIndex)
			if seenRelations[key] {
				continue
			}
			seenRelations[key] = true
			body := fmt.Sprintf("Imported from Obsidian wiki link [[%s]].", targetTitle)
			parsed.Relations = append(parsed.Relations, parsedImportRelation{
				FromIndex:    fromIndex,
				ToIndex:      toIndex,
				FromTitle:    kp.Title,
				ToTitle:      parsed.KnowledgePoints[toIndex].Title,
				Type:         "cites",
				Strength:     0.5,
				BodyMarkdown: body,
			})
		}
	}
	return parsed
}

func parseReadwiseCSVImport(content string, defaultType string) parsedObsidianMarkdownImport {
	content = normalizeMarkdownImportContent(content)
	parsed := parsedObsidianMarkdownImport{}
	if strings.TrimSpace(content) == "" {
		return parsed
	}
	reader := csv.NewReader(strings.NewReader(content))
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	rows, err := reader.ReadAll()
	if err != nil {
		parsed.Warnings = append(parsed.Warnings, fmt.Sprintf("Readwise CSV 解析失败: %v", err))
		return parsed
	}
	if len(rows) == 0 {
		return parsed
	}
	header := csvHeaderIndex(rows[0])
	requiredHighlight, ok := csvHeaderAnyIndex(header, "highlight", "text", "highlight_text")
	if !ok {
		parsed.Warnings = append(parsed.Warnings, "Readwise CSV 缺少 Highlight/Text 列")
		return parsed
	}
	kpType := normalizeImportKPType(defaultType)
	if strings.TrimSpace(defaultType) == "" {
		kpType = "claim"
	}

	var source strings.Builder
	source.WriteString("# Readwise Import\n\n")
	for _, row := range rows[1:] {
		highlight := csvField(row, requiredHighlight)
		if strings.TrimSpace(highlight) == "" {
			continue
		}
		title := firstNonEmptyString(
			csvFieldByHeaderAny(row, header, "title", "book_title", "document_title", "source_title", "full_title"),
			"Untitled Source",
		)
		author := csvFieldByHeaderAny(row, header, "author", "book_author", "document_author")
		note := csvFieldByHeaderAny(row, header, "note", "notes", "highlight_note")
		url := csvFieldByHeaderAny(row, header, "url", "source_url", "highlight_url", "highlight_location_url", "location_url")
		location := readwiseLocationValue(
			csvFieldByHeaderAny(row, header, "location", "highlight_location"),
			csvFieldByHeader(row, header, "location_type"),
		)
		highlightNumber := len(parsed.KnowledgePoints) + 1
		sectionTitle := fmt.Sprintf("%s - Highlight %d", title, highlightNumber)

		start := source.Len()
		fmt.Fprintf(&source, "## %s\n\n", sectionTitle)
		fmt.Fprintf(&source, "> %s\n\n", readwiseInline(highlight))
		if strings.TrimSpace(note) != "" {
			fmt.Fprintf(&source, "- Note: %s\n", markdownInline(note))
		}
		if strings.TrimSpace(author) != "" {
			fmt.Fprintf(&source, "- Author: %s\n", markdownInline(author))
		}
		if strings.TrimSpace(location) != "" {
			fmt.Fprintf(&source, "- Location: %s\n", markdownInline(location))
		}
		if strings.TrimSpace(url) != "" {
			fmt.Fprintf(&source, "- URL: %s\n", markdownInline(url))
		}
		source.WriteString("\n")
		end := source.Len()

		body := readwiseKPBody(highlight, note, author, location, url)
		parsed.KnowledgePoints = append(parsed.KnowledgePoints, parsedImportKnowledgePoint{
			Title:        readwiseKPTitle(title, highlight),
			BodyMarkdown: body,
			Type:         kpType,
			StartOffset:  start,
			EndOffset:    end,
		})
	}
	parsed.SourceMarkdown = source.String()
	return parsed
}

func atlasImportSourceTitle(requested string, parsed parsedObsidianMarkdownImport) string {
	title := strings.TrimSpace(requested)
	if title != "" {
		return title
	}
	if len(parsed.KnowledgePoints) > 0 && strings.TrimSpace(parsed.KnowledgePoints[0].Title) != "" {
		return parsed.KnowledgePoints[0].Title
	}
	return "Atlas Markdown Import"
}

func atlasImportResponseFromParsed(format string, dryRun bool, sourceTitle string, parsed parsedObsidianMarkdownImport) atlasdto.GraphImportResponse {
	out := atlasdto.GraphImportResponse{
		Format:          format,
		DryRun:          dryRun,
		SourceTitle:     sourceTitle,
		KnowledgePoints: make([]atlasdto.GraphImportKnowledgePointResponse, len(parsed.KnowledgePoints)),
		Relations:       make([]atlasdto.GraphImportRelationResponse, len(parsed.Relations)),
		Warnings:        parsed.Warnings,
	}
	for i, kp := range parsed.KnowledgePoints {
		out.KnowledgePoints[i] = atlasdto.GraphImportKnowledgePointResponse{
			Title:        kp.Title,
			BodyMarkdown: kp.BodyMarkdown,
			Type:         kp.Type,
			StartOffset:  kp.StartOffset,
			EndOffset:    kp.EndOffset,
		}
	}
	for i, rel := range parsed.Relations {
		out.Relations[i] = atlasdto.GraphImportRelationResponse{
			FromIndex:    rel.FromIndex,
			ToIndex:      rel.ToIndex,
			FromTitle:    rel.FromTitle,
			ToTitle:      rel.ToTitle,
			Type:         rel.Type,
			Strength:     rel.Strength,
			BodyMarkdown: rel.BodyMarkdown,
		}
	}
	if dryRun {
		out.CreatedKPCount = len(out.KnowledgePoints)
		out.CreatedRelationCount = len(out.Relations)
	}
	return out
}

func csvHeaderIndex(header []string) map[string]int {
	out := make(map[string]int, len(header))
	for i, value := range header {
		key := strings.ToLower(strings.TrimSpace(value))
		key = strings.ReplaceAll(key, " ", "_")
		if key != "" {
			out[key] = i
		}
	}
	return out
}

func csvField(row []string, index int) string {
	if index < 0 || index >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[index])
}

func csvFieldByHeader(row []string, header map[string]int, key string) string {
	index, ok := header[key]
	if !ok {
		return ""
	}
	return csvField(row, index)
}

func csvHeaderAnyIndex(header map[string]int, keys ...string) (int, bool) {
	for _, key := range keys {
		index, ok := header[key]
		if ok {
			return index, true
		}
	}
	return -1, false
}

func csvFieldByHeaderAny(row []string, header map[string]int, keys ...string) string {
	for _, key := range keys {
		if value := csvFieldByHeader(row, header, key); value != "" {
			return value
		}
	}
	return ""
}

func readwiseKPTitle(sourceTitle string, highlight string) string {
	prefix := strings.TrimSpace(sourceTitle)
	if prefix == "" {
		prefix = "Readwise Highlight"
	}
	snippet := markdownInline(highlight)
	if snippet == "" {
		return prefix
	}
	runes := []rune(snippet)
	if len(runes) > 80 {
		snippet = string(runes[:80])
	}
	return fmt.Sprintf("%s - %s", prefix, snippet)
}

func readwiseKPBody(highlight string, note string, author string, location string, url string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "> %s\n\n", readwiseInline(highlight))
	if strings.TrimSpace(note) != "" {
		fmt.Fprintf(&b, "Note: %s\n\n", strings.TrimSpace(note))
	}
	for _, row := range []struct {
		label string
		value string
	}{
		{"Author", author},
		{"Location", location},
		{"URL", url},
	} {
		if strings.TrimSpace(row.value) != "" {
			fmt.Fprintf(&b, "- %s: %s\n", row.label, markdownInline(row.value))
		}
	}
	return strings.TrimSpace(b.String())
}

func readwiseLocationValue(location string, locationType string) string {
	location = strings.TrimSpace(location)
	locationType = strings.TrimSpace(locationType)
	if location != "" && locationType != "" {
		return fmt.Sprintf("%s %s", locationType, location)
	}
	return firstNonEmptyString(location, locationType)
}

func readwiseInline(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\n", " ")
	return strings.Join(strings.Fields(value), " ")
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func obsidianImportSelectors(content string, kp parsedImportKnowledgePoint) []json.RawMessage {
	start := clampInt(kp.StartOffset, 0, len(content))
	end := clampInt(kp.EndOffset, start, len(content))
	exact := strings.TrimSpace(content[start:end])
	if exact == "" {
		exact = kp.Title
	}
	return []json.RawMessage{
		mustRawJSON(map[string]any{
			"type":   "TextQuoteSelector",
			"exact":  clipString(exact, 240),
			"prefix": clipString(content[clampInt(start-80, 0, len(content)):start], 80),
			"suffix": clipString(content[end:clampInt(end+80, end, len(content))], 80),
		}),
		mustRawJSON(map[string]any{
			"type":  "TextPositionSelector",
			"start": start,
			"end":   end,
		}),
		mustRawJSON(map[string]any{
			"type":  "FragmentSelector",
			"value": "heading:" + normalizeWikiTitle(kp.Title),
		}),
	}
}

func cleanMarkdownHeadingTitle(title string) string {
	return strings.TrimSpace(strings.Trim(title, "# \t"))
}

func normalizeImportKPType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "claim", "concept", "question", "definition", "method", "example", "person", "source":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "source"
	}
}

func normalizeWikiLinkTarget(value string) string {
	target := strings.TrimSpace(value)
	if i := strings.Index(target, "|"); i >= 0 {
		target = target[:i]
	}
	if i := strings.Index(target, "#"); i >= 0 {
		target = target[:i]
	}
	target = strings.TrimSpace(strings.TrimSuffix(target, ".md"))
	return target
}

func normalizeWikiTitle(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(strings.TrimSuffix(value, ".md"))), " "))
}

func mustRawJSON(value any) json.RawMessage {
	b, _ := json.Marshal(value)
	return b
}

func clipString(value string, maxLen int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= maxLen {
		return value
	}
	return string(runes[:maxLen])
}

func strPtr(value string) *string {
	return &value
}

func float32Ptr(value float32) *float32 {
	return &value
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func (h *KPHandler) GraphHealth(c echo.Context) error {
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	authorID, err := scope.authorFilter(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	hubLimit := 5
	if v := c.QueryParam("hubLimit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			hubLimit = n
		}
	}
	metrics, err := h.rel.GraphHealth(c.Request().Context(), authorID, hubLimit)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, toGraphHealthResponse(metrics))
}

func atlasExportScopeLabel(scope *atlasScope, authorID *int64) string {
	if authorID == nil {
		return "all"
	}
	if scope != nil && *authorID == scope.UserID {
		return "mine"
	}
	return fmt.Sprintf("author:%d", *authorID)
}

func buildAtlasGraphML(graph atlasdto.GraphResponse, scopeLabel string, generatedAt time.Time) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<graphml xmlns="http://graphml.graphdrawing.org/xmlns">` + "\n")
	for _, key := range []struct {
		id       string
		attrType string
	}{
		{"scope", "string"},
		{"generatedAt", "string"},
		{"uuid", "string"},
		{"title", "string"},
		{"bodyMarkdown", "string"},
		{"type", "string"},
		{"status", "string"},
		{"provenance", "string"},
		{"confidence", "double"},
		{"archived", "boolean"},
		{"evidenceCount", "long"},
		{"createdAt", "string"},
		{"updatedAt", "string"},
		{"strength", "double"},
	} {
		graphMLKey(&b, key.id, key.attrType)
	}
	b.WriteString(`  <graph id="aether-atlas" edgedefault="directed">` + "\n")
	graphMLData(&b, "scope", scopeLabel)
	graphMLData(&b, "generatedAt", generatedAt.Format(time.RFC3339))
	for _, node := range graph.Nodes {
		fmt.Fprintf(&b, `    <node id="kp-%d">`+"\n", node.ID)
		graphMLData(&b, "uuid", node.UUID)
		graphMLData(&b, "title", node.Title)
		graphMLData(&b, "bodyMarkdown", node.BodyMarkdown)
		graphMLData(&b, "type", node.Type)
		graphMLData(&b, "status", node.Status)
		graphMLData(&b, "provenance", node.Provenance)
		graphMLData(&b, "confidence", fmt.Sprintf("%.4f", node.Confidence))
		graphMLData(&b, "archived", fmt.Sprintf("%t", node.Archived))
		graphMLData(&b, "evidenceCount", fmt.Sprintf("%d", graph.KPEvidenceCounts[node.ID]))
		graphMLData(&b, "createdAt", node.CreatedAt.UTC().Format(time.RFC3339))
		graphMLData(&b, "updatedAt", node.UpdatedAt.UTC().Format(time.RFC3339))
		b.WriteString(`    </node>` + "\n")
	}
	for _, edge := range graph.Edges {
		fmt.Fprintf(&b, `    <edge id="rel-%d" source="kp-%d" target="kp-%d">`+"\n", edge.ID, edge.FromKPID, edge.ToKPID)
		graphMLData(&b, "type", edge.Type)
		graphMLData(&b, "strength", fmt.Sprintf("%.4f", edge.Strength))
		graphMLData(&b, "provenance", edge.Provenance)
		if edge.BodyMarkdown != nil {
			graphMLData(&b, "bodyMarkdown", *edge.BodyMarkdown)
		}
		graphMLData(&b, "evidenceCount", fmt.Sprintf("%d", graph.RelationEvidenceCounts[edge.ID]))
		graphMLData(&b, "createdAt", edge.CreatedAt.UTC().Format(time.RFC3339))
		graphMLData(&b, "updatedAt", edge.UpdatedAt.UTC().Format(time.RFC3339))
		b.WriteString(`    </edge>` + "\n")
	}
	b.WriteString(`  </graph>` + "\n")
	b.WriteString(`</graphml>` + "\n")
	return b.String()
}

func graphMLKey(b *strings.Builder, id string, attrType string) {
	b.WriteString(`  <key id="`)
	xml.EscapeText(b, []byte(id))
	b.WriteString(`" for="all" attr.name="`)
	xml.EscapeText(b, []byte(id))
	b.WriteString(`" attr.type="`)
	xml.EscapeText(b, []byte(attrType))
	b.WriteString(`"/>` + "\n")
}

func graphMLData(b *strings.Builder, key string, value string) {
	b.WriteString(`      <data key="`)
	xml.EscapeText(b, []byte(key))
	b.WriteString(`">`)
	xml.EscapeText(b, []byte(value))
	b.WriteString(`</data>` + "\n")
}

func buildAtlasMarkdown(graph atlasdto.GraphResponse, scopeLabel string, generatedAt time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "---\n")
	fmt.Fprintf(&b, "title: Aether Atlas Export\n")
	fmt.Fprintf(&b, "format: markdown\n")
	fmt.Fprintf(&b, "version: 1\n")
	fmt.Fprintf(&b, "scope: %s\n", markdownMetaValue(scopeLabel))
	fmt.Fprintf(&b, "generatedAt: %s\n", generatedAt.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "nodes: %d\n", len(graph.Nodes))
	fmt.Fprintf(&b, "edges: %d\n", len(graph.Edges))
	fmt.Fprintf(&b, "---\n\n")
	fmt.Fprintf(&b, "# Aether Atlas Export\n\n")
	fmt.Fprintf(&b, "- Scope: %s\n", markdownInline(scopeLabel))
	fmt.Fprintf(&b, "- Generated at: %s\n", generatedAt.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "- Knowledge points: %d\n", len(graph.Nodes))
	fmt.Fprintf(&b, "- Relations: %d\n\n", len(graph.Edges))

	titleByID := make(map[int64]string, len(graph.Nodes))
	fmt.Fprintf(&b, "## Knowledge Points\n\n")
	for _, node := range graph.Nodes {
		title := markdownInline(node.Title)
		if title == "" {
			title = "Untitled"
		}
		titleByID[node.ID] = title
		fmt.Fprintf(&b, "### KP %d: %s\n\n", node.ID, title)
		fmt.Fprintf(&b, "- UUID: %s\n", markdownInline(node.UUID))
		fmt.Fprintf(&b, "- Type: %s\n", markdownInline(node.Type))
		fmt.Fprintf(&b, "- Status: %s\n", markdownInline(node.Status))
		fmt.Fprintf(&b, "- Provenance: %s\n", markdownInline(node.Provenance))
		fmt.Fprintf(&b, "- Confidence: %.4f\n", node.Confidence)
		fmt.Fprintf(&b, "- Archived: %t\n", node.Archived)
		fmt.Fprintf(&b, "- Evidence count: %d\n", graph.KPEvidenceCounts[node.ID])
		fmt.Fprintf(&b, "- Created at: %s\n", node.CreatedAt.UTC().Format(time.RFC3339))
		fmt.Fprintf(&b, "- Updated at: %s\n\n", node.UpdatedAt.UTC().Format(time.RFC3339))
		body := strings.TrimSpace(node.BodyMarkdown)
		if body != "" {
			fmt.Fprintf(&b, "%s\n\n", body)
		}
	}

	fmt.Fprintf(&b, "## Relations\n\n")
	if len(graph.Edges) == 0 {
		fmt.Fprintf(&b, "_No relations in this export._\n")
		return b.String()
	}
	for _, edge := range graph.Edges {
		fmt.Fprintf(&b, "### Relation %d: KP %d %s KP %d\n\n", edge.ID, edge.FromKPID, markdownInline(edge.Type), edge.ToKPID)
		fmt.Fprintf(&b, "- From: KP %d - %s\n", edge.FromKPID, markdownInline(titleByID[edge.FromKPID]))
		fmt.Fprintf(&b, "- To: KP %d - %s\n", edge.ToKPID, markdownInline(titleByID[edge.ToKPID]))
		fmt.Fprintf(&b, "- Type: %s\n", markdownInline(edge.Type))
		fmt.Fprintf(&b, "- Strength: %.4f\n", edge.Strength)
		fmt.Fprintf(&b, "- Provenance: %s\n", markdownInline(edge.Provenance))
		fmt.Fprintf(&b, "- Evidence count: %d\n", graph.RelationEvidenceCounts[edge.ID])
		fmt.Fprintf(&b, "- Created at: %s\n", edge.CreatedAt.UTC().Format(time.RFC3339))
		fmt.Fprintf(&b, "- Updated at: %s\n\n", edge.UpdatedAt.UTC().Format(time.RFC3339))
		if edge.BodyMarkdown != nil {
			body := strings.TrimSpace(*edge.BodyMarkdown)
			if body != "" {
				fmt.Fprintf(&b, "%s\n\n", body)
			}
		}
	}
	return b.String()
}

func markdownMetaValue(value string) string {
	return strings.ReplaceAll(strings.TrimSpace(value), "\n", " ")
}

func markdownInline(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

// Search 聚合 KP、Annotation、Carrier 的轻量关键字搜索。
func (h *KPHandler) Search(c echo.Context) error {
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	authorID, err := scope.authorFilter(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	query := strings.TrimSpace(c.QueryParam("q"))
	if query == "" {
		return response.FailWith(c, response.BadRequest, "搜索词不能为空")
	}
	limit := 8
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	if limit <= 0 {
		limit = 8
	} else if limit > 25 {
		limit = 25
	}
	semanticEnabled := parseAtlasSemanticParam(c.QueryParam("semantic"))

	kps, err := h.kp.List(c.Request().Context(), atlasrepo.KPListFilter{
		Keyword:  &query,
		AuthorID: authorID,
		Limit:    limit,
	})
	if err != nil {
		return response.Error(c, err)
	}
	var annotations []atlasmodel.Annotation
	if h.ann != nil {
		annotations, err = h.ann.Search(c.Request().Context(), query, authorID, limit)
		if err != nil {
			return response.Error(c, err)
		}
	}
	var carriers []atlasmodel.Carrier
	if h.atlas != nil && h.atlas.Carriers() != nil {
		carriers, err = h.atlas.Carriers().Search(c.Request().Context(), query, authorID, limit)
		if err != nil {
			return response.Error(c, err)
		}
	}
	semanticAvailable := false
	semanticStatus := "disabled"
	var semanticHits []atlassvc.AtlasSemanticKnowledgePointHit
	if semanticEnabled {
		semanticStatus = "unavailable"
		if h.semantic != nil {
			if result, err := h.semantic.Search(c.Request().Context(), query, authorID, limit); err == nil && result != nil {
				semanticAvailable = true
				semanticStatus = "ok"
				semanticHits = result.KnowledgePoints
			}
		}
	}
	searchKPs, err := h.toSearchKnowledgePoints(c.Request().Context(), scope, kps, semanticHits, semanticAvailable, limit)
	if err != nil {
		return response.Error(c, err)
	}
	if err := h.attachSearchEvidencePreviews(c.Request().Context(), scope, searchKPs); err != nil {
		return response.Error(c, err)
	}

	out := atlasdto.SearchResponse{
		Query:             query,
		Limit:             limit,
		SemanticEnabled:   semanticEnabled,
		SemanticAvailable: semanticAvailable,
		SemanticStatus:    semanticStatus,
		KnowledgePoints:   searchKPs,
		Annotations:       make([]atlasdto.AnnotationResponse, len(annotations)),
		Carriers:          make([]atlasdto.CarrierResponse, len(carriers)),
	}
	for i := range annotations {
		out.Annotations[i] = toAnnotationResponse(&annotations[i])
	}
	for i := range carriers {
		out.Carriers[i] = toCarrierResponse(&carriers[i])
	}
	out.Total = len(out.KnowledgePoints) + len(out.Annotations) + len(out.Carriers)
	recordAtlasActivity(
		h.activity,
		c,
		"atlas.search",
		"Atlas search",
		fmt.Sprintf("q=%q total=%d kp=%d annotation=%d carrier=%d semantic=%s", query, out.Total, len(out.KnowledgePoints), len(out.Annotations), len(out.Carriers), semanticStatus),
		"INFO",
	)
	return response.OK(c, out)
}

func (h *KPHandler) toSearchKnowledgePoints(
	ctx context.Context,
	scope *atlasScope,
	keywordRows []atlasmodel.KnowledgePoint,
	semanticHits []atlassvc.AtlasSemanticKnowledgePointHit,
	semanticAvailable bool,
	limit int,
) ([]atlasdto.SearchKnowledgePointResponse, error) {
	byID := make(map[int64]*atlasdto.SearchKnowledgePointResponse, len(keywordRows)+len(semanticHits))
	keywordOrder := make([]int64, 0, len(keywordRows))
	for i := range keywordRows {
		kp := toKPResponse(&keywordRows[i])
		item := atlasdto.SearchKnowledgePointResponse{
			KnowledgePointResponse: kp,
			SearchSource:           "keyword",
		}
		byID[kp.ID] = &item
		keywordOrder = append(keywordOrder, kp.ID)
	}

	semanticOrder := make([]int64, 0, len(semanticHits))
	if semanticAvailable {
		for _, hit := range semanticHits {
			if hit.ID <= 0 {
				continue
			}
			if existing, ok := byID[hit.ID]; ok {
				existing.SearchScore = hit.Similarity
				existing.SearchSource = "keyword_semantic"
				semanticOrder = append(semanticOrder, hit.ID)
				continue
			}
			kp, err := h.kp.Get(ctx, hit.ID)
			if err != nil {
				return nil, err
			}
			if kp == nil || !scope.canAccessAuthor(kp.AuthorID) {
				continue
			}
			resp := toKPResponse(kp)
			item := atlasdto.SearchKnowledgePointResponse{
				KnowledgePointResponse: resp,
				SearchScore:            hit.Similarity,
				SearchSource:           normalizeAtlasSearchSource(hit.RecallSource),
			}
			byID[resp.ID] = &item
			semanticOrder = append(semanticOrder, resp.ID)
		}
	}

	out := make([]atlasdto.SearchKnowledgePointResponse, 0, len(byID))
	seen := make(map[int64]bool, len(byID))
	appendIfPresent := func(id int64) {
		if seen[id] {
			return
		}
		item, ok := byID[id]
		if !ok {
			return
		}
		seen[id] = true
		out = append(out, *item)
	}
	for _, id := range semanticOrder {
		appendIfPresent(id)
	}
	for _, id := range keywordOrder {
		appendIfPresent(id)
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (h *KPHandler) attachSearchEvidencePreviews(
	ctx context.Context,
	scope *atlasScope,
	items []atlasdto.SearchKnowledgePointResponse,
) error {
	if h == nil || h.kp == nil || h.ann == nil || h.atlas == nil || h.atlas.Carriers() == nil {
		return nil
	}
	for i := range items {
		links, err := h.kp.ListEvidence(ctx, items[i].ID)
		if err != nil {
			return err
		}
		for _, link := range links {
			annotation, err := h.ann.Get(ctx, link.AnnotationID)
			if err != nil {
				return err
			}
			if annotation == nil || !scope.canAccessAuthor(annotation.AuthorID) {
				continue
			}
			carrier, err := h.atlas.Carriers().FindByID(ctx, annotation.CarrierID)
			if err != nil {
				return err
			}
			if carrier == nil || !scope.canAccessOwner(carrier.OwnerID) {
				continue
			}
			preview := toSearchEvidencePreview(annotation, carrier)
			if preview == nil {
				continue
			}
			items[i].EvidencePreview = preview
			break
		}
	}
	return nil
}

func (h *KPHandler) attachGraphKPEvidencePreviews(ctx context.Context, kpIDs []int64, authorID *int64) (map[int64]*atlasdto.SearchEvidencePreviewResponse, error) {
	if h == nil || h.kp == nil {
		return nil, nil
	}
	rows, err := h.kp.FirstEvidencePreviewRowsByKPIDs(ctx, kpIDs, authorID)
	if err != nil {
		return nil, err
	}
	return toGraphEvidencePreviewMap(rows), nil
}

func (h *KPHandler) attachGraphRelationEvidencePreviews(ctx context.Context, relationIDs []int64, authorID *int64) (map[int64]*atlasdto.SearchEvidencePreviewResponse, error) {
	if h == nil || h.rel == nil {
		return nil, nil
	}
	rows, err := h.rel.FirstEvidencePreviewRowsByRelationIDs(ctx, relationIDs, authorID)
	if err != nil {
		return nil, err
	}
	return toGraphEvidencePreviewMap(rows), nil
}

const (
	atlasSearchEvidenceQuoteLimit = 240
	atlasSearchEvidenceNoteLimit  = 180
)

func toSearchEvidencePreview(
	annotation *atlasmodel.Annotation,
	carrier *atlasmodel.Carrier,
) *atlasdto.SearchEvidencePreviewResponse {
	if annotation == nil || carrier == nil {
		return nil
	}
	return toEvidencePreviewResponse(
		annotation.ID,
		annotation.CarrierID,
		carrier.Type,
		carrier.Title,
		annotation.Selectors,
		annotation.BodyText,
	)
}

func toGraphEvidencePreviewMap(rows []atlasrepo.EvidencePreviewRow) map[int64]*atlasdto.SearchEvidencePreviewResponse {
	if len(rows) == 0 {
		return nil
	}
	previews := make(map[int64]*atlasdto.SearchEvidencePreviewResponse, len(rows))
	for _, row := range rows {
		if _, exists := previews[row.SubjectID]; exists {
			continue
		}
		preview := toEvidencePreviewResponse(
			row.AnnotationID,
			row.CarrierID,
			row.CarrierType,
			row.CarrierTitle,
			row.Selectors,
			row.BodyText,
		)
		if preview == nil {
			continue
		}
		previews[row.SubjectID] = preview
	}
	if len(previews) == 0 {
		return nil
	}
	return previews
}

func toEvidencePreviewResponse(
	annotationID int64,
	carrierID int64,
	carrierType string,
	carrierTitle string,
	selectors []byte,
	bodyTextPtr *string,
) *atlasdto.SearchEvidencePreviewResponse {
	quote := truncateAtlasEvidenceText(firstTextQuoteSelectorExact(selectors), atlasSearchEvidenceQuoteLimit)
	bodyText := ""
	if bodyTextPtr != nil {
		bodyText = strings.TrimSpace(*bodyTextPtr)
	}
	if quote == "" {
		quote = truncateAtlasEvidenceText(bodyText, atlasSearchEvidenceQuoteLimit)
	}
	if quote == "" {
		return nil
	}
	var note *string
	if trimmed := truncateAtlasEvidenceText(bodyText, atlasSearchEvidenceNoteLimit); trimmed != "" && trimmed != quote {
		note = &trimmed
	}
	return &atlasdto.SearchEvidencePreviewResponse{
		AnnotationID: annotationID,
		CarrierID:    carrierID,
		CarrierType:  carrierType,
		CarrierTitle: carrierTitle,
		Quote:        quote,
		Note:         note,
	}
}

func firstTextQuoteSelectorExact(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var selectors []struct {
		Type  string `json:"type"`
		Exact string `json:"exact"`
	}
	if err := json.Unmarshal(raw, &selectors); err != nil {
		return ""
	}
	for _, selector := range selectors {
		if selector.Type == "TextQuoteSelector" {
			return strings.TrimSpace(selector.Exact)
		}
	}
	return ""
}

func truncateAtlasEvidenceText(text string, limit int) string {
	text = strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if text == "" || limit <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	if limit <= 3 {
		return string(runes[:limit])
	}
	return strings.TrimSpace(string(runes[:limit-3])) + "..."
}

func parseAtlasSemanticParam(raw string) bool {
	if strings.TrimSpace(raw) == "" {
		return false
	}
	enabled, err := strconv.ParseBool(raw)
	return err == nil && enabled
}

func normalizeAtlasSearchSource(source string) string {
	switch strings.TrimSpace(source) {
	case "semantic", "":
		return "semantic"
	case "keyword", "keyword_semantic":
		return source
	default:
		return "semantic"
	}
}

func (h *KPHandler) assertKPScope(c echo.Context, id int64) (*atlasmodel.KnowledgePoint, error) {
	k, err := h.kp.Get(c.Request().Context(), id)
	if err != nil {
		return nil, err
	}
	if k == nil {
		return nil, atlasError(response.NotFound, "知识点不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return nil, err
	}
	if !scope.canAccessAuthor(k.AuthorID) {
		return nil, atlasError(response.Forbidden, "无权访问该知识点")
	}
	return k, nil
}

func (h *KPHandler) assertRelationScope(c echo.Context, id int64) (*atlasmodel.TypedRelation, error) {
	t, err := h.rel.Get(c.Request().Context(), id)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, atlasError(response.NotFound, "关系不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return nil, err
	}
	if !scope.canAccessAuthor(t.AuthorID) {
		return nil, atlasError(response.Forbidden, "无权访问该关系")
	}
	return t, nil
}

func (h *KPHandler) assertAnnotationScope(c echo.Context, id int64) error {
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

// ---------- 转换 ----------

func toKPResponse(k *atlasmodel.KnowledgePoint) atlasdto.KnowledgePointResponse {
	return atlasdto.KnowledgePointResponse{
		ID:             k.ID,
		UUID:           k.UUID,
		Title:          k.Title,
		BodyMarkdown:   k.BodyMarkdown,
		Type:           k.Type,
		Confidence:     k.Confidence,
		Status:         k.Status,
		AuthorID:       k.AuthorID,
		Provenance:     k.Provenance,
		AISuggestionID: k.AISuggestionID,
		Archived:       k.Archived,
		CreatedAt:      k.CreatedAt,
		UpdatedAt:      k.UpdatedAt,
	}
}

func toRelationResponse(t *atlasmodel.TypedRelation) atlasdto.TypedRelationResponse {
	return atlasdto.TypedRelationResponse{
		ID:             t.ID,
		FromKPID:       t.FromKPID,
		ToKPID:         t.ToKPID,
		Type:           t.Type,
		Strength:       t.Strength,
		BodyMarkdown:   t.BodyMarkdown,
		Provenance:     t.Provenance,
		AISuggestionID: t.AISuggestionID,
		AuthorID:       t.AuthorID,
		CreatedAt:      t.CreatedAt,
		UpdatedAt:      t.UpdatedAt,
	}
}

func toGraphHealthResponse(m *atlasrepo.GraphHealthMetrics) atlasdto.GraphHealthResponse {
	hubs := make([]atlasdto.GraphHealthHubResponse, len(m.TopHubs))
	for i := range m.TopHubs {
		hubs[i] = atlasdto.GraphHealthHubResponse{
			KPID:      m.TopHubs[i].KPID,
			Title:     m.TopHubs[i].Title,
			Degree:    m.TopHubs[i].Degree,
			InDegree:  m.TopHubs[i].InDegree,
			OutDegree: m.TopHubs[i].OutDegree,
		}
	}
	return atlasdto.GraphHealthResponse{
		ActiveKPCount:                m.ActiveKPCount,
		RelationCount:                m.RelationCount,
		RelationDensity:              m.RelationDensity,
		OrphanKPCount:                m.OrphanKPCount,
		OrphanKPRatio:                m.OrphanKPRatio,
		KPEvidenceCount:              m.KPEvidenceCount,
		KPEvidenceCoverage:           m.KPEvidenceCoverage,
		RelationEvidenceCount:        m.RelationEvidenceCount,
		RelationEvidenceCoverage:     m.RelationEvidenceCoverage,
		MissingEvidenceKPCount:       m.MissingEvidenceKPCount,
		MissingEvidenceRelationCount: m.MissingEvidenceRelationCount,
		AIKPCount:                    m.AIKPCount,
		TopHubs:                      hubs,
	}
}
