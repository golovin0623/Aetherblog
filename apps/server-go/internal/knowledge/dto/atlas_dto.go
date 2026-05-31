// Atlas DTO — REST 请求/响应。
//
// 与 packages/types/src/models/atlas.ts 字段一一对应（camelCase）。
// 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 1

package dto

import (
	"encoding/json"
	"time"
)

// ============================================================
// Carrier
// ============================================================

// CarrierResponse 是 GET /atlas/carriers/:id 与 POST /atlas/carriers/markdown 的响应。
type CarrierResponse struct {
	ID            int64           `json:"id"`
	Type          string          `json:"type"`
	SourceURI     string          `json:"sourceUri"`
	ContentHash   string          `json:"contentHash"`
	Title         string          `json:"title"`
	Author        *string         `json:"author,omitempty"`
	Language      *string         `json:"language,omitempty"`
	Metadata      json.RawMessage `json:"metadata"`
	OwnerID       *int64          `json:"ownerId,omitempty"`
	Status        string          `json:"status"`
	StatusMessage *string         `json:"statusMessage,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// EnsureMarkdownCarrierRequest 是 POST /atlas/carriers/markdown 的请求体。
type EnsureMarkdownCarrierRequest struct {
	NoteID int64 `json:"noteId" validate:"required,gt=0"`
}

// CreateMarkdownSourceRequest 是 POST /atlas/carriers/markdown/source 的请求体。
type CreateMarkdownSourceRequest struct {
	Title           string `json:"title"`
	ContentMarkdown string `json:"contentMarkdown" validate:"required"`
}

// MarkdownSourceResponse 是 Atlas Reader 读取 note source 的最小响应。
type MarkdownSourceResponse struct {
	ID              int64  `json:"id"`
	Title           string `json:"title"`
	ContentMarkdown string `json:"contentMarkdown"`
}

// EnsurePDFCarrierRequest 是 POST /atlas/carriers/pdf 的请求体。
type EnsurePDFCarrierRequest struct {
	MediaFileID int64 `json:"mediaFileId" validate:"required,gt=0"`
}

// EnsurePostCarrierRequest 是 POST /atlas/carriers/post 的请求体。
type EnsurePostCarrierRequest struct {
	PostID int64 `json:"postId" validate:"required,gt=0"`
}

// EnsureWebCarrierRequest 是 POST /atlas/carriers/web 的请求体。
type EnsureWebCarrierRequest struct {
	SourceURL       string  `json:"sourceUrl" validate:"required"`
	Title           string  `json:"title,omitempty"`
	ContentMarkdown string  `json:"contentMarkdown" validate:"required"`
	Author          *string `json:"author,omitempty"`
	Language        *string `json:"language,omitempty"`
}

// EnsureMediaTranscriptCarrierRequest 是 POST /atlas/carriers/media-transcript 的请求体。
type EnsureMediaTranscriptCarrierRequest struct {
	MediaFileID        int64   `json:"mediaFileId" validate:"required,gt=0"`
	TranscriptMarkdown string  `json:"transcriptMarkdown" validate:"required"`
	Language           *string `json:"language,omitempty"`
}

// CarrierTextPageResponse 是 PDF 文本层的页级锚定空间。
type CarrierTextPageResponse struct {
	Page      int    `json:"page"`
	Text      string `json:"text"`
	CharStart int    `json:"charStart"`
	CharEnd   int    `json:"charEnd"`
}

// CarrierTextLayerResponse 是 GET /atlas/carriers/:id/text-layer 的响应。
type CarrierTextLayerResponse struct {
	CarrierID   int64                     `json:"carrierId"`
	ContentHash string                    `json:"contentHash"`
	StorageURI  string                    `json:"storageUri"`
	PageCount   int                       `json:"pageCount"`
	CharCount   int                       `json:"charCount"`
	Text        string                    `json:"text"`
	Pages       []CarrierTextPageResponse `json:"pages"`
}

// ============================================================
// Annotation
// ============================================================

// CreateAnnotationRequest 是 POST /atlas/annotations 的请求体。
type CreateAnnotationRequest struct {
	CarrierID        int64             `json:"carrierId" validate:"required,gt=0"`
	CarrierVersionID *int64            `json:"carrierVersionId,omitempty"`
	Selectors        []json.RawMessage `json:"selectors" validate:"required,min=3"`
	RelPosition      *string           `json:"relPosition,omitempty"` // base64 编码 Yjs RelativePosition bytes
	BodyType         string            `json:"bodyType" validate:"required"`
	BodyText         *string           `json:"bodyText,omitempty"`
	BodyMeta         json.RawMessage   `json:"bodyMeta,omitempty"`
	AnchorState      *string           `json:"anchorState,omitempty"`
	AnchorScore      *float32          `json:"anchorScore,omitempty"`
}

// UpdateAnnotationRequest 是 PATCH /atlas/annotations/:id 的请求体。
type UpdateAnnotationRequest struct {
	BodyText    *string         `json:"bodyText,omitempty"`
	BodyMeta    json.RawMessage `json:"bodyMeta,omitempty"`
	AnchorState *string         `json:"anchorState,omitempty"`
	AnchorScore *float32        `json:"anchorScore,omitempty"`
}

// AnnotationResponse 是 Annotation 的对外形态。
type AnnotationResponse struct {
	ID               int64           `json:"id"`
	CarrierID        int64           `json:"carrierId"`
	CarrierVersionID *int64          `json:"carrierVersionId,omitempty"`
	Selectors        json.RawMessage `json:"selectors"`
	RelPosition      *string         `json:"relPosition,omitempty"` // base64
	BodyType         string          `json:"bodyType"`
	BodyText         *string         `json:"bodyText,omitempty"`
	BodyMeta         json.RawMessage `json:"bodyMeta"`
	AnchorState      string          `json:"anchorState"`
	AnchorScore      float32         `json:"anchorScore"`
	AuthorID         *int64          `json:"authorId,omitempty"`
	CreatedAt        time.Time       `json:"createdAt"`
	UpdatedAt        time.Time       `json:"updatedAt"`
}
