// Atlas Phase 3 P3-03/04 — AI 建议 Repo
//
// 红线 C3-1: AI 产出永远只能写到此表，绝不可绕过直接写 KP/Relation 表。

package repository

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
)

// SuggestionRepo 操作 atlas_ai_suggestions + atlas_ignored_suggestions。
type SuggestionRepo struct {
	*AtlasRepo
}

// NewSuggestionRepo 衍生。
func NewSuggestionRepo(base *AtlasRepo) *SuggestionRepo {
	return &SuggestionRepo{AtlasRepo: base}
}

// Create 插入建议。
func (r *SuggestionRepo) Create(ctx context.Context, s *model.AISuggestion) (*model.AISuggestion, error) {
	var out model.AISuggestion
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO atlas_ai_suggestions (
			kind, carrier_id, annotation_id, from_kp_id, to_kp_id,
			proposed_title, proposed_body, proposed_kp_type,
			proposed_relation_type, proposed_strength, proposed_confidence,
			rationale, model_id, tokens_in, tokens_out, cost_usd,
			fingerprint, status, author_id
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		RETURNING *`,
		s.Kind, s.CarrierID, s.AnnotationID, s.FromKPID, s.ToKPID,
		s.ProposedTitle, s.ProposedBody, s.ProposedKPType,
		s.ProposedRelationType, s.ProposedStrength, s.ProposedConfidence,
		s.Rationale, s.ModelID, s.TokensIn, s.TokensOut, s.CostUSD,
		s.Fingerprint, s.Status, s.AuthorID,
	).StructScan(&out)
	return &out, err
}

// FindByID 按 ID 查询。
func (r *SuggestionRepo) FindByID(ctx context.Context, id int64) (*model.AISuggestion, error) {
	var s model.AISuggestion
	err := r.db.GetContext(ctx, &s,
		`SELECT * FROM atlas_ai_suggestions WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

// SuggestionFilter 是 List 入参。
type SuggestionFilter struct {
	Kind      *string
	Status    *string
	CarrierID *int64
	AuthorID  *int64
	Limit     int
}

// List 列出建议（默认按时间倒序）。
func (r *SuggestionRepo) List(ctx context.Context, f SuggestionFilter) ([]model.AISuggestion, error) {
	q := `SELECT * FROM atlas_ai_suggestions WHERE 1=1`
	args := []any{}
	idx := 1
	if f.Kind != nil && *f.Kind != "" {
		q += " AND kind=$" + strconv.Itoa(idx)
		args = append(args, *f.Kind)
		idx++
	}
	if f.Status != nil && *f.Status != "" {
		q += " AND status=$" + strconv.Itoa(idx)
		args = append(args, *f.Status)
		idx++
	}
	if f.CarrierID != nil {
		q += " AND carrier_id=$" + strconv.Itoa(idx)
		args = append(args, *f.CarrierID)
		idx++
	}
	if f.AuthorID != nil {
		q += " AND author_id=$" + strconv.Itoa(idx)
		args = append(args, *f.AuthorID)
		idx++
	}
	q += " ORDER BY created_at DESC LIMIT $" + strconv.Itoa(idx)
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	args = append(args, limit)

	rows := []model.AISuggestion{}
	err := r.db.SelectContext(ctx, &rows, q, args...)
	return rows, err
}

// MarkResolved 标记建议为 accepted（带 resolved_*_id）或 rejected。
//
// PR #724 review fix (Codex P1 #1): UPDATE 必须 WHERE status='pending' + 检查 RowsAffected。
// 否则并发场景下：T1 Accept 已把状态翻到 accepted + resolved_kp_id；T2 Reject 还能盲 UPDATE
// 把同一行改回 rejected 并清空 resolved_*，造成 KP 已建但建议状态错乱+孤儿 KP。
//
// 返回:
//   - nil: 命中并更新了 1 行
//   - ErrStatusNotPending: 行不存在或已不是 pending（调用方应回滚事务）
//   - 其他: DB 错误
func (r *SuggestionRepo) MarkResolved(
	ctx context.Context, id int64, status string,
	resolvedKPID, resolvedRelationID *int64,
) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE atlas_ai_suggestions
		SET status=$1, resolved_kp_id=$2, resolved_relation_id=$3, updated_at=CURRENT_TIMESTAMP
		WHERE id=$4 AND status='pending'`,
		status, resolvedKPID, resolvedRelationID, id,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrStatusNotPending
	}
	return nil
}

// ErrStatusNotPending 是 MarkResolved 在乐观锁失败时返回的错误。
// 调用方可以用 errors.Is(err, ErrStatusNotPending) 区分并发冲突 vs 真实 DB 错误。
var ErrStatusNotPending = errors.New("suggestion 状态已不是 pending（可能被并发 accept/reject）")

// AddIgnored 在 atlas_ignored_suggestions 写入忽略指纹。
func (r *SuggestionRepo) AddIgnored(ctx context.Context, fingerprint, kind string, userID int64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO atlas_ignored_suggestions (fingerprint, suggestion_kind, user_id)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		fingerprint, kind, userID,
	)
	return err
}

// IsIgnored 查询某指纹是否在用户忽略列表里。
func (r *SuggestionRepo) IsIgnored(ctx context.Context, fingerprint string, userID int64) (bool, error) {
	var n int
	err := r.db.GetContext(ctx, &n,
		`SELECT 1 FROM atlas_ignored_suggestions
		 WHERE fingerprint=$1 AND user_id=$2 LIMIT 1`, fingerprint, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return n == 1, err
}

// FindPendingByFingerprint 返回同一作者下尚未处理的同指纹建议。
func (r *SuggestionRepo) FindPendingByFingerprint(ctx context.Context, fingerprint string, authorID *int64) (*model.AISuggestion, error) {
	var s model.AISuggestion
	var err error
	if authorID != nil {
		err = r.db.GetContext(ctx, &s, `
			SELECT * FROM atlas_ai_suggestions
			WHERE fingerprint=$1 AND status='pending'
			  AND author_id=$2
			ORDER BY created_at DESC
			LIMIT 1`, fingerprint, *authorID)
	} else {
		err = r.db.GetContext(ctx, &s, `
			SELECT * FROM atlas_ai_suggestions
			WHERE fingerprint=$1 AND status='pending'
			  AND author_id IS NULL
			ORDER BY created_at DESC
			LIMIT 1`, fingerprint)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}
