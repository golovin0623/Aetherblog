package service

import (
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

func newAccessServiceMock(t *testing.T) (*AccessService, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	cleanup := func() { _ = db.Close() }
	return NewAccessService(repository.NewAccessRepo(sqlx.NewDb(db, "sqlmock"))), mock, cleanup
}

func TestContentPermissionAllowsHierarchy(t *testing.T) {
	tests := []struct {
		granted  string
		required string
		want     bool
	}{
		{granted: "VIEW", required: "VIEW", want: true},
		{granted: "COMMENT", required: "VIEW", want: true},
		{granted: "EDIT", required: "COMMENT", want: true},
		{granted: "MANAGE", required: "EDIT", want: true},
		{granted: "VIEW", required: "EDIT", want: false},
		{granted: "COMMENT", required: "MANAGE", want: false},
	}

	for _, tt := range tests {
		got := contentPermissionAllows(tt.granted, tt.required)
		if got != tt.want {
			t.Fatalf("contentPermissionAllows(%q, %q) = %v, want %v", tt.granted, tt.required, got, tt.want)
		}
	}
}

func TestContentPermissionAllowsRejectsUnknownValues(t *testing.T) {
	if contentPermissionAllows("OWNER", "VIEW") {
		t.Fatal("unknown granted level must not be treated as allowed")
	}
	if contentPermissionAllows("VIEW", "OWNER") {
		t.Fatal("unknown required level must not be treated as allowed")
	}
}

func TestNormalizeRoleCodesDefaultsToUser(t *testing.T) {
	got := normalizeRoleCodes(nil)
	if len(got) != 1 || got[0] != "USER" {
		t.Fatalf("normalizeRoleCodes(nil) = %#v, want [USER]", got)
	}
}

func TestNormalizeRoleCodesForUpdatePreservesOmittedRoles(t *testing.T) {
	if got := normalizeRoleCodesForUpdate(nil); got != nil {
		t.Fatalf("normalizeRoleCodesForUpdate(nil) = %#v, want nil", got)
	}
	got := normalizeRoleCodesForUpdate([]string{})
	if len(got) != 1 || got[0] != "USER" {
		t.Fatalf("normalizeRoleCodesForUpdate(empty) = %#v, want [USER]", got)
	}
}

func TestNormalizeRoleCodesDeduplicatesAndUppercases(t *testing.T) {
	got := normalizeRoleCodes([]string{" author ", "AUTHOR", "admin"})
	want := []string{"AUTHOR", "ADMIN"}
	if len(got) != len(want) {
		t.Fatalf("normalizeRoleCodes length = %d, want %d (%#v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalizeRoleCodes[%d] = %q, want %q; full=%#v", i, got[i], want[i], got)
		}
	}
}

func TestPreventLastAdminLossAllowsOmittedRolesWhenStatusUnchanged(t *testing.T) {
	svc, mock, cleanup := newAccessServiceMock(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)SELECT EXISTS .*WHERE u\.id=\$1.*u\.role='ADMIN'`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	if err := svc.preventLastAdminLoss(t.Context(), 7, nil, nil); err != nil {
		t.Fatalf("preventLastAdminLoss with omitted roles returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestPreventLastAdminLossStillBlocksLastAdminDeactivation(t *testing.T) {
	svc, mock, cleanup := newAccessServiceMock(t)
	defer cleanup()

	status := "INACTIVE"
	mock.ExpectQuery(`(?s)SELECT EXISTS .*WHERE u\.id=\$1.*u\.role='ADMIN'`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`(?s)SELECT COUNT\(DISTINCT u\.id\).*u\.status = 'ACTIVE'`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := svc.preventLastAdminLoss(t.Context(), 7, nil, &status)
	if err == nil || !strings.Contains(err.Error(), "至少需要保留一个可用的管理员账号") {
		t.Fatalf("preventLastAdminLoss error = %v, want last-admin guard", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
