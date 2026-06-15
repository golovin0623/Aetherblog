package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/qatree"
)

// QAWorker 是 QA 流水线的进程内异步 Worker：轮询 qa_document_jobs 的 PENDING 任务，
// 按 stage 分发到对应处理器。每阶段幂等、可重试（attempt<max 重回 PENDING）、留痕。
// 模式同 SyncService（atomic.Bool + context 取消，Shutdown 时随 bgCtx 退出）。
type QAWorker struct {
	svc          *QAService
	pollInterval time.Duration
	running      atomic.Bool
	cancel       atomic.Pointer[context.CancelFunc]
}

// jobLease 是 RUNNING 任务的租约时长。超过此时长仍 RUNNING 视为进程崩溃遗留，
// 由 reclaim 回收。须远大于单任务超时（3min），避免误伤健康实例正在执行的任务。
const jobLease = 10 * time.Minute

// reclaimInterval 是 reclaim 扫描周期。
const reclaimInterval = time.Minute

// NewQAWorker 创建 QAWorker。
func NewQAWorker(svc *QAService) *QAWorker {
	return &QAWorker{svc: svc, pollInterval: 2 * time.Second}
}

// Start 启动 Worker 轮询循环（幂等：重复调用只启动一次）。
func (w *QAWorker) Start(ctx context.Context) {
	if !w.running.CompareAndSwap(false, true) {
		return
	}
	loopCtx, cancel := context.WithCancel(ctx)
	w.cancel.Store(&cancel)
	go w.loop(loopCtx)
	log.Info().Dur("poll", w.pollInterval).Msg("qa worker started")
}

// Stop 停止 Worker。
func (w *QAWorker) Stop() {
	if c := w.cancel.Load(); c != nil {
		(*c)()
	}
	w.running.Store(false)
}

func (w *QAWorker) loop(ctx context.Context) {
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()
	w.reclaimStale(ctx) // 启动即回收一次崩溃遗留的 RUNNING 任务
	lastReclaim := time.Now()
	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("qa worker stopped")
			return
		case <-ticker.C:
			if time.Since(lastReclaim) >= reclaimInterval {
				w.reclaimStale(ctx)
				lastReclaim = time.Now()
			}
			w.drain(ctx)
		}
	}
}

// reclaimStale 回收租约过期（崩溃遗留）的 RUNNING 任务，使其可被重新领取或终态化。
func (w *QAWorker) reclaimStale(ctx context.Context) {
	n, err := w.svc.repo.ReclaimStaleJobs(ctx, time.Now().Add(-jobLease))
	if err != nil {
		log.Warn().Err(err).Msg("qa worker: reclaim stale jobs failed")
		return
	}
	if n > 0 {
		log.Info().Int64("reclaimed", n).Msg("qa worker: reclaimed stale RUNNING jobs")
	}
}

// drain 连续领取并执行 PENDING 任务，直到队列空或 ctx 取消。
func (w *QAWorker) drain(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		job, err := w.svc.repo.ClaimNextPendingJob(ctx)
		if err != nil {
			log.Warn().Err(err).Msg("qa worker: claim job failed")
			return
		}
		if job == nil {
			return
		}
		w.runJob(ctx, job)
	}
}

// runJob 执行单个任务并按结果落终态/重试。
func (w *QAWorker) runJob(ctx context.Context, job *model.QADocumentJob) {
	// 每个任务给一个独立超时，避免单步卡死整个 worker。
	jobCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	err := w.dispatch(jobCtx, job)
	if err == nil {
		_ = w.svc.repo.MarkJobSucceeded(ctx, job.ID, fmt.Sprintf("stage %s ok (attempt %d)", job.Stage, job.AttemptCount))
		return
	}
	retry, mErr := w.svc.repo.MarkJobOutcome(ctx, job, err.Error())
	if mErr != nil {
		log.Error().Err(mErr).Int64("job", job.ID).Msg("qa worker: mark outcome failed")
	}
	if retry {
		log.Warn().Err(err).Int64("job", job.ID).Str("stage", job.Stage).
			Int("attempt", job.AttemptCount).Msg("qa worker: stage failed, will retry")
		return
	}
	log.Error().Err(err).Int64("job", job.ID).Str("stage", job.Stage).Msg("qa worker: stage failed permanently")
	w.svc.fail(ctx, job.DocumentID, job.Stage, err)
}

