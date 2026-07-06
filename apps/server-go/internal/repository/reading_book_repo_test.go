package repository

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func TestJoinKBChunksRemovesConfiguredOverlap(t *testing.T) {
	chunks := []string{
		"第一段开头。这里是一段足够长的边界文字，用来模拟向量切片的尾部重叠。",
		"这里是一段足够长的边界文字，用来模拟向量切片的尾部重叠。\n\n第二段正文继续，而且这里也有足够长的重叠边界。",
		"第二段正文继续，而且这里也有足够长的重叠边界。\n\n第三段正文结束。",
	}

	got := joinKBChunks(chunks, true)
	want := strings.Join([]string{
		"第一段开头。这里是一段足够长的边界文字，用来模拟向量切片的尾部重叠。",
		"第二段正文继续，而且这里也有足够长的重叠边界。",
		"第三段正文结束。",
	}, "\n\n")
	if got != want {
		t.Fatalf("joinKBChunks() = %q, want %q", got, want)
	}
}

func TestJoinKBChunksKeepsSmallAccidentalOverlap(t *testing.T) {
	chunks := []string{
		"one",
		"e two",
	}

	got := joinKBChunks(chunks, true)
	want := "one\n\ne two"
	if got != want {
		t.Fatalf("joinKBChunks() = %q, want %q", got, want)
	}
}

func TestKBChunkingConfigUsesOverlapOnlyForOverlappingChunkers(t *testing.T) {
	tests := []struct {
		name string
		cfg  kbChunkingConfig
		want bool
	}{
		{
			name: "recursive overlap",
			cfg:  kbChunkingConfig{ChunkerKind: "recursive", ChunkOverlapTokens: 64},
			want: true,
		},
		{
			name: "qa ignores overlap field",
			cfg:  kbChunkingConfig{ChunkerKind: "qa", ChunkOverlapTokens: 64},
			want: false,
		},
		{
			name: "parent child ignores overlap field",
			cfg:  kbChunkingConfig{ChunkerKind: "parent_child", ChunkOverlapTokens: 64},
			want: false,
		},
		{
			name: "zero overlap",
			cfg:  kbChunkingConfig{ChunkerKind: "fixed", ChunkOverlapTokens: 0},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cfg.usesOverlap(); got != tt.want {
				t.Fatalf("usesOverlap() = %v, want %v", got, tt.want)
			}
		})
	}
}

func newReadingBookRepoMock(t *testing.T) (*ReadingBookRepo, sqlmock.Sqlmock, func()) {
	t.Helper()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}

	return NewReadingBookRepo(sqlx.NewDb(db, "sqlmock")), mock, func() { _ = db.Close() }
}

func TestReadingBookRepoSlugExistsUsesExistsQuery(t *testing.T) {
	repo, mock, cleanup := newReadingBookRepoMock(t)
	defer cleanup()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT EXISTS(SELECT 1 FROM reading_books WHERE slug=$1 AND id<>$2)`)).
		WithArgs("book-slug", int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	exists, err := repo.SlugExists(context.Background(), "book-slug", 42)
	if err != nil {
		t.Fatalf("SlugExists returned error: %v", err)
	}
	if !exists {
		t.Fatal("SlugExists returned false, want true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestReadingBookRepoListEscapesKeywordWildcards(t *testing.T) {
	repo, mock, cleanup := newReadingBookRepoMock(t)
	defer cleanup()

	filter := ReadingBookListFilter{
		Keyword:  `100%_guide\draft`,
		PageNum:  2,
		PageSize: 10,
	}

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM reading_books WHERE 1=1 AND title ILIKE $1 ESCAPE E'\\'`)).
		WithArgs(`%100\%\_guide\\draft%`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))
	mock.ExpectQuery(`(?s)SELECT\s+id, slug, title, author, cover_image, source_type, source_id, source_ref,\s+word_count, reading_time, status, error, theme, generated_at, created_at, updated_at\s+FROM reading_books WHERE 1=1 AND title ILIKE \$1 ESCAPE E'\\\\' ORDER BY created_at DESC LIMIT \$2 OFFSET \$3`).
		WithArgs(`%100\%\_guide\\draft%`, 10, 10).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	rows, total, err := repo.List(context.Background(), filter)
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if total != 0 {
		t.Fatalf("total = %d, want 0", total)
	}
	if len(rows) != 0 {
		t.Fatalf("rows length = %d, want 0", len(rows))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
