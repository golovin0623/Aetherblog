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

// Get 读取本地文件,返回 ReadCloser + 文件大小 + MIME 类型。
// MIME 类型按扩展名启发(LOCAL 不存元数据,只能这么算)。
func (s *LocalStorage) Get(_ context.Context, key string) (io.ReadCloser, int64, string, error) {
	path, err := getSafePath(s.basePath, key)
	if err != nil {
		return nil, 0, "", fmt.Errorf("get safe path: %w", err)
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, "", err
	}
	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, 0, "", err
	}
	mime := guessMimeFromExt(filepath.Ext(key))
	return f, stat.Size(), mime, nil
}

// List 走 filepath.WalkDir 列出 prefix 下文件。token 表示上次扫描结束位置(此处用 lexicographic 起点)。
// 大目录不建议长时间用 LOCAL List;Phase 5 主要面向 S3 兼容存储,LOCAL 仅作完整性兜底。
func (s *LocalStorage) List(_ context.Context, prefix, continuationToken string, limit int) ([]ObjectInfo, string, error) {
	if limit <= 0 {
		limit = 100
	}
	root := s.basePath
	if prefix != "" {
		root = filepath.Join(s.basePath, prefix)
	}
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return nil, "", nil
		}
		return nil, "", err
	}

	var (
		objects = make([]ObjectInfo, 0, limit)
		nextTok string
		started = continuationToken == ""
	)
	walkErr := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, rerr := filepath.Rel(s.basePath, p)
		if rerr != nil {
			return nil
		}
		key := filepath.ToSlash(rel)
		if !started {
			if key == continuationToken {
				started = true
			}
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		objects = append(objects, ObjectInfo{
			Key:          key,
			Size:         info.Size(),
			LastModified: info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
		})
		if len(objects) >= limit {
			nextTok = key
			return filepath.SkipAll
		}
		return nil
	})
	if walkErr != nil && walkErr != filepath.SkipAll {
		return nil, "", walkErr
	}
	return objects, nextTok, nil
}

// guessMimeFromExt 是 LOCAL 后端 Get 的辅助函数 — 不依赖 net/http(避免循环依赖)。
func guessMimeFromExt(ext string) string {
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".pdf":
		return "application/pdf"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	default:
		return "application/octet-stream"
	}
}
