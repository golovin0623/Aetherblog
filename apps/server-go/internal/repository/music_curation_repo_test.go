package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"
)

func TestMusicRepoBindLyricMovesBindingAndSynchronizesTrackText(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	repo := NewMusicRepo(sqlx.NewDb(db, "sqlmock"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT track_id`)).
		WithArgs(int64(71)).
		WillReturnRows(sqlmock.NewRows([]string{"track_id"}).AddRow(int64(12)))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE music_lyrics`)).
		WithArgs(int64(11), int64(71)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE music_lyrics`)).
		WithArgs(int64(11), int64(71)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE music_tracks`)).
		WithArgs(int64(11), int64(12)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE music_tracks`)).
		WithArgs(int64(71), int64(11)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := repo.BindLyric(context.Background(), 71, 11); err != nil {
		t.Fatalf("BindLyric: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicRepoUnbindLyricClearsDenormalizedTrackText(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	repo := NewMusicRepo(sqlx.NewDb(db, "sqlmock"))

	mock.ExpectExec(regexp.QuoteMeta(`WITH bound_track AS (`)).
		WithArgs(int64(71)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := repo.UnbindLyric(context.Background(), 71); err != nil {
		t.Fatalf("UnbindLyric: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicRepoListTracksTreatsSoftDeletedCoverMediaAsMissing(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	repo := NewMusicRepo(sqlx.NewDb(db, "sqlmock"))

	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*cover_mf\.deleted=false.*cover_mf\.id IS NULL`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`(?s)SELECT .*cover_mf\.deleted=false.*cover_mf\.id IS NULL.*ORDER BY`).
		WithArgs(20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	rows, total, err := repo.ListTracks(context.Background(), MusicTrackFilter{
		CoverState: "WITHOUT_COVER",
		PageNum:    1,
		PageSize:   20,
	})
	if err != nil {
		t.Fatalf("ListTracks: %v", err)
	}
	if len(rows) != 0 || total != 0 {
		t.Fatalf("expected no rows, got rows=%d total=%d", len(rows), total)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicRepoListTracksFiltersTracksWithoutTags(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	repo := NewMusicRepo(sqlx.NewDb(db, "sqlmock"))

	mock.ExpectQuery(`SELECT COUNT\(\*\).*NOT EXISTS.*media_file_tags`).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`SELECT .*NOT EXISTS.*media_file_tags.*ORDER BY`).
		WithArgs(20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	rows, total, err := repo.ListTracks(context.Background(), MusicTrackFilter{
		TagState: "WITHOUT_TAGS",
		PageNum:  1,
		PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListTracks: %v", err)
	}
	if len(rows) != 0 || total != 0 {
		t.Fatalf("expected no rows, got rows=%d total=%d", len(rows), total)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicRepoListLyricsTrackFilterKeepsLimitPlaceholdersContiguous(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	repo := NewMusicRepo(sqlx.NewDb(db, "sqlmock"))
	trackID := int64(42)

	mock.ExpectQuery(`SELECT COUNT\(\*\).*l\.track_id=\$1`).
		WithArgs(trackID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(`SELECT .*l\.track_id=\$1.*LIMIT \$2 OFFSET \$3`).
		WithArgs(trackID, 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	rows, total, err := repo.ListLyrics(context.Background(), MusicLyricFilter{
		TrackID:  &trackID,
		PageNum:  1,
		PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListLyrics: %v", err)
	}
	if len(rows) != 0 || total != 0 {
		t.Fatalf("expected no rows, got rows=%d total=%d", len(rows), total)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
