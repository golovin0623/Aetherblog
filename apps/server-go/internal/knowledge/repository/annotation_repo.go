// Package repository — Atlas annotation_repo
//
// 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 1 task-knowledge-P1-06

package repository

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

// AnnotationRepo 操作 atlas_annotations。
type AnnotationRepo struct {
	*AtlasRepo
}

// NewAnnotationRepo 由 AtlasRepo 衍生。
func NewAnnotationRepo(base *AtlasRepo) *AnnotationRepo {
	return &AnnotationRepo{AtlasRepo: base}
}

// Create 插入一条标注并回填字段。
func (r *AnnotationRepo) Create(ctx context.Context, a *model.Annotation) (*model.Annotation, error) {
	var out model.Annotation
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO atlas_annotations (
			carrier_id, carrier_version_id, selectors, rel_position,
			body_type, body_text, body_meta,
			anchor_state, anchor_score, author_id
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING *`,
		a.CarrierID, a.CarrierVersionID, a.Selectors, a.RelPosition,
		a.BodyType, a.BodyText, a.BodyMeta,
		a.AnchorState, a.AnchorScore, a.AuthorID,
	).StructScan(&out)
	return &out, err
}

// FindByID 按 ID 查询。
func (r *AnnotationRepo) FindByID(ctx context.Context, id int64) (*model.Annotation, error) {
	var a model.Annotation
	err := r.db.GetContext(ctx, &a,
		`SELECT * FROM atlas_annotations WHERE id=$1 AND deleted=false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// FindByCarrier 列出 carrier 下所有未删除标注。Phase 1 不分页（标注数量 < 1k）。
func (r *AnnotationRepo) FindByCarrier(ctx context.Context, carrierID int64) ([]model.Annotation, error) {
	rows := []model.Annotation{}
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM atlas_annotations
		 WHERE carrier_id=$1 AND deleted=false
		 ORDER BY created_at ASC`, carrierID)
	return rows, err
}

// FindByCarrierForAuthor 列出某作者在 carrier 下的未删除标注。
func (r *AnnotationRepo) FindByCarrierForAuthor(ctx context.Context, carrierID int64, authorID int64) ([]model.Annotation, error) {
	rows := []model.Annotation{}
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM atlas_annotations
		 WHERE carrier_id=$1 AND author_id=$2 AND deleted=false
		 ORDER BY created_at ASC`, carrierID, authorID)
	return rows, err
}

// Search 在标注正文与 selectors 文本中做轻量关键字搜索。
func (r *AnnotationRepo) Search(ctx context.Context, keyword string, authorID *int64, limit int) ([]model.Annotation, error) {
	if keyword == "" {
		return []model.Annotation{}, nil
	}
	q := `SELECT * FROM atlas_annotations
		WHERE deleted=false
		  AND (body_text ILIKE $1 OR selectors::text ILIKE $1)`
	args := []any{"%" + dbutil.EscapeLike(keyword) + "%"}
	idx := 2
	if authorID != nil {
		q += " AND author_id=$" + strconv.Itoa(idx)
		args = append(args, *authorID)
		idx++
	}
	if limit <= 0 {
		limit = 20
	} else if limit > 100 {
		limit = 100
	}
	q += " ORDER BY updated_at DESC LIMIT $" + strconv.Itoa(idx)
	args = append(args, limit)

	rows := []model.Annotation{}
	err := r.db.SelectContext(ctx, &rows, q, args...)
	return rows, err
}

// UpdatePartial 部分更新（body / anchor_state / anchor_score / body_meta）。
// 字段 nil 表示不动。
func (r *AnnotationRepo) UpdatePartial(
	ctx context.Context, id int64,
	bodyText *string, bodyMeta []byte,
	anchorState *string, anchorScore *float32,
) (*model.Annotation, error) {
	query := `UPDATE atlas_annotations SET updated_at=CURRENT_TIMESTAMP`
	args := []any{}
	idx := 1
	if bodyText != nil {
		query += ", body_text=$" + strconv.Itoa(idx)
		args = append(args, *bodyText)
		idx++
	}
	if bodyMeta != nil {
		query += ", body_meta=$" + strconv.Itoa(idx)
		args = append(args, bodyMeta)
		idx++
	}
	if anchorState != nil {
		query += ", anchor_state=$" + strconv.Itoa(idx)
		args = append(args, *anchorState)
		idx++
	}
	if anchorScore != nil {
		query += ", anchor_score=$" + strconv.Itoa(idx)
		args = append(args, *anchorScore)
		idx++
	}
	query += " WHERE id=$" + strconv.Itoa(idx) + " AND deleted=false RETURNING *"
	args = append(args, id)

	var out model.Annotation
	err := r.db.QueryRowxContext(ctx, query, args...).StructScan(&out)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// SoftDelete 软删除。
func (r *AnnotationRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE atlas_annotations SET deleted=true, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, id)
	return err
}

// itoa 自定义函数已移除（PR #724 review fix Gemini medium）：改用 strconv.Itoa
