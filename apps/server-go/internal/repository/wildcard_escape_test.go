package repository

import (
	"context"
	"fmt"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func newWildcardEscapeRepoMock(t *testing.T) (*sqlx.DB, sqlmock.Sqlmock, func()) {
	t.Helper()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	return sqlx.NewDb(db, "sqlmock"), mock, func() { _ = db.Close() }
}

func TestBuildAdminWhereDeclaresLikeEscape(t *testing.T) {
	keyword := `100%_guide\draft`
	where, args := buildAdminWhere(AdminPostFilter{Keyword: &keyword})

	for _, want := range []string{
		`p.title ILIKE $1 ESCAPE E'\\'`,
		`p.content_markdown ILIKE $1 ESCAPE E'\\'`,
	} {
		if !regexp.MustCompile(regexp.QuoteMeta(want)).MatchString(where) {
			t.Fatalf("admin post WHERE missing %q:\n%s", want, where)
		}
	}
	if len(args) != 1 || args[0] != `%100\%\_guide\\draft%` {
		t.Fatalf("args = %#v, want escaped wildcard pattern", args)
	}
}

func TestKBRepoListAccessibleDeclaresLikeEscape(t *testing.T) {
	tests := []struct {
		name        string
		filter      AccessibleFilter
		placeholder int
	}{
		{
			name:        "admin",
			filter:      AccessibleFilter{IsAdmin: true, Keyword: `100%_guide\draft`},
			placeholder: 1,
		},
		{
			name:        "member",
			filter:      AccessibleFilter{UserID: 7, Keyword: `100%_guide\draft`},
			placeholder: 8,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, cleanup := newWildcardEscapeRepoMock(t)
			defer cleanup()

			queryFragment := regexp.QuoteMeta(fmt.Sprintf(
				`name ILIKE $%d ESCAPE E'\\' OR COALESCE(description,'') ILIKE $%d ESCAPE E'\\'`,
				tt.placeholder,
				tt.placeholder,
			))
			mock.ExpectQuery(queryFragment).
				WillReturnRows(sqlmock.NewRows([]string{"id"}))

			rows, err := NewKBRepo(db).ListAccessible(context.Background(), tt.filter)
			if err != nil {
				t.Fatalf("ListAccessible returned error: %v", err)
			}
			if len(rows) != 0 {
				t.Fatalf("rows length = %d, want 0", len(rows))
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet expectations: %v", err)
			}
		})
	}
}

func TestKBFileRepoListByKBDeclaresLikeEscape(t *testing.T) {
	db, mock, cleanup := newWildcardEscapeRepoMock(t)
	defer cleanup()

	fragment := regexp.QuoteMeta(`COALESCE(title,'') ILIKE $2 ESCAPE E'\\' OR COALESCE(category,'') ILIKE $2 ESCAPE E'\\'`)
	pattern := `%100\%\_guide\\draft%`
	mock.ExpectQuery(fragment).
		WithArgs(int64(7), pattern).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))
	mock.ExpectQuery(fragment).
		WithArgs(int64(7), pattern, 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	rows, total, err := NewKBFileRepo(db).ListByKB(context.Background(), KBFileListFilter{
		KBID:     7,
		Keyword:  `100%_guide\draft`,
		PageNum:  1,
		PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListByKB returned error: %v", err)
	}
	if total != 0 || len(rows) != 0 {
		t.Fatalf("ListByKB = rows:%d total:%d, want empty", len(rows), total)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
