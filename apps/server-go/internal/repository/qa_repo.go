package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/qatree"
)

// marshalJSON 把任意值序列化为 JSON 字节，nil 返回 nil。
func marshalJSON(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

// nullStr 把空串转为 SQL NULL（用于可空文本列）。
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// QARepo 提供 QA Document Workflow 表族（qa_documents 等 9 张表）的数据访问能力。
type QARepo struct{ db *sqlx.DB }

// NewQARepo 创建 QARepo。
func NewQARepo(db *sqlx.DB) *QARepo { return &QARepo{db: db} }

// DB 暴露底层连接，供 service 层做跨仓储事务（如发布入库）。
func (r *QARepo) DB() *sqlx.DB { return r.db }

// QADocFilter 是文档列表筛选条件。
type QADocFilter struct {
	Keyword  string
	Status   string
	OwnerID  *int64
	PageNum  int
	PageSize int
}

// ---------------- qa_documents ----------------

// CreateDocument 插入文档主记录。
func (r *QARepo) CreateDocument(ctx context.Context, d *model.QADocument) (*model.QADocument, error) {
	var out model.QADocument
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO qa_documents (title, media_file_id, file_type, page_count, split_granularity,
			status, current_version, owner_id, created_by, deleted, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		RETURNING *`,
		d.Title, d.MediaFileID, d.FileType, d.PageCount, d.SplitGranularity, d.Status,
		d.OwnerID, d.CreatedBy,
	).StructScan(&out)
	return &out, err
}

// GetDocument 查询未删除文档。
func (r *QARepo) GetDocument(ctx context.Context, id int64) (*model.QADocument, error) {
	var d model.QADocument
	err := r.db.GetContext(ctx, &d, `SELECT * FROM qa_documents WHERE id=$1 AND deleted=false`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &d, err
}

// ListDocuments 返回后台文档分页列表。
func (r *QARepo) ListDocuments(ctx context.Context, f QADocFilter) ([]model.QADocument, int64, error) {
	clauses := []string{"deleted=false"}
	args := []any{}
	n := 1
	ph := func(v any) string {
		args = append(args, v)
		s := fmt.Sprintf("$%d", n)
		n++
		return s
	}
	if f.Status != "" {
		clauses = append(clauses, "status="+ph(f.Status))
	}
	if f.OwnerID != nil {
		clauses = append(clauses, "owner_id="+ph(*f.OwnerID))
	}
	if kw := strings.TrimSpace(f.Keyword); kw != "" {
		clauses = append(clauses, "title ILIKE "+ph("%"+kw+"%"))
	}
	where := " WHERE " + strings.Join(clauses, " AND ")

	var total int64
	if err := r.db.GetContext(ctx, &total, "SELECT COUNT(*) FROM qa_documents"+where, args...); err != nil {
		return nil, 0, err
	}
	offset := (f.PageNum - 1) * f.PageSize
	listSQL := "SELECT * FROM qa_documents" + where +
		fmt.Sprintf(" ORDER BY id DESC LIMIT $%d OFFSET $%d", n, n+1)
	args = append(args, f.PageSize, offset)

	var rows []model.QADocument
	err := r.db.SelectContext(ctx, &rows, listSQL, args...)
	return rows, total, err
}

// UpdateStatus 更新文档状态（可附错误信息），不做迁移合法性校验（service 层负责）。
func (r *QARepo) UpdateStatus(ctx context.Context, id int64, status string, errMsg *string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE qa_documents SET status=$1, error_message=$2, updated_at=CURRENT_TIMESTAMP
		WHERE id=$3 AND deleted=false`, status, errMsg, id)
	return err
}

// SetPageCount 写入页数。
func (r *QARepo) SetPageCount(ctx context.Context, id int64, n int) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE qa_documents SET page_count=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`, n, id)
	return err
}

// SetCurrentVersion 写入当前版本号。
func (r *QARepo) SetCurrentVersion(ctx context.Context, id int64, versionNo int) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE qa_documents SET current_version=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`, versionNo, id)
	return err
}

// SoftDeleteDocument 软删除文档。
func (r *QARepo) SoftDeleteDocument(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE qa_documents SET deleted=true, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, id)
	return err
}

// ---------------- qa_document_jobs ----------------

