// Atlas Phase 2 DTOs — KP + Relation + Graph

package dto

import "time"

// ============================================================
// KnowledgePoint
// ============================================================

// CreateKnowledgePointRequest POST /atlas/knowledge-points 请求体。
type CreateKnowledgePointRequest struct {
	Title                 string   `json:"title" validate:"required"`
	BodyMarkdown          string   `json:"bodyMarkdown"`
	Type                  string   `json:"type"`
	Confidence            *float32 `json:"confidence,omitempty"`
	Status                *string  `json:"status,omitempty"`
	Provenance            *string  `json:"provenance,omitempty"`
	AISuggestionID        *int64   `json:"aiSuggestionId,omitempty"`
	EvidenceAnnotationIDs []int64  `json:"evidenceAnnotationIds,omitempty"`
}

// UpdateKnowledgePointRequest PATCH /atlas/knowledge-points/:id 请求体。
type UpdateKnowledgePointRequest struct {
	Title        *string  `json:"title,omitempty"`
	BodyMarkdown *string  `json:"bodyMarkdown,omitempty"`
	Type         *string  `json:"type,omitempty"`
	Status       *string  `json:"status,omitempty"`
	Confidence   *float32 `json:"confidence,omitempty"`
	Archived     *bool    `json:"archived,omitempty"`
}

// KnowledgePointResponse 是 KP 对外形态。
type KnowledgePointResponse struct {
	ID             int64     `json:"id"`
	UUID           string    `json:"uuid"`
	Title          string    `json:"title"`
	BodyMarkdown   string    `json:"bodyMarkdown"`
	Type           string    `json:"type"`
	Confidence     float32   `json:"confidence"`
	Status         string    `json:"status"`
	AuthorID       *int64    `json:"authorId,omitempty"`
	Provenance     string    `json:"provenance"`
	AISuggestionID *int64    `json:"aiSuggestionId,omitempty"`
	Archived       bool      `json:"archived"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// LinkAnnotationRequest 把已存在的标注关联到 KP。
type LinkAnnotationRequest struct {
	AnnotationID int64  `json:"annotationId" validate:"required,gt=0"`
	Role         string `json:"role,omitempty"`
}

// ============================================================
// TypedRelation
// ============================================================

// CreateRelationRequest POST /atlas/relations 请求体。
type CreateRelationRequest struct {
	FromKPID              int64    `json:"fromKpId" validate:"required,gt=0"`
	ToKPID                int64    `json:"toKpId" validate:"required,gt=0"`
	Type                  string   `json:"type" validate:"required"`
	Strength              *float32 `json:"strength,omitempty"`
	BodyMarkdown          *string  `json:"bodyMarkdown,omitempty"`
	Provenance            *string  `json:"provenance,omitempty"`
	AISuggestionID        *int64   `json:"aiSuggestionId,omitempty"`
	EvidenceAnnotationIDs []int64  `json:"evidenceAnnotationIds,omitempty"`
}

// TypedRelationResponse 是 typed relation 对外形态。
type TypedRelationResponse struct {
	ID             int64     `json:"id"`
	FromKPID       int64     `json:"fromKpId"`
	ToKPID         int64     `json:"toKpId"`
	Type           string    `json:"type"`
	Strength       float32   `json:"strength"`
	BodyMarkdown   *string   `json:"bodyMarkdown,omitempty"`
	Provenance     string    `json:"provenance"`
	AISuggestionID *int64    `json:"aiSuggestionId,omitempty"`
	AuthorID       *int64    `json:"authorId,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// LinkRelationEvidenceRequest 把一条 annotation 作为 relation evidence。
type LinkRelationEvidenceRequest struct {
	AnnotationID int64 `json:"annotationId" validate:"required,gt=0"`
}

// RelationEvidenceResponse 是 relation -> annotation evidence 行。
type RelationEvidenceResponse struct {
	RelationID   int64     `json:"relationId"`
	AnnotationID int64     `json:"annotationId"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ============================================================
// Graph
// ============================================================

// GraphResponse 是 GET /atlas/graph 的响应。
type GraphResponse struct {
	Nodes                  []KnowledgePointResponse `json:"nodes"`
	Edges                  []TypedRelationResponse  `json:"edges"`
	KPEvidenceCounts       map[int64]int64          `json:"kpEvidenceCounts,omitempty"`
	RelationEvidenceCounts map[int64]int64          `json:"relationEvidenceCounts,omitempty"`
}

// GraphHealthResponse 是 GET /atlas/graph/health 的响应。
type GraphHealthResponse struct {
	ActiveKPCount                int64                    `json:"activeKpCount"`
	RelationCount                int64                    `json:"relationCount"`
	RelationDensity              float64                  `json:"relationDensity"`
	OrphanKPCount                int64                    `json:"orphanKpCount"`
	OrphanKPRatio                float64                  `json:"orphanKpRatio"`
	KPEvidenceCount              int64                    `json:"kpEvidenceCount"`
	KPEvidenceCoverage           float64                  `json:"kpEvidenceCoverage"`
	RelationEvidenceCount        int64                    `json:"relationEvidenceCount"`
	RelationEvidenceCoverage     float64                  `json:"relationEvidenceCoverage"`
	MissingEvidenceKPCount       int64                    `json:"missingEvidenceKpCount"`
	MissingEvidenceRelationCount int64                    `json:"missingEvidenceRelationCount"`
	AIKPCount                    int64                    `json:"aiKpCount"`
	TopHubs                      []GraphHealthHubResponse `json:"topHubs"`
}

// GraphHealthHubResponse 是 graph health 的 hub 节点摘要。
type GraphHealthHubResponse struct {
	KPID      int64  `json:"kpId"`
	Title     string `json:"title"`
	Degree    int64  `json:"degree"`
	InDegree  int64  `json:"inDegree"`
	OutDegree int64  `json:"outDegree"`
}

// SearchResponse 是 GET /atlas/search 的轻量聚合搜索结果。
type SearchResponse struct {
	Query           string                   `json:"query"`
	Limit           int                      `json:"limit"`
	Total           int                      `json:"total"`
	KnowledgePoints []KnowledgePointResponse `json:"knowledgePoints"`
	Annotations     []AnnotationResponse     `json:"annotations"`
	Carriers        []CarrierResponse        `json:"carriers"`
}
