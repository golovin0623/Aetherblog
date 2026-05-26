// Atlas Phase 3 P3-04 — AI 建议 service
//
// 核心约束（手册 §3 Phase 3 C3-1）:
//   * 任何 AI 产出禁止直接写入 KP/Relation 表
//   * 用户 accept 时：创建 KP/Relation（provenance='ai_suggested', ai_suggestion_id 回指），
//                 并把 suggestion.status 改为 accepted + resolved_*_id 回填
//   * 用户 reject 时：suggestion.status=rejected + atlas_ignored_suggestions 记指纹
//
// Phase 3 不直接调用 LiteLLM —— 接收 ai-service 产出的候选 / 由 admin UI 显式生成。

package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// AISuggestionService 编排建议生命周期。
type AISuggestionService struct {
	sug       *repository.SuggestionRepo
	kpSvc     *KnowledgePointService
	relSvc    *RelationService
}

// NewAISuggestionService 创建。
func NewAISuggestionService(sug *repository.SuggestionRepo, kp *KnowledgePointService, rel *RelationService) *AISuggestionService {
	return &AISuggestionService{sug: sug, kpSvc: kp, relSvc: rel}
}

// CreateSuggestionInput 创建建议（由 ai-service 回调或 admin "demo 抽取" 触发）。
type CreateSuggestionInput struct {
	Kind                 string
	CarrierID            *int64
	AnnotationID         *int64
	FromKPID             *int64
	ToKPID               *int64
	ProposedTitle        *string
	ProposedBody         *string
	ProposedKPType       *string
	ProposedRelationType *string
	ProposedStrength     *float32
	ProposedConfidence   *float32
	Rationale            *string
	ModelID              *string
	TokensIn             *int
	TokensOut            *int
	CostUSD              *float64
	AuthorID             *int64
}

// Create 创建一条建议。
func (s *AISuggestionService) Create(ctx context.Context, in CreateSuggestionInput) (*model.AISuggestion, error) {
	if in.Kind != "kp" && in.Kind != "relation" {
		return nil, errors.New("kind 必须是 kp 或 relation")
	}
	if in.Kind == "kp" && in.ProposedTitle == nil {
		return nil, errors.New("kp 建议必须有 proposed_title")
	}
	if in.Kind == "relation" {
		if in.FromKPID == nil || in.ToKPID == nil || in.ProposedRelationType == nil {
			return nil, errors.New("relation 建议必须有 from/to/type")
		}
		if !model.RelationTypeSet[*in.ProposedRelationType] {
			return nil, fmt.Errorf("不支持的 relation type: %s", *in.ProposedRelationType)
		}
	}

	sug := &model.AISuggestion{
		Kind:                 in.Kind,
		CarrierID:            in.CarrierID,
		AnnotationID:         in.AnnotationID,
		FromKPID:             in.FromKPID,
		ToKPID:               in.ToKPID,
		ProposedTitle:        in.ProposedTitle,
		ProposedBody:         in.ProposedBody,
		ProposedKPType:       in.ProposedKPType,
		ProposedRelationType: in.ProposedRelationType,
		ProposedStrength:     in.ProposedStrength,
		ProposedConfidence:   in.ProposedConfidence,
		Rationale:            in.Rationale,
		ModelID:              in.ModelID,
		TokensIn:             in.TokensIn,
		TokensOut:            in.TokensOut,
		CostUSD:              in.CostUSD,
		Status:               "pending",
		AuthorID:             in.AuthorID,
	}
	return s.sug.Create(ctx, sug)
}

// List 列出建议。
func (s *AISuggestionService) List(ctx context.Context, f repository.SuggestionFilter) ([]model.AISuggestion, error) {
	return s.sug.List(ctx, f)
}

// Get 返回单条。
func (s *AISuggestionService) Get(ctx context.Context, id int64) (*model.AISuggestion, error) {
	return s.sug.FindByID(ctx, id)
}

