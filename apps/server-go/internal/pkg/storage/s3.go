package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// multipartThreshold 是 PutObject vs Multipart Upload 的切换阈值。
// >= 该尺寸的请求走 manager.Uploader (自动分片 + 并发 + 失败重试),
// 小文件继续走单次 PutObject (开销小)。AWS 推荐的最小分片大小为 5MB。
const (
	multipartThreshold   int64 = 16 * 1024 * 1024 // 16 MB — 小于这个用 PutObject
	multipartPartSize    int64 = 8 * 1024 * 1024  // 8 MB 分片大小
	multipartConcurrency       = 4                // 单次上传内的分片并发
)

// validateEndpoint 拒绝将 S3 自定义 endpoint 指向内网 / 元数据服务，防御 SSRF。
// SECURITY (VULN-032): 空字符串（走 AWS 默认）放行；非空字符串必须是 http(s)
// scheme，且所有解析出的 IP 都不能落在 loopback / private / link-local / 169.254
// (IMDS) / broadcast 范围内。DNS rebinding 攻击需要网络层封堵作为纵深防御 ——
// 此函数只在创建客户端时做一次 resolve，不做运行时重查。
func validateEndpoint(raw string) error {
	if raw == "" {
		return nil
	}
	u, err := parseEndpoint(raw)
	if err != nil {
		return err
	}
	host := u.Hostname()
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("endpoint DNS lookup failed: %w", err)
	}
	blocked := func(ip net.IP) bool {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
			ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return true
		}
		// 169.254.169.254 已由 IsLinkLocalUnicast 覆盖；这里再显式阻断
		// IPv4 映射的 loopback 形式与 AWS IMDSv2 的边缘场景。
		if ip.Equal(net.IPv4bcast) || ip.Equal(net.ParseIP("169.254.169.254")) {
			return true
		}
		return false
	}
	for _, ip := range ips {
		if blocked(ip) {
			return fmt.Errorf("endpoint %s resolves to internal address %s (blocked)", host, ip)
		}
	}
	return nil
}

func parseEndpoint(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid endpoint: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("endpoint scheme must be http or https, got %q", u.Scheme)
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("endpoint missing hostname")
	}
	return u, nil
}

// S3Config 保存从存储提供商配置 JSON（storage_providers.config_json）解析出的连接参数。
type S3Config struct {
	// Bucket 存储桶名称
	Bucket string `json:"bucket"`
	// Region AWS 区域，默认为 "us-east-1"
	Region string `json:"region"`
	// Endpoint 自定义服务端点，用于 MinIO 等兼容实现；AWS S3 可留空
	Endpoint string `json:"endpoint"`
	// AccessKeyID 访问密钥 ID
	AccessKeyID string `json:"accessKeyId"`
	// SecretAccessKey 访问密钥
	SecretAccessKey string `json:"secretAccessKey"`
	// URLPrefix CDN 或公开访问的 URL 前缀；若设置，GetURL 将优先使用此值
	URLPrefix string `json:"urlPrefix"`
	// Path 对象 key 根前缀,例如 "assets/"。业务传入的 key 会落到该前缀下。
	Path string `json:"path"`
	// CustomURL 图床/自定义域名,优先级高于 URLPrefix,例如 "https://data.example.com"。
	CustomURL string `json:"customUrl"`
	// Options 追加到公开 URL 末尾的查询参数,例如 "?variant=public"。
	Options string `json:"options"`
	// AllowPrivateEndpoint 允许 MinIO 使用内网/localhost endpoint。默认关闭以保留 SSRF 防护。
	AllowPrivateEndpoint bool `json:"allowPrivateEndpoint"`
	// ForcePathStyle 是否强制使用路径风格 URL（MinIO 必须设为 true）
	ForcePathStyle bool `json:"forcePathStyle"`
}

// S3Storage 是兼容 S3 协议的对象存储实现，支持 AWS S3、MinIO、Cloudflare R2 等后端。
type S3Storage struct {
	client       *s3.Client
	cfg          S3Config
	providerType string // 上游 provider 类型(S3/MINIO/R2/COS/OSS),Type() 直接返回该值
}

