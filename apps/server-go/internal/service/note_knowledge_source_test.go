package service

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

type fakeNoteKnowledgeIndexer struct {
	indexCalls     int
	indexErr       error
	indexResult    *NoteIndexResult
	attemptIDs     []string
	onIndex        func()
	readinessCalls int
	readiness      *NoteKnowledgeReadinessResult
}

func (f *fakeNoteKnowledgeIndexer) IndexNote(_ context.Context, _ int64, _ *int64, attemptID *string) (*NoteIndexResult, error) {
	f.indexCalls++
	if attemptID != nil {
		f.attemptIDs = append(f.attemptIDs, *attemptID)
	}
	if f.onIndex != nil {
		f.onIndex()
	}
	if f.indexErr != nil {
		return nil, f.indexErr
	}
	if f.indexResult != nil {
		return f.indexResult, nil
	}
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
	now := noteKnowledgeUpdatedAt()
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

func noteKnowledgeUpdatedAt() time.Time {
	return time.Date(2026, 7, 14, 1, 0, 0, 0, time.UTC)
}

func TestPrepareKnowledgeSourceCreatesCarrierBeforeIndexAndReturnsReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := repository.NewNoteRepo(sqlx.NewDb(db, "sqlmock"))
	svc := NewNoteService(repo, nil)
	svc.newEmbeddingAttemptID = func() (string, error) { return "attempt-a", nil }
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
		WithArgs("attempt-a", int64(11)).
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
	if len(indexer.attemptIDs) != 1 || indexer.attemptIDs[0] != "attempt-a" {
		t.Fatalf("attempt IDs = %#v", indexer.attemptIDs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestPrepareKnowledgeSourcePersistsCurrentIndexFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := repository.NewNoteRepo(sqlx.NewDb(db, "sqlmock"))
	svc := NewNoteService(repo, nil)
	svc.newEmbeddingAttemptID = func() (string, error) { return "attempt-a", nil }
	requestCtx, cancelRequest := context.WithCancel(context.Background())
	defer cancelRequest()
	indexer := &fakeNoteKnowledgeIndexer{
		indexErr: errors.New("upstream unavailable"),
		onIndex:  cancelRequest,
	}
	carrier := &fakeNoteCarrierPreparer{}
	svc.AttachEmbeddingIndexer(indexer)
	svc.AttachKnowledgeCarrierPreparer(carrier)

	mock.ExpectQuery("SELECT \\* FROM notes WHERE id=\\$1 AND deleted=false").
		WithArgs(int64(11)).
		WillReturnRows(noteKnowledgeRows())
	mock.ExpectExec("UPDATE notes").
		WithArgs("attempt-a", int64(11)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE notes
		SET embedding_status='FAILED', embedding_error=$1
		WHERE id=$2
			AND deleted=false
			AND embedding_status='PENDING'
			AND embedding_attempt_id=$3`)).
		WithArgs("知识来源准备失败，请稍后重试。", int64(11), "attempt-a").
		WillReturnResult(sqlmock.NewResult(0, 1))

	result, err := svc.PrepareKnowledgeSource(requestCtx, 11)
	if err != nil {
		t.Fatalf("PrepareKnowledgeSource returned error: %v", err)
	}
	if result.Status != "unavailable" || result.Queryable {
		t.Fatalf("unexpected readiness: %#v", result)
	}
	if carrier.calls != 1 || indexer.indexCalls != 1 || indexer.readinessCalls != 0 {
		t.Fatalf("calls carrier=%d index=%d readiness=%d", carrier.calls, indexer.indexCalls, indexer.readinessCalls)
	}
	if len(indexer.attemptIDs) != 1 || indexer.attemptIDs[0] != "attempt-a" {
		t.Fatalf("attempt IDs = %#v", indexer.attemptIDs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestPrepareKnowledgeSourceRepairsFailedResultThatWasNotPersisted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := repository.NewNoteRepo(sqlx.NewDb(db, "sqlmock"))
	svc := NewNoteService(repo, nil)
	svc.newEmbeddingAttemptID = func() (string, error) { return "attempt-a", nil }
	indexer := &fakeNoteKnowledgeIndexer{
		indexResult: &NoteIndexResult{NoteID: 11, ProfileID: 42, Status: "FAILED"},
		readiness: &NoteKnowledgeReadinessResult{
			NoteID:    11,
			Status:    "failed",
			Queryable: false,
			Message:   "failed",
		},
	}
	carrier := &fakeNoteCarrierPreparer{}
	svc.AttachEmbeddingIndexer(indexer)
	svc.AttachKnowledgeCarrierPreparer(carrier)

	mock.ExpectQuery("SELECT \\* FROM notes WHERE id=\\$1 AND deleted=false").
		WithArgs(int64(11)).
		WillReturnRows(noteKnowledgeRows())
	mock.ExpectExec("UPDATE notes").
		WithArgs("attempt-a", int64(11)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE notes").
		WithArgs("知识来源准备失败，请稍后重试。", int64(11), "attempt-a").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT \\* FROM notes WHERE id=\\$1 AND deleted=false").
		WithArgs(int64(11)).
		WillReturnRows(noteKnowledgeRows())

	result, err := svc.PrepareKnowledgeSource(context.Background(), 11)
	if err != nil {
		t.Fatalf("PrepareKnowledgeSource returned error: %v", err)
	}
	if result.Status != "failed" || result.Queryable {
		t.Fatalf("unexpected readiness: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestScheduleEmbeddingUsesDetachedAttemptAndPersistsTransportFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := repository.NewNoteRepo(sqlx.NewDb(db, "sqlmock"))
	svc := NewNoteService(repo, nil)
	svc.newEmbeddingAttemptID = func() (string, error) { return "attempt-a", nil }
	indexCalled := make(chan struct{})
	indexer := &fakeNoteKnowledgeIndexer{
		indexErr: errors.New("transport timeout"),
		onIndex:  func() { close(indexCalled) },
	}
	svc.AttachEmbeddingIndexer(indexer)

	mock.ExpectExec("UPDATE notes").
		WithArgs("attempt-a", int64(11)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE notes").
		WithArgs("知识来源准备失败，请稍后重试。", int64(11), "attempt-a").
		WillReturnResult(sqlmock.NewResult(0, 1))

	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	svc.ScheduleEmbedding(cancelledCtx, 11, int64Pointer(9), "test")

	select {
	case <-indexCalled:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for scheduled index call")
	}
	deadline := time.Now().Add(time.Second)
	for {
		if err := mock.ExpectationsWereMet(); err == nil {
			break
		} else if time.Now().After(deadline) {
			t.Fatalf("unmet SQL expectations: %v", err)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func stringPointer(value string) *string { return &value }
func int64Pointer(value int64) *int64    { return &value }
