// Atlas — typed_relation_repo (Phase 2 P2-03)

package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
)

// RelationRepo 操作 atlas_typed_relations。
type RelationRepo struct {
	*AtlasRepo
}

// NewRelationRepo 衍生。
func NewRelationRepo(base *AtlasRepo) *RelationRepo {
	return &RelationRepo{AtlasRepo: base}
}

// Create 插入一条 typed relation。
func (r *RelationRepo) Create(ctx context.Context, t *model.TypedRelation) (*model.TypedRelation, error) {
	var out model.TypedRelation
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO atlas_typed_relations (
			from_kp_id, to_kp_id, type, strength,
			body_markdown, provenance, ai_suggestion_id, author_id
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING *`,
		t.FromKPID, t.ToKPID, t.Type, t.Strength,
		t.BodyMarkdown, t.Provenance, t.AISuggestionID, t.AuthorID,
	).StructScan(&out)
	return &out, err
}

// FindByID 按 ID 查询。
func (r *RelationRepo) FindByID(ctx context.Context, id int64) (*model.TypedRelation, error) {
	var t model.TypedRelation
	err := r.db.GetContext(ctx, &t,
		`SELECT * FROM atlas_typed_relations WHERE id=$1 AND deleted=false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

// ListForKP 列出某 KP 的所有出关系（dir=out）或入关系（dir=in）或两者（all）。
func (r *RelationRepo) ListForKP(ctx context.Context, kpID int64, dir string) ([]model.TypedRelation, error) {
	switch dir {
	case "out":
		rows := []model.TypedRelation{}
		err := r.db.SelectContext(ctx, &rows,
			`SELECT * FROM atlas_typed_relations
			 WHERE from_kp_id=$1 AND deleted=false ORDER BY created_at DESC`, kpID)
		return rows, err
	case "in":
		rows := []model.TypedRelation{}
		err := r.db.SelectContext(ctx, &rows,
			`SELECT * FROM atlas_typed_relations
			 WHERE to_kp_id=$1 AND deleted=false ORDER BY created_at DESC`, kpID)
		return rows, err
	default:
		rows := []model.TypedRelation{}
		err := r.db.SelectContext(ctx, &rows,
			`SELECT * FROM atlas_typed_relations
			 WHERE (from_kp_id=$1 OR to_kp_id=$1) AND deleted=false
			 ORDER BY created_at DESC`, kpID)
		return rows, err
	}
}

// ListAll 列出全部未删除关系（图谱视图用）。Limit 默认 5000（手册 §3 Phase 2 C2-3）。
func (r *RelationRepo) ListAll(ctx context.Context, limit int) ([]model.TypedRelation, error) {
	if limit <= 0 || limit > 5000 {
		limit = 5000
	}
	rows := []model.TypedRelation{}
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM atlas_typed_relations
		 WHERE deleted=false
		 ORDER BY id LIMIT $1`, limit)
	return rows, err
}

// SoftDelete 软删除。
func (r *RelationRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE atlas_typed_relations SET deleted=true, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, id)
	return err
}
