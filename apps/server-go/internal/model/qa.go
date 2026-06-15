package model

import (
	"encoding/json"
	"time"
)

// QA Document Workflow 模型族。契约源：docs/features/qa-document-workflow.md。
// 原始文件只读落 media_files；校对/修复/合并/Diff 全部基于 Canonical Document Tree
// （QADocBlock + 版本快照 QADocumentVersion）。
//
// 说明：JSON 列统一用 json.RawMessage —— 既能从 jsonb 正确 Scan，又能在 API 响应里
// 原样输出嵌套 JSON（避免 []byte 被编码成 base64）。json 标签全部 camelCase，前端直接消费。

// QADocument 对应 `qa_documents` 表，是上传文档主记录与状态机载体。
type QADocument struct {
	ID               int64     `db:"id" json:"id"`
	Title            string    `db:"title" json:"title"`
	MediaFileID      *int64    `db:"media_file_id" json:"mediaFileId,omitempty"`
	FileType         string    `db:"file_type" json:"fileType"`
	PageCount        int       `db:"page_count" json:"pageCount"`
	SplitGranularity string    `db:"split_granularity" json:"splitGranularity"`
	Status           string    `db:"status" json:"status"`
	CurrentVersion   int       `db:"current_version" json:"currentVersion"`
	ErrorMessage     *string   `db:"error_message" json:"errorMessage,omitempty"`
	OwnerID          *int64    `db:"owner_id" json:"ownerId,omitempty"`
	CreatedBy        *int64    `db:"created_by" json:"createdBy,omitempty"`
	Deleted          bool      `db:"deleted" json:"deleted"`
	CreatedAt        time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt        time.Time `db:"updated_at" json:"updatedAt"`
}

// QADocumentJob 对应 `qa_document_jobs` 表，是异步流水线的单阶段任务记录。
type QADocumentJob struct {
	ID             int64           `db:"id" json:"id"`
	DocumentID     int64           `db:"document_id" json:"documentId"`
	Stage          string          `db:"stage" json:"stage"`
	Status         string          `db:"status" json:"status"`
	IdempotencyKey string          `db:"idempotency_key" json:"-"`
	AttemptCount   int             `db:"attempt_count" json:"attempt"`
	MaxAttempts    int             `db:"max_attempts" json:"maxAttempts"`
	Payload        json.RawMessage `db:"payload" json:"-"`
	Log            *string         `db:"log" json:"log,omitempty"`
	Error          *string         `db:"error" json:"error,omitempty"`
	StartedAt      *time.Time      `db:"started_at" json:"startedAt,omitempty"`
	FinishedAt     *time.Time      `db:"finished_at" json:"finishedAt,omitempty"`
	CreatedAt      time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt      time.Time       `db:"updated_at" json:"updatedAt"`
}

// QADocumentVersion 对应 `qa_document_versions` 表，是 Canonical Tree 的整树快照。
type QADocumentVersion struct {
	ID         int64           `db:"id" json:"id"`
	DocumentID int64           `db:"document_id" json:"documentId"`
	VersionNo  int             `db:"version_no" json:"versionNo"`
	Source     string          `db:"source" json:"source"`
	TreeJSON   json.RawMessage `db:"tree_json" json:"tree,omitempty"`
	Note       *string         `db:"note" json:"note,omitempty"`
	CreatedBy  *int64          `db:"created_by" json:"createdBy,omitempty"`
	CreatedAt  time.Time       `db:"created_at" json:"createdAt"`
}

// QADocBlock 对应 `qa_doc_blocks` 表，是 Canonical Tree 的单个节点镜像（便于查询/溯源）。
type QADocBlock struct {
	ID            int64           `db:"id" json:"id"`
	DocumentID    int64           `db:"document_id" json:"documentId"`
	VersionID     int64           `db:"version_id" json:"versionId"`
	ParentID      *int64          `db:"parent_id" json:"parentId,omitempty"`
	StableKey     string          `db:"stable_key" json:"stableKey"`
	BlockType     string          `db:"block_type" json:"blockType"`
	PageNo        int             `db:"page_no" json:"pageNo"`
	BBox          json.RawMessage `db:"bbox" json:"bbox,omitempty"`
	Text          *string         `db:"text" json:"text,omitempty"`
	Confidence    float64         `db:"confidence" json:"confidence"`
	SourceCropURL *string         `db:"source_crop_url" json:"sourceCropUrl,omitempty"`
	FieldPath     *string         `db:"field_path" json:"fieldPath,omitempty"`
	OrderIndex    int             `db:"order_index" json:"orderIndex"`
	CreatedAt     time.Time       `db:"created_at" json:"createdAt"`
}

