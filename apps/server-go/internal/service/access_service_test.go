package service

import (
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/dto"
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

func contentShareRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"resource_type",
		"resource_id",
		"principal_type",
		"principal_id",
		"permission_level",
		"granted_by",
		"expires_at",
		"created_at",
		"updated_at",
	})
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

func TestCreateContentShareRejectsMissingResource(t *testing.T) {
	svc, mock, cleanup := newAccessServiceMock(t)
	defer cleanup()

	mock.ExpectQuery(`SELECT EXISTS \(SELECT 1 FROM posts WHERE id=\$1 AND deleted=false AND status='PUBLISHED'\)`).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	_, err := svc.CreateContentShare(t.Context(), dto.CreateContentShareRequest{
		ResourceType:    "POST",
		ResourceID:      42,
		PrincipalType:   "USER",
		PrincipalID:     7,
		PermissionLevel: "VIEW",
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "共享资源不存在") {
		t.Fatalf("CreateContentShare error = %v, want missing resource error", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestBatchCreateContentSharesSelectsAllMatchingResources(t *testing.T) {
	svc, mock, cleanup := newAccessServiceMock(t)
	defer cleanup()

	now := time.Now()
	search := "launch"
	mock.ExpectQuery(`SELECT EXISTS \(SELECT 1 FROM users WHERE id=\$1 AND status='ACTIVE'\)`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`(?s)SELECT p\.id.*FROM posts p.*p\.title ILIKE \$1.*LIMIT \$2`).
		WithArgs("%launch%", maxBatchContentShares+1).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)).AddRow(int64(41)))
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)INSERT INTO content_shares .*ON CONFLICT .*RETURNING \*`).
		WithArgs("POST", int64(42), "USER", int64(7), "VIEW", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(contentShareRows().AddRow(int64(101), "POST", int64(42), "USER", int64(7), "VIEW", nil, nil, now, now))
	mock.ExpectQuery(`(?s)INSERT INTO content_shares .*ON CONFLICT .*RETURNING \*`).
		WithArgs("POST", int64(41), "USER", int64(7), "VIEW", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(contentShareRows().AddRow(int64(102), "POST", int64(41), "USER", int64(7), "VIEW", nil, nil, now, now))
	mock.ExpectCommit()

	got, err := svc.BatchCreateContentShares(t.Context(), dto.BatchCreateContentSharesRequest{
		ResourceType:      "post",
		ResourceSearch:    &search,
		SelectAllMatching: true,
		PrincipalType:     "user",
		PrincipalID:       7,
		PermissionLevel:   "view",
	}, nil)
	if err != nil {
		t.Fatalf("BatchCreateContentShares returned error: %v", err)
	}
	if got.Total != 2 || len(got.Shares) != 2 || got.Shares[0].ResourceID != 42 || got.Shares[1].ResourceID != 41 {
		t.Fatalf("BatchCreateContentShares = %#v, want two matching shares", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
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
