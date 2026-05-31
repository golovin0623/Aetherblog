package model

import "time"

// KnowledgePoint 对应 atlas_knowledge_points 表，Atlas 的一阶公民。
// 与 Annotation 解耦——Annotation 是出处证据，KnowledgePoint 是用户综合产物。
//
// UUID 用 string 表示，避免引入 google/uuid 依赖。
//
// Go 管理侧不读取 embedding / embedding_dim / embedding_profile_id 等向量列；
// Atlas semantic recall 由 ai-service 直接读写 pgvector，并按 active search profile
// 过滤。Repo 层 SELECT 全部显式列出字段，跳过 embedding 列。
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

// IsSupportedRelationType 校验 typed relation 类型是否在 9 种白名单内
// （手册 §3 Phase 2 C2-1 严格限定）。
//
// PR #725 review fix (Gemini medium, knowledge_point.go:46): 过去用 `RelationTypeSet`
// 全局 map 暴露给外部包，存在并发读写风险（虽然现状只读，但全局 map 可被外部 mutate）。
// 改为 switch 函数：完全不可变、线程安全、命中性能更好。
func IsSupportedRelationType(t string) bool {
	switch t {
	case "supports", "refutes", "specializes", "generalizes",
		"precedes", "causes", "similar_to", "cites", "instance_of":
		return true
	default:
		return false
	}
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
