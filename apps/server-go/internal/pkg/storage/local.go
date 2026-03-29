package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// LocalStorage stores files on the local filesystem.
type LocalStorage struct {
	basePath string // absolute path to uploads directory
	baseURL  string // URL prefix for serving files (e.g., "/api/uploads")
}

func NewLocalStorage(basePath, baseURL string) *LocalStorage {
	return &LocalStorage{basePath: basePath, baseURL: baseURL}
}

func (s *LocalStorage) Upload(ctx context.Context, key string, r io.Reader, _ int64, _ string) (string, error) {
	dest := filepath.Join(s.basePath, key)
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return "", fmt.Errorf("create dir: %w", err)
	}
	f, err := os.Create(dest)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}
	return s.GetURL(key), nil
}

func (s *LocalStorage) Delete(_ context.Context, key string) error {
	path := filepath.Join(s.basePath, key)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *LocalStorage) GetURL(key string) string {
	return s.baseURL + "/" + key
}

func (s *LocalStorage) Type() string { return "LOCAL" }
