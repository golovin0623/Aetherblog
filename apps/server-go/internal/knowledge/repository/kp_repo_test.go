package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func TestKPRepoListEscapesKeywordWildcards(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewKPRepo(NewAtlasRepo(sqlx.NewDb(db, "sqlmock")))
	keyword := "100%_atlas"

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT id, uuid, title, body_markdown, type, confidence, status, author_id, provenance, ai_suggestion_id, archived, deleted, created_at, updated_at FROM atlas_knowledge_points WHERE deleted=false AND (title ILIKE $1 OR body_markdown ILIKE $1) ORDER BY updated_at DESC LIMIT $2`,
	)).
		WithArgs(`%100\%\_atlas%`, 200).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	if _, err := repo.List(context.Background(), KPListFilter{Keyword: &keyword}); err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestKPRepoListFiltersByProvenanceAndEvidence(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewKPRepo(NewAtlasRepo(sqlx.NewDb(db, "sqlmock")))
	provenance := "ai_suggested"
	hasEvidence := true

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT id, uuid, title, body_markdown, type, confidence, status, author_id, provenance, ai_suggestion_id, archived, deleted, created_at, updated_at FROM atlas_knowledge_points WHERE deleted=false AND provenance=$1 AND EXISTS (SELECT 1 FROM atlas_annotation_kp_links l WHERE l.kp_id=atlas_knowledge_points.id) ORDER BY updated_at DESC LIMIT $2`,
	)).
		WithArgs(provenance, 200).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	if _, err := repo.List(context.Background(), KPListFilter{
		Provenance:  &provenance,
		HasEvidence: &hasEvidence,
	}); err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestKPRepoLinkAnnotationUpsertsEvidenceRole(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewKPRepo(base)
	mock.ExpectExec(regexp.QuoteMeta(`
		INSERT INTO atlas_annotation_kp_links (annotation_id, kp_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (annotation_id, kp_id) DO UPDATE SET role=EXCLUDED.role`)).
		WithArgs(int64(11), int64(22), "definition").
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := repo.LinkAnnotation(context.Background(), 22, 11, "definition"); err != nil {
		t.Fatalf("LinkAnnotation returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestKPRepoCountEvidenceByKPIDs(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewKPRepo(base)
	mock.ExpectQuery(`SELECT kp_id, COUNT\(\*\) AS count\s+FROM atlas_annotation_kp_links\s+WHERE kp_id = ANY\(\$1\)\s+GROUP BY kp_id`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"kp_id", "count"}).
			AddRow(int64(11), int64(2)).
			AddRow(int64(12), int64(1)))

	counts, err := repo.CountEvidenceByKPIDs(context.Background(), []int64{11, 12, 13})
	if err != nil {
		t.Fatalf("CountEvidenceByKPIDs returned error: %v", err)
	}
	if counts[11] != 2 || counts[12] != 1 {
		t.Fatalf("unexpected counts: %+v", counts)
	}
	if _, ok := counts[13]; ok {
		t.Fatalf("unexpected zero-count entry for kp 13: %+v", counts)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestKPRepoCountEvidenceByKPIDsEmptyDoesNotQuery(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewKPRepo(base)
	counts, err := repo.CountEvidenceByKPIDs(context.Background(), nil)
	if err != nil {
		t.Fatalf("CountEvidenceByKPIDs returned error: %v", err)
	}
	if len(counts) != 0 {
		t.Fatalf("len(counts) = %d, want 0", len(counts))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected sql query: %v", err)
	}
}

func TestKPRepoFirstEvidencePreviewRowsByKPIDsScopesToAuthor(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	authorID := int64(7)
	repo := NewKPRepo(base)
	mock.ExpectQuery(`WITH ranked`).
		WithArgs(sqlmock.AnyArg(), authorID).
		WillReturnRows(sqlmock.NewRows([]string{
			"subject_id", "annotation_id", "carrier_id", "selectors", "body_text",
			"annotation_author_id", "carrier_type", "carrier_title", "carrier_owner_id",
		}).AddRow(
			int64(11), int64(20), int64(30), []byte(`[{"type":"TextQuoteSelector","exact":"quote"}]`), "note",
			authorID, "markdown", "Reader Note", authorID,
		))

	rows, err := repo.FirstEvidencePreviewRowsByKPIDs(context.Background(), []int64{11, 12}, &authorID)
	if err != nil {
		t.Fatalf("FirstEvidencePreviewRowsByKPIDs returned error: %v", err)
	}
	if len(rows) != 1 || rows[0].SubjectID != 11 || rows[0].AnnotationID != 20 {
		t.Fatalf("unexpected preview rows: %+v", rows)
	}
	if rows[0].CarrierType != "markdown" || rows[0].CarrierTitle != "Reader Note" {
		t.Fatalf("unexpected carrier fields: %+v", rows[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
