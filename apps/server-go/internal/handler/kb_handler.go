// Package handler · kb_handler.go — /v1/admin/kbs 路由族。
//
// 端点：
//
//	GET    /v1/admin/kbs                              列表（按权限过滤）
//	POST   /v1/admin/kbs                              创建（CUSTOM）
//	GET    /v1/admin/kbs/:id                          详情
//	PUT    /v1/admin/kbs/:id                          更新
//	DELETE /v1/admin/kbs/:id                          删除（SYSTEM 拒）
//	GET    /v1/admin/kbs/:id/stats                    统计与时间轴
//	GET    /v1/admin/kbs/:id/files                    文件列表
//	POST   /v1/admin/kbs/:id/files                    上传 multipart
//	GET    /v1/admin/kbs/:id/files/:fid               文件详情
//	DELETE /v1/admin/kbs/:id/files/:fid               删除文件
//	POST   /v1/admin/kbs/:id/files/:fid/reindex       单文件重建
//	POST   /v1/admin/kbs/:id/reindex                  全库重建
//	POST   /v1/admin/kbs/:id/retrieve                 验证真实召回（权限 >= USE）
package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/ctxutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// KBHandler 处理知识库 admin 路由。
type KBHandler struct {
	svc            *service.KBService
	activitySvc    activityRecorder
	retrieveAccess kbRetrieveAccess
	retriever      kbRetriever
}

type kbRetrieveAccess interface {
	BuildUserContext(context.Context, int64, string) (*service.KBUserContext, error)
	GetByIDForUser(context.Context, int64, *service.KBUserContext) (*dto.KnowledgeBaseVO, error)
}

type kbRetriever interface {
	Retrieve(context.Context, int64, service.KBRetrievePayload) (*dto.KBRetrieveResponse, error)
}

func NewKBHandler(
	svc *service.KBService,
	activitySvc activityRecorder,
	retriever *service.KBRetrieverClient,
) *KBHandler {
	return &KBHandler{
		svc: svc, activitySvc: activitySvc,
		retrieveAccess: svc, retriever: retriever,
	}
}

// recordKBEvent 写一条 KB 模块审计事件。activitySvc 为空时静默跳过（兼容旧调用方）。
// event 命名遵循 module.action 风格："kb.create" / "kb.update" / "kb.delete" / "kb.file.upload" /
// "kb.file.delete" / "kb.file.reindex" / "kb.reindex" / "kb.member.upsert" / "kb.member.delete" /
// "kb.profile.create" / "kb.profile.activate" / "kb.profile.migrate" / "kb.profile.delete"。
// statusEnum 把 service 层的语义状态映射为 activity_events 表的合法 enum:
// "success" / "ok" → SUCCESS，"failed" / "error" → ERROR，其余 → INFO。
func statusEnum(s string) string {
	switch strings.ToLower(s) {
	case "success", "ok":
		return "SUCCESS"
	case "failed", "fail", "error":
		return "ERROR"
	case "warn", "warning":
		return "WARNING"
	default:
		return "INFO"
	}
}

func (h *KBHandler) recordKBEvent(c echo.Context, eventType string, title string, desc string, status string) {
	if h.activitySvc == nil {
		return
	}
	lu := middleware.GetLoginUser(c)
	var uid *int64
	if lu != nil {
		uid = &lu.UserID
	}
	ip := c.RealIP()
	// event_category 受 CHECK 约束在 (post,comment,user,system,friend,media,ai,security) 之中。
	// KB 写操作语义上归到 "security"（权限/共享/数据访问）；如未来要分桶可拆 sub 类型。
	category := "security"
	d := desc
	s := statusEnum(status)
	err := h.activitySvc.Create(c.Request().Context(), &model.ActivityEvent{
		EventType:     eventType,
		EventCategory: &category,
		Title:         title,
		Description:   &d,
		UserID:        uid,
		IP:            &ip,
		Status:        &s,
	})
	if err != nil {
		log.Warn().Err(err).Str("event_type", eventType).Msg("kb audit record failed")
	}
}

