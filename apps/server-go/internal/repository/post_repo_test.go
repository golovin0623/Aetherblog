package repository

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSearchPublishedQueryCapsTsvectorInput(t *testing.T) {
	query := searchPublishedQuery()

	if count := strings.Count(query, "to_tsvector('simple', left("); count != 2 {
		t.Fatalf("SearchPublished should cap both tsvector calls, found %d capped calls in:\n%s", count, query)
	}
	if strings.Contains(query, "to_tsvector('simple', p.title ||") {
		t.Fatalf("SearchPublished must not build tsvector from the full post body:\n%s", query)
	}
	if !strings.Contains(query, "COALESCE(p.content_markdown, '')") {
		t.Fatalf("SearchPublished should still include content_markdown in the capped search document:\n%s", query)
	}
}

func TestFulltextSearchDocumentLimitStaysBelowPostgresTsvectorLimit(t *testing.T) {
	const postgresTsvectorInputLimitBytes = 1_048_575

	if fulltextSearchDocumentMaxChars <= 0 {
		t.Fatalf("fulltextSearchDocumentMaxChars must be positive, got %d", fulltextSearchDocumentMaxChars)
	}
	if worstCaseUTF8Bytes := fulltextSearchDocumentMaxChars * 4; worstCaseUTF8Bytes >= postgresTsvectorInputLimitBytes {
		t.Fatalf("fulltextSearchDocumentMaxChars=%d can exceed PostgreSQL tsvector input limit in worst-case UTF-8 (%d bytes >= %d bytes)",
			fulltextSearchDocumentMaxChars, worstCaseUTF8Bytes, postgresTsvectorInputLimitBytes)
	}
}

func TestPostFulltextMigrationRebuildsIndexWithCappedDocument(t *testing.T) {
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

	if !strings.Contains(sql, "DROP INDEX IF EXISTS idx_posts_fulltext;") {
		t.Fatalf("migration should drop the old unsafe fulltext index:\n%s", sql)
	}
	if !strings.Contains(sql, "CREATE INDEX IF NOT EXISTS idx_posts_fulltext") {
		t.Fatalf("migration should recreate idx_posts_fulltext:\n%s", sql)
	}
	wantExpr := "to_tsvector('simple', left(title || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content_markdown, ''), 200000))"
	if !strings.Contains(sql, wantExpr) {
		t.Fatalf("migration should use capped tsvector expression %q:\n%s", wantExpr, sql)
	}
	unsafeExpr := "to_tsvector('simple', title || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content_markdown, ''))"
	if strings.Contains(sql, unsafeExpr) {
		t.Fatalf("migration must not recreate the unsafe full-body tsvector expression:\n%s", sql)
	}
}
