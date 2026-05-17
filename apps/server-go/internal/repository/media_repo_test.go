package repository

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func TestMediaRepoMarkBackupVerifiedRestoresSyncedState(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewMediaRepo(sqlx.NewDb(db, "sqlmock"))
	at := time.Date(2026, 5, 10, 10, 42, 0, 0, time.UTC)

	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE media_files
		SET sync_status='SYNCED',
		    backup_error=NULL,
		    last_verified_at=$1
		WHERE id=$2`)).
		WithArgs(at, int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := repo.MarkBackupVerified(context.Background(), 42, at); err != nil {
		t.Fatalf("MarkBackupVerified: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMediaRepoMarkBackupVerifiedWithURLRefreshesBackupURL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewMediaRepo(sqlx.NewDb(db, "sqlmock"))
	at := time.Date(2026, 5, 17, 10, 42, 0, 0, time.UTC)
	backupURL := "https://data.golovin.cn/media/2026/05/a.jpg"

	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE media_files
		SET sync_status='SYNCED',
		    backup_url=$1,
		    backup_error=NULL,
		    last_verified_at=$2
		WHERE id=$3`)).
		WithArgs(backupURL, at, int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := repo.MarkBackupVerifiedWithURL(context.Background(), 42, at, backupURL); err != nil {
		t.Fatalf("MarkBackupVerifiedWithURL: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
