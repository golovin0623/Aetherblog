package storage

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalListTraversal(t *testing.T) {
	// Create temp dir
	tmpDir, err := os.MkdirTemp("", "storage-test-")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	storageDir := filepath.Join(tmpDir, "storage")
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		t.Fatalf("failed to create storage dir: %v", err)
	}

	// create a file outside storage
	secretPath := filepath.Join(tmpDir, "secret.txt")
	if err := os.WriteFile(secretPath, []byte("secret"), 0644); err != nil {
		t.Fatalf("failed to write secret file: %v", err)
	}

	ls := NewLocalStorage(storageDir, "/uploads")

	// Try to list files outside storage using prefix
	_, _, err = ls.List(context.Background(), "../", "", 10)

	if err == nil {
		t.Errorf("expected error when trying to access directory outside base path, got nil")
	} else if !strings.Contains(err.Error(), "path traversal detected") {
		t.Errorf("expected path traversal error, got: %v", err)
	}
}
