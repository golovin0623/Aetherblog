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
