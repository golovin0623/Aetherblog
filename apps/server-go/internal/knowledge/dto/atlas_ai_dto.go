// Atlas Phase 3 — AI 建议 DTO

package dto

import "time"

// CreateSuggestionRequest POST /atlas/suggestions 请求体。
// 由 ai-service 提交或 admin "demo 抽取" UI 触发。
type CreateSuggestionRequest struct {
	Kind                 string   `json:"kind" validate:"required,oneof=kp relation"`
	CarrierID            *int64   `json:"carrierId,omitempty"`
	AnnotationID         *int64   `json:"annotationId,omitempty"`
	FromKPID             *int64   `json:"fromKpId,omitempty"`
	ToKPID               *int64   `json:"toKpId,omitempty"`
	ProposedTitle        *string  `json:"proposedTitle,omitempty"`
	ProposedBody         *string  `json:"proposedBody,omitempty"`
	ProposedKPType       *string  `json:"proposedKpType,omitempty"`
	ProposedRelationType *string  `json:"proposedRelationType,omitempty"`
	ProposedStrength     *float32 `json:"proposedStrength,omitempty"`
	ProposedConfidence   *float32 `json:"proposedConfidence,omitempty"`
	Rationale            *string  `json:"rationale,omitempty"`
	ModelID              *string  `json:"modelId,omitempty"`
	TokensIn             *int     `json:"tokensIn,omitempty"`
	TokensOut            *int     `json:"tokensOut,omitempty"`
	CostUSD              *float64 `json:"costUsd,omitempty"`
}

// GenerateAnnotationSuggestionsRequest 从单条 annotation 生成 KP 建议。
type GenerateAnnotationSuggestionsRequest struct {
	MaxCandidates int     `json:"maxCandidates,omitempty"`
	ModelID       *string `json:"modelId,omitempty"`
}

// GenerateRelationSuggestionRequest 为两条 KP 生成 relation 建议。
type GenerateRelationSuggestionRequest struct {
	ToKPID  int64   `json:"toKpId" validate:"required"`
	ModelID *string `json:"modelId,omitempty"`
}

// SuggestionResponse AI 建议对外形态。
type SuggestionResponse struct {
	ID                   int64     `json:"id"`
	Kind                 string    `json:"kind"`
	CarrierID            *int64    `json:"carrierId,omitempty"`
	AnnotationID         *int64    `json:"annotationId,omitempty"`
	FromKPID             *int64    `json:"fromKpId,omitempty"`
	ToKPID               *int64    `json:"toKpId,omitempty"`
	ProposedTitle        *string   `json:"proposedTitle,omitempty"`
	ProposedBody         *string   `json:"proposedBody,omitempty"`
	ProposedKPType       *string   `json:"proposedKpType,omitempty"`
	ProposedRelationType *string   `json:"proposedRelationType,omitempty"`
	ProposedStrength     *float32  `json:"proposedStrength,omitempty"`
	ProposedConfidence   *float32  `json:"proposedConfidence,omitempty"`
	Rationale            *string   `json:"rationale,omitempty"`
	ModelID              *string   `json:"modelId,omitempty"`
	TokensIn             *int      `json:"tokensIn,omitempty"`
	TokensOut            *int      `json:"tokensOut,omitempty"`
	CostUSD              *float64  `json:"costUsd,omitempty"`
	Fingerprint          *string   `json:"fingerprint,omitempty"`
	Status               string    `json:"status"`
	ResolvedKPID         *int64    `json:"resolvedKpId,omitempty"`
	ResolvedRelationID   *int64    `json:"resolvedRelationId,omitempty"`
	AuthorID             *int64    `json:"authorId,omitempty"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}
