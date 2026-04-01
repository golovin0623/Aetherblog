package storage

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestLocalStorage_UploadAndDelete 测试本地存储的完整上传与删除流程：
// 上传文件后验证 URL 正确、文件内容一致，删除后验证文件已不存在。
func TestLocalStorage_UploadAndDelete(t *testing.T) {
	// 使用测试临时目录，测试结束后自动清理
	dir := t.TempDir()
	store := NewLocalStorage(dir, "/uploads")

	ctx := context.Background()

	// 上传阶段：写入文本内容
	content := "hello world"
	url, err := store.Upload(ctx, "2026/test.txt", strings.NewReader(content), int64(len(content)), "text/plain")
	if err != nil {
		t.Fatalf("Upload 失败: %v", err)
	}
	// 验证返回的访问 URL 格式是否正确
	if url != "/uploads/2026/test.txt" {
		t.Errorf("返回 URL 不符合预期: %s", url)
	}

	// 验证阶段：确认文件已写入磁盘且内容正确
	data, err := os.ReadFile(filepath.Join(dir, "2026/test.txt"))
	if err != nil {
		t.Fatalf("文件未找到: %v", err)
	}
	if string(data) != content {
		t.Errorf("文件内容不匹配: 实际 %q, 期望 %q", string(data), content)
	}

	// 删除阶段：删除已上传的文件
	if err := store.Delete(ctx, "2026/test.txt"); err != nil {
		t.Fatalf("Delete 失败: %v", err)
	}

	// 验证文件已被删除
	if _, err := os.Stat(filepath.Join(dir, "2026/test.txt")); !os.IsNotExist(err) {
		t.Error("文件应已被删除，但仍然存在")
	}
}

// TestLocalStorage_GetURL 测试 GetURL 是否能够正确拼接 baseURL 和 key。
func TestLocalStorage_GetURL(t *testing.T) {
	store := NewLocalStorage("/data", "/api/uploads")
	if got := store.GetURL("img/photo.jpg"); got != "/api/uploads/img/photo.jpg" {
		t.Errorf("GetURL = %q, 期望值为 /api/uploads/img/photo.jpg", got)
	}
}

// TestLocalStorage_Type 测试 Type 方法是否返回正确的存储类型标识符。
func TestLocalStorage_Type(t *testing.T) {
	store := NewLocalStorage("/data", "/uploads")
	if got := store.Type(); got != "LOCAL" {
		t.Errorf("Type = %q, 期望值为 LOCAL", got)
	}
}

// TestLocalStorage_DeleteNonExistent 测试删除不存在的文件时不应返回错误（幂等性验证）。
func TestLocalStorage_DeleteNonExistent(t *testing.T) {
	store := NewLocalStorage(t.TempDir(), "/uploads")
	// 删除不存在的文件应静默成功，不报错
	if err := store.Delete(context.Background(), "nonexistent.txt"); err != nil {
		t.Errorf("删除不存在的文件不应报错，但返回了: %v", err)
	}
}

// TestLocalStorage_PathTraversal 测试路径穿越漏洞防御。
func TestLocalStorage_PathTraversal(t *testing.T) {
	dir := t.TempDir()
	store := NewLocalStorage(dir, "/uploads")
	ctx := context.Background()

	// 构造会导致路径穿越的恶意的 key
	maliciousKeys := []string{
		"../../../etc/passwd",
		"../test.txt",
	}

	for _, key := range maliciousKeys {
		// 测试 Upload 方法
		_, err := store.Upload(ctx, key, strings.NewReader("hack"), 4, "text/plain")
		if err == nil {
			t.Errorf("Upload 方法未能阻止路径穿越: %s", key)
		} else if !strings.Contains(err.Error(), "path traversal detected") {
			t.Errorf("Upload 方法返回了意外错误: %v, 预期包含 'path traversal detected'", err)
		}

		// 测试 Delete 方法
		err = store.Delete(ctx, key)
		if err == nil {
			t.Errorf("Delete 方法未能阻止路径穿越: %s", key)
		} else if !strings.Contains(err.Error(), "path traversal detected") {
			t.Errorf("Delete 方法返回了意外错误: %v, 预期包含 'path traversal detected'", err)
		}
	}
}
