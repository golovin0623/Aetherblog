package service

import (
	"errors"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/model"
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
		name  string
		media *model.MediaFile
		want  bool
	}{
		{
			name: "same provider",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				BackupProviderID:  &primaryID,
				FileURL:           "https://cdn.example.com/a.png",
				BackupURL:         syncTestStringPtr("https://backup.example.com/a.png"),
			},
			want: true,
		},
		{
			name: "same public URL",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				BackupProviderID:  &backupID,
				FileURL:           "https://cdn.example.com/a.png/",
				BackupURL:         syncTestStringPtr("https://cdn.example.com/a.png"),
			},
			want: true,
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
			want: true,
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
			want: false,
		},
		{
			name: "no backup provider",
			media: &model.MediaFile{
				StorageProviderID: &primaryID,
				FileURL:           "https://origin.example.com/a.png",
				BackupURL:         syncTestStringPtr("https://origin.example.com/a.png"),
			},
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := backupTargetMatchesPrimary(tc.media); got != tc.want {
				t.Fatalf("backupTargetMatchesPrimary() = %v, want %v", got, tc.want)
			}
		})
	}
}

func syncTestStringPtr(v string) *string { return &v }
