// Atlas Phase 2 — KnowledgePointService + RelationService
//
// 红线:
//   * C2-1 关系类型严格 9 种（由 model.IsSupportedRelationType 校验）
//   * C2-2 KP 创建必须关联 ≥1 evidence annotation 或 provenance='user' 显式声明
//   * C2-4 关系不允许自环（schema CHECK 已挡）

package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
	"github.com/rs/zerolog/log"
)

var (
	allowedKPTypes = map[string]bool{
		"claim": true, "concept": true, "question": true, "definition": true,
		"method": true, "example": true, "person": true, "source": true,
	}
	allowedKPStatuses = map[string]bool{
		"seed": true, "growing": true, "evergreen": true, "archived": true,
	}
	allowedProvenances = map[string]bool{
		"user": true, "ai_suggested": true, "imported": true,
	}
)

// KnowledgePointService 编排 KP 业务。
type KnowledgePointService struct {
	kp        *repository.KPRepo
	relations *repository.RelationRepo
	indexer   KPEmbeddingIndexer
}

// NewKnowledgePointService 创建。
func NewKnowledgePointService(kp *repository.KPRepo, rel *repository.RelationRepo) *KnowledgePointService {
	return &KnowledgePointService{kp: kp, relations: rel}
}

// KPEmbeddingIndexer 是 ai-service Atlas KP embedding 写入器的最小接口。
type KPEmbeddingIndexer interface {
	IndexKnowledgePoint(ctx context.Context, kpID int64, userID *int64) (*AtlasIndexResult, error)
}

// AttachEmbeddingIndexer 注入异步 KP embedding 写入器。
func (s *KnowledgePointService) AttachEmbeddingIndexer(indexer KPEmbeddingIndexer) {
	s.indexer = indexer
}

// ScheduleEmbedding 异步触发 KP embedding 重写。
func (s *KnowledgePointService) ScheduleEmbedding(ctx context.Context, kpID int64, userID *int64, reason string) {
	if s == nil || s.indexer == nil || kpID <= 0 {
		return
	}
	base := context.Background()
	if ctx != nil {
		base = context.WithoutCancel(ctx)
	}
	go func() {
		bg, cancel := context.WithTimeout(base, 3*time.Minute)
		defer cancel()
		result, err := s.indexer.IndexKnowledgePoint(bg, kpID, userID)
		if err != nil {
			log.Warn().Err(err).Int64("kp_id", kpID).Str("reason", reason).Msg("atlas kp embedding index failed")
			return
		}
		log.Info().
			Int64("kp_id", kpID).
			Int64("profile_id", result.ProfileID).
			Int("embedding_dim", result.EmbeddingDim).
			Str("reason", reason).
			Msg("atlas kp embedding indexed")
	}()
}

// CreateKPInput 是创建 KP 的入参。
type CreateKPInput struct {
	Title                 string
	BodyMarkdown          string
	Type                  string
	Confidence            *float32
	Status                *string
	Provenance            *string
	AISuggestionID        *int64
	AuthorID              *int64
	EvidenceAnnotationIDs []int64
}

// Create 创建 KP 并按 C2-2 校验。
func (s *KnowledgePointService) Create(ctx context.Context, in CreateKPInput) (*model.KnowledgePoint, error) {
	if in.Title == "" {
		return nil, errors.New("title 不能为空")
	}
	t := in.Type
	if t == "" {
		t = "concept"
	}
	if !allowedKPTypes[t] {
		return nil, fmt.Errorf("不支持的 type: %s", t)
	}

	provenance := "user"
	if in.Provenance != nil {
		if !allowedProvenances[*in.Provenance] {
			return nil, fmt.Errorf("不支持的 provenance: %s", *in.Provenance)
		}
		provenance = *in.Provenance
	}

	// C2-2: KP 必须有 evidence 或显式 user provenance（不允许空 KP）。
	// 例外：ai_suggested + ai_suggestion_id 同时存在时视为 suggestion 自身作为证据，
	// 避免阻塞 "用户 accept AI 建议" 路径。
	hasAuditTrail := provenance == "user" ||
		(provenance == "ai_suggested" && in.AISuggestionID != nil)
	if len(in.EvidenceAnnotationIDs) == 0 && !hasAuditTrail {
		return nil, errors.New("KP 必须关联至少一条 evidence 标注，或 provenance=user / ai_suggested+aiSuggestionId")
	}

	status := "seed"
	if in.Status != nil {
		if !allowedKPStatuses[*in.Status] {
			return nil, fmt.Errorf("不支持的 status: %s", *in.Status)
		}
		status = *in.Status
	}

	var confidence float32 = 0.7
	if in.Confidence != nil {
		if *in.Confidence < 0 || *in.Confidence > 1 {
			return nil, errors.New("confidence 必须在 [0,1]")
		}
		confidence = *in.Confidence
	}

	k := &model.KnowledgePoint{
		Title:          in.Title,
		BodyMarkdown:   in.BodyMarkdown,
		Type:           t,
		Confidence:     confidence,
		Status:         status,
		AuthorID:       in.AuthorID,
		Provenance:     provenance,
		AISuggestionID: in.AISuggestionID,
	}

	if len(in.EvidenceAnnotationIDs) > 0 {
		return s.kp.CreateAndLinkInTx(ctx, k, in.EvidenceAnnotationIDs)
	}
	return s.kp.Create(ctx, k)
}

