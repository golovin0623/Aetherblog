package service

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

func newReadingBookServiceMock(t *testing.T) (*ReadingBookService, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	sqlxDB := sqlx.NewDb(db, "sqlmock")
	svc := NewReadingBookService(
		repository.NewReadingBookRepo(sqlxDB),
		repository.NewPostRepo(sqlxDB),
		repository.NewNoteRepo(sqlxDB),
	)
	return svc, mock, func() { _ = db.Close() }
}

func readingBookRows(sourceType string, sourceID int64, status string) *sqlmock.Rows {
	now := time.Now()
	return sqlmock.NewRows([]string{
		"id", "slug", "title", "author", "cover_image", "source_type", "source_id", "source_ref",
		"content_html", "toc", "word_count", "reading_time", "status", "error", "theme",
		"created_by", "generated_at", "created_at", "updated_at",
	}).AddRow(
		int64(1), "book-slug", "Public Book", nil, nil, sourceType, sourceID, nil,
		"<p>正文</p>", []byte("[]"), 2, 1, status, nil, "paper",
		nil, &now, now, now,
	)
}

func expectReadingBookBySlug(mock sqlmock.Sqlmock, sourceType string, sourceID int64, status string) {
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM reading_books WHERE slug=$1`)).
		WithArgs("book-slug").
		WillReturnRows(readingBookRows(sourceType, sourceID, status))
}

func expectPublicPostCheck(mock sqlmock.Sqlmock, sourceID int64, ok bool) {
	mock.ExpectQuery(`(?s)SELECT EXISTS \(\s+SELECT 1 FROM posts\s+WHERE id = \$1.*status = 'PUBLISHED'.*is_hidden = false.*password IS NULL`).
		WithArgs(sourceID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(ok))
}

func TestReadingBookGetBySlugRequiresPublicPostSource(t *testing.T) {
	tests := []struct {
		name       string
		sourceType string
		status     string
		postPublic bool
		wantBook   bool
	}{
		{
			name:       "public post source is returned",
			sourceType: model.ReadingSourcePost,
			status:     model.ReadingStatusReady,
			postPublic: true,
			wantBook:   true,
		},
		{
			name:       "draft hidden or password post source is not returned",
			sourceType: model.ReadingSourcePost,
			status:     model.ReadingStatusReady,
			postPublic: false,
			wantBook:   false,
		},
		{
			name:       "non post source is never exposed publicly",
			sourceType: model.ReadingSourceNote,
			status:     model.ReadingStatusReady,
			wantBook:   false,
		},
		{
			name:       "non ready book is not returned",
			sourceType: model.ReadingSourcePost,
			status:     model.ReadingStatusFailed,
			wantBook:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, cleanup := newReadingBookServiceMock(t)
			defer cleanup()

			const sourceID int64 = 42
			expectReadingBookBySlug(mock, tt.sourceType, sourceID, tt.status)
			if tt.sourceType == model.ReadingSourcePost && tt.status == model.ReadingStatusReady {
				expectPublicPostCheck(mock, sourceID, tt.postPublic)
			}

			book, err := svc.GetBySlug(context.Background(), "book-slug")
			if err != nil {
				t.Fatalf("GetBySlug returned error: %v", err)
			}
			if (book != nil) != tt.wantBook {
				t.Fatalf("book presence = %v, want %v", book != nil, tt.wantBook)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet sql expectations: %v", err)
			}
		})
	}
}
