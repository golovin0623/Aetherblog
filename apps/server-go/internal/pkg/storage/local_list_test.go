package storage

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalListTraversal(t *testing.T) {
	// 创建临时目录
	tmpDir, err := os.MkdirTemp("", "storage-test-")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	storageDir := filepath.Join(tmpDir, "storage")
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		t.Fatalf("failed to create storage dir: %v", err)
	}

	// 在存储之外创建文件
	secretPath := filepath.Join(tmpDir, "secret.txt")
	if err := os.WriteFile(secretPath, []byte("secret"), 0644); err != nil {
		t.Fatalf("failed to write secret file: %v", err)
	}

	ls := NewLocalStorage(storageDir, "/uploads")

	// 尝试使用前缀列出存储外部的文件
	_, _, err = ls.List(context.Background(), "../", "", 10)

	if err == nil {
		t.Errorf("expected error when trying to access directory outside base path, got nil")
	} else if !strings.Contains(err.Error(), "path traversal detected") {
		t.Errorf("expected path traversal error, got: %v", err)
	}
}