// EnqueueJob 幂等入队一个阶段任务。idempotency_key 撞键时返回既有记录（不重复入队）。
func (r *QARepo) EnqueueJob(ctx context.Context, j *model.QADocumentJob) (*model.QADocumentJob, error) {
	payload := j.Payload
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	var out model.QADocumentJob
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO qa_document_jobs (document_id, stage, status, idempotency_key, max_attempts, payload, created_at, updated_at)
		VALUES ($1,$2,'PENDING',$3,$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		ON CONFLICT (idempotency_key) DO UPDATE SET updated_at=qa_document_jobs.updated_at
		RETURNING *`,
		j.DocumentID, j.Stage, j.IdempotencyKey, defaultInt(j.MaxAttempts, 3), payload,
	).StructScan(&out)
	return &out, err
}

func defaultInt(v, def int) int {
	if v <= 0 {
		return def
	}
	return v
}

// ClaimNextPendingJob 原子领取下一个 PENDING 任务（FOR UPDATE SKIP LOCKED），
// 置为 RUNNING、attempt_count++、记录 started_at。无任务时返回 (nil,nil)。
func (r *QARepo) ClaimNextPendingJob(ctx context.Context) (*model.QADocumentJob, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var j model.QADocumentJob
	err = tx.GetContext(ctx, &j, `
		SELECT * FROM qa_document_jobs
		WHERE status='PENDING'
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE SKIP LOCKED`)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := tx.GetContext(ctx, &j, `
		UPDATE qa_document_jobs
		SET status='RUNNING', attempt_count=attempt_count+1, started_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
		WHERE id=$1
		RETURNING *`, j.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &j, nil
}

// MarkJobSucceeded 标记任务成功。
func (r *QARepo) MarkJobSucceeded(ctx context.Context, id int64, logMsg string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE qa_document_jobs
		SET status='SUCCEEDED', log=$1, error=NULL, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
		WHERE id=$2`, logMsg, id)
	return err
}

// MarkJobOutcome 根据 attempt/max 决定失败任务是重回 PENDING 重试还是终态 FAILED。
// 返回 retryScheduled=true 表示已安排重试。
func (r *QARepo) MarkJobOutcome(ctx context.Context, j *model.QADocumentJob, errMsg string) (retryScheduled bool, err error) {
	if j.AttemptCount < j.MaxAttempts {
		_, err = r.db.ExecContext(ctx, `
			UPDATE qa_document_jobs
			SET status='PENDING', error=$1, updated_at=CURRENT_TIMESTAMP
			WHERE id=$2`, errMsg, j.ID)
		return err == nil, err
	}
	_, err = r.db.ExecContext(ctx, `
		UPDATE qa_document_jobs
		SET status='FAILED', error=$1, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
		WHERE id=$2`, errMsg, j.ID)
	return false, err
}

