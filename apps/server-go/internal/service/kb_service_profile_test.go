package service

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

func kbRows() *sqlmock.Rows {
	now := time.Now()
	return sqlmock.NewRows([]string{
		"id", "slug", "name", "description", "icon", "color", "cover_image",
		"kind", "owner_id", "visibility", "folder_id", "active_profile_id",
		"file_count", "chunk_count", "vectorized_count", "failed_count", "total_tokens",
		"is_archived", "created_by", "updated_by", "created_at", "updated_at",
	}).AddRow(
		int64(9), "kb", "KB", nil, nil, nil, nil,
		model.KBKindCustom, nil, "PRIVATE", nil, int64(1),
		0, 0, 0, 0, int64(0),
		false, nil, nil, now, now,
	)
}

func kbProfileRows(status string) *sqlmock.Rows {
	now := time.Now()
	return sqlmock.NewRows([]string{
		"id", "kb_id", "code", "name", "description", "model_id", "chunker_kind",
		"chunk_size_tokens", "chunk_overlap_tokens", "top_k", "score_threshold",
		"status", "created_at", "updated_at",
	}).AddRow(
		int64(22), int64(9), "shadow-v2", "Shadow v2", nil, "text-embedding-3-large", "recursive",
		512, 64, 6, 0.2,
		status, now, now,
	)
}

func TestActivateProfileRejectsShadowProfileDirectSwitch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	sqlxDB := sqlx.NewDb(db, "sqlmock")
	svc := &KBService{
		kbRepo:      repository.NewKBRepo(sqlxDB),
		profileRepo: repository.NewKBProfileRepo(sqlxDB),
	}

	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT id, slug, name, description, icon, color, cover_image, kind, owner_id, visibility, folder_id,
	active_profile_id, file_count, chunk_count, vectorized_count, failed_count, total_tokens,
	is_archived, created_by, updated_by, created_at, updated_at FROM knowledge_bases WHERE id=$1`,
	)).
		WithArgs(int64(9)).
		WillReturnRows(kbRows())
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT id, kb_id, code, name, description, model_id, chunker_kind,
    chunk_size_tokens, chunk_overlap_tokens, top_k, score_threshold, status, created_at, updated_at FROM kb_profiles WHERE id=$1`,
	)).
		WithArgs(int64(22)).
		WillReturnRows(kbProfileRows(model.KBProfileStatusShadow))

	err = svc.ActivateProfile(context.Background(), 9, 22, &KBUserContext{IsAdmin: true})
	if !errors.Is(err, ErrKBProfileBadState) {
		t.Fatalf("ActivateProfile error = %v, want ErrKBProfileBadState", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
