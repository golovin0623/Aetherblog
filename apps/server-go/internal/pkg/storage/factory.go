package storage

import (
	"fmt"
	"strings"
)

// NewFromConfig creates a Storage implementation based on provider type and config JSON.
func NewFromConfig(providerType, configJSON string) (Storage, error) {
	switch strings.ToUpper(providerType) {
	case "LOCAL":
		// Local storage is created directly with basePath/baseURL in server.go
		return nil, fmt.Errorf("local storage must be created with NewLocalStorage")
	case "S3", "MINIO", "R2", "COS", "OSS":
		return NewS3Storage(configJSON)
	default:
		return nil, fmt.Errorf("unsupported storage provider type: %s", providerType)
	}
}
