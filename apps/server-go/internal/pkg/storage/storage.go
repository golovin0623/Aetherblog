// Package storage 定义文件存储后端的统一接口，
// 支持本地文件系统（LOCAL）和 S3 兼容对象存储（S3/MinIO/R2/COS/OSS）等多种实现。
package storage

import (
	"context"
	"io"
)

// Storage 是文件存储后端的抽象接口，所有存储实现必须满足该接口。
type Storage interface {
	// Upload 将 reader 中的内容以给定 key（相对路径）保存到存储后端。
	// size 为内容字节数，mimeType 为文件的 MIME 类型。
	// 成功时返回文件的公开访问 URL。
	Upload(ctx context.Context, key string, r io.Reader, size int64, mimeType string) (url string, err error)

	// Delete 删除存储后端中指定 key 对应的文件。
	Delete(ctx context.Context, key string) error

	// GetURL 返回指定 key 对应文件的公开访问 URL。
	GetURL(key string) string

	// Type 返回存储类型标识符（如 LOCAL、S3、MINIO 等）。
	Type() string
}
