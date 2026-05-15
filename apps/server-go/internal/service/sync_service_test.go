package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	storagepkg "github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

func TestIsNotFoundLikeRecognizesLocalMissingFiles(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "not found", err: errors.New("object not found"), want: true},
		{name: "s3 no such key", err: errors.New("NoSuchKey: key missing"), want: true},
		{name: "http 404", err: errors.New("request failed with status 404"), want: true},
		{name: "local file missing", err: errors.New("open uploads/a.png: no such file or directory"), want: true},
		{name: "port number is not status", err: errors.New("dial tcp 127.0.0.1:4040: connect: connection refused"), want: false},
		{name: "opaque 404 is not enough", err: errors.New("upstream 4040 retry budget exhausted after token 404x"), want: false},
		{name: "permission", err: errors.New("permission denied"), want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNotFoundLike(tc.err); got != tc.want {
				t.Fatalf("isNotFoundLike() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestBackupTargetMatchesPrimary(t *testing.T) {
	primaryID := int64(10)
	backupID := int64(20)

	cases := []struct {
		name      string
		media     *model.MediaFile
		backupKey string
		want      bool
	}{
		{
			name: "same provider and same key",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				BackupProviderID:  &primaryID,
				FilePath:          "media/a.png",
				FileURL:           "https://cdn.example.com/a.png",
				BackupURL:         syncTestStringPtr("https://backup.example.com/a.png"),
			},
			backupKey: "media/a.png",
			want:      true,
		},
		{
			name: "same provider but distinct key",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				BackupProviderID:  &primaryID,
				FilePath:          "media/current.png",
				FileURL:           "https://cdn.example.com/current.png",
				BackupURL:         syncTestStringPtr("https://cdn.example.com/backup.png"),
			},
			backupKey: "media/backup.png",
			want:      false,
		},
		{
			name: "same public URL",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				BackupProviderID:  &backupID,
				FileURL:           "https://cdn.example.com/a.png/",
				BackupURL:         syncTestStringPtr("https://cdn.example.com/a.png"),
			},
			backupKey: "backup/a.png",
			want:      true,
		},
		{
			name: "same CDN URL",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				BackupProviderID:  &backupID,
				FileURL:           "https://origin.example.com/a.png",
				CdnURL:            syncTestStringPtr("https://cdn.example.com/a.png"),
				BackupURL:         syncTestStringPtr("https://cdn.example.com/a.png/"),
			},
			backupKey: "backup/a.png",
			want:      true,
		},
		{
			name: "distinct mirror",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				BackupProviderID:  &backupID,
				FileURL:           "https://origin.example.com/a.png",
				CdnURL:            syncTestStringPtr("https://cdn.example.com/a.png"),
				BackupURL:         syncTestStringPtr("https://backup.example.com/a.png"),
			},
			backupKey: "backup/a.png",
			want:      false,
		},
		{
			name: "no backup provider",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				FileURL:           "https://origin.example.com/a.png",
				BackupURL:         syncTestStringPtr("https://origin.example.com/a.png"),
			},
			backupKey: "origin/a.png",
			want:      false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := backupTargetMatchesPrimary(tc.media, tc.backupKey); got != tc.want {
				t.Fatalf("backupTargetMatchesPrimary() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestFinishVerifyLoopRestartsOnlyWhenDesired(t *testing.T) {
	svc := &SyncService{}

	svc.verifyRunning.Store(true)
	svc.verifyDesired.Store(false)
	if restart := svc.finishVerifyLoop(); restart {
		t.Fatal("finishVerifyLoop should not restart after explicit stop")
	}
	if svc.verifyRunning.Load() {
		t.Fatal("finishVerifyLoop should clear running flag")
	}

	svc.verifyRunning.Store(true)
	svc.verifyDesired.Store(true)
	if restart := svc.finishVerifyLoop(); !restart {
		t.Fatal("finishVerifyLoop should request restart when enable wins the shutdown race")
	}
	if svc.verifyRunning.Load() {
		t.Fatal("finishVerifyLoop should clear running flag before restart")
	}
}

func TestSyncStatusSnapshotJSONUsesLowerCamelCaseCounts(t *testing.T) {
	snapshot := SyncStatusSnapshot{
		Running: true,
		Counts: repository.SyncStatusCounts{
			Pending:   1,
			Running:   2,
			Succeeded: 3,
			Failed:    4,
		},
		UpdatedAt: time.Unix(1700000000, 0),
	}

	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	counts, ok := got["counts"].(map[string]any)
	if !ok {
		t.Fatalf("counts missing or wrong type: %#v", got["counts"])
	}

	for _, key := range []string{"pending", "running", "succeeded", "failed"} {
		if _, ok := counts[key]; !ok {
			t.Fatalf("counts.%s missing in JSON: %s", key, string(raw))
		}
	}
	for _, key := range []string{"Pending", "Running", "Succeeded", "Failed"} {
		if _, ok := counts[key]; ok {
			t.Fatalf("counts should not expose Go field %q in JSON: %s", key, string(raw))
		}
	}
}

func TestRemoveBackupReturnsForceableFailureWhenRemoteDeleteFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mediaID := int64(7)
	backupProviderID := int64(20)
	backupURL := "https://backup.example.com/original/a.png"
	mock.ExpectQuery(`SELECT .* FROM media_files WHERE id=\$1`).
		WithArgs(mediaID).
		WillReturnRows(syncMediaFileRows(model.MediaFile{
			ID:               mediaID,
			Filename:         "a.png",
			OriginalName:     "a.png",
			FilePath:         "current/a.png",
			FileURL:          "/api/uploads/current/a.png",
			FileType:         "IMAGE",
			StorageType:      "LOCAL",
			SyncStatus:       "SYNCED",
			BackupProviderID: &backupProviderID,
			BackupURL:        &backupURL,
		}))

	repo := repository.NewMediaRepo(sqlx.NewDb(db, "sqlmock"))
	store := &failingBackupStore{key: "original/a.png", deleteErr: errors.New("AccessDenied: object cannot be deleted")}
	svc := &SyncService{
		mediaRepo: repo,
		mediaSvc:  NewMediaService(repo, store, nil, ""),
	}

	err = svc.RemoveBackup(context.Background(), mediaID, false)
	var failure *BackupRemoveFailure
	if !errors.As(err, &failure) {
		t.Fatalf("RemoveBackup error = %v, want BackupRemoveFailure", err)
	}
	if !failure.ForceAllowed {
		t.Fatal("BackupRemoveFailure should allow force cleanup")
	}
	if failure.Stage != "delete_remote" {
		t.Fatalf("failure stage = %q, want delete_remote", failure.Stage)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestRemoveBackupForceClearsCatalogWhenRemoteDeleteFails(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mediaID := int64(7)
	backupProviderID := int64(20)
	backupURL := "https://backup.example.com/original/a.png"
	mock.ExpectQuery(`SELECT .* FROM media_files WHERE id=\$1`).
		WithArgs(mediaID).
		WillReturnRows(syncMediaFileRows(model.MediaFile{
			ID:               mediaID,
			Filename:         "a.png",
			OriginalName:     "a.png",
			FilePath:         "current/a.png",
			FileURL:          "/api/uploads/current/a.png",
			FileType:         "IMAGE",
			StorageType:      "LOCAL",
			SyncStatus:       "SYNCED",
			BackupProviderID: &backupProviderID,
			BackupURL:        &backupURL,
		}))
	mock.ExpectExec(regexp.QuoteMeta(`
		UPDATE media_files
		SET sync_status='NONE',
		    backup_provider_id=NULL,
		    backup_url=NULL,
		    backup_at=NULL,
		    backup_error=NULL,
		    last_verified_at=NULL
		WHERE id=$1`)).
		WithArgs(mediaID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	repo := repository.NewMediaRepo(sqlx.NewDb(db, "sqlmock"))
	store := &failingBackupStore{key: "original/a.png", deleteErr: errors.New("AccessDenied: object cannot be deleted")}
	svc := &SyncService{
		mediaRepo: repo,
		mediaSvc:  NewMediaService(repo, store, nil, ""),
	}

	if err := svc.RemoveBackup(context.Background(), mediaID, true); err != nil {
		t.Fatalf("RemoveBackup(force): %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestBackupStorageKeyUsesPersistedBackupURL(t *testing.T) {
	store := storagepkg.NewLocalStorage(t.TempDir(), "/uploads")
	got, err := backupStorageKey(store, "current/new.png", syncTestStringPtr("/uploads/original/backup.png"))
	if err != nil {
		t.Fatalf("backupStorageKey: %v", err)
	}
	if got != "original/backup.png" {
		t.Fatalf("backupStorageKey() = %q, want original/backup.png", got)
	}
}

func syncTestStringPtr(v string) *string { return &v }

type failingBackupStore struct {
	key       string
	keyErr    error
	deleteErr error
}

func (s *failingBackupStore) Upload(context.Context, string, io.Reader, int64, string) (string, error) {
	return "", errors.New("not implemented")
}

func (s *failingBackupStore) Delete(_ context.Context, key string) error {
	if key != s.key {
		return errors.New("unexpected delete key: " + key)
	}
	return s.deleteErr
}

func (s *failingBackupStore) GetURL(key string) string { return "https://backup.example.com/" + key }

func (s *failingBackupStore) Type() string { return "COS" }

func (s *failingBackupStore) Get(context.Context, string) (io.ReadCloser, int64, string, error) {
	return nil, 0, "", errors.New("not implemented")
}

func (s *failingBackupStore) KeyFromURL(string) (string, error) {
	if s.keyErr != nil {
		return "", s.keyErr
	}
	return s.key, nil
}

func syncMediaFileRows(m model.MediaFile) *sqlmock.Rows {
	createdAt := time.Unix(1700000000, 0)
	if m.CreatedAt == nil {
		m.CreatedAt = &createdAt
	}
	if m.CurrentVersion == 0 {
		m.CurrentVersion = 1
	}
	return sqlmock.NewRows([]string{
		"id", "filename", "original_name", "file_path", "file_url", "file_size", "mime_type", "file_type",
		"storage_type", "width", "height", "alt_text", "uploader_id", "created_at", "folder_id",
		"storage_provider_id", "cdn_url", "blurhash", "current_version", "is_archived", "archived_at", "archived_by", "deleted", "deleted_at",
		"sync_status", "backup_provider_id", "backup_url", "backup_at", "backup_error", "last_verified_at",
	}).AddRow(
		m.ID, m.Filename, m.OriginalName, m.FilePath, m.FileURL, m.FileSize, m.MimeType, m.FileType,
		m.StorageType, m.Width, m.Height, m.AltText, m.UploaderID, m.CreatedAt, m.FolderID,
		m.StorageProviderID, m.CdnURL, m.Blurhash, m.CurrentVersion, m.IsArchived, m.ArchivedAt, m.ArchivedBy, m.Deleted, m.DeletedAt,
		m.SyncStatus, m.BackupProviderID, m.BackupURL, m.BackupAt, m.BackupError, m.LastVerifiedAt,
	)
}
