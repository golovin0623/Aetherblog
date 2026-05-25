// Package repository · kb_profile_repo.go — kb_profiles CRUD 与激活事务。
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

type KBProfileRepo struct{ db *sqlx.DB }

func NewKBProfileRepo(db *sqlx.DB) *KBProfileRepo { return &KBProfileRepo{db: db} }

const kbProfileColumns = `id, kb_id, code, name, description, model_id, chunker_kind,
    chunk_size_tokens, chunk_overlap_tokens, top_k, score_threshold, status, created_at, updated_at`

// FindByID 单条查询。
func (r *KBProfileRepo) FindByID(ctx context.Context, id int64) (*model.KBProfile, error) {
	var p model.KBProfile
	err := r.db.GetContext(ctx, &p, `SELECT `+kbProfileColumns+` FROM kb_profiles WHERE id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// FindActiveByKB 返回 kb_id 下 status='active' 的唯一 profile。
func (r *KBProfileRepo) FindActiveByKB(ctx context.Context, kbID int64) (*model.KBProfile, error) {
	var p model.KBProfile
	err := r.db.GetContext(ctx, &p,
		`SELECT `+kbProfileColumns+` FROM kb_profiles WHERE kb_id=$1 AND status='active'`, kbID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// ListByKB 返回所有 profile（active 优先，其次 shadow，最后 deprecated）。
func (r *KBProfileRepo) ListByKB(ctx context.Context, kbID int64) ([]model.KBProfile, error) {
	var ps []model.KBProfile
	err := r.db.SelectContext(ctx, &ps, `
        SELECT `+kbProfileColumns+` FROM kb_profiles
        WHERE kb_id=$1
        ORDER BY CASE status
            WHEN 'active' THEN 0
            WHEN 'shadow' THEN 1
            WHEN 'deprecated' THEN 2
            ELSE 3 END, created_at DESC`, kbID)
	return ps, err
}

// KBProfileCreateRequest 携带 Create 时的全部字段。
type KBProfileCreateRequest struct {
	KBID               int64
	Code               string
	Name               string
	Description        *string
	ModelID            string
	ChunkerKind        string
	ChunkSizeTokens    int
	ChunkOverlapTokens int
	TopK               int
	// nil → repo 用 0.200 兜底；非 nil → 即便是 0 也按传入值写入。
	// 这是为了让 admin 能合法设置 scoreThreshold=0（拉满召回不做相似度过滤）。
	ScoreThreshold     *float64
	Status             string // 默认 'shadow'；首次创建直接传 'active' 可一步到位
}

// Create 写入新 profile 并返回。
func (r *KBProfileRepo) Create(ctx context.Context, req KBProfileCreateRequest) (*model.KBProfile, error) {
	status := req.Status
	if status == "" {
		status = model.KBProfileStatusShadow
	}
	topK := req.TopK
	if topK <= 0 {
		topK = 6
	}
	// nil = "未提供" 走默认 0.200；非 nil 即便是显式 0 也尊重 caller
	// （review chatgpt-codex P2 修复：之前 ScoreThreshold == 0 被误当缺省）。
	threshold := 0.200
	if req.ScoreThreshold != nil {
		threshold = *req.ScoreThreshold
	}
	var id int64
	err := r.db.QueryRowContext(ctx, `
        INSERT INTO kb_profiles (kb_id, code, name, description, model_id, chunker_kind,
            chunk_size_tokens, chunk_overlap_tokens, top_k, score_threshold, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id`,
		req.KBID, req.Code, req.Name, req.Description, req.ModelID, req.ChunkerKind,
		req.ChunkSizeTokens, req.ChunkOverlapTokens, topK, threshold, status,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return r.FindByID(ctx, id)
}

// Update 修改可变字段。仅当 status='shadow' 时允许 model/chunker 等结构性字段；active 限改 top_k / threshold / 描述。
// 业务规则由 service 层强制；本方法负责通用 patch SQL。
func (r *KBProfileRepo) Update(ctx context.Context, id int64, sets map[string]any) error {
	if len(sets) == 0 {
		return nil
	}
	cols := make([]string, 0, len(sets)+1)
	args := make([]any, 0, len(sets)+1)
	i := 1
	for k, v := range sets {
		cols = append(cols, fmt.Sprintf("%s = $%d", k, i))
		args = append(args, v)
		i++
	}
	cols = append(cols, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	q := fmt.Sprintf("UPDATE kb_profiles SET %s WHERE id = $%d", strings.Join(cols, ", "), i)
	_, err := r.db.ExecContext(ctx, q, args...)
	return err
}

// Delete 删除 profile。被 knowledge_bases.active_profile_id 引用时由 ON DELETE SET NULL 处理。
// 业务规则：仅允许删除 status='deprecated'。由 service 层校验。
func (r *KBProfileRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM kb_profiles WHERE id=$1`, id)
	return err
}

// Activate 蓝绿激活：在同一事务里
//   1. 当前 active 的 profile（如有）翻为 deprecated
//   2. 目标 profile 翻为 active
//   3. knowledge_bases.active_profile_id 指向目标
//
// 简单激活：仅指针切换，不重写 embeddings。当 shadow profile 已经写好了 embeddings
// （比如经过 ActivateWithShadow 的 reindex 阶段），调用本方法做最终切换。
//
// 注意：partial unique index ``uq_kb_profile_one_active`` 要求同一 kb 任意时刻
// 至多一行 active。本事务里先把旧 active 翻成 deprecated 再把新 active 翻起来，
// 满足该约束。
func (r *KBProfileRepo) Activate(ctx context.Context, kbID, targetProfileID int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// 旧 active → deprecated
	if _, err := tx.ExecContext(ctx,
		`UPDATE kb_profiles SET status='deprecated', updated_at=CURRENT_TIMESTAMP
         WHERE kb_id=$1 AND status='active' AND id <> $2`,
		kbID, targetProfileID); err != nil {
		return fmt.Errorf("deprecate old active: %w", err)
	}
	// 目标 → active
	if _, err := tx.ExecContext(ctx,
		`UPDATE kb_profiles SET status='active', updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND kb_id=$2`,
		targetProfileID, kbID); err != nil {
		return fmt.Errorf("set new active: %w", err)
	}
	// knowledge_bases 指针
	if _, err := tx.ExecContext(ctx,
		`UPDATE knowledge_bases SET active_profile_id=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
		targetProfileID, kbID); err != nil {
		return fmt.Errorf("update kb active_profile_id: %w", err)
	}
	return tx.Commit()
}

// CommitBlueGreen 在 shadow embeddings 全部写入后执行的最终切换事务：
//   1. 旧 active profile → deprecated；旧 active kb_embeddings → deprecated
//   2. 目标 shadow profile → active；目标 shadow kb_embeddings → active
//   3. knowledge_bases.active_profile_id 指向目标
//
// 这是真正的"零切换窗口"蓝绿切换 —— 整套表的同时翻转保证搜索流量永远落在
// 一致的 (profile, embeddings) 对上。
func (r *KBProfileRepo) CommitBlueGreen(ctx context.Context, kbID, targetProfileID int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 收集旧 active profile id（如有）
	var oldActive sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		`SELECT id FROM kb_profiles WHERE kb_id=$1 AND status='active' AND id <> $2 LIMIT 1`,
		kbID, targetProfileID).Scan(&oldActive); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("locate old active profile: %w", err)
	}

	// 1. 旧 active profile → deprecated
	if oldActive.Valid {
		if _, err := tx.ExecContext(ctx,
			`UPDATE kb_profiles SET status='deprecated', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
			oldActive.Int64); err != nil {
			return fmt.Errorf("deprecate old profile: %w", err)
		}
		// 1.2 旧 active 的 embeddings → deprecated
		if _, err := tx.ExecContext(ctx,
			`UPDATE kb_embeddings SET status='deprecated' WHERE profile_id=$1 AND status='active'`,
			oldActive.Int64); err != nil {
			return fmt.Errorf("deprecate old embeddings: %w", err)
		}
	}

	// 2. shadow embeddings 在目标 profile 下 → active
	if _, err := tx.ExecContext(ctx,
		`UPDATE kb_embeddings SET status='active' WHERE profile_id=$1 AND status='shadow'`,
		targetProfileID); err != nil {
		return fmt.Errorf("promote shadow embeddings: %w", err)
	}

	// 3. 目标 profile 状态 → active
	if _, err := tx.ExecContext(ctx,
		`UPDATE kb_profiles SET status='active', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
		targetProfileID); err != nil {
		return fmt.Errorf("activate target profile: %w", err)
	}

	// 4. knowledge_bases 指针
	if _, err := tx.ExecContext(ctx,
		`UPDATE knowledge_bases SET active_profile_id=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
		targetProfileID, kbID); err != nil {
		return fmt.Errorf("update kb pointer: %w", err)
	}

	return tx.Commit()
}
