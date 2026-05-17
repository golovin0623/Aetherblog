package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func newMediaTagRepoMock(t *testing.T) (*MediaTagRepo, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	cleanup := func() { _ = db.Close() }
	return NewMediaTagRepo(sqlx.NewDb(db, "sqlmock")), mock, cleanup
}

func TestMediaTagRepoTagFileWithUsageBulkInsertsAndUpdatesUsageCount(t *testing.T) {
	repo, mock, cleanup := newMediaTagRepoMock(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`
		WITH inserted AS (
			INSERT INTO media_file_tags (media_file_id, tag_id, tagged_by, source)
			SELECT $1, tag_id, $3, 'MANUAL'
			FROM unnest($2::bigint[]) AS tag_id
			ON CONFLICT (media_file_id, tag_id) DO NOTHING
			RETURNING tag_id
		)
		UPDATE media_tags AS t
		SET usage_count = usage_count + 1
		FROM inserted
		WHERE t.id = inserted.tag_id`)).
		WithArgs(int64(42), sqlmock.AnyArg(), nil).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	if err := repo.TagFileWithUsage(context.Background(), 42, []int64{7, 8, 7}, nil); err != nil {
		t.Fatalf("TagFileWithUsage returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestMediaTagRepoUntagFileWithUsageDeletesAndUpdatesUsageCountAtomically(t *testing.T) {
	repo, mock, cleanup := newMediaTagRepoMock(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`
		WITH deleted AS (
			DELETE FROM media_file_tags
			WHERE media_file_id=$1 AND tag_id=$2
			RETURNING tag_id
		)
		UPDATE media_tags AS t
		SET usage_count = GREATEST(usage_count - 1, 0)
		FROM deleted
		WHERE t.id = deleted.tag_id`)).
		WithArgs(int64(42), int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := repo.UntagFileWithUsage(context.Background(), 42, 7); err != nil {
		t.Fatalf("UntagFileWithUsage returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestMediaTagRepoBatchTagWithUsageIncrementsByInsertedCount(t *testing.T) {
	repo, mock, cleanup := newMediaTagRepoMock(t)
	defer cleanup()

	taggedBy := int64(9)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`
		WITH inserted AS (
			INSERT INTO media_file_tags (media_file_id, tag_id, tagged_by, source)
			SELECT file_id, $2, $3, 'MANUAL'
			FROM unnest($1::bigint[]) AS file_id
			ON CONFLICT (media_file_id, tag_id) DO NOTHING
			RETURNING 1
		),
		inserted_count AS (
			SELECT COUNT(*) AS count FROM inserted
		)
		UPDATE media_tags AS t
		SET usage_count = usage_count + inserted_count.count::int
		FROM inserted_count
		WHERE t.id = $2 AND inserted_count.count > 0`)).
		WithArgs(sqlmock.AnyArg(), int64(7), &taggedBy).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := repo.BatchTagWithUsage(context.Background(), []int64{42, 43, 42}, 7, &taggedBy); err != nil {
		t.Fatalf("BatchTagWithUsage returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
