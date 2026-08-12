package service

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

func musicLyricRows(id int64, trackID *int64, content string) *sqlmock.Rows {
	now := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "name", "content", "format", "language", "source_file_name",
		"timing_offset_ms", "status", "track_id", "bound_track_title",
		"bound_track_artist", "created_at", "updated_at",
	}).AddRow(
		id, "Night Flight", content, "LRC", "zh-Hans", "night-flight.lrc",
		250, "NEEDS_REVIEW", trackID, nil, nil, now, now,
	)
}

func TestMusicServiceCreateLyricPersistsIndependentReviewAsset(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()

	content := "[00:01.00]Night flight"
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO music_lyrics (`)).
		WithArgs(
			"Night Flight",
			content,
			"LRC",
			"zh-Hans",
			"night-flight.lrc",
			250,
			"NEEDS_REVIEW",
		).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(71)))
	mock.ExpectQuery(regexp.QuoteMeta(`FROM music_lyrics l`)).
		WithArgs(int64(71)).
		WillReturnRows(musicLyricRows(71, nil, content))

	lyric, err := svc.CreateLyric(context.Background(), dto.MusicLyricRequest{
		Name:           "  Night Flight  ",
		Content:        "  " + content + "  ",
		Format:         "LRC",
		Language:       "zh-Hans",
		SourceFileName: musicStringPointer("night-flight.lrc"),
		TimingOffsetMs: 250,
		Status:         "NEEDS_REVIEW",
	})
	if err != nil {
		t.Fatalf("CreateLyric: %v", err)
	}
	if lyric.ID != 71 || lyric.BoundTrackID != nil || lyric.Content != content {
		t.Fatalf("lyric = %#v", lyric)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicServiceCreateLyricRejectsEmptyContent(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()

	_, err := svc.CreateLyric(context.Background(), dto.MusicLyricRequest{
		Name:    "Empty",
		Content: "   ",
	})
	if err == nil {
		t.Fatal("CreateLyric error = nil, want validation error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database work: %v", err)
	}
}

func TestNormalizeMusicLyricModelAllowsClearingSourceFileName(t *testing.T) {
	sourceFileName := "night-flight.lrc"
	normalized, err := normalizeMusicLyricModel(dto.MusicLyricRequest{
		Content:        "[00:01.00]Night flight",
		Format:         "LRC",
		Language:       "zh-Hans",
		TimingOffsetMs: 250,
		Status:         "NEEDS_REVIEW",
	}, &repository.MusicLyricRow{
		Name:           "Night Flight",
		SourceFileName: &sourceFileName,
		Language:       "zh-Hans",
		Status:         "NEEDS_REVIEW",
	})
	if err != nil {
		t.Fatalf("normalizeMusicLyricModel: %v", err)
	}
	if normalized.SourceFileName != nil {
		t.Fatalf("SourceFileName = %q, want nil", *normalized.SourceFileName)
	}
	if normalized.Name != "Night Flight" {
		t.Fatalf("Name = %q, want existing name", normalized.Name)
	}
}

func musicStringPointer(value string) *string {
	return &value
}