// ListJobs 返回文档的全部任务（按 id 升序）。
func (r *QARepo) ListJobs(ctx context.Context, documentID int64) ([]model.QADocumentJob, error) {
	var rows []model.QADocumentJob
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM qa_document_jobs WHERE document_id=$1 ORDER BY id ASC`, documentID)
	return rows, err
}

// ---------------- qa_document_versions + qa_doc_blocks ----------------

// NextVersionNo 返回文档的下一个版本号。
func (r *QARepo) NextVersionNo(ctx context.Context, documentID int64) (int, error) {
	var maxNo sql.NullInt64
	err := r.db.GetContext(ctx, &maxNo,
		`SELECT MAX(version_no) FROM qa_document_versions WHERE document_id=$1`, documentID)
	if err != nil {
		return 0, err
	}
	return int(maxNo.Int64) + 1, nil
}

// CreateVersion 写入一个新版本快照及其扁平化 block 节点（同一事务，幂等于版本号唯一约束）。
func (r *QARepo) CreateVersion(ctx context.Context, documentID int64, versionNo int, source string,
	roots []*qatree.Node, note *string, createdBy *int64) (*model.QADocumentVersion, error) {

	treeJSON, err := marshalJSON(roots)
	if err != nil {
		return nil, err
	}
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var ver model.QADocumentVersion
	if err := tx.QueryRowxContext(ctx, `
		INSERT INTO qa_document_versions (document_id, version_no, source, tree_json, note, created_by, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
		RETURNING *`, documentID, versionNo, source, treeJSON, note, createdBy).StructScan(&ver); err != nil {
		return nil, err
	}

	// 写扁平 block 镜像，按 stableKey 解析父子。
	keyToID := map[string]int64{}
	for _, fn := range qatree.Flatten(roots) {
		var parentID *int64
		if fn.ParentKey != "" {
			if pid, ok := keyToID[fn.ParentKey]; ok {
				parentID = &pid
			}
		}
		bbox, _ := marshalJSON(fn.Node.BBox)
		var blockID int64
		if err := tx.QueryRowxContext(ctx, `
			INSERT INTO qa_doc_blocks (document_id, version_id, parent_id, stable_key, block_type,
				page_no, bbox, text, confidence, source_crop_url, field_path, order_index, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP)
			RETURNING id`,
			documentID, ver.ID, parentID, fn.Node.StableKey, fn.Node.BlockType, fn.Node.PageNo,
			bbox, nullStr(fn.Node.Text), fn.Node.Confidence, nullStr(fn.Node.SourceCropURL),
			nullStr(fn.Node.FieldPath), fn.Node.OrderIndex,
		).Scan(&blockID); err != nil {
			return nil, err
		}
		keyToID[fn.Node.StableKey] = blockID
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &ver, nil
}

// GetVersionByID 按主键查版本。
func (r *QARepo) GetVersionByID(ctx context.Context, id int64) (*model.QADocumentVersion, error) {
	var v model.QADocumentVersion
	err := r.db.GetContext(ctx, &v, `SELECT * FROM qa_document_versions WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &v, err
}

// GetVersionByNo 按版本号查版本。
func (r *QARepo) GetVersionByNo(ctx context.Context, documentID int64, versionNo int) (*model.QADocumentVersion, error) {
	var v model.QADocumentVersion
	err := r.db.GetContext(ctx, &v,
		`SELECT * FROM qa_document_versions WHERE document_id=$1 AND version_no=$2`, documentID, versionNo)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &v, err
}

// ListBlocksByVersion 返回版本下的全部 block 节点（按 order_index）。
func (r *QARepo) ListBlocksByVersion(ctx context.Context, versionID int64) ([]model.QADocBlock, error) {
	var rows []model.QADocBlock
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM qa_doc_blocks WHERE version_id=$1 ORDER BY order_index ASC, id ASC`, versionID)
	return rows, err
}

// ---------------- qa_annotations ----------------

// CreateAnnotation 新建标注。
func (r *QARepo) CreateAnnotation(ctx context.Context, a *model.QAAnnotation) (*model.QAAnnotation, error) {
	var out model.QAAnnotation
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO qa_annotations (document_id, version_id, stable_key, annotation_type,
			original_text, corrected_text, note, status, created_by, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE(NULLIF($8,''),'OPEN'),$9,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		RETURNING *`,
		a.DocumentID, a.VersionID, a.StableKey, a.AnnotationType,
		a.OriginalText, a.CorrectedText, a.Note, a.Status, a.CreatedBy,
	).StructScan(&out)
	return &out, err
}

// ListAnnotations 返回文档标注。
func (r *QARepo) ListAnnotations(ctx context.Context, documentID int64) ([]model.QAAnnotation, error) {
	var rows []model.QAAnnotation
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM qa_annotations WHERE document_id=$1 ORDER BY id ASC`, documentID)
	return rows, err
}

// GetAnnotation 按主键查标注（校验归属）。
func (r *QARepo) GetAnnotation(ctx context.Context, documentID, id int64) (*model.QAAnnotation, error) {
	var a model.QAAnnotation
	err := r.db.GetContext(ctx, &a, `SELECT * FROM qa_annotations WHERE id=$1 AND document_id=$2`, id, documentID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &a, err
}

// UpdateAnnotation 更新标注的纠正文本/备注/状态。
func (r *QARepo) UpdateAnnotation(ctx context.Context, id int64, correctedText, note, status *string) (*model.QAAnnotation, error) {
	var out model.QAAnnotation
	err := r.db.QueryRowxContext(ctx, `
		UPDATE qa_annotations SET
			corrected_text=COALESCE($1, corrected_text),
			note=COALESCE($2, note),
			status=COALESCE($3, status),
			updated_at=CURRENT_TIMESTAMP
		WHERE id=$4
		RETURNING *`, correctedText, note, status, id).StructScan(&out)
	return &out, err
}

// DeleteAnnotation 删除标注。
func (r *QARepo) DeleteAnnotation(ctx context.Context, documentID, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM qa_annotations WHERE id=$1 AND document_id=$2`, id, documentID)
	return err
}

// ---------------- qa_patches ----------------

