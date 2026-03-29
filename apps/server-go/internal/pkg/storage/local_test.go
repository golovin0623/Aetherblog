package storage

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalStorage_UploadAndDelete(t *testing.T) {
	dir := t.TempDir()
	store := NewLocalStorage(dir, "/uploads")

	ctx := context.Background()

	// Upload
	content := "hello world"
	url, err := store.Upload(ctx, "2026/test.txt", strings.NewReader(content), int64(len(content)), "text/plain")
	if err != nil {
		t.Fatalf("Upload failed: %v", err)
	}
	if url != "/uploads/2026/test.txt" {
		t.Errorf("unexpected URL: %s", url)
	}

	// Verify file exists
	data, err := os.ReadFile(filepath.Join(dir, "2026/test.txt"))
	if err != nil {
		t.Fatalf("file not found: %v", err)
	}
	if string(data) != content {
		t.Errorf("file content mismatch: got %q, want %q", string(data), content)
	}

	// Delete
	if err := store.Delete(ctx, "2026/test.txt"); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify deleted
	if _, err := os.Stat(filepath.Join(dir, "2026/test.txt")); !os.IsNotExist(err) {
		t.Error("file should be deleted")
	}
}

func TestLocalStorage_GetURL(t *testing.T) {
	store := NewLocalStorage("/data", "/api/uploads")
	if got := store.GetURL("img/photo.jpg"); got != "/api/uploads/img/photo.jpg" {
		t.Errorf("GetURL = %q, want /api/uploads/img/photo.jpg", got)
	}
}

func TestLocalStorage_Type(t *testing.T) {
	store := NewLocalStorage("/data", "/uploads")
	if got := store.Type(); got != "LOCAL" {
		t.Errorf("Type = %q, want LOCAL", got)
	}
}

func TestLocalStorage_DeleteNonExistent(t *testing.T) {
	store := NewLocalStorage(t.TempDir(), "/uploads")
	// Should not error when file doesn't exist
	if err := store.Delete(context.Background(), "nonexistent.txt"); err != nil {
		t.Errorf("Delete non-existent should not error: %v", err)
	}
}
