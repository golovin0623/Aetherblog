package model

import "time"

// Annotation 对应 atlas_annotations 表，W3C WADM 标注层。
type Annotation struct {
	ID               int64     `db:"id"`
	CarrierID        int64     `db:"carrier_id"`
	CarrierVersionID *int64    `db:"carrier_version_id"`
	Selectors        []byte    `db:"selectors"`   // JSONB array
	RelPosition      []byte    `db:"rel_position"` // Y.RelativePosition bytes (nullable)
	BodyType         string    `db:"body_type"`
	BodyText         *string   `db:"body_text"`
	BodyMeta         []byte    `db:"body_meta"` // JSONB
	AnchorState      string    `db:"anchor_state"`
	AnchorScore      float32   `db:"anchor_score"`
	AuthorID         *int64    `db:"author_id"`
	Deleted          bool      `db:"deleted"`
	CreatedAt        time.Time `db:"created_at"`
	UpdatedAt        time.Time `db:"updated_at"`
}
