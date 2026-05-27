// Atlas — knowledge_point_repo (Phase 2 P2-01/02)
//
// 落地手册: docs/plan/task-aether-knowledge-system.md §3 Phase 2

package repository

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

// KPRepo 操作 atlas_knowledge_points + atlas_annotation_kp_links。
type KPRepo struct {
	*AtlasRepo
}

// NewKPRepo 衍生。
func NewKPRepo(base *AtlasRepo) *KPRepo {
	return &KPRepo{AtlasRepo: base}
}

// Create 插入一条 KP，依靠 PG `gen_random_uuid()` 默认生成 uuid。
func (r *KPRepo) Create(ctx context.Context, k *model.KnowledgePoint) (*model.KnowledgePoint, error) {
	var out model.KnowledgePoint
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO atlas_knowledge_points (
			title, body_markdown, type, confidence, status,
			author_id, provenance, ai_suggestion_id
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING ` + model.KPColumns + `
`,
		k.Title, k.BodyMarkdown, k.Type, k.Confidence, k.Status,
		k.AuthorID, k.Provenance, k.AISuggestionID,
	).StructScan(&out)
	return &out, err
}

// FindByID 按 ID 查询未删除 KP。
func (r *KPRepo) FindByID(ctx context.Context, id int64) (*model.KnowledgePoint, error) {
	var k model.KnowledgePoint
	err := r.db.GetContext(ctx, &k,
		`SELECT `+model.KPColumns+` FROM atlas_knowledge_points WHERE id=$1 AND deleted=false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &k, nil
}

// KPListFilter 是列表筛选。
type KPListFilter struct {
	AuthorID *int64
	Type     *string
	Status   *string
	Keyword  *string
	Limit    int
	Offset   int
}

// List 按筛选列出。Phase 2 不分页（< 1k KP）；Limit 0 表示 200 上限。
func (r *KPRepo) List(ctx context.Context, f KPListFilter) ([]model.KnowledgePoint, error) {
	q := `SELECT ` + model.KPColumns + ` FROM atlas_knowledge_points WHERE deleted=false`
	args := []any{}
	idx := 1
	if f.AuthorID != nil {
		q += " AND author_id=$" + strconv.Itoa(idx)
		args = append(args, *f.AuthorID)
		idx++
	}
	if f.Type != nil && *f.Type != "" {
		q += " AND type=$" + strconv.Itoa(idx)
		args = append(args, *f.Type)
		idx++
	}
	if f.Status != nil && *f.Status != "" {
		q += " AND status=$" + strconv.Itoa(idx)
		args = append(args, *f.Status)
		idx++
	}
	if f.Keyword != nil && *f.Keyword != "" {
		q += " AND (title ILIKE $" + strconv.Itoa(idx) + " OR body_markdown ILIKE $" + strconv.Itoa(idx) + ")"
		args = append(args, "%"+dbutil.EscapeLike(*f.Keyword)+"%")
		idx++
	}
	q += " ORDER BY updated_at DESC LIMIT $" + strconv.Itoa(idx)
	// PR #724 review fix (Codex P2, kp_repo.go:99): 上限从 200 提到 5000，与 /atlas/graph
	// handler 的上限对齐；过去 200 上限会让 graph 静默截断节点。
	// 默认值（未指定 limit）仍走 200 保持兼容。
	limit := f.Limit
	if limit <= 0 {
		limit = 200
	} else if limit > 5000 {
		limit = 5000
	}
	args = append(args, limit)

	rows := []model.KnowledgePoint{}
	err := r.db.SelectContext(ctx, &rows, q, args...)
	return rows, err
}

// UpdatePartial 部分更新。
func (r *KPRepo) UpdatePartial(
	ctx context.Context, id int64,
	title, bodyMarkdown, ptrType, ptrStatus *string,
	confidence *float32, archived *bool,
) (*model.KnowledgePoint, error) {
	q := `UPDATE atlas_knowledge_points SET updated_at=CURRENT_TIMESTAMP`
	args := []any{}
	idx := 1
	add := func(col string, val any) {
		q += ", " + col + "=$" + strconv.Itoa(idx)
		args = append(args, val)
		idx++
	}
	if title != nil {
		add("title", *title)
	}
	if bodyMarkdown != nil {
		add("body_markdown", *bodyMarkdown)
	}
	if ptrType != nil {
		add("type", *ptrType)
	}
	if ptrStatus != nil {
		add("status", *ptrStatus)
	}
	if confidence != nil {
		add("confidence", *confidence)
	}
	if archived != nil {
		add("archived", *archived)
	}
	q += " WHERE id=$" + strconv.Itoa(idx) + " AND deleted=false RETURNING " + model.KPColumns
	args = append(args, id)

	var out model.KnowledgePoint
	err := r.db.QueryRowxContext(ctx, q, args...).StructScan(&out)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &out, err
}

// SoftDelete 软删除。
func (r *KPRepo) SoftDelete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE atlas_knowledge_points SET deleted=true, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, id)
	return err
}

