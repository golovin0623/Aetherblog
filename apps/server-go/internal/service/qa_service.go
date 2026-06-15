package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/qatree"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// QAMediaReader 解析上传文件的可访问 URL 与类型，供 PREPROCESS 阶段使用。
type QAMediaReader interface {
	ResolveURL(ctx context.Context, mediaFileID int64) (url string, mime string, err error)
}

// QAService 编排 QA Document Workflow：上传建档、流水线驱动、校对/标注、Agent 修复、
// 合并/Diff、审批发布。状态机迁移在本层强校验（qatree.CanTransition）。
type QAService struct {
	repo     *repository.QARepo
	pipeline QAPipeline
	media    QAMediaReader
}

// NewQAService 创建 QAService。
func NewQAService(repo *repository.QARepo, pipeline QAPipeline, media QAMediaReader) *QAService {
	return &QAService{repo: repo, pipeline: pipeline, media: media}
}

// ErrInvalidTransition 表示非法状态迁移。
var ErrInvalidTransition = errors.New("非法的状态迁移")

// ErrNotFound 表示文档/资源不存在。
var ErrNotFound = errors.New("资源不存在")

// qaJobPayload 是阶段间透传的中间产物。
type qaJobPayload struct {
	Run    string          `json:"run"`
	Pages  json.RawMessage `json:"pages,omitempty"`
	Blocks json.RawMessage `json:"blocks,omitempty"`
	OCR    json.RawMessage `json:"ocr,omitempty"`
}

// CreateQADocInput 是建档入参（媒体上传已由 handler 完成）。
type CreateQADocInput struct {
	Title       string
	MediaFileID int64
	FileType    string // IMAGE | PDF
	Granularity string
	UserID      *int64
}

// CreateDocument 建档并入队自动流水线（PREPROCESS）。
func (s *QAService) CreateDocument(ctx context.Context, in CreateQADocInput) (*model.QADocument, error) {
	if strings.TrimSpace(in.Title) == "" {
		in.Title = "未命名文档"
	}
	if in.Granularity == "" {
		in.Granularity = qatree.GranularityFine
	}
	if !qatree.ValidGranularity(in.Granularity) {
		return nil, fmt.Errorf("非法拆分粒度: %s", in.Granularity)
	}
	if in.FileType != "PDF" {
		in.FileType = "IMAGE"
	}
	doc := &model.QADocument{
		Title:            in.Title,
		MediaFileID:      &in.MediaFileID,
		FileType:         in.FileType,
		SplitGranularity: in.Granularity,
		Status:           qatree.StatusUploaded,
		OwnerID:          in.UserID,
		CreatedBy:        in.UserID,
	}
	created, err := s.repo.CreateDocument(ctx, doc)
	if err != nil {
		return nil, err
	}
	s.audit(ctx, created.ID, in.UserID, "upload", nil, ptr(qatree.StatusUploaded), map[string]any{"granularity": in.Granularity})

	// 入队 PREPROCESS，开启自动流水线。
	if err := s.startPipeline(ctx, created, qatree.StagePreprocess, nil); err != nil {
		log.Warn().Err(err).Int64("doc", created.ID).Msg("qa: enqueue preprocess failed")
	}
	return created, nil
}

// startPipeline 把文档置为起始阶段的运行状态并入队对应 job（新 run）。
func (s *QAService) startPipeline(ctx context.Context, doc *model.QADocument, startStage string, pages json.RawMessage) error {
	run := fmt.Sprintf("%d", time.Now().UnixNano())
	payload := qaJobPayload{Run: run, Pages: pages}
	if running := qatree.StageRunningStatus(startStage); running != "" {
		_ = s.transition(ctx, doc, running, nil)
	} else if startStage != qatree.StagePreprocess {
		// SEGMENT/OCR/... 重入：先回到合理的前置状态再推进（reprocess 用）。
	}
	return s.enqueue(ctx, doc.ID, startStage, run, payload)
}

func (s *QAService) enqueue(ctx context.Context, docID int64, stage, run string, payload qaJobPayload) error {
	payload.Run = run
	_, err := s.repo.EnqueueJob(ctx, &model.QADocumentJob{
		DocumentID:     docID,
		Stage:          stage,
		IdempotencyKey: fmt.Sprintf("doc:%d:%s:%s", docID, stage, run),
		MaxAttempts:    3,
		Payload:        mustJSON(payload),
	})
	return err
}

