package service

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"regexp"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
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
	return musicTrackRowsWithIDAndThumbnail(11, 99, "夜航", nil)
}

func musicTrackRowsWithID(trackID, mediaID int64, title string) *sqlmock.Rows {
	return musicTrackRowsWithIDAndThumbnail(trackID, mediaID, title, nil)
}

func musicTrackRowsWithIDAndThumbnail(trackID, mediaID int64, title string, thumbnailURL *string) *sqlmock.Rows {
	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	mime := "audio/mpeg"
	folderID := int64(7)
	return sqlmock.NewRows([]string{
		"id", "media_file_id", "title", "artist", "album", "duration_seconds",
		"cover_media_file_id", "lyric", "source", "status", "sort_order", "is_featured",
		"play_count", "created_at", "updated_at", "media_original_name", "media_file_url",
		"media_file_size", "media_mime_type", "media_file_type", "media_folder_id", "media_deleted", "media_thumbnail_url",
	}).AddRow(
		trackID, mediaID, title, "Aether", "", nil, nil, nil, "MEDIA_LIBRARY",
		"ACTIVE", 0, false, int64(0), now, now, "night-flight.mp3", "/api/uploads/music/night-flight.mp3",
		int64(4_096), mime, "AUDIO", folderID, false, thumbnailURL,
	)
}

