package handler

import (
	"errors"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/qatree"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// qaMaxUploadBytes 是 QA 文档上传的硬上限（50MB）。
const qaMaxUploadBytes = 50 << 20

// QAHandler 处理后台「试卷智能拆题」闭环接口。契约：docs/features/qa-document-workflow.md §7。
type QAHandler struct {
	svc         *service.QAService
	mediaSvc    *service.MediaService
	activitySvc *service.ActivityService
}

// NewQAHandler 创建 QAHandler。
func NewQAHandler(svc *service.QAService, mediaSvc *service.MediaService, activitySvc *service.ActivityService) *QAHandler {
	return &QAHandler{svc: svc, mediaSvc: mediaSvc, activitySvc: activitySvc}
}

// MountAdmin 注册 /v1/admin/qa-documents 路由。
func (h *QAHandler) MountAdmin(g *echo.Group) {
	g.POST("", h.Upload)
	g.GET("", h.List)
	g.GET("/:id", h.Detail)
	g.DELETE("/:id", h.Delete)
	g.POST("/:id/reprocess", h.Reprocess)
	g.GET("/:id/jobs", h.Jobs)
	g.GET("/:id/tree", h.Tree)
	g.PATCH("/:id/blocks/:blockKey", h.EditBlock)
	g.GET("/:id/annotations", h.ListAnnotations)
	g.POST("/:id/annotations", h.CreateAnnotation)
	g.PATCH("/:id/annotations/:aid", h.UpdateAnnotation)
	g.DELETE("/:id/annotations/:aid", h.DeleteAnnotation)
	g.POST("/:id/agent-fix", h.AgentFix)
	g.GET("/:id/patches", h.ListPatches)
	g.GET("/:id/patches/:pid", h.GetPatch)
	g.POST("/:id/patches/:pid/merge", h.MergePatch)
	g.GET("/:id/diffs", h.ListDiffs)
	g.GET("/:id/diffs/:did", h.GetDiff)
	g.POST("/:id/approve", h.Approve)
	g.POST("/:id/publish", h.Publish)
	g.GET("/:id/questions", h.Questions)
	g.GET("/:id/audit", h.Audit)
}

// Upload 上传图片/PDF，建 media_file + qa_document，入队流水线。
func (h *QAHandler) Upload(c echo.Context) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return response.FailWith(c, response.BadRequest, "缺少上传文件 file")
	}
	if fh.Size > qaMaxUploadBytes {
		return response.FailWith(c, response.BadRequest, "文件超过 50MB 上限")
	}
	uid := currentQAUserID(c)
	vo, err := h.mediaSvc.Upload(c.Request().Context(), fh, &uid, nil)
	if err != nil {
		return response.Error(c, err)
	}
	fileType := classifyQAFileType(fh.Filename, vo)
	if fileType == "" {
		return response.FailWith(c, response.BadRequest, "仅支持图片或 PDF")
	}
	title := strings.TrimSpace(c.FormValue("title"))
	if title == "" {
		title = vo.OriginalName
	}
	doc, err := h.svc.CreateDocument(c.Request().Context(), service.CreateQADocInput{
		Title:       title,
		MediaFileID: vo.ID,
		FileType:    fileType,
		Granularity: strings.TrimSpace(c.FormValue("granularity")),
		UserID:      &uid,
	})
	if err != nil {
		return qaError(c, err)
	}
	h.logActivity(c, "qa.upload", doc.ID)
	return response.OK(c, doc)
}

// List 返回文档分页列表。
func (h *QAHandler) List(c echo.Context) error {
	pageNum := parseIntDefault(c.QueryParam("pageNum"), 1)
	pageSize := parseIntDefault(c.QueryParam("pageSize"), 10)
	if pageNum < 1 || pageSize < 1 || pageSize > 100 {
		return response.FailWith(c, response.BadRequest, "分页参数非法")
	}
	docs, total, err := h.svc.ListDocuments(c.Request().Context(), repository.QADocFilter{
		Keyword:  c.QueryParam("keyword"),
		Status:   c.QueryParam("status"),
		PageNum:  pageNum,
		PageSize: pageSize,
	})
	if err != nil {
		return response.Error(c, err)
	}
	pages := int((total + int64(pageSize) - 1) / int64(pageSize))
	return response.OK(c, map[string]any{
		"list": docs, "total": total, "pageNum": pageNum, "pageSize": pageSize, "pages": pages,
	})
}