// transition 校验并执行状态迁移（带审计）。
func (s *QAService) transition(ctx context.Context, doc *model.QADocument, to string, actor *int64) error {
	from := doc.Status
	if from == to {
		return nil
	}
	if !qatree.CanTransition(from, to) {
		return fmt.Errorf("%w: %s→%s", ErrInvalidTransition, from, to)
	}
	if err := s.repo.UpdateStatus(ctx, doc.ID, to, nil); err != nil {
		return err
	}
	doc.Status = to
	s.audit(ctx, doc.ID, actor, "transition", ptr(from), ptr(to), nil)
	return nil
}

func (s *QAService) fail(ctx context.Context, docID int64, stage string, cause error) {
	msg := fmt.Sprintf("[%s] %v", stage, cause)
	_ = s.repo.UpdateStatus(ctx, docID, qatree.StatusFailed, &msg)
	s.audit(ctx, docID, nil, "fail", nil, ptr(qatree.StatusFailed), map[string]any{"stage": stage, "error": cause.Error()})
}

func (s *QAService) audit(ctx context.Context, docID int64, actor *int64, action string, from, to *string, detail any) {
	if err := s.repo.AppendAudit(ctx, docID, actor, action, from, to, detail); err != nil {
		log.Warn().Err(err).Int64("doc", docID).Str("action", action).Msg("qa: append audit failed")
	}
}

// ---------------- 读取 ----------------

// ListDocuments 返回后台文档分页列表。
func (s *QAService) ListDocuments(ctx context.Context, f repository.QADocFilter) ([]model.QADocument, int64, error) {
	return s.repo.ListDocuments(ctx, f)
}

// QADocumentDetail 是文档详情聚合。
type QADocumentDetail struct {
	Document *model.QADocument        `json:"document"`
	Jobs     []model.QADocumentJob    `json:"jobs"`
	Version  *model.QADocumentVersion `json:"currentVersion"`
}

// GetDetail 返回文档详情（含 jobs 与当前版本元信息）。
func (s *QAService) GetDetail(ctx context.Context, id int64) (*QADocumentDetail, error) {
	doc, err := s.repo.GetDocument(ctx, id)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, ErrNotFound
	}
	jobs, err := s.repo.ListJobs(ctx, id)
	if err != nil {
		return nil, err
	}
	var ver *model.QADocumentVersion
	if doc.CurrentVersion > 0 {
		ver, _ = s.repo.GetVersionByNo(ctx, id, doc.CurrentVersion)
	}
	return &QADocumentDetail{Document: doc, Jobs: jobs, Version: ver}, nil
}

// ListJobs 返回流水线任务。
func (s *QAService) ListJobs(ctx context.Context, id int64) ([]model.QADocumentJob, error) {
	return s.repo.ListJobs(ctx, id)
}

// GetTree 返回指定（或当前）版本的 Canonical Tree。
func (s *QAService) GetTree(ctx context.Context, docID int64, versionNo int) ([]*qatree.Node, *model.QADocumentVersion, error) {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return nil, nil, ErrNotFound
	}
	vn := versionNo
	if vn <= 0 {
		vn = doc.CurrentVersion
	}
	if vn <= 0 {
		return []*qatree.Node{}, nil, nil
	}
	ver, err := s.repo.GetVersionByNo(ctx, docID, vn)
	if err != nil || ver == nil {
		return nil, nil, ErrNotFound
	}
	roots, err := decodeTree(ver.TreeJSON)
	return roots, ver, err
}

// ---------------- 校对 / 标注 ----------------

// qaEditableStatus 是允许人工编辑 block 的状态集合。处理中（UPLOADED..STRUCTURED /
// AGENT_RUNNING）、已发布（PUBLISHED）、失败（FAILED）都不可编辑。
var qaEditableStatus = map[string]bool{
	qatree.StatusReviewReady:   true,
	qatree.StatusAnnotated:     true,
	qatree.StatusPatchProposed: true,
	qatree.StatusMerged:        true,
	qatree.StatusDiffReady:     true,
	qatree.StatusApproved:      true,
}

