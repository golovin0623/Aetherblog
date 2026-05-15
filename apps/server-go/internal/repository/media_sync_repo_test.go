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

func TestMediaSyncRepoEnqueueAllExcludesLocalSourcesForLocalTarget(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewMediaSyncRepo(sqlx.NewDb(db, "sqlmock"))
	mock.ExpectExec(`(?s)JOIN storage_providers target_provider ON target_provider\.id = \$1.*LEFT JOIN storage_providers source_provider ON source_provider\.id = mf\.storage_provider_id.*target_provider\.provider_type = 'LOCAL'.*mf\.storage_provider_id IS NULL OR source_provider\.provider_type = 'LOCAL'`).
		WithArgs(int64(4)).
		WillReturnResult(sqlmock.NewResult(0, 0))

	n, err := repo.EnqueueAllUnsynced(context.Background(), 4)
	if err != nil {
		t.Fatalf("EnqueueAllUnsynced: %v", err)
	}
	if n != 0 {
		t.Fatalf("EnqueueAllUnsynced rows = %d, want 0", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMediaSyncRepoMarkJobSucceededMarksBackupVerified(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewMediaSyncRepo(sqlx.NewDb(db, "sqlmock"))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE media_sync_jobs SET status='SUCCEEDED', finished_at=$1 WHERE id=$2`)).
		WithArgs(sqlmock.AnyArg(), int64(11)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE media_files
		SET sync_status='SYNCED', backup_provider_id=$1, backup_url=$2, backup_at=$3, backup_error=NULL, last_verified_at=$3
		WHERE id=$4`)).
		WithArgs(int64(5), "https://backup.example.com/a.png", sqlmock.AnyArg(), int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := repo.MarkJobSucceeded(context.Background(), 11, 7, 5, "https://backup.example.com/a.png"); err != nil {
		t.Fatalf("MarkJobSucceeded: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
