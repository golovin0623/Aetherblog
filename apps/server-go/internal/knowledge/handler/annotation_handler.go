// Atlas — annotation_handler
//
// 路径 (/v1/admin/atlas, RBAC + AtlasScopeMiddleware):
//   POST   /annotations          创建（请求体 ≥3 selectors）
//   GET    /annotations/:id      读
//   PATCH  /annotations/:id      部分更新
//   DELETE /annotations/:id      软删
//   GET    /carriers/:id/annotations  列出 carrier 下所有
//
// 红线 C1-1 由 service.AnnotationService.Create 兜底校验。

package handler

import (
	"encoding/base64"
	"fmt"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// AnnotationHandler 处理 /annotations/* + /carriers/:id/annotations。
type AnnotationHandler struct {
	svc      *atlassvc.AnnotationService
	kp       *atlassvc.KnowledgePointService
	activity atlasActivityRecorder
}

// NewAnnotationHandler 创建。
func NewAnnotationHandler(svc *atlassvc.AnnotationService, activity atlasActivityRecorder, kp ...*atlassvc.KnowledgePointService) *AnnotationHandler {
	var kpSvc *atlassvc.KnowledgePointService
	if len(kp) > 0 {
		kpSvc = kp[0]
	}
	return &AnnotationHandler{svc: svc, kp: kpSvc, activity: activity}
}

// Mount 挂载到 /atlas 子组。
// 红线 RBAC (PR #724 review fix): mutating routes 套 content.atlas.write。
func (h *AnnotationHandler) Mount(g *echo.Group, write echo.MiddlewareFunc) {
	g.POST("/annotations", h.Create, write)
	g.GET("/annotations/:id", h.Get)
	g.PATCH("/annotations/:id", h.Update, write)
	g.DELETE("/annotations/:id", h.Delete, write)
	g.GET("/carriers/:id/annotations", h.ListByCarrier)
}

// Create POST /annotations。
func (h *AnnotationHandler) Create(c echo.Context) error {
	var req atlasdto.CreateAnnotationRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}

	relPos, err := decodeRelPos(req.RelPosition)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "relPosition base64 解码失败")
	}

	authorID := currentAtlasUserID(c)
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	ownerID, err := h.assertCarrierScopeAndOwner(c, req.CarrierID, scope)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if ownerID != nil {
		authorID = cloneAtlasAuthorID(ownerID)
	}
	a, err := h.svc.Create(c.Request().Context(), atlassvc.CreateAnnotationInput{
		CarrierID:        req.CarrierID,
		CarrierVersionID: req.CarrierVersionID,
		Selectors:        req.Selectors,
		RelPosition:      relPos,
		BodyType:         req.BodyType,
		BodyText:         req.BodyText,
		BodyMeta:         req.BodyMeta,
		AnchorState:      req.AnchorState,
		AnchorScore:      req.AnchorScore,
		AuthorID:         authorID,
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	recordAtlasActivity(
		h.activity,
		c,
		"atlas.annotation_created",
		"创建 Atlas 标注",
		fmt.Sprintf("annotation_id=%d carrier_id=%d anchor_state=%s anchor_score=%.2f", a.ID, a.CarrierID, a.AnchorState, a.AnchorScore),
		"SUCCESS",
	)
	return response.OK(c, toAnnotationResponse(a))
}

// Get GET /annotations/:id。
func (h *AnnotationHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	a, err := h.svc.Get(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if a == nil {
		return response.FailWith(c, response.NotFound, "标注不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if !scope.canAccessAuthor(a.AuthorID) {
		return response.FailWith(c, response.Forbidden, "无权访问该标注")
	}
	return response.OK(c, toAnnotationResponse(a))
}

// Update PATCH /annotations/:id。
func (h *AnnotationHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	var req atlasdto.UpdateAnnotationRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := h.assertAnnotationScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	out, err := h.svc.Update(c.Request().Context(), id, atlassvc.UpdateAnnotationInput{
		BodyText:    req.BodyText,
		BodyMeta:    req.BodyMeta,
		AnchorState: req.AnchorState,
		AnchorScore: req.AnchorScore,
	})
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if out == nil {
		return response.FailWith(c, response.NotFound, "标注不存在")
	}
	h.scheduleLinkedKPEmbeddings(c, id, "annotation_update")
	return response.OK(c, toAnnotationResponse(out))
}

// Delete DELETE /annotations/:id（软删）。
func (h *AnnotationHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	if err := h.assertAnnotationScope(c, id); err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.svc.Delete(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	h.scheduleLinkedKPEmbeddings(c, id, "annotation_delete")
	return response.OKEmpty(c)
}

// ListByCarrier GET /carriers/:id/annotations。
func (h *AnnotationHandler) ListByCarrier(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if err := h.assertCarrierScope(c, id, scope); err != nil {
		return writeAtlasError(c, err)
	}
	var list []atlasmodel.Annotation
	if scope.CanAdmin {
		list, err = h.svc.ListByCarrier(c.Request().Context(), id)
	} else {
		list, err = h.svc.ListByCarrierForAuthor(c.Request().Context(), id, scope.UserID)
	}
	if err != nil {
		return response.Error(c, err)
	}
	items := make([]atlasdto.AnnotationResponse, len(list))
	for i := range list {
		items[i] = toAnnotationResponse(&list[i])
	}
	return response.OK(c, items)
}

func (h *AnnotationHandler) assertCarrierScope(c echo.Context, carrierID int64, scope *atlasScope) error {
	_, err := h.assertCarrierScopeAndOwner(c, carrierID, scope)
	return err
}

func (h *AnnotationHandler) assertCarrierScopeAndOwner(c echo.Context, carrierID int64, scope *atlasScope) (*int64, error) {
	found, ownerID, err := h.svc.CarrierOwner(c.Request().Context(), carrierID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, atlasError(response.NotFound, "载体不存在")
	}
	if !scope.canAccessOwner(ownerID) {
		return nil, atlasError(response.Forbidden, "无权访问该载体")
	}
	return ownerID, nil
}

func (h *AnnotationHandler) assertAnnotationScope(c echo.Context, id int64) error {
	a, err := h.svc.Get(c.Request().Context(), id)
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
		return atlasError(response.Forbidden, "无权操作该标注")
	}
	return nil
}

func decodeRelPos(s *string) ([]byte, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	return base64.StdEncoding.DecodeString(*s)
}

func (h *AnnotationHandler) scheduleLinkedKPEmbeddings(c echo.Context, annotationID int64, reason string) {
	if h.kp == nil {
		return
	}
	ids, err := h.kp.ListKPsForAnnotation(c.Request().Context(), annotationID)
	if err != nil {
		log.Warn().Err(err).Int64("annotation_id", annotationID).Str("reason", reason).Msg("atlas linked kp lookup failed")
		return
	}
	for _, kpID := range ids {
		kp, err := h.kp.Get(c.Request().Context(), kpID)
		if err != nil {
			log.Warn().Err(err).Int64("kp_id", kpID).Int64("annotation_id", annotationID).Str("reason", reason).Msg("atlas linked kp owner lookup failed")
			continue
		}
		if kp == nil {
			continue
		}
		h.kp.ScheduleEmbedding(c.Request().Context(), kpID, cloneAtlasAuthorID(kp.AuthorID), reason)
	}
}

func toAnnotationResponse(a *atlasmodel.Annotation) atlasdto.AnnotationResponse {
	var rel *string
	if len(a.RelPosition) > 0 {
		v := base64.StdEncoding.EncodeToString(a.RelPosition)
		rel = &v
	}
	meta := a.BodyMeta
	if len(meta) == 0 {
		meta = []byte(`{}`)
	}
	return atlasdto.AnnotationResponse{
		ID:               a.ID,
		CarrierID:        a.CarrierID,
		CarrierVersionID: a.CarrierVersionID,
		Selectors:        a.Selectors,
		RelPosition:      rel,
		BodyType:         a.BodyType,
		BodyText:         a.BodyText,
		BodyMeta:         meta,
		AnchorState:      a.AnchorState,
		AnchorScore:      a.AnchorScore,
		AuthorID:         a.AuthorID,
		CreatedAt:        a.CreatedAt,
		UpdatedAt:        a.UpdatedAt,
	}
}

func currentAtlasUserID(c echo.Context) *int64 {
	lu := middleware.GetLoginUser(c)
	if lu == nil || lu.UserID <= 0 {
		return nil
	}
	v := lu.UserID
	return &v
}
