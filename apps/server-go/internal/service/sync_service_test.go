package service

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

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
