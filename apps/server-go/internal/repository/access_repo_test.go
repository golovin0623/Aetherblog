package repository

import (
	"database/sql"
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

func TestAccessRepoGetUserPermissionCodesDoesNotTrustLegacyAdminClaim(t *testing.T) {
	repo, mock, cleanup := newAccessRepoMock(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)SELECT EXISTS .*u\.status='ACTIVE'.*u\.role='ADMIN'`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s)WITH user_role_ids AS .*u\.status='ACTIVE'.*ORDER BY p\.code`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"code"}))

	perms, err := repo.GetUserPermissionCodes(t.Context(), 7, "ADMIN")
	if err != nil {
		t.Fatalf("GetUserPermissionCodes returned error: %v", err)
	}
	if len(perms) != 0 {
		t.Fatalf("GetUserPermissionCodes trusted stale legacy ADMIN claim; got %v", perms)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestAccessRepoUserContentPermissionLevelDoesNotTrustLegacyAdminClaim(t *testing.T) {
	repo, mock, cleanup := newAccessRepoMock(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)SELECT EXISTS .*u\.status='ACTIVE'.*u\.role='ADMIN'`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s)WITH active_user AS .*FROM content_shares.*resource_type = \$2`).
		WithArgs(int64(7), "POST", int64(42)).
		WillReturnError(sql.ErrNoRows)

	level, err := repo.UserContentPermissionLevel(t.Context(), 7, "ADMIN", "POST", 42)
	if err != nil {
		t.Fatalf("UserContentPermissionLevel returned error: %v", err)
	}
	if level != "" {
		t.Fatalf("UserContentPermissionLevel trusted stale legacy ADMIN claim; got %q", level)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
