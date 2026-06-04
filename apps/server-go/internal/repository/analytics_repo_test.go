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

	mock.ExpectQuery(`(?s)^SELECT\s+COUNT\(\*\) FILTER \(WHERE status = 'PUBLISHED'\) AS post_count,\s+COALESCE\(SUM\(view_count\), 0\) AS view_total,\s+COALESCE\(SUM\(word_count\), 0\) AS total_words\s+FROM posts\s+WHERE deleted = false$`).
		WillReturnRows(sqlmock.NewRows([]string{"post_count", "view_total", "total_words"}).AddRow(int64(2), int64(11), int64(900)))
	expectAnalyticsInt64Query(mock, `SELECT COUNT(*) FROM comments WHERE status = 'APPROVED'`, 3)
	mock.ExpectQuery(`(?s)^SELECT COUNT\(\*\) FROM visit_records\s+WHERE is_bot = false\s+AND created_at >= \$1::date\s+AND created_at < \$1::date \+ INTERVAL '1 day'$`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"value"}).AddRow(int64(4)))
	mock.ExpectQuery(`(?s)^SELECT\s+COUNT\(\*\) AS media_count,\s+COALESCE\(SUM\(file_size\), 0\) AS media_size\s+FROM media_files\s+WHERE deleted = false$`).
		WillReturnRows(sqlmock.NewRows([]string{"media_count", "media_size"}).AddRow(int64(5), int64(600)))
	expectAnalyticsInt64Query(mock, `SELECT COUNT(*) FROM categories`, 7)
	expectAnalyticsInt64Query(mock, `SELECT COUNT(*) FROM tags`, 8)
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

func TestAnalyticsRepoGetTrendsCombinesTableAggregations(t *testing.T) {
	repo, mock, cleanup := newAnalyticsRepoMock(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)^SELECT\s+COUNT\(\*\) FILTER \(\s+WHERE published_at >= date_trunc\('month', NOW\(\)\)\s+\) AS posts_this_month,.*AS posts_last_month,.*AS words_this_month,.*AS words_last_month\s+FROM posts\s+WHERE deleted = false\s+AND status = 'PUBLISHED'\s+AND published_at >= date_trunc\('month', NOW\(\) - INTERVAL '1 month'\)$`).
		WillReturnRows(sqlmock.NewRows([]string{
			"posts_this_month",
			"posts_last_month",
			"words_this_month",
			"words_last_month",
		}).AddRow(int64(4), int64(3), int64(1200), int64(900)))

	mock.ExpectQuery(`(?s)^SELECT\s+COUNT\(\*\) FILTER \(\s+WHERE created_at >= date_trunc\('month', NOW\(\)\)\s+\) AS comments_this_month,.*AS comments_last_month\s+FROM comments\s+WHERE status = 'APPROVED'\s+AND created_at >= date_trunc\('month', NOW\(\) - INTERVAL '1 month'\)$`).
		WillReturnRows(sqlmock.NewRows([]string{
			"comments_this_month",
			"comments_last_month",
		}).AddRow(int64(8), int64(5)))

	mock.ExpectQuery(`(?s)^SELECT\s+COUNT\(\*\) FILTER \(\s+WHERE created_at >= date_trunc\('month', NOW\(\)\)\s+\) AS views_this_month,.*AS views_last_month,.*AS visitors_this_month,.*AS visitors_last_month\s+FROM visit_records\s+WHERE is_bot = false\s+AND created_at >= date_trunc\('month', NOW\(\) - INTERVAL '1 month'\)$`).
		WillReturnRows(sqlmock.NewRows([]string{
			"views_this_month",
			"views_last_month",
			"visitors_this_month",
			"visitors_last_month",
		}).AddRow(int64(40), int64(30), int64(12), int64(9)))

	got, err := repo.GetTrends(context.Background())
	if err != nil {
		t.Fatalf("GetTrends returned error: %v", err)
	}

	if got.PostsThisMonth != 4 || got.PostsLastMonth != 3 || got.WordsThisMonth != 1200 || got.WordsLastMonth != 900 {
		t.Fatalf("unexpected post trends: %#v", got)
	}
	if got.CommentsThisMonth != 8 || got.CommentsLastMonth != 5 {
		t.Fatalf("unexpected comment trends: %#v", got)
	}
	if got.ViewsThisMonth != 40 || got.ViewsLastMonth != 30 || got.VisitorsThisMonth != 12 || got.VisitorsLastMonth != 9 {
		t.Fatalf("unexpected visit trends: %#v", got)
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