// NewS3Storage 从提供商配置 JSON 字符串解析参数并创建 S3Storage 实例。
// 若 bucket 为空则返回错误；region 为空时默认使用 "us-east-1"。
//
// providerType 由 factory 透传(S3/MINIO/R2/COS/OSS),用于 Type() 真实返回上游类型;
// 历史调用方未传时统一回落 "S3" 保持兼容。
func NewS3Storage(configJSON string, providerType ...string) (*S3Storage, error) {
	var cfg S3Config
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse s3 config: %w", err)
	}
	// bucket 为必填参数
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("s3 config: bucket is required")
	}
	pt := "S3"
	if len(providerType) > 0 && providerType[0] != "" {
		pt = strings.ToUpper(providerType[0])
	}

	generatedEndpoint, err := applyProviderDefaults(&cfg, pt)
	if err != nil {
		return nil, fmt.Errorf("s3 config: %w", err)
	}
	if err := normalizeS3ConfigPaths(&cfg); err != nil {
		return nil, fmt.Errorf("s3 config: %w", err)
	}
	// SECURITY (VULN-032): 防 SSRF —— 拒绝把用户自定义 endpoint 指向内网 / IMDS。
	// COS/OSS 的内置 endpoint 由受限 region 生成,不做 DNS 依赖的校验,避免单元测试和离线环境受外网 DNS 影响。
	if !generatedEndpoint && !isTrustedProviderEndpoint(cfg.Endpoint, pt, cfg.Region) {
		if err := validateEndpoint(cfg.Endpoint); err != nil {
			return nil, fmt.Errorf("s3 config: %w", err)
		}
	}

	// 构建 S3 客户端选项：设置区域、凭证、自定义端点和路径风格
	opts := []func(*s3.Options){
		func(o *s3.Options) {
			o.Region = cfg.Region
			o.Credentials = credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")
			if cfg.Endpoint != "" {
				o.BaseEndpoint = aws.String(cfg.Endpoint)
			}
			o.UsePathStyle = cfg.ForcePathStyle
		},
	}

	client := s3.New(s3.Options{}, opts...)
	return &S3Storage{client: client, cfg: cfg, providerType: pt}, nil
}

// applyProviderDefaults 补齐 S3 兼容厂商的默认 region/endpoint。
// COS/OSS 若没有显式 endpoint,不能走 AWS SDK 的默认 S3 域名,否则会拼出
// bucket.s3.<region>.amazonaws.com 这类不存在的地址(例如 ap-shanghai)。
func applyProviderDefaults(cfg *S3Config, providerType string) (generatedEndpoint bool, err error) {
	cfg.Region = strings.TrimSpace(cfg.Region)
	cfg.Endpoint = strings.TrimSpace(cfg.Endpoint)
	cfg.URLPrefix = strings.TrimSpace(cfg.URLPrefix)
	cfg.CustomURL = strings.TrimSpace(cfg.CustomURL)
	cfg.Options = strings.TrimSpace(cfg.Options)
	if cfg.Region == "" {
		switch providerType {
		case "COS":
			cfg.Region = "ap-guangzhou"
		case "OSS":
			cfg.Region = "cn-hangzhou"
		case "R2":
			cfg.Region = "auto"
		default:
			cfg.Region = "us-east-1"
		}
	}
	if cfg.Endpoint != "" {
		return false, nil
	}
	switch providerType {
	case "COS":
		if err := validateProviderRegion(cfg.Region); err != nil {
			return false, err
		}
		cfg.Endpoint = fmt.Sprintf("https://cos.%s.myqcloud.com", cfg.Region)
		return true, nil
	case "OSS":
		if err := validateProviderRegion(cfg.Region); err != nil {
			return false, err
		}
		if strings.HasPrefix(cfg.Region, "oss-") {
			cfg.Endpoint = fmt.Sprintf("https://%s.aliyuncs.com", cfg.Region)
		} else {
			cfg.Endpoint = fmt.Sprintf("https://oss-%s.aliyuncs.com", cfg.Region)
		}
		return true, nil
	case "MINIO", "R2":
		return false, fmt.Errorf("%s endpoint is required", providerType)
	default:
		return false, nil
	}
}

func validateProviderRegion(region string) error {
	if region == "" {
		return fmt.Errorf("region is required")
	}
	for _, r := range region {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
			continue
		}
		return fmt.Errorf("region contains invalid character %q", r)
	}
	return nil
}

