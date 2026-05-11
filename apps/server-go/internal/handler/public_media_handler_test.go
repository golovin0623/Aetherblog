package handler

import (
	"path/filepath"
	"testing"
)

func TestSafeUploadFilePathRejectsTraversal(t *testing.T) {
	base := t.TempDir()
	for _, key := range []string{"../secret.txt", "../../secret.txt", "nested/../../../secret.txt"} {
		t.Run(key, func(t *testing.T) {
			if _, err := safeUploadFilePath(base, key); err == nil {
				t.Fatalf("safeUploadFilePath(%q) should reject traversal", key)
			}
		})
	}
}

func TestSafeUploadFilePathAcceptsNestedKeys(t *testing.T) {
	base := t.TempDir()
	got, err := safeUploadFilePath(base, "2026/05/a.png")
	if err != nil {
		t.Fatalf("safeUploadFilePath: %v", err)
	}
	want := filepath.Join(base, "2026", "05", "a.png")
	if got != want {
		t.Fatalf("safeUploadFilePath() = %q, want %q", got, want)
	}
}

func TestUploadAccessHandlerPointsToUploadsKey(t *testing.T) {
	handler := NewUploadAccessHandler(nil, t.TempDir())
	key := "2026/05/a.png"

	tests := []struct {
		name   string
		target string
		want   bool
	}{
		{
			name:   "api uploads path",
			target: "/api/uploads/2026/05/a.png",
			want:   true,
		},
		{
			name:   "absolute api uploads url",
			target: "https://blog.example.com/api/uploads/2026/05/a.png",
			want:   true,
		},
		{
			name:   "absolute api uploads url with query",
			target: "https://blog.example.com/api/uploads/2026/05/a.png?download=1",
			want:   true,
		},
		{
			name:   "legacy uploads path",
			target: "/uploads/2026/05/a.png",
			want:   true,
		},
		{
			name:   "object storage url",
			target: "https://cdn.example.com/media/2026/05/a.png",
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := handler.pointsToUploadsKey(tt.target, key)
			if got != tt.want {
				t.Fatalf("pointsToUploadsKey(%q, %q) = %v, want %v", tt.target, key, got, tt.want)
			}
		})
	}
}
