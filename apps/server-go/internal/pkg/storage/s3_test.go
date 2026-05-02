package storage

import (
	"context"
	"strings"
	"testing"
)

// TestS3Storage_TypeReturnsProviderType 验证 Type() 透传 providerType。
// Phase 1 修复:原实现固定返回 "S3",造成 media_files.storage_type 与实际 provider 脱节。
func TestS3Storage_TypeReturnsProviderType(t *testing.T) {
	cfg := `{"bucket":"x","region":"us-east-1","accessKeyId":"k","secretAccessKey":"s"}`
	cases := []struct {
		providerType string
		want         string
	}{
		{"COS", "COS"},
		{"OSS", "OSS"},
		{"R2", "R2"},
		{"MINIO", "MINIO"},
		{"S3", "S3"},
		{"", "S3"}, // 空 → 兜底 S3
	}
	for _, c := range cases {
		var st *S3Storage
		var err error
		if c.providerType == "" {
			st, err = NewS3Storage(cfg)
		} else {
			st, err = NewS3Storage(cfg, c.providerType)
		}
		if err != nil {
			t.Fatalf("NewS3Storage(%q): %v", c.providerType, err)
		}
		if got := st.Type(); got != c.want {
			t.Errorf("providerType=%q Type()=%q want %q", c.providerType, got, c.want)
		}
	}
}

// TestS3Storage_FactoryRoutes 验证 NewFromConfig 把上游类型透传到 Type()。
func TestS3Storage_FactoryRoutes(t *testing.T) {
	cfg := `{"bucket":"x","region":"us-east-1","accessKeyId":"k","secretAccessKey":"s"}`
	cases := []string{"S3", "MINIO", "OSS", "COS", "R2"}
	for _, p := range cases {
		store, err := NewFromConfig(p, cfg)
		if err != nil {
			t.Fatalf("NewFromConfig(%q): %v", p, err)
		}
		if got := store.Type(); got != p {
			t.Errorf("provider %q Type()=%q want %q", p, got, p)
		}
	}
}

// TestS3Storage_FactoryRejectsLocal verifies LOCAL 必须走 NewLocalStorage。
func TestS3Storage_FactoryRejectsLocal(t *testing.T) {
	if _, err := NewFromConfig("LOCAL", `{"basePath":"./uploads"}`); err == nil {
		t.Error("NewFromConfig(LOCAL) should error; LOCAL has its own constructor")
	}
}

// TestValidateS3Key 验证 key 校验拦截畸形值。
func TestValidateS3Key(t *testing.T) {
	cases := []struct {
		key       string
		shouldErr bool
	}{
		{"normal/path/file.jpg", false},
		{"", true},
		{"/leading-slash", true},
		{"contains/../parent", true},
		{strings.Repeat("a", 1025), true},
		{"a/normal-path", false},
	}
	for _, c := range cases {
		err := validateS3Key(c.key)
		if (err != nil) != c.shouldErr {
			t.Errorf("validateS3Key(%q): err=%v shouldErr=%v", c.key, err, c.shouldErr)
		}
	}
}

// TestValidateEndpoint_RejectsPrivate SSRF 防御 (VULN-032)。
func TestValidateEndpoint_RejectsPrivate(t *testing.T) {
	// 跳过非常依赖 DNS 的环境,只测明显的 loopback / 私网
	cases := []struct {
		endpoint  string
		shouldErr bool
	}{
		{"", false}, // 空字符串放行 (走默认 AWS endpoint)
		{"http://127.0.0.1:9000", true},
		{"http://localhost:9000", true},
		{"https://10.0.0.1", true},
		{"https://192.168.1.1", true},
		{"https://169.254.169.254", true}, // IMDS
		{"ftp://example.com", true},        // 非 http(s)
	}
	for _, c := range cases {
		err := validateEndpoint(c.endpoint)
		if (err != nil) != c.shouldErr {
			t.Errorf("validateEndpoint(%q): err=%v shouldErr=%v", c.endpoint, err, c.shouldErr)
		}
	}
}

// TestS3Storage_GetURLPrefersURLPrefix 当配了 CDN/URLPrefix 时,GetURL 优先返回。
func TestS3Storage_GetURLPrefersURLPrefix(t *testing.T) {
	cfg := `{"bucket":"my-bucket","region":"us-east-1","urlPrefix":"https://cdn.example.com"}`
	st, err := NewS3Storage(cfg, "S3")
	if err != nil {
		t.Fatalf("init: %v", err)
	}
	got := st.GetURL("path/to/file.jpg")
	if got != "https://cdn.example.com/path/to/file.jpg" {
		t.Errorf("got %q, want CDN-prefixed URL", got)
	}
}

// TestLocalStorage_ListFiltersByPrefix verifies LOCAL List 走 prefix 过滤 + 分页。
func TestLocalStorage_ListFiltersByPrefix(t *testing.T) {
	dir := t.TempDir()
	store := NewLocalStorage(dir, "/uploads")
	ctx := context.Background()

	// 准备 3 个文件,2 个在 2026/05/ 下
	files := []string{"2026/05/a.jpg", "2026/05/b.jpg", "2025/12/old.png"}
	for _, k := range files {
		if _, err := store.Upload(ctx, k, strings.NewReader("x"), 1, "image/jpeg"); err != nil {
			t.Fatalf("upload %s: %v", k, err)
		}
	}

	objs, _, err := store.List(ctx, "2026/05", "", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(objs) != 2 {
		t.Errorf("expected 2 objects under 2026/05/, got %d: %v", len(objs), objs)
	}
	for _, o := range objs {
		if !strings.HasPrefix(o.Key, "2026/05/") {
			t.Errorf("unexpected key %q outside prefix", o.Key)
		}
	}
}

// TestLocalStorage_GetReturnsContent verifies Storage.Get 接口可用。
func TestLocalStorage_GetReturnsContent(t *testing.T) {
	dir := t.TempDir()
	store := NewLocalStorage(dir, "/uploads")
	ctx := context.Background()

	want := "hello get"
	store.Upload(ctx, "x.txt", strings.NewReader(want), int64(len(want)), "text/plain")

	rc, size, mime, err := store.Get(ctx, "x.txt")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer rc.Close()
	buf := make([]byte, size)
	rc.Read(buf)
	if string(buf) != want {
		t.Errorf("content mismatch: got %q want %q", buf, want)
	}
	_ = mime
}