func isTrustedProviderEndpoint(raw, providerType, region string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	if u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Port() != "" ||
		u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if u.Path != "" && u.Path != "/" {
		return false
	}
	region = strings.ToLower(strings.TrimSpace(region))
	if err := validateProviderRegion(region); err != nil {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")

	switch strings.ToUpper(providerType) {
	case "COS":
		return host == fmt.Sprintf("cos.%s.myqcloud.com", region)
	case "OSS":
		endpointRegion := region
		if !strings.HasPrefix(endpointRegion, "oss-") {
			endpointRegion = "oss-" + endpointRegion
		}
		return host == endpointRegion+".aliyuncs.com" ||
			host == endpointRegion+"-internal.aliyuncs.com"
	case "R2":
		return isTrustedR2EndpointHost(host)
	case "S3":
		return isTrustedAWSS3EndpointHost(host, region)
	default:
		return false
	}
}

func isTrustedR2EndpointHost(host string) bool {
	const suffix = ".r2.cloudflarestorage.com"
	if !strings.HasSuffix(host, suffix) {
		return false
	}
	accountID := strings.TrimSuffix(host, suffix)
	if accountID == "" || strings.Contains(accountID, ".") || strings.HasPrefix(accountID, "-") || strings.HasSuffix(accountID, "-") {
		return false
	}
	for _, r := range accountID {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			continue
		}
		return false
	}
	return true
}

func isTrustedAWSS3EndpointHost(host, region string) bool {
	if host == "s3.amazonaws.com" || host == "s3-accelerate.amazonaws.com" ||
		host == "s3-accelerate.dualstack.amazonaws.com" {
		return true
	}
	return host == fmt.Sprintf("s3.%s.amazonaws.com", region) ||
		host == fmt.Sprintf("s3.%s.amazonaws.com.cn", region) ||
		host == fmt.Sprintf("s3.dualstack.%s.amazonaws.com", region) ||
		host == fmt.Sprintf("s3.dualstack.%s.amazonaws.com.cn", region)
}

func normalizeS3ConfigPaths(cfg *S3Config) error {
	pathPrefix, err := normalizeKeyPrefix(cfg.Path)
	if err != nil {
		return fmt.Errorf("path: %w", err)
	}
	cfg.Path = pathPrefix
	return nil
}

func normalizeKeyPrefix(prefix string) (string, error) {
	prefix = strings.ReplaceAll(strings.TrimSpace(prefix), "\\", "/")
	prefix = strings.Trim(prefix, "/")
	if prefix == "" {
		return "", nil
	}
	if len(prefix) > 512 {
		return "", fmt.Errorf("too long")
	}
	if strings.Contains(prefix, "..") {
		return "", fmt.Errorf("must not contain '..'")
	}
	return prefix + "/", nil
}

func (s *S3Storage) objectKey(key string) (string, error) {
	fullKey := key
	if s.cfg.Path == "" {
		if err := validateS3Key(fullKey); err != nil {
			return "", err
		}
		return fullKey, nil
	}
	trimmedKey := strings.TrimLeft(key, "/")
	if trimmedKey == "" {
		return "", fmt.Errorf("s3 key: empty")
	}
	fullKey = s.cfg.Path + trimmedKey
	if err := validateS3Key(fullKey); err != nil {
		return "", err
	}
	return fullKey, nil
}

func (s *S3Storage) listPrefix(prefix string) string {
	prefix = strings.TrimLeft(prefix, "/")
	if s.cfg.Path == "" {
		return prefix
	}
	return s.cfg.Path + prefix
}

func (s *S3Storage) externalKey(objectKey string) string {
	if s.cfg.Path == "" {
		return objectKey
	}
	return strings.TrimPrefix(objectKey, s.cfg.Path)
}

// validateS3Key 阻止畸形 key（前导 '/', '..', 超长）传入 SDK。
// SECURITY (VULN-054): S3 允许 '/' 作为伪目录分隔符，但绝对路径 '/foo' 会让
// 对象 key 变成 '/foo' 而非 'foo'，造成 URL 错位且可能与未来的路径穿越防御
// 冲突。此处做一次前置 sanity check，保持行为可预期。
func validateS3Key(key string) error {
	if key == "" {
		return fmt.Errorf("s3 key: empty")
	}
	if len(key) > 1024 {
		return fmt.Errorf("s3 key: too long (>%d)", 1024)
	}
	if key[0] == '/' {
		return fmt.Errorf("s3 key: must not start with '/'")
	}
	// 拒绝任何 '..' 段
	for i := 0; i < len(key)-1; i++ {
		if key[i] == '.' && key[i+1] == '.' {
			return fmt.Errorf("s3 key: must not contain '..'")
		}
	}
	return nil
}