// Mount 注册路由到 admin group（不含子模块 profile / member，由各自 handler 挂载）。
func (h *KBHandler) Mount(g *echo.Group) {
	g.GET("", h.List)
	g.POST("", h.Create)
	g.GET("/:id", h.Get)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	g.GET("/:id/stats", h.Stats)
	g.GET("/:id/files", h.ListFiles)
	g.POST("/:id/files", h.UploadFile)
	g.GET("/:id/files/:fid", h.GetFile)
	g.DELETE("/:id/files/:fid", h.DeleteFile)
	g.POST("/:id/files/:fid/reindex", h.ReindexFile)
	g.POST("/:id/reindex", h.ReindexAll)
	g.POST("/:id/retrieve", h.Retrieve)
}

// ---------- helpers ----------

func (h *KBHandler) buildUC(c echo.Context) (*service.KBUserContext, error) {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return nil, errors.New("未登录")
	}
	return h.svc.BuildUserContext(c.Request().Context(), lu.UserID, lu.Role)
}

func parseInt64Param(c echo.Context, name string) (int64, error) {
	return strconv.ParseInt(c.Param(name), 10, 64)
}

func (h *KBHandler) handleSvcErr(c echo.Context, err error) error {
	switch {
	case errors.Is(err, service.ErrKBNotFound):
		return response.FailWith(c, response.NotFound, "知识库不存在")
	case errors.Is(err, service.ErrKBPermission):
		return response.FailWith(c, response.Forbidden, "无权访问该知识库")
	case errors.Is(err, service.ErrKBSlugConflict):
		return response.FailWith(c, response.BadRequest, "slug 已存在")
	case errors.Is(err, service.ErrKBForbidSystem):
		return response.FailWith(c, response.BadRequest,
			"系统知识库（文章索引库）不接受此操作；如需重建文章向量请到「搜索配置」页执行")
	case errors.Is(err, service.ErrKBProfileNotFound):
		return response.FailWith(c, response.NotFound, "索引档案不存在")
	case errors.Is(err, service.ErrKBProfileBadState):
		return response.FailWith(c, response.BadRequest, "档案当前状态不允许该操作")
	case errors.Is(err, service.ErrKBProfileBadConfig):
		return response.FailWith(c, response.BadRequest, err.Error())
	case errors.Is(err, service.ErrKBFileNotFound):
		return response.FailWith(c, response.NotFound, "知识库文件不存在")
	case errors.Is(err, service.ErrKBFileWrongKB), errors.Is(err, service.ErrKBMemberWrongKB):
		return response.FailWith(c, response.BadRequest, err.Error())
	case errors.Is(err, service.ErrKBMigrateInProgress):
		// 用 409 语义：已有任务在进行中，重试前请等当前任务完成。
		// 直接 c.JSON 输出（response 包没有定义 Conflict 常量）。
		return c.JSON(http.StatusConflict, echo.Map{
			"code":          http.StatusConflict,
			"message":       err.Error(),
			"errorCategory": "kb_migrate_in_progress",
		})
	default:
		log.Warn().
			Err(err).
			Str("path", c.Request().URL.Path).
			Str("trace_id", ctxutil.TraceID(c)).
			Msg("kb handler internal error")
		return response.Error(c, err)
	}
}

// ---------- routes ----------

func (h *KBHandler) List(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	kind := c.QueryParam("kind")
	keyword := c.QueryParam("q")
	rows, err := h.svc.ListAccessible(c.Request().Context(), uc, kind, keyword)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, rows)
}

func (h *KBHandler) Create(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	var req dto.CreateKnowledgeBaseRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.Create(c.Request().Context(), req, uc)
	if err != nil {
		h.recordKBEvent(c, "kb.create", "知识库创建失败", fmt.Sprintf("name=%s err=%v", req.Name, err), "failed")
		return h.handleSvcErr(c, err)
	}
	h.recordKBEvent(c, "kb.create", "创建知识库 "+vo.Name, fmt.Sprintf("kb_id=%d slug=%s", vo.ID, vo.Slug), "success")
	return response.OK(c, vo)
}

