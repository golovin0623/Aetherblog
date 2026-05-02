package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// multipartThreshold 是 PutObject vs Multipart Upload 的切换阈值。
// >= 该尺寸的请求走 manager.Uploader (自动分片 + 并发 + 失败重试),
// 小文件继续走单次 PutObject (开销小)。AWS 推荐的最小分片大小为 5MB。
const (
	multipartThreshold int64 = 16 * 1024 * 1024 // 16 MB — 小于这个用 PutObject
	multipartPartSize  int64 = 8 * 1024 * 1024  // 8 MB 分片大小
	multipartConcurrency     = 4                  // 单次上传内的分片并发
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
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid endpoint: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("endpoint scheme must be http or https, got %q", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("endpoint missing hostname")
	}
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

// S3Config 保存从存储提供商配置 JSON（storage_providers.config_json）解析出的连接参数。
type S3Config struct {
	// Bucket 存储桶名称
	Bucket         string `json:"bucket"`
	// Region AWS 区域，默认为 "us-east-1"
	Region         string `json:"region"`
	// Endpoint 自定义服务端点，用于 MinIO 等兼容实现；AWS S3 可留空
	Endpoint       string `json:"endpoint"`
	// AccessKeyID 访问密钥 ID
	AccessKeyID    string `json:"accessKeyId"`
	// SecretAccessKey 访问密钥
	SecretAccessKey string `json:"secretAccessKey"`
	// URLPrefix CDN 或公开访问的 URL 前缀；若设置，GetURL 将优先使用此值
	URLPrefix      string `json:"urlPrefix"`
	// ForcePathStyle 是否强制使用路径风格 URL（MinIO 必须设为 true）
	ForcePathStyle bool   `json:"forcePathStyle"`
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
	// SECURITY (VULN-032): 防 SSRF —— 拒绝把 endpoint 指向内网 / IMDS。
	if err := validateEndpoint(cfg.Endpoint); err != nil {
		return nil, fmt.Errorf("s3 config: %w", err)
	}
	// region 默认值
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
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

	pt := "S3"
	if len(providerType) > 0 && providerType[0] != "" {
		pt = providerType[0]
	}

	client := s3.New(s3.Options{}, opts...)
	return &S3Storage{client: client, cfg: cfg, providerType: pt}, nil
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
	if err := validateS3Key(key); err != nil {
		return "", err
	}

	if size > 0 && size < multipartThreshold {
		input := &s3.PutObjectInput{
			Bucket:        aws.String(s.cfg.Bucket),
			Key:           aws.String(key),
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
		Key:         aws.String(key),
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
	if err := validateS3Key(key); err != nil {
		return fmt.Errorf("s3 delete object: %w", err)
	}
	input := &s3.DeleteObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(key),
	}
	if _, err := s.client.DeleteObject(ctx, input); err != nil {
		return fmt.Errorf("s3 delete object: %w", err)
	}
	return nil
}

// GetURL 返回指定 key 对应文件的公开访问 URL，优先级如下：
//  1. 若配置了 URLPrefix（如 CDN 域名），则直接拼接返回
//  2. 若配置了自定义 Endpoint，根据 ForcePathStyle 选择路径风格或虚拟主机风格
//  3. 默认构造标准 AWS S3 公开访问 URL
func (s *S3Storage) GetURL(key string) string {
	if s.cfg.URLPrefix != "" {
		// 使用 CDN 或自定义公开访问前缀
		return s.cfg.URLPrefix + "/" + key
	}
	// 自定义端点（如 MinIO）的 URL 构造
	if s.cfg.Endpoint != "" {
		if s.cfg.ForcePathStyle {
			// 路径风格：endpoint/bucket/key（MinIO 默认）
			return s.cfg.Endpoint + "/" + s.cfg.Bucket + "/" + key
		}
		// 虚拟主机风格：endpoint/key
		return s.cfg.Endpoint + "/" + key
	}
	// 标准 AWS S3 公开访问 URL 格式
	return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", s.cfg.Bucket, s.cfg.Region, key)
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
	if err := validateS3Key(key); err != nil {
		return nil, 0, "", err
	}
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(key),
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
	if prefix != "" {
		input.Prefix = aws.String(prefix)
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
			key = *o.Key
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
	if verr := validateS3Key(key); verr != nil {
		return 0, "", false, verr
	}
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.cfg.Bucket),
		Key:    aws.String(key),
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
