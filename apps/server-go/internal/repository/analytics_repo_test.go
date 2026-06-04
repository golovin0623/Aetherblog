package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func newAnalyticsRepoMock(t *testing.T) (*AnalyticsRepo, sqlmock.Sqlmock, func()) {
	t.Helper()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	mock.MatchExpectationsInOrder(false)

	return NewAnalyticsRepo(sqlx.NewDb(db, "sqlmock")), mock, func() { _ = db.Close() }
}

func expectAnalyticsInt64Query(mock sqlmock.Sqlmock, query string, value int64) {
	mock.ExpectQuery("^" + regexp.QuoteMeta(query) + "$").
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(value))
}

func TestAnalyticsRepoGetDashboardPreservesMetricsWithConcurrentQueries(t *testing.T) {
	repo, mock, cleanup := newAnalyticsRepoMock(t)
	defer cleanup()

	expectAnalyticsInt64Query(mock, `SELECT COUNT(*) FROM posts WHERE deleted = false AND status = 'PUBLISHED'`, 2)
	expectAnalyticsInt64Query(mock, `SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'`, 3)
	expectAnalyticsInt64Query(mock, `SELECT COALESCE(SUM(view_count), 0) FROM posts WHERE deleted = false`, 11)
	mock.ExpectQuery(`(?s)^SELECT COUNT\(\*\) FROM visit_records\s+WHERE is_bot = false\s+AND created_at >= \$1::date\s+AND created_at < \$1::date \+ INTERVAL '1 day'$`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(int64(4)))
	expectAnalyticsInt64Query(mock, `SELECT COUNT(*) FROM media_files WHERE deleted = false`, 5)
	expectAnalyticsInt64Query(mock, `SELECT COALESCE(SUM(file_size), 0) FROM media_files WHERE deleted = false`, 600)
	expectAnalyticsInt64Query(mock, `SELECT COUNT(*) FROM categories`, 7)
	expectAnalyticsInt64Query(mock, `SELECT COUNT(*) FROM tags`, 8)
	expectAnalyticsInt64Query(mock, `SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE deleted = false`, 900)
	expectAnalyticsInt64Query(mock, `SELECT COUNT(DISTINCT visitor_hash) FROM visit_records WHERE is_bot = false`, 10)

	got, err := repo.GetDashboard(context.Background())
	if err != nil {
		t.Fatalf("GetDashboard returned error: %v", err)
	}

	if got.PostCount != 2 || got.CommentCount != 3 || got.ViewTotal != 11 || got.TodayVisits != 4 {
		t.Fatalf("unexpected dashboard traffic counts: %#v", got)
	}
	if got.MediaCount != 5 || got.MediaSize != 600 || got.CategoryCount != 7 || got.TagCount != 8 {
		t.Fatalf("unexpected dashboard inventory counts: %#v", got)
	}
	if got.TotalWords != 900 {
		t.Fatalf("TotalWords = %d, want all non-deleted post words 900", got.TotalWords)
	}
	if got.UniqueVisitors != 10 {
		t.Fatalf("UniqueVisitors = %d, want 10", got.UniqueVisitors)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations were not met: %v", err)
	}
}

func TestAnalyticsRepoGetTodayVisitCountUsesRangePredicate(t *testing.T) {
	repo, mock, cleanup := newAnalyticsRepoMock(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)^SELECT COUNT\(\*\) FROM visit_records\s+WHERE is_bot = false\s+AND created_at >= \$1::date\s+AND created_at < \$1::date \+ INTERVAL '1 day'$`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(int64(12)))

	got, err := repo.GetTodayVisitCount(context.Background())
	if err != nil {
		t.Fatalf("GetTodayVisitCount returned error: %v", err)
	}
	if got != 12 {
		t.Fatalf("GetTodayVisitCount = %d, want 12", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations were not met: %v", err)
	}
}
