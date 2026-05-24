package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
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

func TestBuildNoteAdminWhereCapsTsvectorInput(t *testing.T) {
	keyword := "长笔记"

	where, args := buildNoteAdminWhere(AdminNoteFilter{Keyword: &keyword})

	if count := strings.Count(where, "to_tsvector('simple', left("); count != 1 {
		t.Fatalf("note keyword search should cap the tsvector call, found %d capped calls in:\n%s", count, where)
	}
	if strings.Contains(where, "to_tsvector('simple', n.title ||") {
		t.Fatalf("note keyword search must not build tsvector from the full note body:\n%s", where)
	}
	if !strings.Contains(where, "n.content_markdown ILIKE") {
		t.Fatalf("note keyword search should keep full-body ILIKE fallback:\n%s", where)
	}
	if !strings.Contains(where, "COALESCE(n.content_markdown, '')") {
		t.Fatalf("note keyword tsvector expression should coalesce content_markdown:\n%s", where)
	}
	if len(args) != 2 || args[0] != keyword || args[1] != "%长笔记%" {
		t.Fatalf("unexpected keyword args: %#v", args)
	}
}

func TestNoteFulltextMigrationRebuildsIndexWithCappedDocument(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migrationPath := filepath.Join(filepath.Dir(filename), "..", "..", "migrations", "000055_limit_fulltext_tsvector_input.up.sql")

	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(raw)

	if !strings.Contains(sql, "DROP INDEX IF EXISTS idx_notes_fulltext;") {
		t.Fatalf("migration should drop the old unsafe notes fulltext index:\n%s", sql)
	}
	if !strings.Contains(sql, "CREATE INDEX IF NOT EXISTS idx_notes_fulltext") {
		t.Fatalf("migration should recreate idx_notes_fulltext:\n%s", sql)
	}
	wantExpr := "to_tsvector('simple', left(title || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content_markdown, ''), 200000))"
	if !strings.Contains(sql, wantExpr) {
		t.Fatalf("migration should use capped notes tsvector expression %q:\n%s", wantExpr, sql)
	}
	unsafeExpr := "to_tsvector('simple', title || ' ' || COALESCE(summary, '') || ' ' || content_markdown)"
	if strings.Contains(sql, unsafeExpr) {
		t.Fatalf("migration must not recreate the unsafe full-body notes tsvector expression:\n%s", sql)
	}
}
