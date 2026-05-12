package repository

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func newAccessRepoMock(t *testing.T) (*AccessRepo, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	cleanup := func() { _ = db.Close() }
	return NewAccessRepo(sqlx.NewDb(db, "sqlmock")), mock, cleanup
}

func TestAccessRepoUserHasPermissionDoesNotTrustLegacyAdminClaim(t *testing.T) {
	repo, mock, cleanup := newAccessRepoMock(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)SELECT EXISTS .*u\.status='ACTIVE'.*p\.code=\$2`).
		WithArgs(int64(7), "system.users.manage").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	ok, err := repo.UserHasPermission(t.Context(), 7, "ADMIN", "system.users.manage")
	if err != nil {
		t.Fatalf("UserHasPermission returned error: %v", err)
	}
	if ok {
		t.Fatal("UserHasPermission trusted stale legacy ADMIN claim; want database result false")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
