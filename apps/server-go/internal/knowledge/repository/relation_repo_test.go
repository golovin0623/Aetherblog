package repository

import (
	"context"
	"math"
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

func TestRelationRepoCountEvidenceByRelationIDs(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewRelationRepo(base)
	mock.ExpectQuery(`SELECT relation_id, COUNT\(\*\) AS count\s+FROM atlas_relation_evidence\s+WHERE relation_id = ANY\(\$1\)\s+GROUP BY relation_id`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"relation_id", "count"}).
			AddRow(int64(21), int64(3)).
			AddRow(int64(22), int64(1)))

	counts, err := repo.CountEvidenceByRelationIDs(context.Background(), []int64{21, 22, 23})
	if err != nil {
		t.Fatalf("CountEvidenceByRelationIDs returned error: %v", err)
	}
	if counts[21] != 3 || counts[22] != 1 {
		t.Fatalf("unexpected counts: %+v", counts)
	}
	if _, ok := counts[23]; ok {
		t.Fatalf("unexpected zero-count entry for relation 23: %+v", counts)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestRelationRepoCountEvidenceByRelationIDsEmptyDoesNotQuery(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewRelationRepo(base)
	counts, err := repo.CountEvidenceByRelationIDs(context.Background(), nil)
	if err != nil {
		t.Fatalf("CountEvidenceByRelationIDs returned error: %v", err)
	}
	if len(counts) != 0 {
		t.Fatalf("len(counts) = %d, want 0", len(counts))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected sql query: %v", err)
	}
}

func TestRelationRepoGraphHealthComputesLiveMetrics(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewRelationRepo(base)
	authorID := int64(7)

	mock.ExpectQuery(`WITH scoped_kp AS`).
		WithArgs(authorID).
		WillReturnRows(sqlmock.NewRows([]string{
			"active_kp_count",
			"relation_count",
			"orphan_kp_count",
			"kp_evidence_count",
			"relation_evidence_count",
			"ai_kp_count",
		}).AddRow(int64(4), int64(3), int64(1), int64(3), int64(2), int64(1)))

	mock.ExpectQuery(`WITH scoped_kp AS`).
		WithArgs(authorID, 5).
		WillReturnRows(sqlmock.NewRows([]string{
			"kp_id",
			"title",
			"degree",
			"in_degree",
			"out_degree",
		}).AddRow(int64(10), "Graph Hub", int64(3), int64(1), int64(2)))

	metrics, err := repo.GraphHealth(context.Background(), &authorID, 5)
	if err != nil {
		t.Fatalf("GraphHealth returned error: %v", err)
	}
	if metrics.ActiveKPCount != 4 || metrics.RelationCount != 3 {
		t.Fatalf("unexpected counts: %+v", metrics)
	}
	if math.Abs(metrics.RelationDensity-0.75) > 0.001 {
		t.Fatalf("RelationDensity = %.3f, want 0.75", metrics.RelationDensity)
	}
	if math.Abs(metrics.OrphanKPRatio-0.25) > 0.001 {
		t.Fatalf("OrphanKPRatio = %.3f, want 0.25", metrics.OrphanKPRatio)
	}
	if math.Abs(metrics.KPEvidenceCoverage-0.75) > 0.001 {
		t.Fatalf("KPEvidenceCoverage = %.3f, want 0.75", metrics.KPEvidenceCoverage)
	}
	if math.Abs(metrics.RelationEvidenceCoverage-0.666) > 0.01 {
		t.Fatalf("RelationEvidenceCoverage = %.3f, want approximately 0.667", metrics.RelationEvidenceCoverage)
	}
	if metrics.MissingEvidenceKPCount != 1 || metrics.MissingEvidenceRelationCount != 1 {
		t.Fatalf("unexpected missing evidence counts: %+v", metrics)
	}
	if len(metrics.TopHubs) != 1 || metrics.TopHubs[0].KPID != 10 || metrics.TopHubs[0].Degree != 3 {
		t.Fatalf("unexpected hubs: %+v", metrics.TopHubs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