func (h *KBHandler) Get(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	vo, err := h.svc.GetByIDForUser(c.Request().Context(), id, uc)
	if err != nil {
		return h.handleSvcErr(c, err)
	}
	return response.OK(c, vo)
}

func (h *KBHandler) Update(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.UpdateKnowledgeBaseRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.Update(c.Request().Context(), id, req, uc)
	if err != nil {
		return h.handleSvcErr(c, err)
	}
	return response.OK(c, vo)
}

func (h *KBHandler) Delete(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.Delete(c.Request().Context(), id, uc); err != nil {
		h.recordKBEvent(c, "kb.delete", "知识库删除失败", fmt.Sprintf("kb_id=%d err=%v", id, err), "failed")
		return h.handleSvcErr(c, err)
	}
	h.recordKBEvent(c, "kb.delete", fmt.Sprintf("删除知识库 #%d", id), "", "success")
	return response.OKEmpty(c)
}

func (h *KBHandler) Stats(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	stats, err := h.svc.Stats(c.Request().Context(), id, uc)
	if err != nil {
		return h.handleSvcErr(c, err)
	}
	return response.OK(c, stats)
}

func (h *KBHandler) ListFiles(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var q dto.KBFileListQuery
	_ = c.Bind(&q)
	rows, total, err := h.svc.ListFiles(c.Request().Context(), id, q, uc)
	if err != nil {
		return h.handleSvcErr(c, err)
	}
	return response.OK(c, echo.Map{
		"items":    rows,
		"total":    total,
		"page":     max1(q.PageNum),
		"pageSize": defaultPageSize(q.PageSize),
	})
}

func (h *KBHandler) UploadFile(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "缺少 file 字段")
	}
	cat := c.FormValue("category")
	var catPtr *string
	if cat != "" {
		catPtr = &cat
	}
	vo, err := h.svc.UploadFile(c.Request().Context(), id, fh, catPtr, uc)
	if err != nil {
		h.recordKBEvent(c, "kb.file.upload", "KB 上传失败", fmt.Sprintf("kb_id=%d file=%s err=%v", id, fh.Filename, err), "failed")
		return h.handleSvcErr(c, err)
	}
	h.recordKBEvent(c, "kb.file.upload", fmt.Sprintf("上传到 KB #%d", id), fmt.Sprintf("file=%s mediaFileId=%v", fh.Filename, vo.MediaFileID), "success")
	return c.JSON(http.StatusOK, echo.Map{"code": 0, "data": vo, "message": "ok"})
}

func (h *KBHandler) GetFile(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	fid, err := parseInt64Param(c, "fid")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	// 传入 kbID 让 service 强制校验 file 属于该 KB（防 nested-resource scoping 绕过）
	vo, err := h.svc.GetFile(c.Request().Context(), id, fid, uc)
	if err != nil {
		return h.handleSvcErr(c, err)
	}
	return response.OK(c, vo)
}

func (h *KBHandler) DeleteFile(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	fid, err := parseInt64Param(c, "fid")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	// review chatgpt-codex P2：传入 kbID 让 service 校验 file 属于该 KB，
	// 防止 EDIT KB A 的用户用 /kbs/A/files/<fid_B> 删 KB B 的文件
	if err := h.svc.DeleteFile(c.Request().Context(), id, fid, uc); err != nil {
		h.recordKBEvent(c, "kb.file.delete", "KB 文件删除失败", fmt.Sprintf("kb_id=%d file_id=%d err=%v", id, fid, err), "failed")
		return h.handleSvcErr(c, err)
	}
	h.recordKBEvent(c, "kb.file.delete", fmt.Sprintf("删除 KB #%d 文件 #%d", id, fid), "", "success")
	return response.OKEmpty(c)
}

