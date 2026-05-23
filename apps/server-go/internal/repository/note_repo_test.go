package repository

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func newNoteRepoMock(t *testing.T) (*NoteRepo, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	cleanup := func() { _ = db.Close() }
	return NewNoteRepo(sqlx.NewDb(db, "sqlmock")), mock, cleanup
}

func noteRows() *sqlmock.Rows {
	now := time.Date(2026, 5, 23, 10, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "title", "content_markdown", "summary", "folder_id", "author_id",
		"source_type", "source_url", "source_title", "source_meta",
		"is_pinned", "is_favorite", "archived", "deleted", "word_count", "embedding_status",
		"last_opened_at", "created_at", "updated_at",
	}).AddRow(
		int64(42), "新标题", "正文", nil, nil, nil,
		"manual", nil, nil, []byte(`{}`),
		false, false, false, false, 2, "PENDING",
		nil, now, now,
	)
}

func TestNoteRepoUpdatePropertiesWithTagsRollsBackOnTagFailure(t *testing.T) {
	repo, mock, cleanup := newNoteRepoMock(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("UPDATE notes SET title=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND deleted=false RETURNING *")).
		WithArgs("新标题", int64(42)).
		WillReturnRows(noteRows())
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM note_tag_links WHERE note_id=$1")).
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(`
			INSERT INTO note_tags (name, created_at, updated_at)
			VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT (name) DO UPDATE SET updated_at=note_tags.updated_at
			RETURNING id`)).
		WithArgs("标签").
		WillReturnError(errors.New("tag insert failed"))
	mock.ExpectRollback()

	_, err := repo.UpdatePropertiesWithTags(context.Background(), 42, map[string]any{"title": "新标题"}, []string{"标签"})
	if err == nil || !strings.Contains(err.Error(), "tag insert failed") {
		t.Fatalf("UpdatePropertiesWithTags error = %v, want tag insert failure", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
