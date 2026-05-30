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
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// AISuggestionService 编排建议生命周期。
//
// PR #724 review fix (Codex P2): Accept 必须原子 —— 创建 KP/Relation 和 MarkResolved
// 在同一事务里，避免 retry 时产生重复 KP/Relation。
type AISuggestionService struct {
	sug    *repository.SuggestionRepo
	kpSvc  *KnowledgePointService
	relSvc *RelationService
	db     *sqlx.DB // for atomic Accept tx
}

// NewAISuggestionService 创建。
func NewAISuggestionService(
	sug *repository.SuggestionRepo,
	kp *KnowledgePointService,
	rel *RelationService,
	db *sqlx.DB,
) *AISuggestionService {
	return &AISuggestionService{sug: sug, kpSvc: kp, relSvc: rel, db: db}
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
	if in.Kind == "kp" && in.CarrierID == nil && in.AnnotationID == nil {
		return nil, errors.New("kp 建议必须绑定 carrier 或 annotation 作为证据来源")
	}
	if in.ProposedKPType != nil && !allowedKPTypes[*in.ProposedKPType] {
		return nil, fmt.Errorf("不支持的 proposed kp type: %s", *in.ProposedKPType)
	}
	if in.Kind == "relation" {
		if in.FromKPID == nil || in.ToKPID == nil || in.ProposedRelationType == nil {
			return nil, errors.New("relation 建议必须有 from/to/type")
		}
		if !model.IsSupportedRelationType(*in.ProposedRelationType) {
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
	fingerprint := fingerprintSuggestion(sug)
	sug.Fingerprint = &fingerprint
	if in.AuthorID != nil && *in.AuthorID > 0 {
		ignored, err := s.sug.IsIgnored(ctx, fingerprint, *in.AuthorID)
		if err != nil {
			return nil, err
		}
		if ignored {
			return nil, errors.New("该建议已被用户忽略，不再加入 inbox")
		}
	}
	existing, err := s.sug.FindPendingByFingerprint(ctx, fingerprint, in.AuthorID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
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

// Accept 接受建议：创建 KP 或 Relation + 把 suggestion 标 accepted（**单一事务**）。
// 红线 C3-2: 必须保留 ai_suggestion_id 指向源建议。
// PR #724 review fix (Codex P2): KP/Relation INSERT 与 SuggestionMarkResolved 同一 tx，
// 任一失败则全部回滚，避免 retry 产生重复实体。
func (s *AISuggestionService) Accept(ctx context.Context, id int64, userID *int64) (*model.AISuggestion, error) {
	sug, err := s.sug.FindByID(ctx, id)
	if err != nil || sug == nil {
		return sug, err
	}
	if sug.Status != "pending" {
		return nil, fmt.Errorf("建议状态 %s 不可 accept", sug.Status)
	}

	// 预校验（与 KP/Relation Service.Create 等价的最低门槛）
	switch sug.Kind {
	case "kp":
		if sug.ProposedTitle == nil || strPtrVal(sug.ProposedTitle, "") == "" {
			return nil, errors.New("kp 建议缺 proposed_title")
		}
	case "relation":
		t := strPtrVal(sug.ProposedRelationType, "")
		if !model.IsSupportedRelationType(t) {
			return nil, fmt.Errorf("不支持的关系类型 %q（C2-1 严格 9 种）", t)
		}
		if int64Val(sug.FromKPID) == int64Val(sug.ToKPID) {
			return nil, errors.New("不允许自环关系 (C2-4)")
		}
	default:
		return nil, fmt.Errorf("未知 kind: %s", sug.Kind)
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() // commit 后是 no-op

	// PR #725 review fix (Gemini medium, suggestion_service.go:154): 加 SELECT FOR UPDATE
	// 悲观锁，避免并发 accept 时各自做完昂贵的 INSERT 再回滚（无用 DB 开销）。
	// 拿不到锁 / 状态已变 → 立即退出，不进 INSERT 路径。
	var lockedStatus string
	if err := tx.QueryRowxContext(ctx,
		`SELECT status FROM atlas_ai_suggestions WHERE id=$1 FOR UPDATE`, sug.ID,
	).Scan(&lockedStatus); err != nil {
		return nil, fmt.Errorf("select for update: %w", err)
	}
	if lockedStatus != "pending" {
		return nil, fmt.Errorf("建议 %d 状态已被并发改为 %s，本事务退出", sug.ID, lockedStatus)
	}

	var resolvedKPID *int64
	var resolvedRelID *int64

	switch sug.Kind {
	case "kp":
		title := strPtrVal(sug.ProposedTitle, "未命名 KP")
		body := strPtrVal(sug.ProposedBody, "")
		kpType := strPtrVal(sug.ProposedKPType, "concept")

		var newID int64
		if err := tx.QueryRowxContext(ctx, `
			INSERT INTO atlas_knowledge_points (
				title, body_markdown, type, confidence, status,
				author_id, provenance, ai_suggestion_id
			)
			VALUES ($1,$2,$3,COALESCE($4, 0.7),'seed',$5,'ai_suggested',$6)
			RETURNING id`,
			title, body, kpType, sug.ProposedConfidence,
			userID, sug.ID,
		).Scan(&newID); err != nil {
			return nil, fmt.Errorf("insert kp: %w", err)
		}
		resolvedKPID = &newID

		// 关联 evidence annotation（若有）
		if sug.AnnotationID != nil {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO atlas_annotation_kp_links (annotation_id, kp_id, role)
				VALUES ($1, $2, 'evidence') ON CONFLICT DO NOTHING`,
				*sug.AnnotationID, newID,
			); err != nil {
				return nil, fmt.Errorf("link annotation: %w", err)
			}
		}

	case "relation":
		t := strPtrVal(sug.ProposedRelationType, "")
		var newID int64
		if err := tx.QueryRowxContext(ctx, `
			INSERT INTO atlas_typed_relations (
				from_kp_id, to_kp_id, type, strength,
				body_markdown, provenance, ai_suggestion_id, author_id
			)
			VALUES ($1,$2,$3,COALESCE($4, 0.8),$5,'ai_suggested',$6,$7)
			RETURNING id`,
			*sug.FromKPID, *sug.ToKPID, t, sug.ProposedStrength,
			sug.Rationale, sug.ID, userID,
		).Scan(&newID); err != nil {
			return nil, fmt.Errorf("insert relation: %w", err)
		}
		resolvedRelID = &newID

		if sug.AnnotationID != nil {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO atlas_relation_evidence (relation_id, annotation_id)
				VALUES ($1, $2) ON CONFLICT DO NOTHING`,
				newID, *sug.AnnotationID,
			); err != nil {
				return nil, fmt.Errorf("link relation evidence: %w", err)
			}
		}
	}

	// MarkResolved 同事务
	// PR #724 review fix (Codex P1 #2): 必须检查 RowsAffected。并发场景下：
	//   T1 BEGIN → T1 INSERT kp → T1 UPDATE WHERE pending → 1 row → T1 COMMIT
	//   T2 BEGIN → T2 INSERT kp → T2 UPDATE WHERE pending → 0 rows (T1 已翻转)
	// 若 T2 不检查 RowsAffected 会成功 commit，留下重复 KP/Relation 而 suggestion 仍只指向 T1 的那个。
	// 这里 0 rows 即并发冲突 —— 必须返回错误触发 Rollback 抹掉本 tx 插入的 KP/Relation。
	res, err := tx.ExecContext(ctx, `
		UPDATE atlas_ai_suggestions
		SET status='accepted', resolved_kp_id=$1, resolved_relation_id=$2, updated_at=CURRENT_TIMESTAMP
		WHERE id=$3 AND status='pending'`,
		resolvedKPID, resolvedRelID, sug.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("mark resolved: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("rows affected check: %w", err)
	}
	if rowsAffected == 0 {
		return nil, fmt.Errorf("建议 %d 状态已被并发改变（可能另一个 tx 已 accept），本事务回滚以避免重复实体", sug.ID)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	sug.Status = "accepted"
	sug.ResolvedKPID = resolvedKPID
	sug.ResolvedRelationID = resolvedRelID
	return sug, nil
}

// Reject 拒绝建议 + 把指纹写入忽略列表（防止反复推荐）。
//
// PR #724 review fix (Codex P1 #1): MarkResolved 现在带 WHERE status='pending' 守卫。
// 若返回 ErrStatusNotPending（并发场景下另一个 tx 已 accept/reject），向上传播让 handler
// 返回明确的并发冲突错误，避免静默盖掉 Accept 结果。
func (s *AISuggestionService) Reject(ctx context.Context, id int64, userID int64) (*model.AISuggestion, error) {
	sug, err := s.sug.FindByID(ctx, id)
	if err != nil || sug == nil {
		return sug, err
	}
	if sug.Status != "pending" {
		return nil, fmt.Errorf("建议状态 %s 不可 reject", sug.Status)
	}
	if err := s.sug.MarkResolved(ctx, sug.ID, "rejected", nil, nil); err != nil {
		if errors.Is(err, repository.ErrStatusNotPending) {
			return nil, fmt.Errorf("建议 %d 已被并发处理（accept/reject），本次 reject 拒绝执行", sug.ID)
		}
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
	// PR #725 review fix (Gemini medium, suggestion_service.go:288): 用标准库 strings.Join
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(h[:])
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