// EditBlock 人工编辑某 block 文本，落为 MANUAL 新版本。
// 仅在校对/评审相关状态可编辑；若文档已 APPROVED，编辑会产生未经审批的新版本，
// 因此回退到 REVIEW_READY 强制重新审批（避免 Publish 把未审版本写入题库）。
func (s *QAService) EditBlock(ctx context.Context, docID int64, stableKey, text string, actor *int64) (*model.QADocumentVersion, error) {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return nil, ErrNotFound
	}
	if !qaEditableStatus[doc.Status] {
		return nil, fmt.Errorf("%w: 当前状态 %s 不允许编辑 block", ErrInvalidTransition, doc.Status)
	}
	roots, _, err := s.GetTree(ctx, docID, 0)
	if err != nil {
		return nil, err
	}
	idx := qatree.Index(roots)
	node, ok := idx[stableKey]
	if !ok {
		return nil, fmt.Errorf("%w: block %s", ErrNotFound, stableKey)
	}
	node.Text = text
	wasApproved := doc.Status == qatree.StatusApproved
	ver, err := s.commitVersion(ctx, doc, roots, qatree.VersionSourceManual, ptr("人工编辑 "+stableKey), actor)
	if err != nil {
		return nil, err
	}
	if wasApproved {
		// 新的 MANUAL 版本尚未审批 —— 退回评审态，必须重新审批才能发布。
		_ = s.transition(ctx, doc, qatree.StatusReviewReady, actor)
	}
	s.audit(ctx, docID, actor, "edit_block", nil, nil, map[string]any{"stableKey": stableKey, "reopened": wasApproved})
	return ver, nil
}

// CreateAnnotation 新建标注；若文档处于 REVIEW_READY 则推进为 ANNOTATED。
func (s *QAService) CreateAnnotation(ctx context.Context, docID int64, a *model.QAAnnotation, actor *int64) (*model.QAAnnotation, error) {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return nil, ErrNotFound
	}
	a.DocumentID = docID
	a.CreatedBy = actor
	if doc.CurrentVersion > 0 {
		if ver, _ := s.repo.GetVersionByNo(ctx, docID, doc.CurrentVersion); ver != nil {
			a.VersionID = &ver.ID
		}
	}
	out, err := s.repo.CreateAnnotation(ctx, a)
	if err != nil {
		return nil, err
	}
	if doc.Status == qatree.StatusReviewReady {
		_ = s.transition(ctx, doc, qatree.StatusAnnotated, actor)
	}
	s.audit(ctx, docID, actor, "annotate", nil, nil, map[string]any{"type": a.AnnotationType, "stableKey": a.StableKey})
	return out, nil
}

// ListAnnotations 返回标注。
func (s *QAService) ListAnnotations(ctx context.Context, docID int64) ([]model.QAAnnotation, error) {
	return s.repo.ListAnnotations(ctx, docID)
}

// UpdateAnnotation 更新标注。
func (s *QAService) UpdateAnnotation(ctx context.Context, docID, id int64, correctedText, note, status *string) (*model.QAAnnotation, error) {
	existing, err := s.repo.GetAnnotation(ctx, docID, id)
	if err != nil || existing == nil {
		return nil, ErrNotFound
	}
	return s.repo.UpdateAnnotation(ctx, id, correctedText, note, status)
}

// DeleteAnnotation 删除标注。
func (s *QAService) DeleteAnnotation(ctx context.Context, docID, id int64) error {
	return s.repo.DeleteAnnotation(ctx, docID, id)
}

// ---------------- Agent 修复 ----------------

// TriggerAgentFix 入队 AGENT_FIX 任务（异步），文档→AGENT_RUNNING。
func (s *QAService) TriggerAgentFix(ctx context.Context, docID int64, actor *int64) error {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return ErrNotFound
	}
	if !qatree.CanTransition(doc.Status, qatree.StatusAgentRunning) {
		return fmt.Errorf("%w: 当前状态 %s 不能触发 Agent 修复", ErrInvalidTransition, doc.Status)
	}
	if err := s.transition(ctx, doc, qatree.StatusAgentRunning, actor); err != nil {
		return err
	}
	run := fmt.Sprintf("%d", time.Now().UnixNano())
	return s.enqueue(ctx, docID, qatree.StageAgentFix, run, qaJobPayload{Run: run})
}

// ListPatches 返回 Patch 列表。
func (s *QAService) ListPatches(ctx context.Context, docID int64) ([]model.QAPatch, error) {
	return s.repo.ListPatches(ctx, docID)
}

// GetPatch 返回单个 Patch。
func (s *QAService) GetPatch(ctx context.Context, docID, id int64) (*model.QAPatch, error) {
	p, err := s.repo.GetPatch(ctx, docID, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, ErrNotFound
	}
	return p, nil
}

