package model

import "time"

// AISuggestion 对应 atlas_ai_suggestions 表。
// 红线 C3-1: AI 产出永远先入这张表，用户 accept 后才落到 KP / relation 表。
type AISuggestion struct {
	ID                   int64     `db:"id"`
	Kind                 string    `db:"kind"` // kp | relation
	CarrierID            *int64    `db:"carrier_id"`
	AnnotationID         *int64    `db:"annotation_id"`
	FromKPID             *int64    `db:"from_kp_id"`
	ToKPID               *int64    `db:"to_kp_id"`
	ProposedTitle        *string   `db:"proposed_title"`
	ProposedBody         *string   `db:"proposed_body"`
	ProposedKPType       *string   `db:"proposed_kp_type"`
	ProposedRelationType *string   `db:"proposed_relation_type"`
	ProposedStrength     *float32  `db:"proposed_strength"`
	ProposedConfidence   *float32  `db:"proposed_confidence"`
	Rationale            *string   `db:"rationale"`
	ModelID              *string   `db:"model_id"`
	TokensIn             *int      `db:"tokens_in"`
	TokensOut            *int      `db:"tokens_out"`
	CostUSD              *float64  `db:"cost_usd"`
	Fingerprint          *string   `db:"fingerprint"`
	Status               string    `db:"status"`
	ResolvedKPID         *int64    `db:"resolved_kp_id"`
	ResolvedRelationID   *int64    `db:"resolved_relation_id"`
	AuthorID             *int64    `db:"author_id"`
	CreatedAt            time.Time `db:"created_at"`
	UpdatedAt            time.Time `db:"updated_at"`
}
