// 图集注释_服务 — 第 1 阶段 P1-06
//
// 红线 C1-1: selectors 至少 3 个，至少包含 TextQuote + TextPosition 双选。
// 服务层是最后一道闸——前端可绕过，后端不能。

package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// 允许的标注类型 / 锚定状态白名单（与 schema CHECK 对齐）。
var (
	allowedBodyTypes = map[string]bool{
		"highlight": true, "note": true, "image": true, "link": true, "sticker": true,
	}
	allowedAnchorStates = map[string]bool{
		"anchored": true, "soft_anchored": true, "orphan": true,
	}
)

// AnnotationService 处理标注业务编排。
type AnnotationService struct {
	repo     *repository.AnnotationRepo
	carriers *repository.CarrierRepo
}

// NewAnnotationService 创建。
func NewAnnotationService(repo *repository.AnnotationRepo, carriers ...*repository.CarrierRepo) *AnnotationService {
	var carrierRepo *repository.CarrierRepo
	if len(carriers) > 0 {
		carrierRepo = carriers[0]
	}
	return &AnnotationService{repo: repo, carriers: carrierRepo}
}

// CreateAnnotationInput 是 POST /atlas/annotations 的请求模型。
type CreateAnnotationInput struct {
	CarrierID        int64
	CarrierVersionID *int64
	Selectors        []json.RawMessage // W3C selector JSONB array
	RelPosition      []byte            // Y.RelativePosition bytes (optional)
	BodyType         string
	BodyText         *string
	BodyMeta         json.RawMessage
	AnchorState      *string
	AnchorScore      *float32
	AuthorID         *int64
}

// UpdateAnnotationInput 是 PATCH 的请求模型。
type UpdateAnnotationInput struct {
	BodyText    *string
	BodyMeta    json.RawMessage
	AnchorState *string
	AnchorScore *float32
}

// Create 验证 + 写入 + 回读。
func (s *AnnotationService) Create(ctx context.Context, in CreateAnnotationInput) (*model.Annotation, error) {
	if in.CarrierID <= 0 {
		return nil, errors.New("carrier_id 不能为空")
	}
	if !allowedBodyTypes[in.BodyType] {
		return nil, fmt.Errorf("不支持的 body_type: %s", in.BodyType)
	}
	if len(in.Selectors) < 3 {
		return nil, errors.New("selectors 必须至少 3 个（W3C 红线 C1-1）")
	}
	if !hasSelectorType(in.Selectors, "TextQuoteSelector") {
		return nil, errors.New("selectors 必须包含 TextQuoteSelector")
	}
	if !hasSelectorType(in.Selectors, "TextPositionSelector") {
		return nil, errors.New("selectors 必须包含 TextPositionSelector")
	}

	state := "anchored"
	if in.AnchorState != nil {
		if !allowedAnchorStates[*in.AnchorState] {
			return nil, fmt.Errorf("不支持的 anchor_state: %s", *in.AnchorState)
		}
		state = *in.AnchorState
	}

	var score float32 = 1.0
	if in.AnchorScore != nil {
		if *in.AnchorScore < 0 || *in.AnchorScore > 1 {
			return nil, errors.New("anchor_score 必须在 [0,1]")
		}
		score = *in.AnchorScore
	}

	selJSON, err := json.Marshal(in.Selectors)
	if err != nil {
		return nil, fmt.Errorf("序列化 selectors: %w", err)
	}
	bodyMeta := in.BodyMeta
	if len(bodyMeta) == 0 {
		bodyMeta = json.RawMessage(`{}`)
	}

	a := &model.Annotation{
		CarrierID:        in.CarrierID,
		CarrierVersionID: in.CarrierVersionID,
		Selectors:        selJSON,
		RelPosition:      in.RelPosition,
		BodyType:         in.BodyType,
		BodyText:         in.BodyText,
		BodyMeta:         bodyMeta,
		AnchorState:      state,
		AnchorScore:      score,
		AuthorID:         in.AuthorID,
	}
	return s.repo.Create(ctx, a)
}

// Get 返回单条标注。
func (s *AnnotationService) Get(ctx context.Context, id int64) (*model.Annotation, error) {
	return s.repo.FindByID(ctx, id)
}

// CarrierOwner 返回 carrier 的 owner，用于 handler 层做 Atlas scope 校验。
func (s *AnnotationService) CarrierOwner(ctx context.Context, carrierID int64) (bool, *int64, error) {
	if s.carriers == nil {
		return true, nil, nil
	}
	carrier, err := s.carriers.FindByID(ctx, carrierID)
	if err != nil || carrier == nil {
		return carrier != nil, nil, err
	}
	return true, carrier.OwnerID, nil
}

// ListByCarrier 列出 carrier 下所有未删除标注。
func (s *AnnotationService) ListByCarrier(ctx context.Context, carrierID int64) ([]model.Annotation, error) {
	return s.repo.FindByCarrier(ctx, carrierID)
}

// ListByCarrierForAuthor 列出某作者在 carrier 下的标注。
func (s *AnnotationService) ListByCarrierForAuthor(ctx context.Context, carrierID, authorID int64) ([]model.Annotation, error) {
	return s.repo.FindByCarrierForAuthor(ctx, carrierID, authorID)
}

// Search 在标注正文与 selectors 中检索。
func (s *AnnotationService) Search(ctx context.Context, keyword string, authorID *int64, limit int) ([]model.Annotation, error) {
	return s.repo.Search(ctx, keyword, authorID, limit)
}

// Update 部分更新。
func (s *AnnotationService) Update(ctx context.Context, id int64, in UpdateAnnotationInput) (*model.Annotation, error) {
	if in.AnchorState != nil && !allowedAnchorStates[*in.AnchorState] {
		return nil, fmt.Errorf("不支持的 anchor_state: %s", *in.AnchorState)
	}
	if in.AnchorScore != nil && (*in.AnchorScore < 0 || *in.AnchorScore > 1) {
		return nil, errors.New("anchor_score 必须在 [0,1]")
	}
	var bodyMeta []byte
	if len(in.BodyMeta) > 0 {
		bodyMeta = in.BodyMeta
	}
	return s.repo.UpdatePartial(ctx, id, in.BodyText, bodyMeta, in.AnchorState, in.AnchorScore)
}

// Delete 软删除。
func (s *AnnotationService) Delete(ctx context.Context, id int64) error {
	return s.repo.SoftDelete(ctx, id)
}

func hasSelectorType(selectors []json.RawMessage, want string) bool {
	for _, raw := range selectors {
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil {
			continue
		}
		if probe.Type == want {
			return true
		}
	}
	return false
}
