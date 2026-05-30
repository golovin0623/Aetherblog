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

package handler

import (
	"fmt"
	"strconv"
	"strings"

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
	activity atlasActivityRecorder
}

// NewKPHandler 创建。
func NewKPHandler(
	kp *atlassvc.KnowledgePointService,
	rel *atlassvc.RelationService,
	ann *atlassvc.AnnotationService,
	atlas *atlassvc.AtlasService,
	activity atlasActivityRecorder,
) *KPHandler {
	return &KPHandler{kp: kp, rel: rel, ann: ann, atlas: atlas, activity: activity}
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
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	authorID, err := scope.authorFilter(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	limit := 5000
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	kps, err := h.kp.List(c.Request().Context(), atlasrepo.KPListFilter{Limit: limit, AuthorID: authorID})
	if err != nil {
		return response.Error(c, err)
	}
	nodes := make([]atlasdto.KnowledgePointResponse, len(kps))
	nodeIDs := make([]int64, len(kps))
	for i := range kps {
		nodes[i] = toKPResponse(&kps[i])
		nodeIDs[i] = kps[i].ID
	}
	rels, err := h.rel.ListForNodeIDs(c.Request().Context(), nodeIDs, limit, authorID)
	if err != nil {
		return response.Error(c, err)
	}
	edges := make([]atlasdto.TypedRelationResponse, len(rels))
	for i := range rels {
		edges[i] = toRelationResponse(&rels[i])
	}
	return response.OK(c, atlasdto.GraphResponse{Nodes: nodes, Edges: edges})
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

	out := atlasdto.SearchResponse{
		Query:           query,
		Limit:           limit,
		KnowledgePoints: make([]atlasdto.KnowledgePointResponse, len(kps)),
		Annotations:     make([]atlasdto.AnnotationResponse, len(annotations)),
		Carriers:        make([]atlasdto.CarrierResponse, len(carriers)),
	}
	for i := range kps {
		out.KnowledgePoints[i] = toKPResponse(&kps[i])
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
		fmt.Sprintf("q=%q total=%d kp=%d annotation=%d carrier=%d", query, out.Total, len(out.KnowledgePoints), len(out.Annotations), len(out.Carriers)),
		"INFO",
	)
	return response.OK(c, out)
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