// dispatch 把任务按 stage 路由到处理器。
func (w *QAWorker) dispatch(ctx context.Context, job *model.QADocumentJob) error {
	var payload qaJobPayload
	if len(job.Payload) > 0 {
		_ = json.Unmarshal(job.Payload, &payload)
	}
	switch job.Stage {
	case qatree.StagePreprocess:
		return w.stagePreprocess(ctx, job, payload)
	case qatree.StageSegment:
		return w.stageSegment(ctx, job, payload)
	case qatree.StageOCR:
		return w.stageOCR(ctx, job, payload)
	case qatree.StageStructure:
		return w.stageStructure(ctx, job, payload)
	case qatree.StageQualityCheck:
		return w.stageQualityCheck(ctx, job, payload)
	case qatree.StageAgentFix:
		return w.stageAgentFix(ctx, job, payload)
	default:
		return fmt.Errorf("未知阶段: %s", job.Stage)
	}
}

func (w *QAWorker) loadDoc(ctx context.Context, id int64) (*model.QADocument, error) {
	doc, err := w.svc.repo.GetDocument(ctx, id)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, fmt.Errorf("文档 %d 不存在", id)
	}
	return doc, nil
}

// advance 尽力推进状态；非法迁移只记日志不阻断阶段（幂等重跑容忍）。
func (w *QAWorker) advance(ctx context.Context, doc *model.QADocument, to string) {
	if err := w.svc.transition(ctx, doc, to, nil); err != nil {
		log.Debug().Err(err).Int64("doc", doc.ID).Str("to", to).Msg("qa worker: advance skipped")
	}
}

func (w *QAWorker) stagePreprocess(ctx context.Context, job *model.QADocumentJob, payload qaJobPayload) error {
	doc, err := w.loadDoc(ctx, job.DocumentID)
	if err != nil {
		return err
	}
	w.advance(ctx, doc, qatree.StatusPreprocessing)
	if doc.MediaFileID == nil {
		return fmt.Errorf("文档无关联媒体文件")
	}
	url, mime, err := w.svc.media.ResolveURL(ctx, *doc.MediaFileID)
	if err != nil {
		return fmt.Errorf("解析媒体 URL: %w", err)
	}
	_ = mime
	pages, n, err := w.svc.pipeline.Preprocess(ctx, doc.ID, url, doc.FileType, doc.PageCount)
	if err != nil {
		return err
	}
	if err := w.svc.repo.SetPageCount(ctx, doc.ID, n); err != nil {
		return err
	}
	return w.svc.enqueue(ctx, doc.ID, qatree.StageSegment, payload.Run, qaJobPayload{Pages: pages})
}

func (w *QAWorker) stageSegment(ctx context.Context, job *model.QADocumentJob, payload qaJobPayload) error {
	doc, err := w.loadDoc(ctx, job.DocumentID)
	if err != nil {
		return err
	}
	blocks, err := w.svc.pipeline.Segment(ctx, payload.Pages, doc.SplitGranularity)
	if err != nil {
		return err
	}
	w.advance(ctx, doc, qatree.StatusSegmented)
	return w.svc.enqueue(ctx, doc.ID, qatree.StageOCR, payload.Run, qaJobPayload{Blocks: blocks})
}

func (w *QAWorker) stageOCR(ctx context.Context, job *model.QADocumentJob, payload qaJobPayload) error {
	doc, err := w.loadDoc(ctx, job.DocumentID)
	if err != nil {
		return err
	}
	ocr, err := w.svc.pipeline.OCR(ctx, payload.Blocks)
	if err != nil {
		return err
	}
	w.advance(ctx, doc, qatree.StatusOCRDone)
	return w.svc.enqueue(ctx, doc.ID, qatree.StageStructure, payload.Run, qaJobPayload{Blocks: payload.Blocks, OCR: ocr})
}

func (w *QAWorker) stageStructure(ctx context.Context, job *model.QADocumentJob, payload qaJobPayload) error {
	doc, err := w.loadDoc(ctx, job.DocumentID)
	if err != nil {
		return err
	}
	roots, err := w.svc.pipeline.Structure(ctx, payload.Blocks, payload.OCR, doc.SplitGranularity)
	if err != nil {
		return err
	}
	if _, err := w.svc.commitVersion(ctx, doc, roots, qatree.VersionSourceStructure, ptr("OCR/结构化初版"), nil); err != nil {
		return err
	}
	w.advance(ctx, doc, qatree.StatusStructured)
	return w.svc.enqueue(ctx, doc.ID, qatree.StageQualityCheck, payload.Run, qaJobPayload{})
}