// QAAnnotation 对应 `qa_annotations` 表，是人工校对标注。
type QAAnnotation struct {
	ID             int64     `db:"id" json:"id"`
	DocumentID     int64     `db:"document_id" json:"documentId"`
	VersionID      *int64    `db:"version_id" json:"versionId,omitempty"`
	StableKey      string    `db:"stable_key" json:"stableKey"`
	AnnotationType string    `db:"annotation_type" json:"annotationType"`
	OriginalText   *string   `db:"original_text" json:"originalText,omitempty"`
	CorrectedText  *string   `db:"corrected_text" json:"correctedText,omitempty"`
	Note           *string   `db:"note" json:"note,omitempty"`
	Status         string    `db:"status" json:"status"`
	CreatedBy      *int64    `db:"created_by" json:"createdBy,omitempty"`
	CreatedAt      time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt      time.Time `db:"updated_at" json:"updatedAt"`
}

// QAPatch 对应 `qa_patches` 表，是 Agent 产出的 Patch Proposal。
type QAPatch struct {
	ID          int64           `db:"id" json:"id"`
	DocumentID  int64           `db:"document_id" json:"documentId"`
	BaseVersion int64           `db:"base_version" json:"baseVersion"`
	Status      string          `db:"status" json:"status"`
	Summary     *string         `db:"summary" json:"summary,omitempty"`
	Operations  json.RawMessage `db:"operations" json:"operations"`
	AgentModel  *string         `db:"agent_model" json:"agentModel,omitempty"`
	CreatedBy   *int64          `db:"created_by" json:"createdBy,omitempty"`
	CreatedAt   time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt   time.Time       `db:"updated_at" json:"updatedAt"`
}

// QADocumentDiff 对应 `qa_document_diffs` 表，是合并 Patch 后产生的 Diff 结果。
type QADocumentDiff struct {
	ID          int64           `db:"id" json:"id"`
	DocumentID  int64           `db:"document_id" json:"documentId"`
	PatchID     *int64          `db:"patch_id" json:"patchId,omitempty"`
	FromVersion *int64          `db:"from_version" json:"fromVersionId,omitempty"`
	ToVersion   *int64          `db:"to_version" json:"toVersionId,omitempty"`
	DiffLevel   string          `db:"diff_level" json:"diffLevel"`
	HasConflict bool            `db:"has_conflict" json:"hasConflict"`
	Diff        json.RawMessage `db:"diff" json:"diff"`
	CreatedAt   time.Time       `db:"created_at" json:"createdAt"`
}

// QAQuestion 对应 `qa_questions` 表，是审批发布后的正式题库记录（带溯源）。
type QAQuestion struct {
	ID             int64           `db:"id" json:"id"`
	DocumentID     int64           `db:"document_id" json:"documentId"`
	VersionNo      int             `db:"version_no" json:"versionNo"`
	QuestionType   string          `db:"question_type" json:"questionType"`
	Stem           string          `db:"stem" json:"stem"`
	Options        json.RawMessage `db:"options" json:"options"`
	Answer         *string         `db:"answer" json:"answer,omitempty"`
	Analysis       *string         `db:"analysis" json:"analysis,omitempty"`
	SourceBlockIDs json.RawMessage `db:"source_block_ids" json:"sourceBlockIds"`
	OrderIndex     int             `db:"order_index" json:"orderIndex"`
	CreatedBy      *int64          `db:"created_by" json:"createdBy,omitempty"`
	CreatedAt      time.Time       `db:"created_at" json:"createdAt"`
}

// QAAuditLog 对应 `qa_audit_logs` 表，是状态迁移与人工动作的审计记录。
type QAAuditLog struct {
	ID         int64           `db:"id" json:"id"`
	DocumentID int64           `db:"document_id" json:"documentId"`
	ActorID    *int64          `db:"actor_id" json:"userId,omitempty"`
	Action     string          `db:"action" json:"action"`
	FromStatus *string         `db:"from_status" json:"fromStatus,omitempty"`
	ToStatus   *string         `db:"to_status" json:"toStatus,omitempty"`
	Detail     json.RawMessage `db:"detail" json:"detail,omitempty"`
	CreatedAt  time.Time       `db:"created_at" json:"createdAt"`
}