func musicTrackRowsWithLyricAsset(trackID, mediaID int64, title string, lyricContent *string, lyricStatus string) *sqlmock.Rows {
	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)
	mime := "audio/mpeg"
	folderID := int64(7)
	lyricID := int64(31)
	lyricFormat := "LRC"
	lyricLanguage := "zh-Hans"
	return sqlmock.NewRows([]string{
		"id", "media_file_id", "title", "artist", "album", "duration_seconds",
		"cover_media_file_id", "lyric", "source", "status", "sort_order", "is_featured",
		"play_count", "created_at", "updated_at", "media_original_name", "media_file_url",
		"media_file_size", "media_mime_type", "media_file_type", "media_folder_id", "media_deleted", "media_thumbnail_url",
		"lyric_asset_id", "lyric_format", "lyric_language", "lyric_status",
	}).AddRow(
		trackID, mediaID, title, "Aether", "", nil, nil, lyricContent, "MEDIA_LIBRARY",
		"ACTIVE", 0, false, int64(0), now, now, "night-flight.mp3", "/api/uploads/music/night-flight.mp3",
		int64(4_096), mime, "AUDIO", folderID, false, nil,
		lyricID, lyricFormat, lyricLanguage, lyricStatus,
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

func TestResolveMusicImportFieldsUsesTagsWithoutOverridingExplicitValues(t *testing.T) {
	metadata := &audioTrackMetadata{
		Title:  "假如让我说下去",
		Artist: "杨千嬅",
		Album:  "千嬅盛放",
	}

	title, artist, album := resolveMusicImportFields(
		dto.MusicImportMediaRequest{MediaFileID: 37},
		metadata,
		"杨千嬅 - 假如让我说下去.mp3",
	)
	if title != "假如让我说下去" || artist != "杨千嬅" || album != "千嬅盛放" {
		t.Fatalf("tag-derived fields = %q, %q, %q", title, artist, album)
	}

	title, artist, album = resolveMusicImportFields(
		dto.MusicImportMediaRequest{
			MediaFileID: 37,
			Title:       "手动歌名",
			Artist:      "手动艺人",
		},
		metadata,
		"杨千嬅 - 假如让我说下去.mp3",
	)
	if title != "手动歌名" || artist != "手动艺人" || album != "千嬅盛放" {
		t.Fatalf("explicit precedence fields = %q, %q, %q", title, artist, album)
	}

	title, artist, album = resolveMusicImportFields(
		dto.MusicImportMediaRequest{MediaFileID: 37},
		&audioTrackMetadata{
			Title:  strings.Repeat("歌", musicTrackTitleMaxRunes+20),
			Artist: strings.Repeat("艺", musicTrackArtistMaxRunes+20),
			Album:  strings.Repeat("专", musicTrackAlbumMaxRunes+20),
		},
		"fallback.mp3",
	)
	if utf8.RuneCountInString(title) != musicTrackTitleMaxRunes ||
		utf8.RuneCountInString(artist) != musicTrackArtistMaxRunes ||
		utf8.RuneCountInString(album) != musicTrackAlbumMaxRunes {
		t.Fatalf("metadata fields were not bounded: %d, %d, %d", utf8.RuneCountInString(title), utf8.RuneCountInString(artist), utf8.RuneCountInString(album))
	}
}

func TestResolveMusicMetadataMimeFallsBackWithoutTrustingNonAudioNames(t *testing.T) {
	persistedFLAC := " audio/flac "
	persistedGeneric := "application/octet-stream"
	cases := []struct {
		name            string
		downloadedMime  string
		persistedMime   *string
		downloadedName  string
		rowOriginalName string
		want            string
	}{
		{
			name:            "persisted audio mime wins over filenames",
			downloadedMime:  "application/octet-stream",
			persistedMime:   &persistedFLAC,
			downloadedName:  "download.mp3",
			rowOriginalName: "row.m4a",
			want:            "audio/flac",
		},
		{
			name:            "download original name is the first filename fallback",
			downloadedMime:  "application/octet-stream",
			persistedMime:   &persistedGeneric,
			downloadedName:  "download.mp3",
			rowOriginalName: "row.flac",
			want:            "audio/mpeg",
		},
		{
			name:            "row original name is used after unsafe download name",
			downloadedMime:  "application/octet-stream",
			downloadedName:  "download.svg",
			rowOriginalName: "row.m4a",
			want:            "audio/x-m4a",
		},
		{
			name:            "non audio filename guesses never escape the audio boundary",
			downloadedMime:  "application/octet-stream",
			downloadedName:  "download.svg",
			rowOriginalName: "row.png",
			want:            "application/octet-stream",
		},
		{
			name:            "concrete storage mime is authoritative",
			downloadedMime:  "audio/ogg",
			persistedMime:   &persistedFLAC,
			downloadedName:  "download.mp3",
			rowOriginalName: "row.m4a",
			want:            "audio/ogg",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveMusicMetadataMime(
				tc.downloadedMime,
				tc.persistedMime,
				tc.downloadedName,
				tc.rowOriginalName,
			)
			if got != tc.want {
				t.Fatalf("resolveMusicMetadataMime() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestMusicServiceImportMediaExtractsID3WhenStorageReturnsOctetStream(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	payload := buildID3v23TextPayload(map[string]string{
		"TIT2": "假如让我说下去",
		"TPE1": "杨千嬅",
		"TALB": "千嬅盛放",
	})
	persistedMime := "audio/mpeg"
	media := model.MediaFile{
		ID:           37,
		Filename:     "opaque-object",
		OriginalName: "杨千嬅 - 假如让我说下去.mp3",
		FilePath:     "music/opaque-object",
		FileURL:      "music/opaque-object",
		FileSize:     int64(len(payload)),
		MimeType:     &persistedMime,
		FileType:     "AUDIO",
		StorageType:  "LOCAL",
	}
	sqlDB := sqlx.NewDb(db, "sqlmock")
	mediaSvc := NewMediaService(
		repository.NewMediaRepo(sqlDB),
		musicMetadataStorage{data: payload, mimeType: "application/octet-stream"},
		nil,
		"",
	)
	svc := NewMusicService(repository.NewMusicRepo(sqlDB), mediaSvc)

	mock.ExpectQuery(regexp.QuoteMeta(`FROM media_files mf`)).
		WithArgs(int64(37)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "original_name", "file_url", "file_size", "mime_type", "file_type",
			"folder_id", "deleted", "thumbnail_url", "mapped_track_id", "mapped_title",
		}).AddRow(
			media.ID, media.OriginalName, media.FileURL, media.FileSize, media.MimeType, media.FileType,
			nil, false, nil, nil, nil,
		))
	mock.ExpectQuery(regexp.QuoteMeta(`FROM media_files WHERE id=$1`)).
		WithArgs(int64(37)).
		WillReturnRows(syncMediaFileRows(media))
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO music_tracks (`)).
		WithArgs(
			int64(37), "假如让我说下去", "杨千嬅", "千嬅盛放", nil, nil,
			nil, "MEDIA_LIBRARY", "ACTIVE", 0, false,
		).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(11)))
	mock.ExpectQuery(regexp.QuoteMeta(`FROM music_tracks t`)).
		WithArgs(int64(11)).
		WillReturnRows(musicTrackRowsWithID(11, 37, "假如让我说下去"))

	track, err := svc.ImportMedia(
		context.Background(),
		dto.MusicImportMediaRequest{MediaFileID: 37},
		"MEDIA_LIBRARY",
	)
	if err != nil {
		t.Fatalf("ImportMedia: %v", err)
	}
	if track == nil || track.Title != "假如让我说下去" {
		t.Fatalf("imported track = %#v", track)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

type musicMetadataStorage struct {
	data     []byte
	mimeType string
}

func (s musicMetadataStorage) Upload(context.Context, string, io.Reader, int64, string) (string, error) {
	return "", errors.New("not implemented")
}

func (s musicMetadataStorage) Delete(context.Context, string) error {
	return errors.New("not implemented")
}

func (s musicMetadataStorage) GetURL(key string) string {
	return "/api/uploads/" + key
}

func (s musicMetadataStorage) Type() string { return "LOCAL" }

func (s musicMetadataStorage) Get(context.Context, string) (io.ReadCloser, int64, string, error) {
	return io.NopCloser(bytes.NewReader(s.data)), int64(len(s.data)), s.mimeType, nil
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

func TestMusicServicePublicPlayerOnlyExposesReadyLyricAssets(t *testing.T) {
	readyLyric := "[00:01.00]已发布的歌词"

	tests := []struct {
		name      string
		status    string
		lyric     *string
		wantLyric string
	}{
		{
			name:      "draft lyric asset stays out of public projection",
			status:    "DRAFT",
			lyric:     nil,
			wantLyric: "",
		},
		{
			name:      "needs review lyric asset stays out of public projection",
			status:    "NEEDS_REVIEW",
			lyric:     nil,
			wantLyric: "",
		},
		{
			name:      "ready lyric asset is exposed",
			status:    "READY",
			lyric:     &readyLyric,
			wantLyric: readyLyric,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, mock, cleanup := newMusicServiceMock(t)
			defer cleanup()
			expectMusicSettings(mock, true)
			mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.id, p.name, p.slug`)).
				WillReturnRows(musicPlaylistRows())
			mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*)`)).
				WithArgs(int64(42)).
				WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
			mock.ExpectQuery(regexp.QuoteMeta(`COALESCE(CASE WHEN ml.status='READY' THEN ml.content ELSE NULL END, t.lyric)`)).
				WithArgs(int64(42), 100, 0).
				WillReturnRows(musicTrackRowsWithLyricAsset(11, 99, "夜航", tt.lyric, tt.status))

			player, err := svc.PublicPlayer(context.Background())
			if err != nil {
				t.Fatalf("PublicPlayer: %v", err)
			}
			if len(player.Tracks) != 1 {
				t.Fatalf("tracks len = %d, want 1", len(player.Tracks))
			}
			if got := derefString(player.Tracks[0].Lyric); got != tt.wantLyric {
				t.Fatalf("Lyric = %q, want %q", got, tt.wantLyric)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet expectations: %v", err)
			}
		})
	}
}

func TestMusicServicePublicPlayerFallsBackToExtractedAudioArtwork(t *testing.T) {
	svc, mock, cleanup := newMusicServiceMock(t)
	defer cleanup()
	thumb := "/api/uploads/thumbnails/audio/2026/07/night-flight.jpg"
	expectMusicSettings(mock, true)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT p.id, p.name, p.slug`)).
		WillReturnRows(musicPlaylistRows())
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*)`)).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT `)).
		WithArgs(int64(42), 100, 0).
		WillReturnRows(musicTrackRowsWithIDAndThumbnail(11, 99, "夜航", &thumb))

	player, err := svc.PublicPlayer(context.Background())
	if err != nil {
		t.Fatalf("PublicPlayer: %v", err)
	}
	if len(player.Tracks) != 1 {
		t.Fatalf("tracks len = %d, want 1", len(player.Tracks))
	}
	if got := player.Tracks[0].CoverURL; got != thumb {
		t.Fatalf("CoverURL = %q, want extracted thumbnail %q", got, thumb)
	}
	if got := player.Tracks[0].Media.ThumbnailURL; got != thumb {
		t.Fatalf("Media.ThumbnailURL = %q, want %q", got, thumb)
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
