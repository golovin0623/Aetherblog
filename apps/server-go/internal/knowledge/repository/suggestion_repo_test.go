package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func suggestionRows() *sqlmock.Rows {
	now := time.Date(2026, 5, 31, 9, 30, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "kind", "carrier_id", "annotation_id", "from_kp_id", "to_kp_id",
		"proposed_title", "proposed_body", "proposed_kp_type", "proposed_relation_type",
		"proposed_strength", "proposed_confidence", "rationale", "model_id",
		"tokens_in", "tokens_out", "cost_usd", "fingerprint", "status",
		"resolved_kp_id", "resolved_relation_id", "author_id", "created_at", "updated_at",
	}).AddRow(
		int64(3), "kp", int64(11), int64(12), nil, nil,
		"系统一", nil, "concept", nil,
		nil, float32(0.7), nil, "test/model",
		10, 20, 0.0001, "fp-1", "pending",
		nil, nil, int64(7), now, now,
	)
}

func TestSuggestionRepoFindPendingByFingerprintScopesToAuthor(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewSuggestionRepo(base)
	authorID := int64(7)
	mock.ExpectQuery(`SELECT \* FROM atlas_ai_suggestions\s+WHERE fingerprint=\$1 AND status='pending'\s+AND author_id=\$2`).
		WithArgs("fp-1", authorID).
		WillReturnRows(suggestionRows())

	row, err := repo.FindPendingByFingerprint(context.Background(), "fp-1", &authorID)
	if err != nil {
		t.Fatalf("FindPendingByFingerprint returned error: %v", err)
	}
	if row == nil {
		t.Fatal("FindPendingByFingerprint returned nil, want row")
	}
	if row.Fingerprint == nil || *row.Fingerprint != "fp-1" {
		t.Fatalf("Fingerprint = %#v, want fp-1", row.Fingerprint)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestSuggestionRepoFindPendingByFingerprintHandlesAnonymousAuthor(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewSuggestionRepo(base)
	mock.ExpectQuery(`SELECT \* FROM atlas_ai_suggestions\s+WHERE fingerprint=\$1 AND status='pending'\s+AND author_id IS NULL`).
		WithArgs("fp-2").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "kind", "carrier_id", "annotation_id", "from_kp_id", "to_kp_id",
			"proposed_title", "proposed_body", "proposed_kp_type", "proposed_relation_type",
			"proposed_strength", "proposed_confidence", "rationale", "model_id",
			"tokens_in", "tokens_out", "cost_usd", "fingerprint", "status",
			"resolved_kp_id", "resolved_relation_id", "author_id", "created_at", "updated_at",
		}))

	row, err := repo.FindPendingByFingerprint(context.Background(), "fp-2", nil)
	if err != nil {
		t.Fatalf("FindPendingByFingerprint returned error: %v", err)
	}
	if row != nil {
		t.Fatalf("FindPendingByFingerprint returned %#v, want nil", row)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestSuggestionRepoListScopesToAuthor(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewSuggestionRepo(base)
	authorID := int64(7)
	status := "pending"
	mock.ExpectQuery(`SELECT \* FROM atlas_ai_suggestions WHERE 1=1 AND status=\$1 AND author_id=\$2 ORDER BY created_at DESC LIMIT \$3`).
		WithArgs(status, authorID, 20).
		WillReturnRows(suggestionRows())

	rows, err := repo.List(context.Background(), SuggestionFilter{
		Status:   &status,
		AuthorID: &authorID,
		Limit:    20,
	})
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("len(rows) = %d, want 1", len(rows))
	}
	if rows[0].AuthorID == nil || *rows[0].AuthorID != authorID {
		t.Fatalf("AuthorID = %#v, want %d", rows[0].AuthorID, authorID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
