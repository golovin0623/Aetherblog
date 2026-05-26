package model

import "time"

// KnowledgePoint 对应 atlas_knowledge_points 表，Atlas 的一阶公民。
// 与 Annotation 解耦——Annotation 是出处证据，KnowledgePoint 是用户综合产物。
//
// UUID 用 string 表示，避免引入 google/uuid 依赖。
//
// Phase 2 范围：不读取 embedding / embedding_dim 列（pgvector 需要专用 marshaller，
// Phase 3 hybrid retrieval 上线时再引入 pgvector-go 并扩字段）。Repo 层 SELECT
// 全部显式列出字段，跳过 embedding 列。
type KnowledgePoint struct {
	ID             int64     `db:"id"`
	UUID           string    `db:"uuid"`
	Title          string    `db:"title"`
	BodyMarkdown   string    `db:"body_markdown"`
	Type           string    `db:"type"`
	Confidence     float32   `db:"confidence"`
	Status         string    `db:"status"` // seed|growing|evergreen|archived
	AuthorID       *int64    `db:"author_id"`
	Provenance     string    `db:"provenance"` // user|ai_suggested|imported
	AISuggestionID *int64    `db:"ai_suggestion_id"`
	Archived       bool      `db:"archived"`
	Deleted        bool      `db:"deleted"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

// KPColumns 是 atlas_knowledge_points 的显式 SELECT 列表（跳过 embedding 列）。
const KPColumns = `id, uuid, title, body_markdown, type, confidence, status,
	author_id, provenance, ai_suggestion_id, archived, deleted, created_at, updated_at`

// RelationTypeSet 是 9 种 typed relation 的全集（手册 §3 Phase 2 C2-1 严格限定）。
// 不要在此处之外硬编码字符串字面量——所有引用必走 RelationTypeSet。
var RelationTypeSet = map[string]bool{
	"supports":    true,
	"refutes":     true,
	"specializes": true,
	"generalizes": true,
	"precedes":    true,
	"causes":      true,
	"similar_to":  true,
	"cites":       true,
	"instance_of": true,
}

// TypedRelation 对应 atlas_typed_relations 表。
type TypedRelation struct {
	ID             int64     `db:"id"`
	FromKPID       int64     `db:"from_kp_id"`
	ToKPID         int64     `db:"to_kp_id"`
	Type           string    `db:"type"`
	Strength       float32   `db:"strength"`
	BodyMarkdown   *string   `db:"body_markdown"`
	Provenance     string    `db:"provenance"`
	AISuggestionID *int64    `db:"ai_suggestion_id"`
	AuthorID       *int64    `db:"author_id"`
	Deleted        bool      `db:"deleted"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}
