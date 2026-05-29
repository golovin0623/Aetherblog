package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func TestFindPublicNoPasswordFiltersPrivateArticleTags(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := NewTagRepo(sqlx.NewDb(db, "sqlmock"))
	now := time.Now()
	mock.ExpectQuery(`(?s)COUNT\(pt\.post_id\)::int AS post_count.*FROM tags t.*JOIN post_tags pt.*JOIN posts p.*p\.deleted = false.*p\.status = 'PUBLISHED'.*p\.is_hidden = false.*p\.password IS NULL`).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "name", "slug", "description", "color", "post_count", "created_at", "updated_at",
		}).AddRow(int64(5), "Public", "public", nil, "#ffffff", 2, now, now))

	tags, err := repo.FindPublicNoPassword(context.Background())
	if err != nil {
		t.Fatalf("FindPublicNoPassword returned error: %v", err)
	}
	if len(tags) != 1 || tags[0].ID != 5 || tags[0].PostCount != 2 {
		t.Fatalf("unexpected tags: %#v", tags)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
