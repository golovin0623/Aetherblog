package storage

import (
	"context"
	"strings"
	"testing"
)

// TestS3Storage_TypeReturnsProviderType 验证 Type() 透传 providerType。
// Phase 1 修复:原实现固定返回 "S3",造成 media_files.storage_type 与实际 provider 脱节。
func TestS3Storage_TypeReturnsProviderType(t *testing.T) {
	cases := []struct {
		providerType string
		cfg          string
		want         string
	}{
		{"COS", `{"bucket":"x","region":"ap-shanghai","accessKeyId":"k","secretAccessKey":"s"}`, "COS"},
		{"OSS", `{"bucket":"x","region":"cn-shanghai","accessKeyId":"k","secretAccessKey":"s"}`, "OSS"},
		{"R2", `{"bucket":"x","region":"auto","endpoint":"https://1234567890abcdef1234567890abcdef.r2.cloudflarestorage.com","accessKeyId":"k","secretAccessKey":"s"}`, "R2"},
		// 用公网 IP 字面量,避免 net.LookupIP 在离线 CI 触发真实 DNS 查询。
		{"MINIO", `{"bucket":"x","region":"us-east-1","endpoint":"https://example.com","allowPrivateEndpoint":true,"accessKeyId":"k","secretAccessKey":"s"}`, "MINIO"},
		{"S3", `{"bucket":"x","region":"us-east-1","accessKeyId":"k","secretAccessKey":"s"}`, "S3"},
		{"", `{"bucket":"x","region":"us-east-1","accessKeyId":"k","secretAccessKey":"s"}`, "S3"}, // 空 → 兜底 S3
	}
	for _, c := range cases {
		var st *S3Storage
		var err error
		if c.providerType == "" {
			st, err = NewS3Storage(c.cfg)
		} else {
			st, err = NewS3Storage(c.cfg, c.providerType)
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
	cases := map[string]string{
		"S3":    `{"bucket":"x","region":"us-east-1","accessKeyId":"k","secretAccessKey":"s"}`,
		"MINIO": `{"bucket":"x","region":"us-east-1","endpoint":"https://example.com","allowPrivateEndpoint":true,"accessKeyId":"k","secretAccessKey":"s"}`,
		"OSS":   `{"bucket":"x","region":"cn-shanghai","accessKeyId":"k","secretAccessKey":"s"}`,
		"COS":   `{"bucket":"x","region":"ap-shanghai","accessKeyId":"k","secretAccessKey":"s"}`,
		"R2":    `{"bucket":"x","region":"auto","endpoint":"https://1234567890abcdef1234567890abcdef.r2.cloudflarestorage.com","accessKeyId":"k","secretAccessKey":"s"}`,
	}
	for p, cfg := range cases {
		store, err := NewFromConfig(p, cfg)
		if err != nil {
			t.Fatalf("NewFromConfig(%q): %v", p, err)
		}
		if got := store.Type(); got != p {
			t.Errorf("provider %q Type()=%q want %q", p, got, p)
		}
	}
}

// TestS3Storage_DefaultEndpointsForCloudProviders 验证 COS/OSS 留空 endpoint 时
// 后端会按 provider + region 生成厂商域名,而不是落到 AWS 默认 S3 域名。
func TestS3Storage_DefaultEndpointsForCloudProviders(t *testing.T) {
	cases := []struct {
		name         string
		providerType string
		cfg          string
		wantEndpoint string
		wantURL      string
	}{
		{
			name:         "cos",
			providerType: "COS",
			cfg:          `{"bucket":"example-bucket","region":"ap-shanghai","accessKeyId":"k","secretAccessKey":"s"}`,
			wantEndpoint: "https://cos.ap-shanghai.myqcloud.com",
			wantURL:      "https://example-bucket.cos.ap-shanghai.myqcloud.com/2026/05/a.jpg",
		},
		{
			name:         "oss",
			providerType: "OSS",
			cfg:          `{"bucket":"my-bucket","region":"cn-shanghai","accessKeyId":"k","secretAccessKey":"s"}`,
			wantEndpoint: "https://oss-cn-shanghai.aliyuncs.com",
			wantURL:      "https://my-bucket.oss-cn-shanghai.aliyuncs.com/2026/05/a.jpg",
		},
		{
			name:         "oss endpoint-style region",
			providerType: "OSS",
			cfg:          `{"bucket":"my-bucket","region":"oss-cn-hangzhou","accessKeyId":"k","secretAccessKey":"s"}`,
			wantEndpoint: "https://oss-cn-hangzhou.aliyuncs.com",
			wantURL:      "https://my-bucket.oss-cn-hangzhou.aliyuncs.com/2026/05/a.jpg",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st, err := NewS3Storage(c.cfg, c.providerType)
			if err != nil {
				t.Fatalf("NewS3Storage(%q): %v", c.providerType, err)
			}
			if st.cfg.Endpoint != c.wantEndpoint {
				t.Errorf("endpoint=%q want %q", st.cfg.Endpoint, c.wantEndpoint)
			}
			if got := st.GetURL("2026/05/a.jpg"); got != c.wantURL {
				t.Errorf("GetURL()=%q want %q", got, c.wantURL)
			}
		})
	}
}

func TestS3Storage_ImageHostCustomURLPathAndOptions(t *testing.T) {
	cfg := `{
		"bucket":"example-bucket",
		"region":"ap-shanghai",
		"path":"assets/",
		"customUrl":"https://cdn.example.com",
		"options":"?variant=public",
		"accessKeyId":"k",
		"secretAccessKey":"s"
	}`
	st, err := NewS3Storage(cfg, "COS")
	if err != nil {
		t.Fatalf("NewS3Storage(COS): %v", err)
	}
	objectKey, err := st.objectKey("sample.image.png")
	if err != nil {
		t.Fatalf("objectKey: %v", err)
	}
	if objectKey != "assets/sample.image.png" {
		t.Fatalf("objectKey=%q", objectKey)
	}
	got := st.GetURL("sample.image.png")
	want := "https://cdn.example.com/assets/sample.image.png?variant=public"
	if got != want {
		t.Fatalf("GetURL()=%q want %q", got, want)
	}
}

func TestS3Storage_CustomURLPreservesExistingQuery(t *testing.T) {
	cfg := `{
		"bucket":"example-bucket",
		"region":"ap-shanghai",
		"path":"assets/",
		"customUrl":"https://cdn.example.com/static?token=abc",
		"options":"?variant=public",
		"accessKeyId":"k",
		"secretAccessKey":"s"
	}`
	st, err := NewS3Storage(cfg, "COS")
	if err != nil {
		t.Fatalf("NewS3Storage(COS): %v", err)
	}
	got := st.GetURL("a.png")
	want := "https://cdn.example.com/static/assets/a.png?token=abc&variant=public"
	if got != want {
		t.Fatalf("GetURL()=%q want %q", got, want)
	}
}

func TestS3Storage_PathPrefixIsTransparentForListingKeys(t *testing.T) {
	cfg := `{"bucket":"b","region":"ap-shanghai","path":"/assets/","accessKeyId":"k","secretAccessKey":"s"}`
	st, err := NewS3Storage(cfg, "COS")
	if err != nil {
		t.Fatalf("NewS3Storage(COS): %v", err)
	}
	if got := st.listPrefix("2026/05"); got != "assets/2026/05" {
		t.Fatalf("listPrefix=%q", got)
	}
	if got := st.externalKey("assets/2026/05/a.png"); got != "2026/05/a.png" {
		t.Fatalf("externalKey=%q", got)
	}
}

func TestS3Storage_ObjectKeyValidatesFinalPrefixedKey(t *testing.T) {
	cfg := `{"bucket":"x","region":"ap-shanghai","path":"` + strings.Repeat("p", 512) + `","accessKeyId":"k","secretAccessKey":"s"}`
	st, err := NewS3Storage(cfg, "COS")
	if err != nil {
		t.Fatalf("NewS3Storage(COS): %v", err)
	}
	if _, err := st.objectKey(strings.Repeat("k", 512)); err == nil {
		t.Fatal("objectKey should reject final key longer than 1024 bytes")
	}
}

func TestS3Storage_ObjectKeyWithPathAcceptsLeadingSlashAfterNormalization(t *testing.T) {
	cfg := `{"bucket":"x","region":"ap-shanghai","path":"assets","accessKeyId":"k","secretAccessKey":"s"}`
	st, err := NewS3Storage(cfg, "COS")
	if err != nil {
		t.Fatalf("NewS3Storage(COS): %v", err)
	}
	got, err := st.objectKey("/a.png")
	if err != nil {
		t.Fatalf("objectKey: %v", err)
	}
	if got != "assets/a.png" {
		t.Fatalf("objectKey=%q", got)
	}
}

func TestS3Storage_RejectsInvalidPathPrefix(t *testing.T) {
	cfg := `{"bucket":"x","region":"ap-shanghai","path":"../img","accessKeyId":"k","secretAccessKey":"s"}`
	if _, err := NewS3Storage(cfg, "COS"); err == nil {
		t.Fatal("NewS3Storage(COS) should reject path traversal prefix")
	}
}

func TestS3Storage_RejectsInvalidProviderRegionForGeneratedEndpoint(t *testing.T) {
	cfg := `{"bucket":"x","region":"ap-shanghai.example.com","accessKeyId":"k","secretAccessKey":"s"}`
	if _, err := NewS3Storage(cfg, "COS"); err == nil {
		t.Fatal("NewS3Storage(COS) should reject invalid generated endpoint region")
	}
}

func TestTrustedProviderEndpoint(t *testing.T) {
	cases := []struct {
		name         string
		providerType string
		region       string
		endpoint     string
		want         bool
	}{
		{
			name:         "cos official service endpoint",
			providerType: "COS",
			region:       "ap-shanghai",
			endpoint:     "https://cos.ap-shanghai.myqcloud.com",
			want:         true,
		},
		{
			name:         "oss official service endpoint",
			providerType: "OSS",
			region:       "cn-shanghai",
			endpoint:     "https://oss-cn-shanghai.aliyuncs.com",
			want:         true,
		},
		{
			name:         "oss endpoint-style region",
			providerType: "OSS",
			region:       "oss-cn-hangzhou",
			endpoint:     "https://oss-cn-hangzhou.aliyuncs.com",
			want:         true,
		},
		{
			name:         "oss internal endpoint",
			providerType: "OSS",
			region:       "cn-hangzhou",
			endpoint:     "https://oss-cn-hangzhou-internal.aliyuncs.com",
			want:         true,
		},
		{
			name:         "r2 account endpoint",
			providerType: "R2",
			region:       "auto",
			endpoint:     "https://1234567890abcdef1234567890abcdef.r2.cloudflarestorage.com",
			want:         true,
		},
		{
			name:         "aws regional endpoint",
			providerType: "S3",
			region:       "us-west-2",
			endpoint:     "https://s3.us-west-2.amazonaws.com",
			want:         true,
		},
		{
			name:         "aws china regional endpoint",
			providerType: "S3",
			region:       "cn-north-1",
			endpoint:     "https://s3.cn-north-1.amazonaws.com.cn",
			want:         true,
		},
		{
			name:         "aws dualstack endpoint",
			providerType: "S3",
			region:       "us-east-1",
			endpoint:     "https://s3.dualstack.us-east-1.amazonaws.com",
			want:         true,
		},
		{
			name:         "cos lookalike suffix",
			providerType: "COS",
			region:       "ap-shanghai",
			endpoint:     "https://cos.ap-shanghai.myqcloud.com.evil.example",
			want:         false,
		},
		{
			name:         "cos wrong region",
			providerType: "COS",
			region:       "ap-guangzhou",
			endpoint:     "https://cos.ap-shanghai.myqcloud.com",
			want:         false,
		},
		{
			name:         "cos non-https",
			providerType: "COS",
			region:       "ap-shanghai",
			endpoint:     "http://cos.ap-shanghai.myqcloud.com",
			want:         false,
		},
		{
			name:         "r2 lookalike suffix",
			providerType: "R2",
			region:       "auto",
			endpoint:     "https://1234567890abcdef1234567890abcdef.r2.cloudflarestorage.com.evil.example",
			want:         false,
		},
		{
			name:         "aws wrong region",
			providerType: "S3",
			region:       "us-east-1",
			endpoint:     "https://s3.us-west-2.amazonaws.com",
			want:         false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isTrustedProviderEndpoint(c.endpoint, c.providerType, c.region); got != c.want {
				t.Fatalf("isTrustedProviderEndpoint()=%v want %v", got, c.want)
			}
		})
	}
}