func (w *QAWorker) stageQualityCheck(ctx context.Context, job *model.QADocumentJob, _ qaJobPayload) error {
	doc, err := w.loadDoc(ctx, job.DocumentID)
	if err != nil {
		return err
	}
	roots, ver, err := w.svc.GetTree(ctx, doc.ID, 0)
	if err != nil {
		return err
	}
	issues, err := w.svc.pipeline.QualityCheck(ctx, roots)
	if err != nil {
		return err
	}
	var verID *int64
	if ver != nil {
		verID = &ver.ID
	}
	for _, iss := range issues {
		at := mapIssueToAnnotationType(iss.Type)
		if at == "" {
			continue // 信息类问题（如低置信度）不落为待办标注，仅记日志
		}
		note := iss.Message
		// 记录写入失败但不让阶段失败：QC 重跑会重复建标注（CreateAnnotation 非幂等），
		// 因此 best-effort 落标注 + 记日志，避免「重试→重复标注」。
		if _, err := w.svc.repo.CreateAnnotation(ctx, &model.QAAnnotation{
			DocumentID: doc.ID, VersionID: verID, StableKey: iss.StableKey,
			AnnotationType: at, Note: &note, Status: "OPEN",
		}); err != nil {
			log.Error().Err(err).Int64("doc", doc.ID).Str("key", iss.StableKey).
				Msg("qa worker: create quality-check annotation failed")
		}
	}
	w.advance(ctx, doc, qatree.StatusReviewReady)
	w.svc.audit(ctx, doc.ID, nil, "quality_check", nil, ptr(qatree.StatusReviewReady), map[string]any{"issues": len(issues)})
	return nil
}

func (w *QAWorker) stageAgentFix(ctx context.Context, job *model.QADocumentJob, _ qaJobPayload) error {
	doc, err := w.loadDoc(ctx, job.DocumentID)
	if err != nil {
		return err
	}
	roots, ver, err := w.svc.GetTree(ctx, doc.ID, 0)
	if err != nil {
		return err
	}
	if ver == nil {
		return fmt.Errorf("无可用版本，无法运行 Agent")
	}
	anns, err := w.svc.repo.ListAnnotations(ctx, doc.ID)
	if err != nil {
		return err
	}
	inputs := make([]QAAnnotationInput, 0, len(anns))
	for _, a := range anns {
		if a.Status == "DISMISSED" {
			continue
		}
		inputs = append(inputs, QAAnnotationInput{
			StableKey: a.StableKey, Type: a.AnnotationType,
			OriginalText: deref(a.OriginalText), CorrectedText: deref(a.CorrectedText), Note: deref(a.Note),
		})
	}
	patch, modelName, err := w.svc.pipeline.AgentFix(ctx, roots, inputs)
	if err != nil {
		return err
	}
	_, err = w.svc.repo.CreatePatch(ctx, &model.QAPatch{
		DocumentID:  doc.ID,
		BaseVersion: ver.ID,
		Status:      "PROPOSED",
		Summary:     ptr(patch.Summary),
		Operations:  mustJSON(patch.Operations),
		AgentModel:  &modelName,
	})
	if err != nil {
		return err
	}
	w.advance(ctx, doc, qatree.StatusPatchProposed)
	w.svc.audit(ctx, doc.ID, nil, "agent_fix", nil, ptr(qatree.StatusPatchProposed), map[string]any{"ops": len(patch.Operations), "model": modelName})
	return nil
}

// mapIssueToAnnotationType 把质检问题类型映射为标注枚举；无对应返回空串（跳过建标注）。
func mapIssueToAnnotationType(issueType string) string {
	switch issueType {
	case "TYPO":
		return "TYPO"
	case "MISSING", "MISSING_FIELD":
		return "MISSING"
	case "FORMULA_ERROR":
		return "FORMULA_ERROR"
	case "TABLE_ERROR":
		return "TABLE_ERROR"
	case "ANSWER_ERROR":
		return "ANSWER_ERROR"
	case "ANALYSIS_ERROR":
		return "ANALYSIS_ERROR"
	default:
		return ""
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
