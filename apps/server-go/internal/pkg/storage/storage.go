package storage

import (
	"context"
	"io"
)

// Storage is the abstraction for file storage backends.
type Storage interface {
	// Upload saves the reader content under the given key (relative path).
	// Returns the public URL of the uploaded file.
	Upload(ctx context.Context, key string, r io.Reader, size int64, mimeType string) (url string, err error)

	// Delete removes the file at the given key.
	Delete(ctx context.Context, key string) error

	// GetURL returns the public URL for the given key.
	GetURL(key string) string

	// Type returns the storage type identifier (LOCAL, MINIO, S3, etc.)
	Type() string
}