// ---------------- 合并 / Diff ----------------

// MergePatch 把 Patch 合并到当前版本，产出新候选版本 + Diff（冲突进入人工处理）。
func (s *QAService) MergePatch(ctx context.Context, docID, patchID int64, actor *int64) (*model.QADocumentDiff, error) {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return nil, ErrNotFound
	}
	patch, err := s.repo.GetPatch(ctx, docID, patchID)
	if err != nil || patch == nil {
		return nil, ErrNotFound
	}
	if patch.Status != "PROPOSED" {
		return nil, fmt.Errorf("Patch 状态为 %s，不可合并", patch.Status)
	}
	if !qatree.CanTransition(doc.Status, qatree.StatusMerged) {
		return nil, fmt.Errorf("%w: 当前状态 %s 不能合并", ErrInvalidTransition, doc.Status)
	}

	current, currentVer, err := s.GetTree(ctx, docID, 0)
	if err != nil {
		return nil, err
	}
	var p qatree.Patch
	if err := json.Unmarshal(patch.Operations, &p.Operations); err != nil {
		return nil, fmt.Errorf("解析 patch operations: %w", err)
	}
	res := qatree.ApplyPatch(current, p)
	diffResult := qatree.Diff(current, res.Tree, currentVerNo(currentVer), doc.CurrentVersion+1)
	diffResult.Conflicts = res.Conflicts

	// 落新版本（MERGE 来源）。
	newVer, err := s.commitVersion(ctx, doc, res.Tree, qatree.VersionSourceMerge, ptr("合并 Patch #"+fmt.Sprint(patchID)), actor)
	if err != nil {
		return nil, err
	}

	diffJSON := mustJSON(diffResult)
	var fromID *int64
	if currentVer != nil {
		fromID = &currentVer.ID
	}
	diffRow, err := s.repo.CreateDiff(ctx, &model.QADocumentDiff{
		DocumentID:  docID,
		PatchID:     &patchID,
		FromVersion: fromID,
		ToVersion:   &newVer.ID,
		DiffLevel:   diffResult.Level,
		HasConflict: len(res.Conflicts) > 0,
		Diff:        diffJSON,
	})
	if err != nil {
		return nil, err
	}

	// 状态：PATCH_PROPOSED→MERGED→DIFF_READY。
	_ = s.transition(ctx, doc, qatree.StatusMerged, actor)
	_ = s.transition(ctx, doc, qatree.StatusDiffReady, actor)
	patchStatus := "MERGED"
	if len(res.Conflicts) > 0 {
		patchStatus = "CONFLICT"
	}
	_ = s.repo.UpdatePatchStatus(ctx, patchID, patchStatus)
	s.audit(ctx, docID, actor, "merge", nil, nil, map[string]any{
		"patchId": patchID, "applied": res.Applied, "conflicts": len(res.Conflicts), "diffLevel": diffResult.Level,
	})
	return diffRow, nil
}

// GetDiff 返回 Diff。
func (s *QAService) GetDiff(ctx context.Context, docID, id int64) (*model.QADocumentDiff, error) {
	d, err := s.repo.GetDiff(ctx, docID, id)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, ErrNotFound
	}
	return d, nil
}

// ---------------- 审批 / 发布 ----------------

// Approve 审批候选版本（DIFF_READY→APPROVED）。
// 安全闸门：若最近一次合并仍带未解决冲突、且该冲突版本就是当前版本（未被后续人工
// 修订版本覆盖），拒绝审批 —— 避免把部分应用/冲突的合并直接审批发布。
func (s *QAService) Approve(ctx context.Context, docID, versionID int64, actor *int64) error {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return ErrNotFound
	}
	// 防陈旧审批：若评审者打开页面后又有人产生了更新版本，提交的 versionId 与当前版本
	// 不一致时拒绝 —— 避免误把"评审者没看过的版本"审批通过。versionId 为评审时的版本号。
	if versionID > 0 && doc.CurrentVersion > 0 && versionID != int64(doc.CurrentVersion) {
		return fmt.Errorf("%w: 待审批版本(v%d)已更新到 v%d，请刷新后重新审阅", ErrInvalidTransition, versionID, doc.CurrentVersion)
	}
	if diff, _ := s.repo.GetLatestDiff(ctx, docID); diff != nil && diff.HasConflict {
		if diff.ToVersion != nil && *diff.ToVersion == s.currentVersionID(ctx, doc) {
			return fmt.Errorf("%w: 当前合并存在未解决冲突，请先在校对页处理冲突后再审批", ErrInvalidTransition)
		}
	}
	if err := s.transition(ctx, doc, qatree.StatusApproved, actor); err != nil {
		return err
	}
	s.audit(ctx, docID, actor, "approve", nil, ptr(qatree.StatusApproved), map[string]any{"versionId": versionID})
	return nil
}

