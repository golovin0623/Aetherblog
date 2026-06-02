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

// GraphHealthMetrics 是 live Atlas 图谱健康指标。
type GraphHealthMetrics struct {
	ActiveKPCount                int64            `db:"active_kp_count" json:"activeKpCount"`
	RelationCount                int64            `db:"relation_count" json:"relationCount"`
	RelationDensity              float64          `json:"relationDensity"`
	OrphanKPCount                int64            `db:"orphan_kp_count" json:"orphanKpCount"`
	OrphanKPRatio                float64          `json:"orphanKpRatio"`
	KPEvidenceCount              int64            `db:"kp_evidence_count" json:"kpEvidenceCount"`
	KPEvidenceCoverage           float64          `json:"kpEvidenceCoverage"`
	RelationEvidenceCount        int64            `db:"relation_evidence_count" json:"relationEvidenceCount"`
	RelationEvidenceCoverage     float64          `json:"relationEvidenceCoverage"`
	MissingEvidenceKPCount       int64            `json:"missingEvidenceKpCount"`
	MissingEvidenceRelationCount int64            `json:"missingEvidenceRelationCount"`
	AIKPCount                    int64            `db:"ai_kp_count" json:"aiKpCount"`
	TopHubs                      []GraphHealthHub `json:"topHubs"`
}