func (h *KBHandler) ReindexFile(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	fid, err := parseInt64Param(c, "fid")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件ID")
	}
	if err := h.svc.ReindexFile(c.Request().Context(), id, fid, uc); err != nil {
		h.recordKBEvent(c, "kb.file.reindex", "KB 文件重建失败", fmt.Sprintf("file_id=%d err=%v", fid, err), "failed")
		return h.handleSvcErr(c, err)
	}
	h.recordKBEvent(c, "kb.file.reindex", fmt.Sprintf("重建 KB 文件 #%d", fid), "", "success")
	return response.OKEmpty(c)
}

func (h *KBHandler) ReindexAll(c echo.Context) error {
	uc, err := h.buildUC(c)
	if err != nil {
		return response.FailWith(c, response.Unauthorized, err.Error())
	}
	id, err := parseInt64Param(c, "id")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := h.svc.ReindexAll(c.Request().Context(), id, uc); err != nil {
		h.recordKBEvent(c, "kb.reindex", "KB 全库重建失败", fmt.Sprintf("kb_id=%d err=%v", id, err), "failed")
		return h.handleSvcErr(c, err)
	}
	h.recordKBEvent(c, "kb.reindex", fmt.Sprintf("全库重建 KB #%d", id), "", "success")
	return response.OKEmpty(c)
}

// Retrieve verifies the actual retrieval result for exactly one KB. Missing and
// unauthorized KBs intentionally share the same 403 response so callers cannot
// probe private KB existence. VIEW is read-only metadata access and is not enough;
// USE, EDIT, and MANAGE may retrieve content.
func (h *KBHandler) Retrieve(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseInt64Param(c, "id")
	if err != nil || id <= 0 {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	var req dto.KBRetrieveRequest
	if err := bindAndValidate(c, &req); err != nil {
		return nil
	}
	req.Query = strings.TrimSpace(req.Query)
	if len([]rune(req.Query)) < 2 || len([]rune(req.Query)) > 500 {
		return response.FailWith(c, response.BadRequest, "问题长度必须为 2 到 500 个字符")
	}
	if req.Limit == 0 {
		req.Limit = 5
	}

	if h.retrieveAccess == nil {
		return response.OK(c, dto.KBRetrieveResponse{
			Status: "unavailable", Query: req.Query, Hits: []dto.KBRetrieveHit{},
		})
	}
	uc, err := h.retrieveAccess.BuildUserContext(c.Request().Context(), lu.UserID, lu.Role)
	if err != nil {
		return response.Error(c, err)
	}
	kb, err := h.retrieveAccess.GetByIDForUser(c.Request().Context(), id, uc)
	if err != nil {
		if errors.Is(err, service.ErrKBNotFound) || errors.Is(err, service.ErrKBPermission) {
			return response.FailWith(c, response.Forbidden, "无权使用该知识库进行检索")
		}
		return response.Error(c, err)
	}
	switch kb.EffectivePermission {
	case model.KBPermissionUse, model.KBPermissionEdit, model.KBPermissionManage:
	default:
		return response.FailWith(c, response.Forbidden, "无权使用该知识库进行检索")
	}

	if h.retriever == nil {
		return response.OK(c, dto.KBRetrieveResponse{
			Status: "unavailable", Query: req.Query, Hits: []dto.KBRetrieveHit{},
		})
	}
	result, err := h.retriever.Retrieve(c.Request().Context(), id, service.KBRetrievePayload{
		Query: req.Query,
		Limit: req.Limit,
	})
	if err != nil {
		log.Warn().Err(err).Int64("kb_id", id).Str("trace_id", ctxutil.TraceID(c)).Msg("kb retrieve unavailable")
		return response.OK(c, dto.KBRetrieveResponse{
			Status: "unavailable", Query: req.Query, Hits: []dto.KBRetrieveHit{},
		})
	}
	return response.OK(c, result)
}

func max1(n int) int {
	if n < 1 {
		return 1
	}
	return n
}
func defaultPageSize(n int) int {
	if n < 1 {
		return 20
	}
	return n
}