// Upload 将 reader 中的内容上传到 S3 兼容存储的指定 key。
//
// 路由策略 (遗留 3):
//   - size < multipartThreshold (16 MB) 或 size <= 0(未知大小): 单次 PutObject。
//     reader 由 SDK 直接消费,不在 Go 端缓冲;ContentLength 透传给 SDK 做 chunked
//     传输(若 reader 不支持 Seek 则 SDK 自动降级)。
//   - size >= multipartThreshold: manager.Uploader 自动分片(8 MB/片,4 并发),
//     失败自动重试每片;大文件不会一次性灌进内存。
//
// 成功时返回文件的公开访问 URL。
func (s *S3Storage) Upload(ctx context.Context, key string, r io.Reader, size int64, mimeType string) (string, error) {
	objectKey, err := s.objectKey(key)
	if err != nil {
		return "", err
	}

	if size > 0 && size < multipartThreshold {
		input := &s3.PutObjectInput{
			Bucket:        aws.String(s.cfg.Bucket),
			Key:           aws.String(objectKey),
			Body:          r,
			ContentLength: aws.Int64(size),
			ContentType:   aws.String(mimeType),
		}
		if _, err := s.client.PutObject(ctx, input); err != nil {
			return "", fmt.Errorf("s3 put object: %w", err)
		}
		return s.GetURL(key), nil
	}

	// 大文件 / 未知大小走 multipart。Uploader 会按 PartSize 切片并并发上传,
	// 失败的分片自动重试,最终调 CompleteMultipartUpload 拼回。
	uploader := manager.NewUploader(s.client, func(u *manager.Uploader) {
		u.PartSize = multipartPartSize
		u.Concurrency = multipartConcurrency
		// 默认 LeavePartsOnError=false → 失败时清理已上传分片,避免冷数据 / 跨账户费用
	})
	input := &s3.PutObjectInput{
		Bucket:      aws.String(s.cfg.Bucket),
		Key:         aws.String(objectKey),
		Body:        r,
		ContentType: aws.String(mimeType),
	}
	if _, err := uploader.Upload(ctx, input); err != nil {
		return "", fmt.Errorf("s3 multipart upload: %w", err)
	}
	return s.GetURL(key), nil
}

// Delete 删除 S3 存储桶中指定 key 对应的对象。
func (s *S3Storage) Delete(ctx context.Context, key string) error {
	objectKey, err := s.objectKey(key)
	if err != nil {
		return fmt.Errorf("s3 delete object: %w", err)
	}
	input := &s3.DeleteObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(objectKey),
	}
	if _, err := s.client.DeleteObject(ctx, input); err != nil {
		return fmt.Errorf("s3 delete object: %w", err)
	}
	return nil
}

