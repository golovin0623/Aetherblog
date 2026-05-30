package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func newAtlasRepoMock(t *testing.T) (*AtlasRepo, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	return NewAtlasRepo(sqlx.NewDb(db, "sqlmock")), mock, func() { _ = db.Close() }
}

func relationRows() *sqlmock.Rows {
	now := time.Date(2026, 5, 31, 9, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "from_kp_id", "to_kp_id", "type", "strength", "body_markdown",
		"provenance", "ai_suggestion_id", "author_id", "deleted", "created_at", "updated_at",
	}).AddRow(int64(10), int64(1), int64(2), "supports", float32(0.8), nil, "user", nil, int64(7), false, now, now)
}

func TestRelationRepoListForNodeIDsScopesEdgesToReturnedNodes(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewRelationRepo(base)
	mock.ExpectQuery(`SELECT \* FROM atlas_typed_relations\s+WHERE deleted=false\s+AND from_kp_id = ANY\(\$1\)\s+AND to_kp_id = ANY\(\$1\)`).
		WithArgs(sqlmock.AnyArg(), 50).
		WillReturnRows(relationRows())

	rows, err := repo.ListForNodeIDs(context.Background(), []int64{1, 2, 3}, 50, nil)
	if err != nil {
		t.Fatalf("ListForNodeIDs returned error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("len(rows) = %d, want 1", len(rows))
	}
	if rows[0].FromKPID != 1 || rows[0].ToKPID != 2 {
		t.Fatalf("unexpected edge: %+v", rows[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestRelationRepoListForNodeIDsEmptyNodesReturnsNoRowsWithoutQuery(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewRelationRepo(base)
	rows, err := repo.ListForNodeIDs(context.Background(), nil, 50, nil)
	if err != nil {
		t.Fatalf("ListForNodeIDs returned error: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("len(rows) = %d, want 0", len(rows))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected sql query: %v", err)
	}
}

func TestRelationRepoListForNodeIDsScopesEdgesToAuthor(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	authorID := int64(7)
	repo := NewRelationRepo(base)
	mock.ExpectQuery(`SELECT \* FROM atlas_typed_relations\s+WHERE deleted=false\s+AND from_kp_id = ANY\(\$1\)\s+AND to_kp_id = ANY\(\$1\)\s+AND author_id=\$2\s+ORDER BY id LIMIT \$3`).
		WithArgs(sqlmock.AnyArg(), authorID, 50).
		WillReturnRows(relationRows())

	rows, err := repo.ListForNodeIDs(context.Background(), []int64{1, 2, 3}, 50, &authorID)
	if err != nil {
		t.Fatalf("ListForNodeIDs returned error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("len(rows) = %d, want 1", len(rows))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestRelationRepoLinkAndListEvidence(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewRelationRepo(base)
	mock.ExpectExec(`INSERT INTO atlas_relation_evidence \(relation_id, annotation_id\)`).
		WithArgs(int64(10), int64(20)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := repo.LinkEvidence(context.Background(), 10, 20); err != nil {
		t.Fatalf("LinkEvidence returned error: %v", err)
	}

	now := time.Date(2026, 5, 31, 10, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`SELECT relation_id, annotation_id, created_at\s+FROM atlas_relation_evidence\s+WHERE relation_id=\$1`).
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"relation_id", "annotation_id", "created_at"}).
			AddRow(int64(10), int64(20), now))

	rows, err := repo.ListEvidence(context.Background(), 10)
	if err != nil {
		t.Fatalf("ListEvidence returned error: %v", err)
	}
	if len(rows) != 1 || rows[0].RelationID != 10 || rows[0].AnnotationID != 20 {
		t.Fatalf("unexpected evidence rows: %+v", rows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
