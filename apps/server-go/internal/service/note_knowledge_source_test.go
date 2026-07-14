package service

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

type fakeNoteKnowledgeIndexer struct {
	indexCalls     int
	readinessCalls int
	readiness      *NoteKnowledgeReadinessResult
}

func (f *fakeNoteKnowledgeIndexer) IndexNote(context.Context, int64, *int64) (*NoteIndexResult, error) {
	f.indexCalls++
	return &NoteIndexResult{NoteID: 11, ProfileID: 42, ChunkCount: 2, Status: "INDEXED"}, nil
}

func (f *fakeNoteKnowledgeIndexer) GetReadiness(context.Context, int64, *int64) (*NoteKnowledgeReadinessResult, error) {
	f.readinessCalls++
	return f.readiness, nil
}

type fakeNoteCarrierPreparer struct {
	calls int
}

func (f *fakeNoteCarrierPreparer) PrepareNoteCarrier(context.Context, int64) (int64, error) {
	f.calls++
	return 77, nil
}

func noteKnowledgeRows() *sqlmock.Rows {
	now := time.Date(2026, 7, 14, 1, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "title", "content_markdown", "summary", "folder_id", "author_id",
		"source_type", "source_url", "source_title", "source_meta",
		"is_pinned", "is_favorite", "archived", "deleted", "word_count", "embedding_status",
		"embedding_fingerprint", "embedding_profile_id", "embedding_indexed_at", "embedding_error",
		"last_opened_at", "created_at", "updated_at",
	}).AddRow(
		int64(11), "Evidence", "Grounded material", nil, nil, int64(9),
		"manual", nil, nil, []byte(`{}`),
		false, false, false, false, 2, "PENDING",
		nil, nil, nil, nil,
		nil, now, now,
	)
}

func TestPrepareKnowledgeSourceCreatesCarrierBeforeIndexAndReturnsReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := repository.NewNoteRepo(sqlx.NewDb(db, "sqlmock"))
	svc := NewNoteService(repo, nil)
	profileID := int64(42)
	carrierID := int64(77)
	indexer := &fakeNoteKnowledgeIndexer{readiness: &NoteKnowledgeReadinessResult{
		NoteID:             11,
		Status:             "ready",
		Queryable:          true,
		ProfileID:          &profileID,
		ChunkCount:         2,
		CarrierID:          &carrierID,
		SourceFingerprint:  "current",
		IndexedFingerprint: stringPointer("current"),
		Message:            "ready",
	}}
	carrier := &fakeNoteCarrierPreparer{}
	svc.AttachEmbeddingIndexer(indexer)
	svc.AttachKnowledgeCarrierPreparer(carrier)

	mock.ExpectQuery("SELECT \\* FROM notes WHERE id=\\$1 AND deleted=false").
		WithArgs(int64(11)).
		WillReturnRows(noteKnowledgeRows())
	mock.ExpectExec("UPDATE notes").
		WithArgs(int64(11)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT \\* FROM notes WHERE id=\\$1 AND deleted=false").
		WithArgs(int64(11)).
		WillReturnRows(noteKnowledgeRows())

	result, err := svc.PrepareKnowledgeSource(context.Background(), 11)
	if err != nil {
		t.Fatalf("PrepareKnowledgeSource returned error: %v", err)
	}
	if !result.Queryable || result.ChunkCount != 2 || result.CarrierID == nil || *result.CarrierID != 77 {
		t.Fatalf("unexpected readiness: %#v", result)
	}
	if carrier.calls != 1 || indexer.indexCalls != 1 || indexer.readinessCalls != 1 {
		t.Fatalf("calls carrier=%d index=%d readiness=%d", carrier.calls, indexer.indexCalls, indexer.readinessCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func stringPointer(value string) *string { return &value }
