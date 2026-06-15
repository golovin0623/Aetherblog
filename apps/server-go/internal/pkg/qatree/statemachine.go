package qatree

// 状态机状态常量（契约 §1）。
const (
	StatusUploaded      = "UPLOADED"
	StatusPreprocessing = "PREPROCESSING"
	StatusSegmented     = "SEGMENTED"
	StatusOCRDone       = "OCR_DONE"
	StatusStructured    = "STRUCTURED"
	StatusReviewReady   = "REVIEW_READY"
	StatusAnnotated     = "ANNOTATED"
	StatusAgentRunning  = "AGENT_RUNNING"
	StatusPatchProposed = "PATCH_PROPOSED"
	StatusMerged        = "MERGED"
	StatusDiffReady     = "DIFF_READY"
	StatusApproved      = "APPROVED"
	StatusPublished     = "PUBLISHED"
	StatusFailed        = "FAILED"
)

// 版本来源常量（qa_document_versions.source）。
const (
	VersionSourceOCR       = "OCR"
	VersionSourceStructure = "STRUCTURE"
	VersionSourceAgent     = "AGENT"
	VersionSourceMerge     = "MERGE"
	VersionSourceManual    = "MANUAL"
)

// 流水线阶段常量（qa_document_jobs.stage）。
const (
	StagePreprocess   = "PREPROCESS"
	StageSegment      = "SEGMENT"
	StageOCR          = "OCR"
	StageStructure    = "STRUCTURE"
	StageQualityCheck = "QUALITY_CHECK"
	StageAgentFix     = "AGENT_FIX"
	StageMerge        = "MERGE"
	StagePublish      = "PUBLISH"
)

// transitions 是合法状态迁移表（契约 §1）。
var transitions = map[string]map[string]bool{
	StatusUploaded:      set2(StatusPreprocessing, StatusFailed),
	StatusPreprocessing: set2(StatusSegmented, StatusFailed),
	StatusSegmented:     set2(StatusOCRDone, StatusFailed),
	StatusOCRDone:       set2(StatusStructured, StatusFailed),
	StatusStructured:    set2(StatusReviewReady, StatusFailed),
	StatusReviewReady:   set2(StatusAnnotated, StatusAgentRunning, StatusFailed),
	StatusAnnotated:     set2(StatusAgentRunning, StatusReviewReady, StatusFailed),
	StatusAgentRunning:  set2(StatusPatchProposed, StatusFailed),
	StatusPatchProposed: set2(StatusMerged, StatusReviewReady, StatusAnnotated, StatusFailed),
	StatusMerged:        set2(StatusDiffReady, StatusFailed),
	StatusDiffReady:     set2(StatusApproved, StatusReviewReady, StatusFailed),
	StatusApproved:      set2(StatusPublished, StatusFailed),
	StatusPublished:     {},
	// FAILED 允许 reprocess 重入自动流水线的任意阶段。
	StatusFailed: set2(StatusPreprocessing, StatusSegmented, StatusOCRDone, StatusStructured, StatusReviewReady),
}

func set2(items ...string) map[string]bool { return set(items...) }

// CanTransition 判断状态迁移 from→to 是否合法。
func CanTransition(from, to string) bool {
	if from == to {
		return true
	}
	allowed, ok := transitions[from]
	if !ok {
		return false
	}
	return allowed[to]
}

// autoPipeline 是上传后自动串行推进的阶段顺序。
var autoPipeline = []string{StagePreprocess, StageSegment, StageOCR, StageStructure, StageQualityCheck}

// AutoPipelineStages 返回自动流水线阶段顺序的副本。
func AutoPipelineStages() []string {
	out := make([]string, len(autoPipeline))
	copy(out, autoPipeline)
	return out
}

// NextAutoStage 返回给定阶段在自动流水线中的下一阶段；末尾返回空串。
func NextAutoStage(stage string) string {
	for i, s := range autoPipeline {
		if s == stage && i+1 < len(autoPipeline) {
			return autoPipeline[i+1]
		}
	}
	return ""
}

// stageResultStatus 是各阶段成功后文档应进入的状态。
var stageResultStatus = map[string]string{
	StagePreprocess:   StatusPreprocessing, // 预处理进行中→完成段（实际完成后由 worker 推进为 SEGMENTED 前的过渡）
	StageSegment:      StatusSegmented,
	StageOCR:          StatusOCRDone,
	StageStructure:    StatusStructured,
	StageQualityCheck: StatusReviewReady,
	StageAgentFix:     StatusPatchProposed,
	StageMerge:        StatusDiffReady,
	StagePublish:      StatusPublished,
}

// StageRunningStatus 返回某阶段执行期间文档应处的"进行中"状态。
func StageRunningStatus(stage string) string {
	switch stage {
	case StagePreprocess:
		return StatusPreprocessing
	case StageAgentFix:
		return StatusAgentRunning
	case StageMerge:
		return StatusMerged
	default:
		return ""
	}
}

// StageSuccessStatus 返回某阶段成功后文档应进入的状态。
func StageSuccessStatus(stage string) string {
	return stageResultStatus[stage]
}

// ReprocessStartStage 把 reprocess 请求的目标阶段映射为合法的自动阶段；
// 非自动阶段或空值回退到 PREPROCESS。
func ReprocessStartStage(stage string) string {
	for _, s := range autoPipeline {
		if s == stage {
			return s
		}
	}
	return StagePreprocess
}
