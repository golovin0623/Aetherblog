package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
	"github.com/jmoiron/sqlx"
)

func TestImageCarrierTextAndType(t *testing.T) {
	text := ImageCarrierText(ImageCarrierInput{
		DescriptionMarkdown: "## Diagram\n\nA **Knowledge Atlas** screenshot with labels.",
	})
	for _, want := range []string{"Diagram", "Knowledge Atlas screenshot", "labels"} {
		if !strings.Contains(text, want) {
			t.Fatalf("ImageCarrierText() = %q, want it to contain %q", text, want)
		}
	}
	if strings.Contains(text, "**") {
		t.Fatalf("ImageCarrierText() should normalize markdown syntax, got %q", text)
	}

	for _, tt := range []struct {
		media ImageMediaSnapshot
		want  string
	}{
		{media: ImageMediaSnapshot{FileType: "IMAGE", MimeType: "application/octet-stream"}, want: "image"},
		{media: ImageMediaSnapshot{FileType: "OTHER", MimeType: "image/png"}, want: "image"},
	} {
		got, ok := imageCarrierType(&tt.media)
		if !ok || got != tt.want {
			t.Fatalf("imageCarrierType(%+v) = %q,%v want %q,true", tt.media, got, ok, tt.want)
		}
	}

	if got, ok := imageCarrierType(&ImageMediaSnapshot{FileType: "VIDEO", MimeType: "video/mp4"}); ok || got != "" {
		t.Fatalf("video media should not be accepted as image carrier, got %q,%v", got, ok)
	}
}

func TestImageTextLayerStorageURI(t *testing.T) {
	if got := ImageTextLayerStorageURI(42, "abc123"); got != "atlas-text-layer://image/42/abc123" {
		t.Fatalf("ImageTextLayerStorageURI() = %q", got)
	}
}

func TestAtlasServiceAttachImageMedia(t *testing.T) {
	images := NewImageCarrierService(nil, nil)
	svc := NewAtlasService(nil, nil)
	svc.AttachImageMedia(images)
	if svc.ImageMedia() != images {
		t.Fatalf("ImageMedia() did not return attached service")
	}
}

func TestImageCarrierRefreshPersistsDisplayFields(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	ownerID := int64(7)
	media := &ImageMediaSnapshot{
		ID:           9,
		Title:        "Updated media title",
		OriginalName: "old-title.png",
		FileURL:      "/uploads/image.png",
		MimeType:     "image/png",
		FileType:     "IMAGE",
		OwnerID:      &ownerID,
	}
	language := "zh"
	input := ImageCarrierInput{
		MediaFileID:         media.ID,
		DescriptionMarkdown: "Same description",
		Language:            &language,
	}
	text := ImageCarrierText(input)
	hash := contentSHA256(text)
	storageURI := ImageTextLayerStorageURI(media.ID, hash)
	now := time.Now()

	rows := sqlmock.NewRows([]string{
		"id", "type", "source_uri", "content_hash", "title", "author", "language",
		"metadata", "owner_id", "status", "status_message", "deleted", "created_at", "updated_at",
		"just_created",
	}).AddRow(
		int64(99), "image", MediaSourceURI(media.ID), hash, "Old media title", nil, "en",
		[]byte(`{"textLayerURI":"old"}`), ownerID, "ready", nil, false, now, now, false,
	)

	mock.ExpectBegin()
	mock.ExpectQuery("INSERT INTO atlas_carriers").
		WillReturnRows(rows)
	mock.ExpectCommit()
	mock.ExpectExec("INSERT INTO atlas_carrier_text_layers").
		WithArgs(int64(99), hash, storageURI, 1, textLayerCharCount(text), text, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE atlas_carriers\\s+SET title=\\$1,\\s+author=\\$2,\\s+language=\\$3,\\s+metadata=\\$4,\\s+status=\\$5,\\s+status_message=\\$6,\\s+updated_at=CURRENT_TIMESTAMP\\s+WHERE id=\\$7").
		WithArgs("Updated media title", nil, "zh", sqlmock.AnyArg(), "ready", nil, int64(99)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	repo := repository.NewCarrierRepo(repository.NewAtlasRepo(sqlx.NewDb(db, "sqlmock")))
	svc := NewImageCarrierService(repo, &fakeImageMediaReader{snapshot: media})

	carrier, err := svc.CreateOrUpdateForMediaAs(context.Background(), input, ownerID, false)
	if err != nil {
		t.Fatalf("CreateOrUpdateForMediaAs returned error: %v", err)
	}
	if carrier.Title != "Updated media title" {
		t.Fatalf("carrier title = %q, want updated title", carrier.Title)
	}
	if carrier.Language == nil || *carrier.Language != "zh" {
		t.Fatalf("carrier language = %v, want zh", carrier.Language)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

type fakeImageMediaReader struct {
	snapshot *ImageMediaSnapshot
}

func (f *fakeImageMediaReader) GetImageMediaSnapshot(_ context.Context, mediaFileID int64) (*ImageMediaSnapshot, error) {
	if f.snapshot == nil || f.snapshot.ID != mediaFileID {
		return nil, nil
	}
	copy := *f.snapshot
	return &copy, nil
}
