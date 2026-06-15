package dto

// QA Document Workflow 的请求 DTO。响应直接复用 model + 解析后的树/补丁结构。

// CreateQAAnnotationRequest 新建校对标注。
// 兼容两种前端入参：annotationType（枚举码）或 category（中文标签）；
// stableKey 或 blockId（二者其一即可定位 block）。
type CreateQAAnnotationRequest struct {
	StableKey      string  `json:"stableKey"`
	BlockID        string  `json:"blockId"`
	AnnotationType string  `json:"annotationType"`
	Category       string  `json:"category"`
	OriginalText   *string `json:"originalText"`
	CorrectedText  *string `json:"correctedText"`
	Note           *string `json:"note"`
}

// UpdateQAAnnotationRequest 更新标注（纠正文本/备注/状态）。
type UpdateQAAnnotationRequest struct {
	CorrectedText *string `json:"correctedText"`
	Note          *string `json:"note"`
	Status        *string `json:"status" validate:"omitempty,oneof=OPEN RESOLVED DISMISSED"`
}

// EditQABlockRequest 人工编辑某 block 文本。
type EditQABlockRequest struct {
	StableKey string `json:"stableKey" validate:"required"`
	Text      string `json:"text"`
}

// ReprocessQARequest 从指定阶段重跑流水线。
type ReprocessQARequest struct {
	Stage string `json:"stage" validate:"omitempty,oneof=PREPROCESS SEGMENT OCR STRUCTURE QUALITY_CHECK"`
}

// ApproveQARequest 审批候选版本。
type ApproveQARequest struct {
	VersionID int64 `json:"versionId" validate:"required"`
}