// GetURL 返回指定 key 对应文件的公开访问 URL，优先级如下：
//  1. 若配置了 CustomURL（图床/自定义域名），则直接拼接返回
//  2. 若配置了 URLPrefix（如 CDN 域名），则直接拼接返回
//  3. 若配置了自定义 Endpoint，根据 ForcePathStyle 选择路径风格或虚拟主机风格
//  4. 默认构造标准 AWS S3 公开访问 URL
func (s *S3Storage) GetURL(key string) string {
	objectKey, err := s.objectKey(key)
	if err != nil {
		return ""
	}
	publicBase := s.cfg.CustomURL
	if publicBase == "" {
		publicBase = s.cfg.URLPrefix
	}
	if publicBase != "" {
		// 使用 CDN 或自定义公开访问前缀
		return appendURLOptions(joinURLPath(publicBase, objectKey), s.cfg.Options)
	}
	// 自定义端点（如 MinIO）的 URL 构造
	if s.cfg.Endpoint != "" {
		if s.cfg.ForcePathStyle {
			// 路径风格：endpoint/bucket/key（MinIO 默认）
			return appendURLOptions(joinURLPath(s.cfg.Endpoint, s.cfg.Bucket, objectKey), s.cfg.Options)
		}
		// 虚拟主机风格：bucket.endpoint/key
		return appendURLOptions(virtualHostedURL(s.cfg.Endpoint, s.cfg.Bucket, objectKey), s.cfg.Options)
	}
	// 标准 AWS S3 公开访问 URL 格式
	return appendURLOptions(fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", s.cfg.Bucket, s.cfg.Region, objectKey), s.cfg.Options)
}

// PublicURLCandidates 返回当前 key 可能对应的公开 URL,用于跨 CustomURL/URLPrefix
// 配置切换后的 catalog 反查。第一个候选始终与 GetURL(key) 一致。
func (s *S3Storage) PublicURLCandidates(key string) []string {
	objectKey, err := s.objectKey(key)
	if err != nil {
		return nil
	}
	bases := s.publicURLBases()
	if len(bases) == 0 {
		if publicURL := strings.TrimSpace(s.GetURL(key)); publicURL != "" {
			return []string{publicURL}
		}
		return nil
	}

	urls := make([]string, 0, len(bases)*2)
	add := func(rawURL string) {
		rawURL = strings.TrimSpace(rawURL)
		if rawURL == "" {
			return
		}
		for _, existing := range urls {
			if existing == rawURL {
				return
			}
		}
		urls = append(urls, rawURL)
	}

	for _, base := range bases {
		rawURL := joinURLPath(base, objectKey)
		add(appendURLOptions(rawURL, s.cfg.Options))
		add(rawURL)
	}
	return urls
}

// KeyFromURL 从 GetURL 生成的公开 URL 反解出业务 key。
// 当存储后来配置了 CustomURL/URLPrefix 时,历史落库的供应商原始公开 URL
// 仍然属于同一个 bucket,也应能反解,否则备份校验/删除会被域名切换卡住。
func (s *S3Storage) KeyFromURL(rawURL string) (string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", fmt.Errorf("s3 url: empty")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("s3 url: %w", err)
	}
	if u.Path == "" {
		return "", fmt.Errorf("s3 url: missing object path")
	}

	objectKey, err := s.objectKeyFromURL(u)
	if err != nil {
		return "", err
	}
	if err := validateS3Key(objectKey); err != nil {
		return "", err
	}
	key := s.externalKey(objectKey)
	if key == "" {
		return "", fmt.Errorf("s3 url: missing key")
	}
	return key, nil
}

func (s *S3Storage) objectKeyFromURL(u *url.URL) (string, error) {
	bases := s.publicURLBases()
	if len(bases) == 0 {
		return strings.TrimLeft(u.Path, "/"), nil
	}

	var firstErr error
	var sameHostErr error
	for _, base := range bases {
		objectKey, err := stripURLBasePath(u, base)
		if err == nil {
			return objectKey, nil
		}
		if firstErr == nil {
			firstErr = err
		}
		if sameHostErr == nil && urlBaseHostMatches(u, base) {
			sameHostErr = err
		}
	}
	if len(bases) > 1 {
		if sameHostErr != nil {
			return "", fmt.Errorf("s3 url: host matched a configured public base but path did not: %w", sameHostErr)
		}
		return "", fmt.Errorf("s3 url: no configured public base matched %q: %w", u.Host, firstErr)
	}
	return "", firstErr
}

func urlBaseHostMatches(u *url.URL, rawBase string) bool {
	base, err := url.Parse(strings.TrimSpace(rawBase))
	if err != nil || !base.IsAbs() {
		return false
	}
	return strings.EqualFold(u.Scheme, base.Scheme) && strings.EqualFold(u.Host, base.Host)
}

func (s *S3Storage) publicURLBases() []string {
	var bases []string
	add := func(base string) {
		base = strings.TrimSpace(base)
		if base == "" {
			return
		}
		for _, existing := range bases {
			if existing == base {
				return
			}
		}
		bases = append(bases, base)
	}

	add(s.cfg.CustomURL)
	add(s.cfg.URLPrefix)
	if s.cfg.Endpoint != "" {
		if s.cfg.ForcePathStyle {
			add(joinURLPath(s.cfg.Endpoint, s.cfg.Bucket))
		} else {
			add(virtualHostedURL(s.cfg.Endpoint, s.cfg.Bucket, ""))
		}
		return bases
	}
	if s.cfg.Bucket != "" && s.cfg.Region != "" {
		add(fmt.Sprintf("https://%s.s3.%s.amazonaws.com", s.cfg.Bucket, s.cfg.Region))
	}
	return bases
}