// Detail 返回文档详情。
func (h *QAHandler) Detail(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	detail, err := h.svc.GetDetail(c.Request().Context(), id)
	if err != nil {
		return qaError(c, err)
	}
	// 前端 getById 期望扁平 QaDocument（jobs 走独立 /jobs 接口）。
	return response.OK(c, detail.Document)
}

// Delete 软删除文档。
func (h *QAHandler) Delete(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteDocument(c.Request().Context(), id, ptrUser(c)); err != nil {
		return qaError(c, err)
	}
	h.logActivity(c, "qa.delete", id)
	return response.OKEmpty(c)
}

// Reprocess 从指定阶段重跑流水线。
func (h *QAHandler) Reprocess(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	var req dto.ReprocessQARequest
	_ = bindAndValidate(c, &req)
	if err := h.svc.Reprocess(c.Request().Context(), id, req.Stage, ptrUser(c)); err != nil {
		return qaError(c, err)
	}
	return response.OKEmpty(c)
}

// Jobs 返回流水线任务列表。
func (h *QAHandler) Jobs(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	jobs, err := h.svc.ListJobs(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, jobs)
}

// Tree 返回当前/指定版本的 Canonical Tree。
func (h *QAHandler) Tree(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	versionNo := parseIntDefault(c.QueryParam("version"), 0)
	roots, _, err := h.svc.GetTree(c.Request().Context(), id, versionNo)
	if err != nil {
		return qaError(c, err)
	}
	if roots == nil {
		roots = []*qatree.Node{}
	}
	// 前端 getTree 期望 data 直接为 CanonicalNode[]。
	return response.OK(c, roots)
}

// EditBlock 人工编辑 block 文本。
func (h *QAHandler) EditBlock(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	blockKey := c.Param("blockKey")
	var req dto.EditQABlockRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if req.StableKey == "" {
		req.StableKey = blockKey
	}
	ver, err := h.svc.EditBlock(c.Request().Context(), id, req.StableKey, req.Text, ptrUser(c))
	if err != nil {
		return qaError(c, err)
	}
	return response.OK(c, ver)
}

// ListAnnotations 返回标注列表。
func (h *QAHandler) ListAnnotations(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	anns, err := h.svc.ListAnnotations(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, toAnnotationVOs(anns))
}

// CreateAnnotation 新建标注。
func (h *QAHandler) CreateAnnotation(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	var req dto.CreateQAAnnotationRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	stableKey := req.StableKey
	if stableKey == "" {
		stableKey = req.BlockID
	}
	if stableKey == "" {
		return response.FailWith(c, response.BadRequest, "缺少 stableKey / blockId")
	}
	annType := resolveAnnotationType(req.AnnotationType, req.Category)
	if annType == "" {
		return response.FailWith(c, response.BadRequest, "非法的标注类型 annotationType / category")
	}
	a := &model.QAAnnotation{
		StableKey:      stableKey,
		AnnotationType: annType,
		OriginalText:   req.OriginalText,
		CorrectedText:  req.CorrectedText,
		Note:           req.Note,
		Status:         "OPEN",
	}
	out, err := h.svc.CreateAnnotation(c.Request().Context(), id, a, ptrUser(c))
	if err != nil {
		return qaError(c, err)
	}
	return response.OK(c, toAnnotationVO(out))
}

// UpdateAnnotation 更新标注。
func (h *QAHandler) UpdateAnnotation(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	aid, err := qaID(c, "aid")
	if err != nil {
		return err
	}
	var req dto.UpdateQAAnnotationRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	out, err := h.svc.UpdateAnnotation(c.Request().Context(), id, aid, req.CorrectedText, req.Note, req.Status)
	if err != nil {
		return qaError(c, err)
	}
	return response.OK(c, toAnnotationVO(out))
}

