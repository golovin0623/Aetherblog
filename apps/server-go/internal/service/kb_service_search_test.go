package service

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
)

func TestListPostsAsKBFilesEscapesKeywordWildcards(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	svc := &KBService{db: sqlx.NewDb(db, "sqlmock")}
	kb := &model.KnowledgeBase{ID: 9}
	query := dto.KBFileListQuery{Keyword: "100%_kb", PageNum: 1, PageSize: 20}
	pattern := `%100\%\_kb%`

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT COUNT(*) FROM posts p WHERE p.deleted = FALSE AND (p.title ILIKE $1 OR p.slug ILIKE $1)`,
	)).
		WithArgs(pattern).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))

	mock.ExpectQuery(`(?s)SELECT p\.id, p\.title, p\.slug, p\.embedding_status.*FROM posts p WHERE p\.deleted = FALSE.*p\.title ILIKE \$1.*LIMIT \$2 OFFSET \$3`).
		WithArgs(pattern, 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "title", "slug", "embedding_status", "created_at", "updated_at", "chunk_count",
		}))

	if _, _, err := svc.listPostsAsKBFiles(context.Background(), kb, query); err != nil {
		t.Fatalf("listPostsAsKBFiles returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
