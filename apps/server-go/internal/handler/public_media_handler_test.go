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