// DeleteAnnotation 删除标注。
func (h *QAHandler) DeleteAnnotation(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	aid, err := qaID(c, "aid")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteAnnotation(c.Request().Context(), id, aid); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// AgentFix 触发 Agent 修复（异步，产出 Patch Proposal）。
func (h *QAHandler) AgentFix(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	if err := h.svc.TriggerAgentFix(c.Request().Context(), id, ptrUser(c)); err != nil {
		return qaError(c, err)
	}
	h.logActivity(c, "qa.agent_fix", id)
	return response.OKEmpty(c)
}

// ListPatches 返回 Patch 列表。
func (h *QAHandler) ListPatches(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	patches, err := h.svc.ListPatches(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, patches)
}

// GetPatch 返回单个 Patch。
func (h *QAHandler) GetPatch(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	pid, err := qaID(c, "pid")
	if err != nil {
		return err
	}
	p, err := h.svc.GetPatch(c.Request().Context(), id, pid)
	if err != nil {
		return qaError(c, err)
	}
	return response.OK(c, p)
}

// MergePatch 合并 Patch，产出候选版本 + Diff。
func (h *QAHandler) MergePatch(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	pid, err := qaID(c, "pid")
	if err != nil {
		return err
	}
	diff, err := h.svc.MergePatch(c.Request().Context(), id, pid, ptrUser(c))
	if err != nil {
		return qaError(c, err)
	}
	h.logActivity(c, "qa.merge", id)
	return response.OK(c, toDiffVO(diff))
}

// ListDiffs 返回文档的 Diff 列表（详情页刷新后恢复历史 Diff 链接）。
func (h *QAHandler) ListDiffs(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	rows, err := h.svc.ListDiffs(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	out := make([]qaDiffVO, 0, len(rows))
	for i := range rows {
		out = append(out, toDiffVO(&rows[i]))
	}
	return response.OK(c, out)
}

// GetDiff 返回 Diff。
func (h *QAHandler) GetDiff(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	did, err := qaID(c, "did")
	if err != nil {
		return err
	}
	d, err := h.svc.GetDiff(c.Request().Context(), id, did)
	if err != nil {
		return qaError(c, err)
	}
	return response.OK(c, toDiffVO(d))
}

// Approve 审批候选版本。
func (h *QAHandler) Approve(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	var req dto.ApproveQARequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.Approve(c.Request().Context(), id, req.VersionID, ptrUser(c)); err != nil {
		return qaError(c, err)
	}
	h.logActivity(c, "qa.approve", id)
	return response.OKEmpty(c)
}

// Publish 发布入库。
func (h *QAHandler) Publish(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	n, err := h.svc.Publish(c.Request().Context(), id, ptrUser(c))
	if err != nil {
		return qaError(c, err)
	}
	h.logActivity(c, "qa.publish", id)
	return response.OK(c, map[string]any{"questionCount": n})
}

// Questions 返回已发布题目。
func (h *QAHandler) Questions(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	qs, err := h.svc.ListQuestions(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, qs)
}

// Audit 返回审计日志。
func (h *QAHandler) Audit(c echo.Context) error {
	id, err := qaID(c, "id")
	if err != nil {
		return err
	}
	logs, err := h.svc.ListAudit(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, logs)
}

// ---------------- 辅助 ----------------

func qaID(c echo.Context, name string) (int64, error) {
	id, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil {
		return 0, response.FailWith(c, response.BadRequest, "无效的ID: "+name)
	}
	return id, nil
}

func currentQAUserID(c echo.Context) int64 {
	if lu := middleware.GetLoginUser(c); lu != nil {
		return lu.UserID
	}
	return 0
}

func ptrUser(c echo.Context) *int64 {
	uid := currentQAUserID(c)
	if uid == 0 {
		return nil
	}
	return &uid
}

// classifyQAFileType 依据扩展名/MIME 判定 IMAGE/PDF，其余返回空串（拒绝）。
func classifyQAFileType(filename string, vo *dto.MediaFileVO) string {
	lower := strings.ToLower(filename)
	mime := ""
	if vo != nil && vo.MimeType != nil {
		mime = strings.ToLower(*vo.MimeType)
	}
	if strings.HasSuffix(lower, ".pdf") || strings.Contains(mime, "pdf") {
		return "PDF"
	}
	if strings.HasPrefix(mime, "image/") ||
		strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".jpg") ||
		strings.HasSuffix(lower, ".jpeg") || strings.HasSuffix(lower, ".webp") {
		return "IMAGE"
	}
	if vo != nil && vo.FileType == "IMAGE" {
		return "IMAGE"
	}
	return ""
}

func qaError(c echo.Context, err error) error {
	switch {
	case errors.Is(err, service.ErrNotFound):
		return response.FailWith(c, response.NotFound, "资源不存在")
	case errors.Is(err, service.ErrInvalidTransition):
		return response.FailWith(c, response.BadRequest, err.Error())
	default:
		return response.Error(c, err)
	}
}

func (h *QAHandler) logActivity(c echo.Context, action string, docID int64) {
	if h.activitySvc == nil {
		return
	}
	// best-effort：活动记录失败不影响主流程。
	cat := "qa"
	status := "SUCCESS"
	desc := "qa_document #" + strconv.FormatInt(docID, 10)
	_ = h.activitySvc.Create(c.Request().Context(), &model.ActivityEvent{
		EventType:     action,
		EventCategory: &cat,
		Title:         action,
		Description:   &desc,
		UserID:        ptrUser(c),
		Status:        &status,
	})
}
