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

	// Get 读取指定 key 的对象内容,返回 ReadCloser、字节数和 MIME 类型。
	// 调用方负责 Close 返回的 reader。
	// 用于 Phase 4 同步备份(本地读 → 云端写)和 Phase 5 反向导入。
	Get(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
}

// ObjectInfo 描述单个对象的轻量元数据(供 List 使用)。
// @ref 对象存储 rollout - Phase 5
type ObjectInfo struct {
	Key          string
	Size         int64
	LastModified string // RFC3339;不直接用 time.Time 避免跨 provider 时区差异
	ETag         string
	ContentType  string
}

// Lister 是 Storage 的可选扩展接口,实现"列出 bucket 下指定 prefix 的对象"。
// 不是所有 Storage 都强制要求实现 List(LOCAL 兜底实现, S3 系实现);故拆出来方便接口分层。
//
// nextToken 用于分页;首次调用传空字符串,后续传上一次返回的 token,直到返回 ""。
type Lister interface {
	List(ctx context.Context, prefix, continuationToken string, limit int) (objects []ObjectInfo, nextToken string, err error)
}

// Existser 是 Storage 的可选扩展接口,用于 Phase 5 的"备份完整性校验"。
// 返回值:
//
//	exists=true, err=nil  → 对象存在
//	exists=false, err=nil → 对象 *确认* 不存在(404 / NoSuchKey)
//	err != nil            → 瞬时错误(网络 / 5xx / 凭据失效),caller 应跳过本轮不改状态
//
// 区分"确认不存在"与"瞬时错误"是关键 —— 否则一次网络抖动就会把整批 SYNCED 错标 MISSING。
type Existser interface {
	Exists(ctx context.Context, key string) (exists bool, err error)
}