// ListDiffs 返回文档的 Diff 列表（供详情页刷新后恢复历史 Diff，最新在前）。
func (s *QAService) ListDiffs(ctx context.Context, docID int64) ([]model.QADocumentDiff, error) {
	return s.repo.ListDiffs(ctx, docID)
}

// currentVersionID 返回当前版本号对应的版本行 id（无则 0）。
func (s *QAService) currentVersionID(ctx context.Context, doc *model.QADocument) int64 {
	if doc.CurrentVersion <= 0 {
		return 0
	}
	if v, _ := s.repo.GetVersionByNo(ctx, doc.ID, doc.CurrentVersion); v != nil {
		return v.ID
	}
	return 0
}

// Publish 发布当前已审批版本入库，写 qa_questions（APPROVED→PUBLISHED）。
func (s *QAService) Publish(ctx context.Context, docID int64, actor *int64) (int, error) {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return 0, ErrNotFound
	}
	if doc.Status != qatree.StatusApproved {
		return 0, fmt.Errorf("%w: 仅 APPROVED 文档可发布（当前 %s）", ErrInvalidTransition, doc.Status)
	}
	roots, _, err := s.GetTree(ctx, docID, 0)
	if err != nil {
		return 0, err
	}
	questions := treeToQuestions(roots, doc.CurrentVersion, actor)
	if len(questions) == 0 {
		return 0, fmt.Errorf("当前版本未解析出任何题目，无法发布")
	}
	for i := range questions {
		questions[i].DocumentID = docID
	}
	n, err := s.repo.PublishQuestions(ctx, docID, doc.CurrentVersion, questions)
	if err != nil {
		return 0, err
	}
	if err := s.transition(ctx, doc, qatree.StatusPublished, actor); err != nil {
		return 0, err
	}
	s.audit(ctx, docID, actor, "publish", nil, ptr(qatree.StatusPublished), map[string]any{"questionCount": n, "versionNo": doc.CurrentVersion})
	return n, nil
}

// ListQuestions 返回已发布题目。
func (s *QAService) ListQuestions(ctx context.Context, docID int64) ([]model.QAQuestion, error) {
	return s.repo.ListQuestions(ctx, docID)
}

// ListAudit 返回审计日志。
func (s *QAService) ListAudit(ctx context.Context, docID int64) ([]model.QAAuditLog, error) {
	return s.repo.ListAudit(ctx, docID)
}

// ---------------- 删除 / 重跑 ----------------

// DeleteDocument 软删除文档。
func (s *QAService) DeleteDocument(ctx context.Context, docID int64, actor *int64) error {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return ErrNotFound
	}
	if err := s.repo.SoftDeleteDocument(ctx, docID); err != nil {
		return err
	}
	s.audit(ctx, docID, actor, "delete", nil, nil, nil)
	return nil
}

// Reprocess 从指定阶段重跑自动流水线。
func (s *QAService) Reprocess(ctx context.Context, docID int64, stage string, actor *int64) error {
	doc, err := s.repo.GetDocument(ctx, docID)
	if err != nil || doc == nil {
		return ErrNotFound
	}
	// 守卫：已发布 / 已审批 / Agent 运行中不可重跑。PUBLISHED 重跑会留下孤儿
	// qa_questions 且把文档拉回进行中态；APPROVED 会丢弃已审批版本；AGENT_RUNNING
	// 有在飞任务会与新 run 竞争。其余状态（含 FAILED / 处理中 / 评审态）允许整链重跑。
	switch doc.Status {
	case qatree.StatusPublished, qatree.StatusApproved, qatree.StatusAgentRunning:
		return fmt.Errorf("%w: 当前状态 %s 不允许重跑流水线", ErrInvalidTransition, doc.Status)
	}
	// 始终从 PREPROCESS 全量重跑：SEGMENT/OCR/STRUCTURE/QUALITY_CHECK 都依赖前序
	// 阶段在 job payload 里串联的 pages/blocks/ocr 产物，无法脱离前序独立重入
	// （单独入队中途阶段会因缺少 payload 失败、或状态机迁移非法卡死）。stage 入参
	// 仅作审计记录的"用户意图"，实际执行恒为完整流水线。
	_ = stage
	if err := s.repo.UpdateStatus(ctx, docID, qatree.StatusPreprocessing, nil); err != nil {
		return err
	}
	doc.Status = qatree.StatusPreprocessing
	s.audit(ctx, docID, actor, "reprocess", nil, ptr(qatree.StatusPreprocessing), map[string]any{"requestedStage": stage, "actualStage": qatree.StagePreprocess})
	run := fmt.Sprintf("%d", time.Now().UnixNano())
	return s.enqueue(ctx, docID, qatree.StagePreprocess, run, qaJobPayload{Run: run})
}

