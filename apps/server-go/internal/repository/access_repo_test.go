package repository

import (
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
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

func teamRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"name",
		"slug",
		"description",
		"owner_id",
		"visibility",
		"created_by",
		"created_at",
		"updated_at",
		"member_count",
	})
}

func TestAccessRepoUpdateTeamSyncsOwnerMembership(t *testing.T) {
	repo, mock, cleanup := newAccessRepoMock(t)
	defer cleanup()

	now := time.Now()
	previousOwnerID := int64(10)
	nextOwnerID := int64(20)
	creatorID := int64(1)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT owner_id FROM teams WHERE id=\$1 FOR UPDATE`).
		WithArgs(int64(99)).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(previousOwnerID))
	mock.ExpectQuery(`(?s)UPDATE teams SET .*RETURNING id`).
		WithArgs("Core", "core", sqlmock.AnyArg(), sqlmock.AnyArg(), "PRIVATE", int64(99)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(99)))
	mock.ExpectExec(`(?s)INSERT INTO team_members .*ON CONFLICT`).
		WithArgs(int64(99), nextOwnerID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE team_members\s+SET member_role='MANAGER'`).
		WithArgs(int64(99), previousOwnerID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	mock.ExpectQuery(`(?s)FROM teams t WHERE t\.id=\$1`).
		WithArgs(int64(99)).
		WillReturnRows(teamRows().AddRow(
			int64(99),
			"Core",
			"core",
			nil,
			nextOwnerID,
			"PRIVATE",
			creatorID,
			now,
			now,
			2,
		))

	team, err := repo.UpdateTeam(t.Context(), 99, &model.Team{
		Name:       "Core",
		Slug:       "core",
		OwnerID:    &nextOwnerID,
		Visibility: "PRIVATE",
		CreatedBy:  &creatorID,
	})
	if err != nil {
		t.Fatalf("UpdateTeam returned error: %v", err)
	}
	if team == nil || team.OwnerID == nil || *team.OwnerID != nextOwnerID {
		t.Fatalf("UpdateTeam owner = %#v, want %d", team, nextOwnerID)
	}
	if team.MemberCount != 2 {
		t.Fatalf("MemberCount = %d, want 2", team.MemberCount)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