// GraphHealthHub 是按入/出度聚合的 hub 节点。
type GraphHealthHub struct {
	KPID      int64  `db:"kp_id" json:"kpId"`
	Title     string `db:"title" json:"title"`
	Degree    int64  `db:"degree" json:"degree"`
	InDegree  int64  `db:"in_degree" json:"inDegree"`
	OutDegree int64  `db:"out_degree" json:"outDegree"`
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

// CountEvidenceByRelationIDs 批量统计 relation evidence 数量，Graph inspector / filters 使用。
func (r *RelationRepo) CountEvidenceByRelationIDs(ctx context.Context, relationIDs []int64) (map[int64]int64, error) {
	counts := map[int64]int64{}
	if len(relationIDs) == 0 {
		return counts, nil
	}
	rows := []struct {
		RelationID int64 `db:"relation_id"`
		Count      int64 `db:"count"`
	}{}
	if err := r.db.SelectContext(ctx, &rows, `
		SELECT e.relation_id, COUNT(*) AS count
		FROM atlas_relation_evidence e
		JOIN atlas_annotations a ON a.id = e.annotation_id AND a.deleted = false
		WHERE e.relation_id = ANY($1)
		GROUP BY e.relation_id`, pq.Int64Array(relationIDs)); err != nil {
		return nil, err
	}
	for _, row := range rows {
		counts[row.RelationID] = row.Count
	}
	return counts, nil
}

// FirstEvidencePreviewRowsByRelationIDs returns one scoped evidence annotation
// per relation for graph inspector previews.
func (r *RelationRepo) FirstEvidencePreviewRowsByRelationIDs(ctx context.Context, relationIDs []int64, authorID *int64) ([]EvidencePreviewRow, error) {
	if len(relationIDs) == 0 {
		return []EvidencePreviewRow{}, nil
	}
	q := `
WITH ranked AS (
	SELECT
		e.relation_id AS subject_id,
		a.id AS annotation_id,
		a.carrier_id,
		a.selectors,
		a.body_text,
		a.author_id AS annotation_author_id,
		c.type AS carrier_type,
		c.title AS carrier_title,
		c.owner_id AS carrier_owner_id,
		ROW_NUMBER() OVER (
			PARTITION BY e.relation_id
			ORDER BY e.created_at ASC, e.annotation_id ASC
		) AS rn
	FROM atlas_relation_evidence e
	JOIN atlas_annotations a ON a.id = e.annotation_id AND a.deleted = false
	JOIN atlas_carriers c ON c.id = a.carrier_id AND c.deleted = false
	WHERE e.relation_id = ANY($1)`
	args := []any{pq.Int64Array(relationIDs)}
	q += `
	  AND (
		NULLIF(BTRIM(COALESCE(a.body_text, '')), '') IS NOT NULL
		OR a.selectors::text LIKE '%TextQuoteSelector%'
	  )`
	if authorID != nil {
		q += `
	  AND a.author_id = $2
	  AND c.owner_id = $2`
		args = append(args, *authorID)
	}
	q += `
)
SELECT
	subject_id,
	annotation_id,
	carrier_id,
	selectors,
	body_text,
	annotation_author_id,
	carrier_type,
	carrier_title,
	carrier_owner_id
FROM ranked
WHERE rn = 1`
	rows := []EvidencePreviewRow{}
	err := r.db.SelectContext(ctx, &rows, q, args...)
	return rows, err
}

// GraphHealth 汇总当前 scope 下的关系密度、evidence 覆盖率和 hub 排名。
func (r *RelationRepo) GraphHealth(ctx context.Context, authorID *int64, hubLimit int) (*GraphHealthMetrics, error) {
	if hubLimit <= 0 {
		hubLimit = 5
	} else if hubLimit > 20 {
		hubLimit = 20
	}

	args := []any{}
	kpAuthorClause := ""
	relAuthorClause := ""
	nextArg := 1
	if authorID != nil {
		kpAuthorClause = " AND author_id=$" + strconv.Itoa(nextArg)
		relAuthorClause = " AND r.author_id=$" + strconv.Itoa(nextArg)
		args = append(args, *authorID)
		nextArg++
	}

	countQuery := `
WITH scoped_kp AS (
	SELECT id, title, provenance
	FROM atlas_knowledge_points
	WHERE deleted=false
	  AND archived=false
	  AND status <> 'archived'` + kpAuthorClause + `
),
scoped_rel AS (
	SELECT r.id, r.from_kp_id, r.to_kp_id, r.body_markdown
	FROM atlas_typed_relations r
	JOIN scoped_kp from_kp ON from_kp.id = r.from_kp_id
	JOIN scoped_kp to_kp ON to_kp.id = r.to_kp_id
	WHERE r.deleted=false` + relAuthorClause + `
)
SELECT
	(SELECT COUNT(*) FROM scoped_kp) AS active_kp_count,
	(SELECT COUNT(*) FROM scoped_rel) AS relation_count,
	(
		SELECT COUNT(*)
		FROM scoped_kp k
		WHERE NOT EXISTS (
			SELECT 1
			FROM scoped_rel r
			WHERE r.from_kp_id = k.id OR r.to_kp_id = k.id
		)
	) AS orphan_kp_count,
	(
		SELECT COUNT(*)
		FROM scoped_kp k
		WHERE EXISTS (
			SELECT 1
			FROM atlas_annotation_kp_links l
			JOIN atlas_annotations a ON a.id = l.annotation_id AND a.deleted = false
			WHERE l.kp_id = k.id
		)
	) AS kp_evidence_count,
	(
		SELECT COUNT(*)
		FROM scoped_rel r
		WHERE EXISTS (
			SELECT 1
			FROM atlas_relation_evidence e
			JOIN atlas_annotations a ON a.id = e.annotation_id AND a.deleted = false
			WHERE e.relation_id = r.id
		)
		OR NULLIF(BTRIM(COALESCE(r.body_markdown, '')), '') IS NOT NULL
	) AS relation_evidence_count,
	(SELECT COUNT(*) FROM scoped_kp WHERE provenance='ai_suggested') AS ai_kp_count`

	var metrics GraphHealthMetrics
	if err := r.db.GetContext(ctx, &metrics, countQuery, args...); err != nil {
		return nil, err
	}
	if metrics.ActiveKPCount > 0 {
		metrics.RelationDensity = float64(metrics.RelationCount) / float64(metrics.ActiveKPCount)
		metrics.OrphanKPRatio = float64(metrics.OrphanKPCount) / float64(metrics.ActiveKPCount)
		metrics.KPEvidenceCoverage = float64(metrics.KPEvidenceCount) / float64(metrics.ActiveKPCount)
	}
	if metrics.RelationCount > 0 {
		metrics.RelationEvidenceCoverage = float64(metrics.RelationEvidenceCount) / float64(metrics.RelationCount)
	}
	metrics.MissingEvidenceKPCount = nonNegativeMetricDelta(metrics.ActiveKPCount, metrics.KPEvidenceCount)
	metrics.MissingEvidenceRelationCount = nonNegativeMetricDelta(metrics.RelationCount, metrics.RelationEvidenceCount)

	hubArgs := append([]any{}, args...)
	limitArg := nextArg
	hubArgs = append(hubArgs, hubLimit)
	hubQuery := `
WITH scoped_kp AS (
	SELECT id, title
	FROM atlas_knowledge_points
	WHERE deleted=false
	  AND archived=false
	  AND status <> 'archived'` + kpAuthorClause + `
),
scoped_rel AS (
	SELECT r.id, r.from_kp_id, r.to_kp_id
	FROM atlas_typed_relations r
	JOIN scoped_kp from_kp ON from_kp.id = r.from_kp_id
	JOIN scoped_kp to_kp ON to_kp.id = r.to_kp_id
	WHERE r.deleted=false` + relAuthorClause + `
),
degrees AS (
	SELECT
		k.id AS kp_id,
		k.title,
		COUNT(r.id) AS degree,
		COUNT(r.id) FILTER (WHERE r.to_kp_id = k.id) AS in_degree,
		COUNT(r.id) FILTER (WHERE r.from_kp_id = k.id) AS out_degree
	FROM scoped_kp k
	LEFT JOIN scoped_rel r ON r.from_kp_id = k.id OR r.to_kp_id = k.id
	GROUP BY k.id, k.title
)
SELECT kp_id, title, degree, in_degree, out_degree
FROM degrees
WHERE degree > 0
ORDER BY degree DESC, kp_id ASC
LIMIT $` + strconv.Itoa(limitArg)
	hubs := []GraphHealthHub{}
	if err := r.db.SelectContext(ctx, &hubs, hubQuery, hubArgs...); err != nil {
		return nil, err
	}
	metrics.TopHubs = hubs
	return &metrics, nil
}

func nonNegativeMetricDelta(total, covered int64) int64 {
	if covered >= total {
		return 0
	}
	return total - covered
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
		SELECT e.relation_id, e.annotation_id, e.created_at
		FROM atlas_relation_evidence e
		JOIN atlas_annotations a ON a.id = e.annotation_id AND a.deleted = false
		WHERE e.relation_id=$1
		ORDER BY e.created_at ASC`, relationID)
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
