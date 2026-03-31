package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// LocalStorage 是基于本地文件系统的存储实现，将上传文件保存到指定目录。
type LocalStorage struct {
	basePath string // 上传目录的绝对路径
	baseURL  string // 文件访问的 URL 前缀（例如 "/api/uploads"）
}

// NewLocalStorage 创建一个新的 LocalStorage 实例。
// basePath 为本地存储根目录的绝对路径，baseURL 为对应的 URL 访问前缀。
func NewLocalStorage(basePath, baseURL string) *LocalStorage {
	return &LocalStorage{basePath: basePath, baseURL: baseURL}
}

// getSafePath 根据 basePath 和 key 拼接并验证绝对路径，防止路径穿越攻击（Path Traversal）。
func getSafePath(basePath, key string) (string, error) {
	dest := filepath.Join(basePath, key)
	absBase, err := filepath.Abs(basePath)
	if err != nil {
		return "", fmt.Errorf("resolve base path: %w", err)
	}
	absDest, err := filepath.Abs(dest)
	if err != nil {
		return "", fmt.Errorf("resolve dest path: %w", err)
	}

	// 验证最终路径是否在基础路径下
	rel, err := filepath.Rel(absBase, absDest)
	if err != nil {
		return "", fmt.Errorf("rel path: %w", err)
	}

	// 如果相对路径以 ".." 开头，或者是 ".."，说明跳出了 basePath
	if rel == ".." || (len(rel) >= 3 && rel[:3] == ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid path: path traversal detected")
	}

	return absDest, nil
}

// Upload 将 reader 中的内容保存到本地文件系统的 basePath/key 路径下。
// 目标目录不存在时会自动递归创建。
// 成功时返回文件的公开访问 URL。
func (s *LocalStorage) Upload(ctx context.Context, key string, r io.Reader, _ int64, _ string) (string, error) {
	// 验证目标文件的完整路径，防止路径穿越
	dest, err := getSafePath(s.basePath, key)
	if err != nil {
		return "", fmt.Errorf("get safe path: %w", err)
	}

	// 确保目标目录存在，权限为 0755
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return "", fmt.Errorf("create dir: %w", err)
	}
	// 创建目标文件
	f, err := os.Create(dest)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer f.Close()
	// 将 reader 数据流写入目标文件
	if _, err := io.Copy(f, r); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}
	return s.GetURL(key), nil
}

// Delete 删除本地文件系统中指定 key 对应的文件。
// 若文件不存在，则静默忽略错误（幂等删除）。
func (s *LocalStorage) Delete(_ context.Context, key string) error {
	path, err := getSafePath(s.basePath, key)
	if err != nil {
		return fmt.Errorf("get safe path: %w", err)
	}

	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// GetURL 根据 key 拼接并返回文件的公开访问 URL。
func (s *LocalStorage) GetURL(key string) string {
	return s.baseURL + "/" + key
}

// Type 返回存储类型标识符 "LOCAL"。
func (s *LocalStorage) Type() string { return "LOCAL" }
