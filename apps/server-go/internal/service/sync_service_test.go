package service

import (
	"errors"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/model"
	storagepkg "github.com/golovin0623/aetherblog-server/internal/pkg/storage"
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
