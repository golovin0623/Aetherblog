// Package storage 中的工厂函数，根据存储提供商类型和配置 JSON 创建对应的 Storage 实现。
package storage

import (
	"fmt"
	"strings"
)

// NewFromConfig 根据提供商类型标识符和配置 JSON 字符串创建对应的 Storage 实现。
//
// 支持的 providerType（不区分大小写）：
//   - "S3" / "MINIO" / "R2" / "COS" / "OSS"：创建 S3 兼容存储实例
//   - "LOCAL"：本地存储不支持通过本函数创建，需使用 NewLocalStorage 直接构造
//
// 若 providerType 不受支持，则返回错误。
func NewFromConfig(providerType, configJSON string) (Storage, error) {
	switch strings.ToUpper(providerType) {
	case "LOCAL":
		// 本地存储需要在 server.go 中通过 basePath/baseURL 参数直接构造，
		// 不支持通过通用工厂方法创建
		return nil, fmt.Errorf("local storage must be created with NewLocalStorage")
	case "S3", "MINIO", "R2", "COS", "OSS":
		// S3 兼容存储（包括 MinIO、Cloudflare R2、腾讯 COS、阿里 OSS）
		return NewS3Storage(configJSON)
	default:
		return nil, fmt.Errorf("unsupported storage provider type: %s", providerType)
	}
}
