// Atlas Phase 2 — KP + Relation + Graph 路由
//
// 路径 (admin.Group("/atlas")):
//   POST   /knowledge-points                       创建
//   GET    /knowledge-points                       列表（含 type/status/keyword 筛选）
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
//   DELETE /relations/:id                          软删
//
//   GET    /graph                                  图谱 JSON（nodes + edges）

package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	atlasrepo "github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// KPHandler 处理 /knowledge-points/* + /relations/* + /graph。
type KPHandler struct {
	kp  *atlassvc.KnowledgePointService
	rel *atlassvc.RelationService
}

// NewKPHandler 创建。
func NewKPHandler(kp *atlassvc.KnowledgePointService, rel *atlassvc.RelationService) *KPHandler {
	return &KPHandler{kp: kp, rel: rel}
}

// Mount 挂到 /atlas 子组。
func (h *KPHandler) Mount(g *echo.Group) {
	g.POST("/knowledge-points", h.CreateKP)
	g.GET("/knowledge-points", h.ListKP)
	g.GET("/knowledge-points/:id", h.GetKP)
	g.PATCH("/knowledge-points/:id", h.UpdateKP)
	g.DELETE("/knowledge-points/:id", h.DeleteKP)
	g.POST("/knowledge-points/:id/annotations", h.LinkAnnotation)
	g.GET("/knowledge-points/:id/evidence", h.ListEvidence)
	g.GET("/knowledge-points/:id/relations", h.ListKPRelations)
	g.GET("/annotations/:id/knowledge-points", h.ListKPsForAnnotation)

	g.POST("/relations", h.CreateRelation)
	g.GET("/relations/:id", h.GetRelation)
	g.DELETE("/relations/:id", h.DeleteRelation)

	g.GET("/graph", h.Graph)
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
	f := atlasrepo.KPListFilter{}
	if v := c.QueryParam("type"); v != "" {
		f.Type = &v
	}
	if v := c.QueryParam("status"); v != "" {
		f.Status = &v
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
	if err := h.kp.LinkAnnotation(c.Request().Context(), kpID, req.AnnotationID, req.Role); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

func (h *KPHandler) ListEvidence(c echo.Context) error {
	kpID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
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
	dir := c.QueryParam("dir")
	list, err := h.rel.ListForKP(c.Request().Context(), kpID, dir)
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
	authorID := currentAtlasUserID(c)
	out, err := h.rel.Create(c.Request().Context(), atlassvc.CreateRelationInput{
		FromKPID:       req.FromKPID,
		ToKPID:         req.ToKPID,
		Type:           req.Type,
		Strength:       req.Strength,
		BodyMarkdown:   req.BodyMarkdown,
		Provenance:     req.Provenance,
		AISuggestionID: req.AISuggestionID,
		AuthorID:       authorID,
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toRelationResponse(out))
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
	return response.OK(c, toRelationResponse(t))
}

func (h *KPHandler) DeleteRelation(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if err := h.rel.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// ---------- Graph ----------

func (h *KPHandler) Graph(c echo.Context) error {
	limit := 5000
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	kps, err := h.kp.List(c.Request().Context(), atlasrepo.KPListFilter{Limit: limit})
	if err != nil {
		return response.Error(c, err)
	}
	rels, err := h.rel.ListAll(c.Request().Context(), limit)
	if err != nil {
		return response.Error(c, err)
	}
	nodes := make([]atlasdto.KnowledgePointResponse, len(kps))
	for i := range kps {
		nodes[i] = toKPResponse(&kps[i])
	}
	edges := make([]atlasdto.TypedRelationResponse, len(rels))
	for i := range rels {
		edges[i] = toRelationResponse(&rels[i])
	}
	return response.OK(c, atlasdto.GraphResponse{Nodes: nodes, Edges: edges})
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