// Get 返回 KP。
func (s *KnowledgePointService) Get(ctx context.Context, id int64) (*model.KnowledgePoint, error) {
	return s.kp.FindByID(ctx, id)
}

// List 列表。
func (s *KnowledgePointService) List(ctx context.Context, f repository.KPListFilter) ([]model.KnowledgePoint, error) {
	return s.kp.List(ctx, f)
}

// UpdateKPInput 是部分更新入参。
type UpdateKPInput struct {
	Title        *string
	BodyMarkdown *string
	Type         *string
	Status       *string
	Confidence   *float32
	Archived     *bool
}

// Update 部分更新 KP。
func (s *KnowledgePointService) Update(ctx context.Context, id int64, in UpdateKPInput) (*model.KnowledgePoint, error) {
	if in.Type != nil && !allowedKPTypes[*in.Type] {
		return nil, fmt.Errorf("不支持的 type: %s", *in.Type)
	}
	if in.Status != nil && !allowedKPStatuses[*in.Status] {
		return nil, fmt.Errorf("不支持的 status: %s", *in.Status)
	}
	if in.Confidence != nil && (*in.Confidence < 0 || *in.Confidence > 1) {
		return nil, errors.New("confidence 必须在 [0,1]")
	}
	return s.kp.UpdatePartial(ctx, id, in.Title, in.BodyMarkdown, in.Type, in.Status, in.Confidence, in.Archived)
}

// Delete 软删除。
func (s *KnowledgePointService) Delete(ctx context.Context, id int64) error {
	return s.kp.SoftDelete(ctx, id)
}

// LinkAnnotation 把已存在的标注关联到 KP。
func (s *KnowledgePointService) LinkAnnotation(ctx context.Context, kpID, annotationID int64, role string) error {
	if kpID <= 0 || annotationID <= 0 {
		return errors.New("invalid id")
	}
	return s.kp.LinkAnnotation(ctx, kpID, annotationID, role)
}

// ListEvidence 列出某 KP 的出处标注。
func (s *KnowledgePointService) ListEvidence(ctx context.Context, kpID int64) ([]repository.EvidenceLink, error) {
	return s.kp.ListEvidenceAnnotations(ctx, kpID)
}

// CountEvidenceByKPIDs 批量统计 KP evidence 数量。
func (s *KnowledgePointService) CountEvidenceByKPIDs(ctx context.Context, kpIDs []int64) (map[int64]int64, error) {
	return s.kp.CountEvidenceByKPIDs(ctx, kpIDs)
}

// ListKPsForAnnotation 列出某标注支撑的所有 KP ID（双向投影用）。
func (s *KnowledgePointService) ListKPsForAnnotation(ctx context.Context, annotationID int64) ([]int64, error) {
	return s.kp.ListKPsForAnnotation(ctx, annotationID)
}

// ============================================================
// RelationService
// ============================================================

// RelationService 编排 typed relation。
type RelationService struct {
	repo *repository.RelationRepo
}

// NewRelationService 创建。
func NewRelationService(repo *repository.RelationRepo) *RelationService {
	return &RelationService{repo: repo}
}

// CreateRelationInput 创建入参。
type CreateRelationInput struct {
	FromKPID              int64
	ToKPID                int64
	Type                  string
	Strength              *float32
	BodyMarkdown          *string
	Provenance            *string
	AISuggestionID        *int64
	AuthorID              *int64
	EvidenceAnnotationIDs []int64
}

