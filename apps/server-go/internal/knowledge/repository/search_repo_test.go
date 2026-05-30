package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestAnnotationRepoSearchEscapesKeywordAndScopesAuthor(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewAnnotationRepo(base)
	authorID := int64(7)
	now := time.Date(2026, 5, 31, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`SELECT \* FROM atlas_annotations\s+WHERE deleted=false\s+AND \(body_text ILIKE \$1 OR selectors::text ILIKE \$1\)\s+AND author_id=\$2\s+ORDER BY updated_at DESC LIMIT \$3`).
		WithArgs(`%100\%\_atlas%`, authorID, 20).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "carrier_id", "carrier_version_id", "selectors", "rel_position",
			"body_type", "body_text", "body_meta", "anchor_state", "anchor_score",
			"author_id", "deleted", "created_at", "updated_at",
		}).AddRow(
			int64(1), int64(2), nil, []byte(`[{"type":"TextQuoteSelector","exact":"100%_atlas"}]`), nil,
			"highlight", "100%_atlas body", []byte(`{}`), "anchored", float32(1),
			authorID, false, now, now,
		))

	rows, err := repo.Search(context.Background(), "100%_atlas", &authorID, 20)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(rows) != 1 || rows[0].AuthorID == nil || *rows[0].AuthorID != authorID {
		t.Fatalf("unexpected rows: %+v", rows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestCarrierRepoSearchEscapesKeywordAndScopesOwner(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewCarrierRepo(base)
	ownerID := int64(9)
	now := time.Date(2026, 5, 31, 12, 30, 0, 0, time.UTC)
	author := "Aether"
	mock.ExpectQuery(`SELECT \* FROM atlas_carriers\s+WHERE deleted=false\s+AND \(title ILIKE \$1 OR source_uri ILIKE \$1 OR author ILIKE \$1\)\s+AND owner_id=\$2\s+ORDER BY updated_at DESC LIMIT \$3`).
		WithArgs(`%source\_uri%`, ownerID, 25).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "type", "source_uri", "content_hash", "title", "author", "language",
			"metadata", "owner_id", "status", "status_message", "deleted", "created_at", "updated_at",
		}).AddRow(
			int64(3), "markdown", "notes://source_uri", "hash", "Source URI", author, nil,
			[]byte(`{}`), ownerID, "ready", nil, false, now, now,
		))

	rows, err := repo.Search(context.Background(), "source_uri", &ownerID, 25)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(rows) != 1 || rows[0].OwnerID == nil || *rows[0].OwnerID != ownerID {
		t.Fatalf("unexpected rows: %+v", rows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
