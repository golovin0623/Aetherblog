package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// S3Config holds connection parameters parsed from storage_providers.config_json.
type S3Config struct {
	Bucket         string `json:"bucket"`
	Region         string `json:"region"`
	Endpoint       string `json:"endpoint"`
	AccessKeyID    string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	URLPrefix      string `json:"urlPrefix"`      // CDN / public URL prefix
	ForcePathStyle bool   `json:"forcePathStyle"` // true for MinIO
}

// S3Storage implements Storage for S3-compatible backends (AWS S3, MinIO, R2, etc.).
type S3Storage struct {
	client *s3.Client
	cfg    S3Config
}

// NewS3Storage creates an S3Storage from the provider's config JSON.
func NewS3Storage(configJSON string) (*S3Storage, error) {
	var cfg S3Config
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, fmt.Errorf("parse s3 config: %w", err)
	}
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("s3 config: bucket is required")
	}
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}

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

func (s *S3Storage) Upload(ctx context.Context, key string, r io.Reader, size int64, mimeType string) (string, error) {
	// Read all content for PutObject (S3 requires content length or uses chunked)
	data, err := io.ReadAll(r)
	if err != nil {
		return "", fmt.Errorf("read upload data: %w", err)
	}

	input := &s3.PutObjectInput{
		Bucket:      aws.String(s.cfg.Bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(mimeType),
	}

	if _, err := s.client.PutObject(ctx, input); err != nil {
		return "", fmt.Errorf("s3 put object: %w", err)
	}

	return s.GetURL(key), nil
}

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

func (s *S3Storage) GetURL(key string) string {
	if s.cfg.URLPrefix != "" {
		return s.cfg.URLPrefix + "/" + key
	}
	// Default: construct from endpoint + bucket + key
	if s.cfg.Endpoint != "" {
		if s.cfg.ForcePathStyle {
			return s.cfg.Endpoint + "/" + s.cfg.Bucket + "/" + key
		}
		return s.cfg.Endpoint + "/" + key
	}
	return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", s.cfg.Bucket, s.cfg.Region, key)
}

func (s *S3Storage) Type() string { return "S3" }

// TestConnection performs a lightweight HeadBucket call to verify connectivity.
func (s *S3Storage) TestConnection(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(s.cfg.Bucket),
	})
	return err
}