// Create 校验 9 种类型 + 不自环（schema 已挡 + 这里二次防护）。
func (s *RelationService) Create(ctx context.Context, in CreateRelationInput) (*model.TypedRelation, error) {
	if in.FromKPID <= 0 || in.ToKPID <= 0 {
		return nil, errors.New("from_kp_id / to_kp_id 不能为空")
	}
	if in.FromKPID == in.ToKPID {
		return nil, errors.New("不允许自环关系 (C2-4)")
	}
	if !model.IsSupportedRelationType(in.Type) {
		return nil, fmt.Errorf("不支持的关系类型 %q（手册 §3 Phase 2 C2-1 严格 9 种）", in.Type)
	}

	provenance := "user"
	if in.Provenance != nil {
		if !allowedProvenances[*in.Provenance] {
			return nil, fmt.Errorf("不支持的 provenance: %s", *in.Provenance)
		}
		provenance = *in.Provenance
	}

	var strength float32 = 0.8
	if in.Strength != nil {
		if *in.Strength < 0 || *in.Strength > 1 {
			return nil, errors.New("strength 必须在 [0,1]")
		}
		strength = *in.Strength
	}

	t := &model.TypedRelation{
		FromKPID:       in.FromKPID,
		ToKPID:         in.ToKPID,
		Type:           in.Type,
		Strength:       strength,
		BodyMarkdown:   in.BodyMarkdown,
		Provenance:     provenance,
		AISuggestionID: in.AISuggestionID,
		AuthorID:       in.AuthorID,
	}
	if len(in.EvidenceAnnotationIDs) > 0 {
		return s.repo.CreateAndLinkEvidenceInTx(ctx, t, in.EvidenceAnnotationIDs)
	}
	return s.repo.Create(ctx, t)
}

// Get 返回单条关系。
func (s *RelationService) Get(ctx context.Context, id int64) (*model.TypedRelation, error) {
	return s.repo.FindByID(ctx, id)
}

// ListForKP 列出 KP 的关系（dir = in | out | all）。
func (s *RelationService) ListForKP(ctx context.Context, kpID int64, dir string, authorID *int64) ([]model.TypedRelation, error) {
	return s.repo.ListForKP(ctx, kpID, dir, authorID)
}

// LinkEvidence 关联 relation 的 evidence annotation。
func (s *RelationService) LinkEvidence(ctx context.Context, relationID, annotationID int64) error {
	if relationID <= 0 || annotationID <= 0 {
		return errors.New("invalid id")
	}
	return s.repo.LinkEvidence(ctx, relationID, annotationID)
}

// ListEvidence 列出 relation evidence。
func (s *RelationService) ListEvidence(ctx context.Context, relationID int64) ([]repository.RelationEvidenceLink, error) {
	if relationID <= 0 {
		return nil, errors.New("invalid relation id")
	}
	return s.repo.ListEvidence(ctx, relationID)
}

// DeleteEvidence 删除 relation evidence 关联。
func (s *RelationService) DeleteEvidence(ctx context.Context, relationID, annotationID int64) error {
	if relationID <= 0 || annotationID <= 0 {
		return errors.New("invalid id")
	}
	return s.repo.DeleteEvidence(ctx, relationID, annotationID)
}

// ListAll 图谱视图用。
func (s *RelationService) ListAll(ctx context.Context, limit int) ([]model.TypedRelation, error) {
	return s.repo.ListAll(ctx, limit)
}

// ListForNodeIDs 图谱视图用：只返回两端都在当前 node set 内的边。
func (s *RelationService) ListForNodeIDs(ctx context.Context, nodeIDs []int64, limit int, authorID *int64) ([]model.TypedRelation, error) {
	return s.repo.ListForNodeIDs(ctx, nodeIDs, limit, authorID)
}

// CountEvidenceByRelationIDs 批量统计 relation evidence 数量。
func (s *RelationService) CountEvidenceByRelationIDs(ctx context.Context, relationIDs []int64) (map[int64]int64, error) {
	return s.repo.CountEvidenceByRelationIDs(ctx, relationIDs)
}

// GraphHealth 图谱健康指标。
func (s *RelationService) GraphHealth(ctx context.Context, authorID *int64, hubLimit int) (*repository.GraphHealthMetrics, error) {
	return s.repo.GraphHealth(ctx, authorID, hubLimit)
}

// Delete 软删除。
func (s *RelationService) Delete(ctx context.Context, id int64) error {
	return s.repo.SoftDelete(ctx, id)
}