func TestMinIOPrivateEndpointAlwaysBlocked(t *testing.T) {
	blockedCfg := `{"bucket":"x","region":"us-east-1","endpoint":"http://127.0.0.1:9000","accessKeyId":"k","secretAccessKey":"s"}`
	if _, err := NewS3Storage(blockedCfg, "MINIO"); err == nil {
		t.Fatal("NewS3Storage(MINIO) should reject private endpoint")
	}

	blockedWithFlagCfg := `{"bucket":"x","region":"us-east-1","endpoint":"http://127.0.0.1:9000","allowPrivateEndpoint":true,"accessKeyId":"k","secretAccessKey":"s"}`
	if _, err := NewS3Storage(blockedWithFlagCfg, "MINIO"); err == nil {
		t.Fatal("NewS3Storage(MINIO) should reject private endpoint even when allowPrivateEndpoint is true")
	}
}

func TestS3Storage_EndpointRequiredForMinIOAndR2(t *testing.T) {
	cfg := `{"bucket":"x","region":"auto","accessKeyId":"k","secretAccessKey":"s"}`
	for _, providerType := range []string{"MINIO", "R2"} {
		if _, err := NewS3Storage(cfg, providerType); err == nil {
			t.Fatalf("NewS3Storage(%s) should require endpoint", providerType)
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
		{"ftp://example.com", true},       // 非 http(s)
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

	page1, tok, err := store.List(ctx, "2026/05", "", 1)
	if err != nil {
		t.Fatalf("list page1: %v", err)
	}
	page2, _, err := store.List(ctx, "2026/05", tok, 1)
	if err != nil {
		t.Fatalf("list page2: %v", err)
	}
	if tok == "" || len(page1) != 1 || len(page2) != 1 || page1[0].Key == page2[0].Key {
		t.Errorf("pagination should return distinct objects across pages, page1=%v token=%q page2=%v", page1, tok, page2)
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
