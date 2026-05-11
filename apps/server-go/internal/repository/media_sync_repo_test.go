package repository

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func TestMediaSyncRepoEnqueueOneDedupNoRows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewMediaSyncRepo(sqlx.NewDb(db, "sqlmock"))
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO media_sync_jobs")).
		WithArgs(int64(7), int64(3)).
		WillReturnError(sql.ErrNoRows)

	id, err := repo.EnqueueOne(context.Background(), 7, 3)
	if err != nil {
		t.Fatalf("EnqueueOne duplicate should not fail: %v", err)
	}
	if id != 0 {
		t.Fatalf("EnqueueOne duplicate id = %d, want 0", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMediaSyncRepoEnqueueAllResyncsOldBackupTarget(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewMediaSyncRepo(sqlx.NewDb(db, "sqlmock"))
	mock.ExpectExec(`backup_provider_id = \$1`).
		WithArgs(int64(9)).
		WillReturnResult(sqlmock.NewResult(0, 4))

	n, err := repo.EnqueueAllUnsynced(context.Background(), 9)
	if err != nil {
		t.Fatalf("EnqueueAllUnsynced: %v", err)
	}
	if n != 4 {
		t.Fatalf("EnqueueAllUnsynced rows = %d, want 4", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