// Accept 接受建议：创建 KP 或 Relation + 把 suggestion 标 accepted。
// 红线 C3-2: 必须保留 ai_suggestion_id 指向源建议。
func (s *AISuggestionService) Accept(ctx context.Context, id int64, userID *int64) (*model.AISuggestion, error) {
	sug, err := s.sug.FindByID(ctx, id)
	if err != nil || sug == nil {
		return sug, err
	}
	if sug.Status != "pending" {
		return nil, fmt.Errorf("建议状态 %s 不可 accept", sug.Status)
	}

	switch sug.Kind {
	case "kp":
		title := strPtrVal(sug.ProposedTitle, "未命名 KP")
		body := strPtrVal(sug.ProposedBody, "")
		kpType := strPtrVal(sug.ProposedKPType, "concept")
		provenance := "ai_suggested"
		kp, err := s.kpSvc.Create(ctx, CreateKPInput{
			Title:          title,
			BodyMarkdown:   body,
			Type:           kpType,
			Confidence:     sug.ProposedConfidence,
			Provenance:     &provenance,
			AISuggestionID: &sug.ID,
			AuthorID:       userID,
		})
		if err != nil {
			return nil, err
		}
		// 若建议有 annotation_id，把 KP 与该 annotation 关联
		if sug.AnnotationID != nil {
			_ = s.kpSvc.LinkAnnotation(ctx, kp.ID, *sug.AnnotationID, "evidence")
		}
		if err := s.sug.MarkResolved(ctx, sug.ID, "accepted", &kp.ID, nil); err != nil {
			return nil, err
		}
		sug.Status = "accepted"
		sug.ResolvedKPID = &kp.ID

	case "relation":
		t := strPtrVal(sug.ProposedRelationType, "")
		provenance := "ai_suggested"
		rel, err := s.relSvc.Create(ctx, CreateRelationInput{
			FromKPID:       int64Val(sug.FromKPID),
			ToKPID:         int64Val(sug.ToKPID),
			Type:           t,
			Strength:       sug.ProposedStrength,
			BodyMarkdown:   sug.Rationale,
			Provenance:     &provenance,
			AISuggestionID: &sug.ID,
			AuthorID:       userID,
		})
		if err != nil {
			return nil, err
		}
		if err := s.sug.MarkResolved(ctx, sug.ID, "accepted", nil, &rel.ID); err != nil {
			return nil, err
		}
		sug.Status = "accepted"
		sug.ResolvedRelationID = &rel.ID

	default:
		return nil, fmt.Errorf("未知 kind: %s", sug.Kind)
	}

	return sug, nil
}

// Reject 拒绝建议 + 把指纹写入忽略列表（防止反复推荐）。
func (s *AISuggestionService) Reject(ctx context.Context, id int64, userID int64) (*model.AISuggestion, error) {
	sug, err := s.sug.FindByID(ctx, id)
	if err != nil || sug == nil {
		return sug, err
	}
	if sug.Status != "pending" {
		return nil, fmt.Errorf("建议状态 %s 不可 reject", sug.Status)
	}
	if err := s.sug.MarkResolved(ctx, sug.ID, "rejected", nil, nil); err != nil {
		return nil, err
	}
	if userID > 0 {
		_ = s.sug.AddIgnored(ctx, fingerprintSuggestion(sug), sug.Kind, userID)
	}
	sug.Status = "rejected"
	return sug, nil
}

// fingerprintSuggestion 计算建议指纹（用于去重）。
func fingerprintSuggestion(s *model.AISuggestion) string {
	parts := []string{s.Kind}
	if s.CarrierID != nil {
		parts = append(parts, "c"+strconv.FormatInt(*s.CarrierID, 10))
	}
	if s.AnnotationID != nil {
		parts = append(parts, "a"+strconv.FormatInt(*s.AnnotationID, 10))
	}
	if s.FromKPID != nil {
		parts = append(parts, "f"+strconv.FormatInt(*s.FromKPID, 10))
	}
	if s.ToKPID != nil {
		parts = append(parts, "t"+strconv.FormatInt(*s.ToKPID, 10))
	}
	if s.ProposedTitle != nil {
		parts = append(parts, "T="+*s.ProposedTitle)
	}
	if s.ProposedRelationType != nil {
		parts = append(parts, "R="+*s.ProposedRelationType)
	}
	h := sha256.Sum256([]byte(joinStrings(parts, "|")))
	return hex.EncodeToString(h[:])
}

func joinStrings(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}

func strPtrVal(p *string, fallback string) string {
	if p == nil {
		return fallback
	}
	return *p
}

func int64Val(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}