func stripURLBasePath(u *url.URL, rawBase string) (string, error) {
	base, err := url.Parse(strings.TrimSpace(rawBase))
	if err != nil {
		return "", fmt.Errorf("base url: %w", err)
	}
	if base.IsAbs() {
		if !strings.EqualFold(u.Scheme, base.Scheme) || !strings.EqualFold(u.Host, base.Host) {
			return "", fmt.Errorf("url host %q does not match base %q", u.Host, base.Host)
		}
	}
	path := strings.TrimLeft(u.Path, "/")
	basePath := strings.Trim(base.Path, "/")
	if basePath == "" {
		if path == "" {
			return "", fmt.Errorf("url path: missing key")
		}
		return path, nil
	}
	if path == basePath {
		return "", fmt.Errorf("url path: missing key after base %q", basePath)
	}
	prefix := basePath + "/"
	if !strings.HasPrefix(path, prefix) {
		return "", fmt.Errorf("url path %q does not match base path %q", path, basePath)
	}
	return strings.TrimPrefix(path, prefix), nil
}

func joinURLPath(base string, parts ...string) string {
	base = strings.TrimSpace(base)
	if base == "" {
		return ""
	}
	if u, err := url.Parse(base); err == nil && (u.Scheme != "" || u.Host != "" || strings.HasPrefix(base, "/")) {
		path := strings.TrimRight(u.Path, "/")
		for _, part := range parts {
			part = strings.Trim(part, "/")
			if part == "" {
				continue
			}
			path += "/" + part
		}
		u.Path = path
		u.RawPath = ""
		return u.String()
	}

	out := strings.TrimRight(base, "/")
	for _, part := range parts {
		part = strings.Trim(part, "/")
		if part == "" {
			continue
		}
		out += "/" + part
	}
	return out
}

func virtualHostedURL(endpoint, bucket, key string) string {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return joinURLPath(endpoint, key)
	}
	hostname := u.Hostname()
	if hostname != "" && !strings.HasPrefix(hostname, bucket+".") {
		host := bucket + "." + hostname
		if port := u.Port(); port != "" {
			host = net.JoinHostPort(host, port)
		}
		u.Host = host
	}
	return joinURLPath(u.String(), key)
}

func appendURLOptions(rawURL, options string) string {
	options = strings.TrimSpace(options)
	if options == "" || rawURL == "" {
		return rawURL
	}
	options = strings.TrimPrefix(strings.TrimPrefix(options, "?"), "&")
	if options == "" {
		return rawURL
	}
	if u, err := url.Parse(rawURL); err == nil && (u.Scheme != "" || u.Host != "" || strings.HasPrefix(rawURL, "/")) {
		if u.RawQuery == "" {
			u.RawQuery = options
		} else {
			u.RawQuery += "&" + options
		}
		return u.String()
	}
	hasQuery := strings.Contains(rawURL, "?")
	if hasQuery {
		return rawURL + "&" + options
	}
	return rawURL + "?" + options
}

// Type 返回上游存储类型标识符(S3/MINIO/R2/COS/OSS)。
// 早期版本固定返回 "S3",造成媒体记录的 storage_type 与 provider 实际类型脱节;
// 现按 providerType 字段透传上游真实类型。
func (s *S3Storage) Type() string {
	if s.providerType == "" {
		return "S3"
	}
	return s.providerType
}

// TestConnection 通过 HeadBucket 调用验证 S3 存储的连通性，
// 是一种轻量级的健康检查方式，不传输实际数据。
func (s *S3Storage) TestConnection(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(s.cfg.Bucket),
	})
	return err
}

// Get 实现 Storage.Get,从 bucket 读对象。返回的 ReadCloser 必须由调用方关闭。
func (s *S3Storage) Get(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	objectKey, err := s.objectKey(key)
	if err != nil {
		return nil, 0, "", err
	}
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		return nil, 0, "", fmt.Errorf("s3 get object: %w", err)
	}
	size := int64(0)
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	mime := ""
	if out.ContentType != nil {
		mime = *out.ContentType
	}
	return out.Body, size, mime, nil
}

