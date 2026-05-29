package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func TestKBProfileActivatePromotesTargetEmbeddingsAndDeprecatesOld(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewKBProfileRepo(sqlx.NewDb(db, "sqlmock"))
	const kbID int64 = 7
	const oldProfileID int64 = 11
	const targetProfileID int64 = 22

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT id FROM kb_profiles WHERE kb_id=$1 AND status='active' AND id <> $2 LIMIT 1`,
	)).
		WithArgs(kbID, targetProfileID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(oldProfileID))
	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE kb_profiles SET status='deprecated', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
	)).
		WithArgs(oldProfileID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE kb_embeddings SET status='deprecated' WHERE profile_id=$1 AND status='active'`,
	)).
		WithArgs(oldProfileID).
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE kb_embeddings SET status='active' WHERE profile_id=$1 AND status IN ('shadow', 'deprecated')`,
	)).
		WithArgs(targetProfileID).
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE kb_profiles SET status='active', updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND kb_id=$2`,
	)).
		WithArgs(targetProfileID, kbID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(
		`UPDATE knowledge_bases SET active_profile_id=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
	)).
		WithArgs(targetProfileID, kbID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := repo.Activate(context.Background(), kbID, targetProfileID); err != nil {
		t.Fatalf("Activate returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