// CreatePatch 写入一个 Patch Proposal。
func (r *QARepo) CreatePatch(ctx context.Context, p *model.QAPatch) (*model.QAPatch, error) {
	ops := p.Operations
	if len(ops) == 0 {
		ops = []byte("[]")
	}
	var out model.QAPatch
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO qa_patches (document_id, base_version, status, summary, operations, agent_model, created_by, created_at, updated_at)
		VALUES ($1,$2,COALESCE(NULLIF($3,''),'PROPOSED'),$4,$5,$6,$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
		RETURNING *`,
		p.DocumentID, p.BaseVersion, p.Status, p.Summary, ops, p.AgentModel, p.CreatedBy,
	).StructScan(&out)
	return &out, err
}

// GetPatch 按主键查 Patch（校验归属）。
func (r *QARepo) GetPatch(ctx context.Context, documentID, id int64) (*model.QAPatch, error) {
	var p model.QAPatch
	err := r.db.GetContext(ctx, &p, `SELECT * FROM qa_patches WHERE id=$1 AND document_id=$2`, id, documentID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

// ListPatches 返回文档的 Patch 列表。
func (r *QARepo) ListPatches(ctx context.Context, documentID int64) ([]model.QAPatch, error) {
	var rows []model.QAPatch
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM qa_patches WHERE document_id=$1 ORDER BY id DESC`, documentID)
	return rows, err
}

// UpdatePatchStatus 更新 Patch 状态。
func (r *QARepo) UpdatePatchStatus(ctx context.Context, id int64, status string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE qa_patches SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`, status, id)
	return err
}

// ---------------- qa_document_diffs ----------------

// CreateDiff 写入合并产生的 Diff 结果。
func (r *QARepo) CreateDiff(ctx context.Context, d *model.QADocumentDiff) (*model.QADocumentDiff, error) {
	diff := d.Diff
	if len(diff) == 0 {
		diff = []byte("{}")
	}
	var out model.QADocumentDiff
	err := r.db.QueryRowxContext(ctx, `
		INSERT INTO qa_document_diffs (document_id, patch_id, from_version, to_version, diff_level, has_conflict, diff, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)
		RETURNING *`,
		d.DocumentID, d.PatchID, d.FromVersion, d.ToVersion, d.DiffLevel, d.HasConflict, diff,
	).StructScan(&out)
	return &out, err
}

// GetDiff 按主键查 Diff（校验归属）。
func (r *QARepo) GetDiff(ctx context.Context, documentID, id int64) (*model.QADocumentDiff, error) {
	var d model.QADocumentDiff
	err := r.db.GetContext(ctx, &d, `SELECT * FROM qa_document_diffs WHERE id=$1 AND document_id=$2`, id, documentID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &d, err
}

// ---------------- qa_questions（发布入库，事务）----------------

// PublishQuestions 在单事务内删除旧的同版本题目并批量写入，返回写入条数。
func (r *QARepo) PublishQuestions(ctx context.Context, documentID int64, versionNo int, questions []model.QAQuestion) (int, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM qa_questions WHERE document_id=$1 AND version_no=$2`, documentID, versionNo); err != nil {
		return 0, err
	}
	for _, q := range questions {
		opts := q.Options
		if len(opts) == 0 {
			opts = []byte("[]")
		}
		srcIDs := q.SourceBlockIDs
		if len(srcIDs) == 0 {
			srcIDs = []byte("[]")
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO qa_questions (document_id, version_no, question_type, stem, options, answer, analysis,
				source_block_ids, order_index, created_by, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)`,
			documentID, versionNo, q.QuestionType, q.Stem, opts, q.Answer, q.Analysis,
			srcIDs, q.OrderIndex, q.CreatedBy); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(questions), nil
}

// ListQuestions 返回文档已发布题目。
func (r *QARepo) ListQuestions(ctx context.Context, documentID int64) ([]model.QAQuestion, error) {
	var rows []model.QAQuestion
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM qa_questions WHERE document_id=$1 ORDER BY version_no DESC, order_index ASC`, documentID)
	return rows, err
}

// ---------------- qa_audit_logs ----------------

// AppendAudit 追加一条审计日志（best-effort，失败不阻断主流程）。
func (r *QARepo) AppendAudit(ctx context.Context, documentID int64, actorID *int64, action string, from, to *string, detail any) error {
	d, _ := marshalJSON(detail)
	if len(d) == 0 {
		d = []byte("{}")
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO qa_audit_logs (document_id, actor_id, action, from_status, to_status, detail, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)`,
		documentID, actorID, action, from, to, d)
	return err
}

// ListAudit 返回文档审计日志。
func (r *QARepo) ListAudit(ctx context.Context, documentID int64) ([]model.QAAuditLog, error) {
	var rows []model.QAAuditLog
	err := r.db.SelectContext(ctx, &rows,
		`SELECT * FROM qa_audit_logs WHERE document_id=$1 ORDER BY id DESC LIMIT 200`, documentID)
	return rows, err
}
