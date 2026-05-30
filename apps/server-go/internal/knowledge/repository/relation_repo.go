// Atlas — typed_relation_repo (Phase 2 P2-03)

package repository

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"

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

// CreateAndLinkEvidenceInTx 原子创建 relation 并关联 evidence annotations。
func (r *RelationRepo) CreateAndLinkEvidenceInTx(
	ctx context.Context,
	t *model.TypedRelation,
	annotationIDs []int64,
) (*model.TypedRelation, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var out model.TypedRelation
	err = tx.QueryRowxContext(ctx, `
		INSERT INTO atlas_typed_relations (
			from_kp_id, to_kp_id, type, strength,
			body_markdown, provenance, ai_suggestion_id, author_id
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING *`,
		t.FromKPID, t.ToKPID, t.Type, t.Strength,
		t.BodyMarkdown, t.Provenance, t.AISuggestionID, t.AuthorID,
	).StructScan(&out)
	if err != nil {
		return nil, err
	}
	if err := r.LinkEvidenceTx(ctx, tx, out.ID, annotationIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &out, nil
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
func (r *RelationRepo) ListForKP(ctx context.Context, kpID int64, dir string, authorID *int64) ([]model.TypedRelation, error) {
	authorClause := ""
	args := []any{kpID}
	if authorID != nil {
		authorClause = " AND author_id=$2"
		args = append(args, *authorID)
	}
	switch dir {
	case "out":
		rows := []model.TypedRelation{}
		err := r.db.SelectContext(ctx, &rows,
			`SELECT * FROM atlas_typed_relations
			 WHERE from_kp_id=$1 AND deleted=false`+authorClause+`
			 ORDER BY created_at DESC`, args...)
		return rows, err
	case "in":
		rows := []model.TypedRelation{}
		err := r.db.SelectContext(ctx, &rows,
			`SELECT * FROM atlas_typed_relations
			 WHERE to_kp_id=$1 AND deleted=false`+authorClause+`
			 ORDER BY created_at DESC`, args...)
		return rows, err
	default:
		rows := []model.TypedRelation{}
		err := r.db.SelectContext(ctx, &rows,
			`SELECT * FROM atlas_typed_relations
			 WHERE (from_kp_id=$1 OR to_kp_id=$1) AND deleted=false`+authorClause+`
			 ORDER BY created_at DESC`, args...)
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

// ListForNodeIDs 列出两端都在给定节点集合内的未删除关系。
func (r *RelationRepo) ListForNodeIDs(ctx context.Context, nodeIDs []int64, limit int, authorID *int64) ([]model.TypedRelation, error) {
	if len(nodeIDs) == 0 {
		return []model.TypedRelation{}, nil
	}
	if limit <= 0 || limit > 5000 {
		limit = 5000
	}
	q := `SELECT * FROM atlas_typed_relations
		 WHERE deleted=false
		   AND from_kp_id = ANY($1)
		   AND to_kp_id = ANY($1)`
	args := []any{pq.Int64Array(nodeIDs)}
	idx := 2
	if authorID != nil {
		q += " AND author_id=$" + strconv.Itoa(idx)
		args = append(args, *authorID)
		idx++
	}
	q += " ORDER BY id LIMIT $" + strconv.Itoa(idx)
	args = append(args, limit)
	rows := []model.TypedRelation{}
	err := r.db.SelectContext(ctx, &rows, q, args...)
	return rows, err
}

// RelationEvidenceLink 是 atlas_relation_evidence 的对外行。
type RelationEvidenceLink struct {
	RelationID   int64     `db:"relation_id" json:"relationId"`
	AnnotationID int64     `db:"annotation_id" json:"annotationId"`
	CreatedAt    time.Time `db:"created_at" json:"createdAt"`
}

// LinkEvidence 幂等关联一条 annotation evidence。
func (r *RelationRepo) LinkEvidence(ctx context.Context, relationID, annotationID int64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO atlas_relation_evidence (relation_id, annotation_id)
		VALUES ($1, $2)
		ON CONFLICT (relation_id, annotation_id) DO NOTHING`,
		relationID, annotationID)
	return err
}

// LinkEvidenceTx 在事务中幂等关联多条 annotation evidence。
func (r *RelationRepo) LinkEvidenceTx(ctx context.Context, tx *sqlx.Tx, relationID int64, annotationIDs []int64) error {
	if len(annotationIDs) == 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO atlas_relation_evidence (relation_id, annotation_id)
		SELECT $1, unnest($2::bigint[])
		ON CONFLICT (relation_id, annotation_id) DO NOTHING`,
		relationID, pq.Int64Array(annotationIDs))
	return err
}

// ListEvidence 列出 relation 的 evidence annotations。
func (r *RelationRepo) ListEvidence(ctx context.Context, relationID int64) ([]RelationEvidenceLink, error) {
	rows := []RelationEvidenceLink{}
	err := r.db.SelectContext(ctx, &rows, `
		SELECT relation_id, annotation_id, created_at
		FROM atlas_relation_evidence
		WHERE relation_id=$1
		ORDER BY created_at ASC`, relationID)
	return rows, err
}

// DeleteEvidence 删除一条 relation evidence 关联。
func (r *RelationRepo) DeleteEvidence(ctx context.Context, relationID, annotationID int64) error {
	_, err := r.db.ExecContext(ctx, `
		DELETE FROM atlas_relation_evidence
		WHERE relation_id=$1 AND annotation_id=$2`,
		relationID, annotationID)
	return err
}

// SoftDelete 软删除。
func (r *RelationRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE atlas_typed_relations SET deleted=true, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, id)
	return err
}