// List 实现 Storage/Lister.List,使用 ListObjectsV2 (S3/COS/OSS/MinIO/R2 均兼容)。
// continuationToken 留空表示首次拉取;非空时直接传给 SDK。返回的 nextToken 为空表示已到末页。
func (s *S3Storage) List(ctx context.Context, prefix, continuationToken string, limit int) ([]ObjectInfo, string, error) {
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	maxKeys := int32(limit)
	input := &s3.ListObjectsV2Input{
		Bucket:  aws.String(s.cfg.Bucket),
		MaxKeys: &maxKeys,
	}
	objectPrefix := s.listPrefix(prefix)
	if objectPrefix != "" {
		input.Prefix = aws.String(objectPrefix)
	}
	if continuationToken != "" {
		input.ContinuationToken = aws.String(continuationToken)
	}
	out, err := s.client.ListObjectsV2(ctx, input)
	if err != nil {
		return nil, "", fmt.Errorf("s3 list objects: %w", err)
	}
	objects := make([]ObjectInfo, 0, len(out.Contents))
	for _, o := range out.Contents {
		key := ""
		if o.Key != nil {
			key = s.externalKey(*o.Key)
		}
		size := int64(0)
		if o.Size != nil {
			size = *o.Size
		}
		etag := ""
		if o.ETag != nil {
			etag = *o.ETag
		}
		lastMod := ""
		if o.LastModified != nil {
			lastMod = o.LastModified.UTC().Format("2006-01-02T15:04:05Z")
		}
		objects = append(objects, ObjectInfo{Key: key, Size: size, LastModified: lastMod, ETag: etag})
	}
	nextTok := ""
	if out.IsTruncated != nil && *out.IsTruncated && out.NextContinuationToken != nil {
		nextTok = *out.NextContinuationToken
	}
	return objects, nextTok, nil
}

// HeadObject 返回 key 的元数据(大小、MIME),用于 Phase 5 反向导入时判断"云上还在不在"。
func (s *S3Storage) HeadObject(ctx context.Context, key string) (size int64, mime string, exists bool, err error) {
	objectKey, err := s.objectKey(key)
	if err != nil {
		return 0, "", false, err
	}
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		// SDK 没有显式 NotFound 类型简单识别;按字符串/状态码匹配
		// 这里不严格区分 — caller 把 err 视作 "不存在或不可访问"
		return 0, "", false, err
	}
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	if out.ContentType != nil {
		mime = *out.ContentType
	}
	return size, mime, true, nil
}

// Exists 实现 Existser 接口,专为 Phase 5 备份完整性校验设计。
//
// 与 HeadObject 的关键差别:
//   - 区分"确认不存在"(types.NotFound / NoSuchKey)与"瞬时错误"(网络 / 5xx / 凭据失效)
//   - 确认不存在时返回 (false, nil) — 校验 worker 据此把 SYNCED 标 MISSING
//   - 瞬时错误返回 (false, err) — caller 跳过本轮,不更改 sync_status
//
// 这样一次网络抖动不会把整批 SYNCED 错标 MISSING。
func (s *S3Storage) Exists(ctx context.Context, key string) (bool, error) {
	objectKey, err := s.objectKey(key)
	if err != nil {
		return false, err
	}
	_, err = s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(objectKey),
	})
	if err == nil {
		return true, nil
	}
	if isS3ObjectNotFoundError(err) {
		return false, nil
	}
	// 其他错误视为瞬时,caller 不应改状态
	return false, err
}

func isS3ObjectNotFoundError(err error) bool {
	var notFound *s3types.NotFound
	var noSuchKey *s3types.NoSuchKey
	if errors.As(err, &notFound) || errors.As(err, &noSuchKey) {
		return true
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		code := strings.ToLower(apiErr.ErrorCode())
		if code == "notfound" || code == "no_such_key" || code == "nosuchkey" || code == "404" {
			return true
		}
	}
	var statusErr interface{ HTTPStatusCode() int }
	if errors.As(err, &statusErr) && statusErr.HTTPStatusCode() == 404 {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "status code: 404") ||
		strings.Contains(msg, "statuscode: 404") ||
		strings.Contains(msg, "nosuchkey") ||
		strings.Contains(msg, "not found")
}
