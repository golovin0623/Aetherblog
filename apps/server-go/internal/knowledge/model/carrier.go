// Package model 定义 Atlas（Aether Knowledge）域的 Go 数据模型。
//
// 与 docs/plan/task-aether-knowledge-system.md §2 数据骨架一一对应：
//
//	Carrier / CarrierVersion / Annotation / KnowledgePoint / TypedRelation
//
// 命名规范：与现有 internal/model 包对齐，避免 import 冲突时通过包前缀 atlasmodel 区分。
package model

import "time"

// Carrier 对应 atlas_carriers 表，是 Atlas 的多模态载体一阶对象。
type Carrier struct {
	ID            int64     `db:"id"`
	Type          string    `db:"type"` // pdf|epub|markdown|web|video|audio|image
	SourceURI     string    `db:"source_uri"`
	ContentHash   string    `db:"content_hash"`
	Title         string    `db:"title"`
	Author        *string   `db:"author"`
	Language      *string   `db:"language"`
	Metadata      []byte    `db:"metadata"` // JSONB
	OwnerID       *int64    `db:"owner_id"`
	Status        string    `db:"status"` // ingesting|ready|failed
	StatusMessage *string   `db:"status_message"`
	Deleted       bool      `db:"deleted"`
	CreatedAt     time.Time `db:"created_at"`
	UpdatedAt     time.Time `db:"updated_at"`
}

// CarrierVersion 对应 atlas_carrier_versions 表，原文不可变 + 版本叠加的实现。
type CarrierVersion struct {
	ID           int64     `db:"id"`
	CarrierID    int64     `db:"carrier_id"`
	VersionNo    int       `db:"version_no"`
	ContentHash  string    `db:"content_hash"`
	StorageURI   string    `db:"storage_uri"`
	DiffFromPrev []byte    `db:"diff_from_prev"`
	Reason       string    `db:"reason"`
	CreatedAt    time.Time `db:"created_at"`
}

// CarrierTextLayer stores extracted rootText artifacts for non-markdown carriers.
type CarrierTextLayer struct {
	ID          int64     `db:"id"`
	CarrierID   int64     `db:"carrier_id"`
	ContentHash string    `db:"content_hash"`
	StorageURI  string    `db:"storage_uri"`
	PageCount   int       `db:"page_count"`
	CharCount   int       `db:"char_count"`
	TextContent string    `db:"text_content"`
	Pages       []byte    `db:"pages"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`
}