// ---------------- 内部辅助 ----------------

// commitVersion 落一个新版本快照并更新 current_version。
func (s *QAService) commitVersion(ctx context.Context, doc *model.QADocument, roots []*qatree.Node, source string, note *string, actor *int64) (*model.QADocumentVersion, error) {
	vn, err := s.repo.NextVersionNo(ctx, doc.ID)
	if err != nil {
		return nil, err
	}
	ver, err := s.repo.CreateVersion(ctx, doc.ID, vn, source, roots, note, actor)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SetCurrentVersion(ctx, doc.ID, vn); err != nil {
		return nil, err
	}
	doc.CurrentVersion = vn
	return ver, nil
}

func decodeTree(raw []byte) ([]*qatree.Node, error) {
	if len(raw) == 0 {
		return []*qatree.Node{}, nil
	}
	var roots []*qatree.Node
	if err := json.Unmarshal(raw, &roots); err != nil {
		return nil, fmt.Errorf("解析 tree_json: %w", err)
	}
	return roots, nil
}

func currentVerNo(v *model.QADocumentVersion) int {
	if v == nil {
		return 0
	}
	return v.VersionNo
}

func ptr[T any](v T) *T { return &v }

// treeToQuestions 把 Canonical Tree 转换为 qa_questions 记录（带 source_block_ids 溯源）。
func treeToQuestions(roots []*qatree.Node, versionNo int, actor *int64) []model.QAQuestion {
	var questions []model.QAQuestion
	order := 0
	var walk func(n *qatree.Node)
	walk = func(n *qatree.Node) {
		if n.BlockType == qatree.BlockQuestion {
			q := buildQuestion(n, versionNo, order, actor)
			questions = append(questions, q)
			order++
			return // 题目内部不再下钻为独立题
		}
		for _, c := range n.Children {
			walk(c)
		}
	}
	for _, r := range roots {
		walk(r)
	}
	// 粗/标准粒度无 QUESTION 节点时，回退：每个叶子 PAGE/BLOCK 作为一题。
	if len(questions) == 0 {
		for _, fn := range qatree.Flatten(roots) {
			n := fn.Node
			if len(n.Children) == 0 && (n.BlockType == qatree.BlockPage || n.BlockType == qatree.BlockBlock) {
				questions = append(questions, model.QAQuestion{
					VersionNo: versionNo, QuestionType: "RAW", Stem: n.Text,
					Options: []byte("[]"), SourceBlockIDs: mustJSON([]string{n.StableKey}),
					OrderIndex: order, CreatedBy: actor,
				})
				order++
			}
		}
	}
	return questions
}

func buildQuestion(q *qatree.Node, versionNo, order int, actor *int64) model.QAQuestion {
	var stem, answer, analysis string
	var options []string
	srcIDs := []string{q.StableKey}
	for _, c := range q.Children {
		srcIDs = append(srcIDs, c.StableKey)
		switch c.BlockType {
		case qatree.BlockStem:
			stem = c.Text
		case qatree.BlockOption:
			options = append(options, c.Text)
		case qatree.BlockAnswer:
			answer = c.Text
		case qatree.BlockAnalysis:
			analysis = c.Text
		}
	}
	if stem == "" {
		stem = q.Text
	}
	return model.QAQuestion{
		VersionNo:      versionNo,
		QuestionType:   "CHOICE",
		Stem:           stem,
		Options:        mustJSON(options),
		Answer:         nilIfEmpty(answer),
		Analysis:       nilIfEmpty(analysis),
		SourceBlockIDs: mustJSON(srcIDs),
		OrderIndex:     order,
		CreatedBy:      actor,
	}
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
