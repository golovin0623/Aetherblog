package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/model"
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

func TestCarrierRepoUpsertTextLayerPersistsRootText(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewCarrierRepo(base)
	mock.ExpectExec(`INSERT INTO atlas_carrier_text_layers`).
		WithArgs(
			int64(3),
			"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			"atlas-text-layer://pdf/9/hash",
			2,
			12,
			"page one\n\npage two",
			[]byte(`[{"page":1}]`),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

	err := repo.UpsertTextLayer(context.Background(), &model.CarrierTextLayer{
		CarrierID:   3,
		ContentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		StorageURI:  "atlas-text-layer://pdf/9/hash",
		PageCount:   2,
		CharCount:   12,
		TextContent: "page one\n\npage two",
		Pages:       []byte(`[{"page":1}]`),
	})
	if err != nil {
		t.Fatalf("UpsertTextLayer returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestCarrierRepoFindTextLayerByCarrierAndHash(t *testing.T) {
	base, mock, cleanup := newAtlasRepoMock(t)
	defer cleanup()

	repo := NewCarrierRepo(base)
	now := time.Date(2026, 5, 31, 13, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`SELECT \* FROM atlas_carrier_text_layers WHERE carrier_id=\$1 AND content_hash=\$2 LIMIT 1`).
		WithArgs(int64(3), "hash-current").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "carrier_id", "content_hash", "storage_uri", "page_count", "char_count",
			"text_content", "pages", "created_at", "updated_at",
		}).AddRow(
			int64(11), int64(3), "hash-current", "atlas-text-layer://pdf/9/hash-current", 2, 21,
			"page one\n\npage two", []byte(`[{"page":1,"text":"page one","char_start":0,"char_end":8}]`),
			now, now,
		))

	layer, err := repo.FindTextLayerByCarrierAndHash(context.Background(), 3, "hash-current")
	if err != nil {
		t.Fatalf("FindTextLayerByCarrierAndHash returned error: %v", err)
	}
	if layer == nil || layer.CarrierID != 3 || layer.ContentHash != "hash-current" || layer.PageCount != 2 {
		t.Fatalf("unexpected text layer: %+v", layer)
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
