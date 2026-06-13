package service

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

func newMusicServiceMock(t *testing.T) (*MusicService, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	svc := NewMusicService(repository.NewMusicRepo(sqlx.NewDb(db, "sqlmock")), nil)
	return svc, mock, func() { _ = db.Close() }
}

func musicSettingsRows(enabled bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "enabled", "show_on_home_page", "show_on_profile_card", "featured_playlist_id",
		"media_folder_id", "playback_mode", "carousel_enabled", "carousel_interval_seconds",
		"random_enabled", "created_at", "updated_at",
	}).AddRow(int16(1), enabled, true, true, nil, nil, "SEQUENTIAL", true, 8, false, nil, nil)
}

func expectMusicSettings(mock sqlmock.Sqlmock, enabled bool) {
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO music_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM music_settings WHERE id=1`)).
		WillReturnRows(musicSettingsRows(enabled))
}

func musicPlaylistRows() *sqlmock.Rows {
	return musicPlaylistRowsWithTrackCount(1)
}

func musicPlaylistRowsWithTrackCount(trackCount int64) *sqlmock.Rows {
	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "name", "slug", "description", "cover_media_file_id", "visibility", "status",
		"display_on_home", "display_on_profile", "carousel_enabled", "random_enabled",
		"sort_order", "created_at", "updated_at", "track_count",
	}).AddRow(int64(42), "晚间电台", "evening-radio", nil, nil, "PUBLIC", "ACTIVE", true, true, true, false, 0, now, now, trackCount)
}

func musicTrackRows() *sqlmock.Rows {
	return musicTrackRowsWithID(11, 99, "夜航")
}

func musicTrackRowsWithID(trackID, mediaID int64, title string) *sqlmock.Rows {
	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	mime := "audio/mpeg"
	folderID := int64(7)
	return sqlmock.NewRows([]string{
		"id", "media_file_id", "title", "artist", "album", "duration_seconds",
		"cover_media_file_id", "lyric", "source", "status", "sort_order", "is_featured",
		"play_count", "created_at", "updated_at", "media_original_name", "media_file_url",
		"media_file_size", "media_mime_type", "media_file_type", "media_folder_id", "media_deleted",
	}).AddRow(
		trackID, mediaID, title, "Aether", "", nil, nil, nil, "MEDIA_LIBRARY",
		"ACTIVE", 0, false, int64(0), now, now, "night-flight.mp3", "/api/uploads/music/night-flight.mp3",
		int64(4_096), mime, "AUDIO", folderID, false,
	)
}

func TestMusicServicePublicPlayerDisabledDoesNotLoadTracks(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()
	expectMusicSettings(mock, false)

	player, err := svc.PublicPlayer(context.Background())
	if err != nil {
		t.Fatalf("PublicPlayer: %v", err)
	}
	if player.Enabled {
		t.Fatalf("Enabled = true, want false")
	}
	if len(player.Tracks) != 0 {
		t.Fatalf("tracks len = %d, want 0", len(player.Tracks))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicServiceImportMediaRejectsMissingAudio(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()
	mock.ExpectQuery(regexp.QuoteMeta(`FROM media_files mf`)).
		WithArgs(int64(9)).
		WillReturnError(sql.ErrNoRows)

	_, err := svc.ImportMedia(context.Background(), dto.MusicImportMediaRequest{MediaFileID: 9}, "MEDIA_LIBRARY")
	if !errors.Is(err, ErrMusicMediaNotAudio) {
		t.Fatalf("ImportMedia err = %v, want %v", err, ErrMusicMediaNotAudio)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicServicePublicPlayerUsesPublicPlaylistTracks(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()
	expectMusicSettings(mock, true)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.id, p.name, p.slug`)).
		WillReturnRows(musicPlaylistRows())
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*)`)).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT `)).
		WithArgs(int64(42), 100, 0).
		WillReturnRows(musicTrackRows())

	player, err := svc.PublicPlayer(context.Background())
	if err != nil {
		t.Fatalf("PublicPlayer: %v", err)
	}
	if player.Playlist == nil || player.Playlist.ID != 42 {
		t.Fatalf("playlist = %#v, want id 42", player.Playlist)
	}
	if player.CarouselIntervalSeconds != 8 {
		t.Fatalf("carousel interval = %d, want 8", player.CarouselIntervalSeconds)
	}
	if len(player.Tracks) != 1 {
		t.Fatalf("tracks len = %d, want 1", len(player.Tracks))
	}
	if got := player.Tracks[0].Media.PublicURL; got != "/api/v1/public/media/99" {
		t.Fatalf("track public URL = %q, want stable media endpoint", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicServicePublicPlayerLoadsFullPlaylistQueue(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()
	expectMusicSettings(mock, true)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.id, p.name, p.slug`)).
		WillReturnRows(musicPlaylistRowsWithTrackCount(2))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*)`)).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(2)))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT `)).
		WithArgs(int64(42), 100, 0).
		WillReturnRows(musicTrackRowsWithID(11, 99, "第一首"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*)`)).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(2)))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT `)).
		WithArgs(int64(42), 100, 100).
		WillReturnRows(musicTrackRowsWithID(12, 100, "第二首"))

	player, err := svc.PublicPlayer(context.Background())
	if err != nil {
		t.Fatalf("PublicPlayer: %v", err)
	}
	if len(player.Tracks) != 2 {
		t.Fatalf("tracks len = %d, want 2", len(player.Tracks))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicServicePublicPlayerWithoutPublicPlaylistReturnsEmptyQueue(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()
	expectMusicSettings(mock, true)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.id, p.name, p.slug`)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "name", "slug", "description", "cover_media_file_id", "visibility", "status",
			"display_on_home", "display_on_profile", "carousel_enabled", "random_enabled",
			"sort_order", "created_at", "updated_at", "track_count",
		}))

	player, err := svc.PublicPlayer(context.Background())
	if err != nil {
		t.Fatalf("PublicPlayer: %v", err)
	}
	if player.Playlist != nil {
		t.Fatalf("playlist = %#v, want nil", player.Playlist)
	}
	if len(player.Tracks) != 0 {
		t.Fatalf("tracks len = %d, want 0", len(player.Tracks))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMusicServiceReorderPlaylistPatchesOnlyProvidedTracks(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.id, p.name, p.slug`)).
		WithArgs(int64(42)).
		WillReturnRows(musicPlaylistRowsWithTrackCount(101))
	mock.ExpectBegin()
	for i := 0; i < 100; i++ {
		mock.ExpectExec(regexp.QuoteMeta(`UPDATE music_playlist_tracks`)).
			WithArgs(int64(42), int64(i+1), i).
			WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.ExpectCommit()

	req := dto.MusicPlaylistReorderRequest{Tracks: make([]dto.MusicPlaylistTrackOrder, 0, 100)}
	for i := 0; i < 100; i++ {
		req.Tracks = append(req.Tracks, dto.MusicPlaylistTrackOrder{
			TrackID:   int64(i + 1),
			SortOrder: i,
		})
	}

	if err := svc.ReorderPlaylist(context.Background(), 42, req); err != nil {
		t.Fatalf("ReorderPlaylist: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestTitleFromFilenameBoundsFallbackTitle(t *testing.T) {
	got := titleFromFilename(strings.Repeat("长", 220) + ".mp3")
	if utf8.RuneCountInString(got) != musicTrackTitleMaxRunes {
		t.Fatalf("title rune length = %d, want %d", utf8.RuneCountInString(got), musicTrackTitleMaxRunes)
	}
}
