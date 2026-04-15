package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

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
	client *s3.Client
	cfg    S3Config
}

// NewS3Storage 从提供商配置 JSON 字符串解析参数并创建 S3Storage 实例。
// 若 bucket 为空则返回错误；region 为空时默认使用 "us-east-1"。
func NewS3Storage(configJSON string) (*S3Storage, error) {
	var cfg S3Config
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse s3 config: %w", err)
	}
	// bucket 为必填参数
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("s3 config: bucket is required")
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

	client := s3.New(s3.Options{}, opts...)
	return &S3Storage{client: client, cfg: cfg}, nil
}

// Upload 将 reader 中的内容上传到 S3 兼容存储的指定 key。
// 由于 PutObject 需要完整数据，会先将 reader 内容读入内存缓冲区。
// 成功时返回文件的公开访问 URL。
func (s *S3Storage) Upload(ctx context.Context, key string, r io.Reader, size int64, mimeType string) (string, error) {
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

// Delete 删除 S3 存储桶中指定 key 对应的对象。
func (s *S3Storage) Delete(ctx context.Context, key string) error {
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

// Type 返回存储类型标识符 "S3"。
func (s *S3Storage) Type() string { return "S3" }

// TestConnection 通过 HeadBucket 调用验证 S3 存储的连通性，
// 是一种轻量级的健康检查方式，不传输实际数据。
func (s *S3Storage) TestConnection(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(s.cfg.Bucket),
	})
	return err
}