// LinkAnnotation 在 atlas_annotation_kp_links 写一行（幂等：ON CONFLICT DO NOTHING）。
func (r *KPRepo) LinkAnnotation(ctx context.Context, kpID, annotationID int64, role string) error {
	if role == "" {
		role = "evidence"
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO atlas_annotation_kp_links (annotation_id, kp_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (annotation_id, kp_id) DO NOTHING`,
		annotationID, kpID, role,
	)
	return err
}

// LinkAnnotationsTx 在事务中关联多条标注到一个 KP。
func (r *KPRepo) LinkAnnotationsTx(ctx context.Context, tx *sqlx.Tx, kpID int64, annotationIDs []int64) error {
	if len(annotationIDs) == 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO atlas_annotation_kp_links (annotation_id, kp_id, role)
		SELECT unnest($1::bigint[]), $2, 'evidence'
		ON CONFLICT DO NOTHING`,
		pq.Int64Array(annotationIDs), kpID,
	)
	return err
}

// ListEvidenceAnnotations 列出某 KP 的所有出处标注 ID（含 role）。
func (r *KPRepo) ListEvidenceAnnotations(ctx context.Context, kpID int64) ([]EvidenceLink, error) {
	rows := []EvidenceLink{}
	err := r.db.SelectContext(ctx, &rows, `
		SELECT annotation_id, kp_id, role
		FROM atlas_annotation_kp_links
		WHERE kp_id=$1`, kpID)
	return rows, err
}

// ListKPsForAnnotation 列出某标注支撑的所有 KP ID。
func (r *KPRepo) ListKPsForAnnotation(ctx context.Context, annotationID int64) ([]int64, error) {
	ids := []int64{}
	err := r.db.SelectContext(ctx, &ids, `
		SELECT kp_id FROM atlas_annotation_kp_links WHERE annotation_id=$1`, annotationID)
	return ids, err
}

// CreateAndLinkInTx 原子事务：创建 KP + 关联多条 annotation。
func (r *KPRepo) CreateAndLinkInTx(
	ctx context.Context, k *model.KnowledgePoint, annotationIDs []int64,
) (*model.KnowledgePoint, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var out model.KnowledgePoint
	err = tx.QueryRowxContext(ctx, `
		INSERT INTO atlas_knowledge_points (
			title, body_markdown, type, confidence, status,
			author_id, provenance, ai_suggestion_id
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING ` + model.KPColumns + `
`,
		k.Title, k.BodyMarkdown, k.Type, k.Confidence, k.Status,
		k.AuthorID, k.Provenance, k.AISuggestionID,
	).StructScan(&out)
	if err != nil {
		return nil, err
	}

	if err := r.LinkAnnotationsTx(ctx, tx, out.ID, annotationIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &out, nil
}

// EvidenceLink 是 listEvidenceAnnotations 的行类型。
type EvidenceLink struct {
	AnnotationID int64  `db:"annotation_id" json:"annotationId"`
	KPID         int64  `db:"kp_id" json:"kpId"`
	Role         string `db:"role" json:"role"`
}

// itoaKP 自定义函数已移除（PR #724 review fix Gemini medium）：改用 strconv.Itoa
