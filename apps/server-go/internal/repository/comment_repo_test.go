package repository

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/dto"
)

func newCommentRepoMock(t *testing.T) (*CommentRepo, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	cleanup := func() { _ = db.Close() }
	return NewCommentRepo(sqlx.NewDb(db, "sqlmock")), mock, cleanup
}

func TestCommentRepoFindForAdminKeywordSearchesEmailAndPostTitle(t *testing.T) {
	repo, mock, cleanup := newCommentRepoMock(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM comments WHERE .*COALESCE\(email, ''\) ILIKE \$1.*FROM posts p.*p\.title ILIKE \$1`).
		WithArgs("%deploy%").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))
	mock.ExpectQuery(`(?s)SELECT \* FROM comments WHERE .*COALESCE\(email, ''\) ILIKE \$1.*FROM posts p.*p\.title ILIKE \$1.*ORDER BY created_at DESC LIMIT \$2 OFFSET \$3`).
		WithArgs("%deploy%", 10, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	rows, total, err := repo.FindForAdmin(t.Context(), dtoCommentFilter("deploy"))
	if err != nil {
		t.Fatalf("FindForAdmin returned error: %v", err)
	}
	if total != 0 || len(rows) != 0 {
		t.Fatalf("FindForAdmin = rows:%v total:%d, want empty result", rows, total)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func dtoCommentFilter(keyword string) dto.CommentFilter {
	return dto.CommentFilter{Keyword: keyword, PageNum: 1, PageSize: 10}
}
