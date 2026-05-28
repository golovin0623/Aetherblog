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

func TestSplitSearchTermsHandlesMixedNaturalLanguage(t *testing.T) {
	got := splitSearchTerms("Docker怎么使用?")
	want := []string{"docker", "怎么使用", "使用"}

	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("splitSearchTerms() = %#v, want %#v", got, want)
	}
}

func TestSplitSearchTermsExpandsChineseQuestionPhrase(t *testing.T) {
	got := splitSearchTerms("如何部署 PostgreSQL")
	want := []string{"如何部署", "postgresql", "部署"}

	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("splitSearchTerms() = %#v, want %#v", got, want)
	}
}

func TestSplitSearchTermsPreservesSymbolLanguageNames(t *testing.T) {
	got := splitSearchTerms("C++ C# F#")
	want := []string{"c++", "c#", "f#"}

	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("splitSearchTerms() = %#v, want %#v", got, want)
	}
}

func TestBuildSearchPublishedArgsEscapesPhraseAndTerms(t *testing.T) {
	args := buildSearchPublishedArgs("Docker 100%_Guide", 10, 0)

	if len(args) != 2+maxSearchTermPatterns+2 {
		t.Fatalf("buildSearchPublishedArgs returned %d args, want %d: %#v",
			len(args), 2+maxSearchTermPatterns+2, args)
	}
	if args[1] != `%docker 100\%\_guide%` {
		t.Fatalf("phrase LIKE pattern was not escaped/lowercased: %#v", args[1])
	}
	if args[2] != `%docker%` {
		t.Fatalf("first term LIKE pattern = %#v, want %%docker%%", args[2])
	}
	if args[3] != `%100\%\_guide%` {
		t.Fatalf("second term LIKE pattern = %#v, want escaped guide term", args[3])
	}
}

func TestSearchPublishedQueryIncludesNaturalLanguageCategoryAndTagFallbacks(t *testing.T) {
	query := searchPublishedQuery()

	for _, want := range []string{
		`p.title ILIKE $3 ESCAPE '\'`,
		`COALESCE(p.summary,'') ILIKE $3 ESCAPE '\'`,
		`COALESCE(p.content_markdown,'') ILIKE $3 ESCAPE '\'`,
		`c.name ILIKE $2 ESCAPE '\'`,
		`FROM post_tags pt`,
		`JOIN tags t ON t.id = pt.tag_id`,
		`t.name ILIKE $3 ESCAPE '\'`,
		`t.slug ILIKE $3 ESCAPE '\'`,
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("SearchPublished query missing %q:\n%s", want, query)
		}
	}
}

func TestSearchPublishedQueryPrioritizesStructuredMatchesOverBodyFrequency(t *testing.T) {
	query := searchPublishedQuery()

	for _, want := range []string{
		`LEAST(`,
		`0.35`,
		`CASE WHEN p.title ILIKE $2 ESCAPE '\' THEN 2.4 ELSE 0 END`,
		`CASE WHEN (c.name ILIKE $2 ESCAPE '\' OR c.slug ILIKE $2 ESCAPE '\') THEN 1.2 ELSE 0 END`,
		`CASE WHEN COALESCE(p.content_markdown,'') ILIKE $2 ESCAPE '\' THEN 0.18 ELSE 0 END`,
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("SearchPublished query missing ranking signal %q:\n%s", want, query)
		}
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
