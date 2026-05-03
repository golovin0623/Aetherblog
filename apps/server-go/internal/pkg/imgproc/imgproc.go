// Package imgproc 提供图片处理相关的工具函数，包括类型判断、尺寸获取和缩略图生成。
package imgproc

import (
	"bytes"
	"fmt"
	"image"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
)

// IsImage 判断给定的 MIME 类型是否为可处理的图片格式。
// SVG 和 GIF 被排除在外，因为它们不支持常规的像素操作处理。
func IsImage(mimeType string) bool {
	return strings.HasPrefix(mimeType, "image/") &&
		mimeType != "image/svg+xml" &&
		mimeType != "image/gif"
}

// GetDimensions 返回指定图片文件的宽度和高度（单位：像素）。
// 通过解码图片配置头获取尺寸，不加载完整像素数据，性能较高。
func GetDimensions(path string) (int, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	// 仅解码图片配置（宽高、色彩模式），不读取像素数据
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, err
	}
	return cfg.Width, cfg.Height, nil
}

// GenerateThumbnail 将 srcPath 指向的图片缩放至 maxSize×maxSize 边界内，
// 保持宽高比（Fit 模式），并将结果保存到 thumbPath。
// 目标目录不存在时会自动创建。
// 缩放算法使用高质量的 Lanczos 滤波器。
func GenerateThumbnail(srcPath, thumbPath string, maxSize int) error {
	// 确保缩略图目标目录存在
	if err := os.MkdirAll(filepath.Dir(thumbPath), 0755); err != nil {
		return err
	}
	// 打开并解码源图片
	src, err := imaging.Open(srcPath)
	if err != nil {
		return err
	}
	// 按比例缩放，使图片适配 maxSize×maxSize 的边界框
	thumb := imaging.Fit(src, maxSize, maxSize, imaging.Lanczos)
	// 保存缩略图到目标路径
	return imaging.Save(thumb, thumbPath)
}

// GetDimensionsFromReader 从 io.Reader 解码图片配置头,返回宽高(像素)。
// 仅读取 header(不加载像素),适合 S3/COS 等远程存储模式下从内存 buffer 读取。
func GetDimensionsFromReader(r io.Reader) (int, int, error) {
	cfg, _, err := image.DecodeConfig(r)
	if err != nil {
		return 0, 0, err
	}
	return cfg.Width, cfg.Height, nil
}

// GenerateThumbnailFromReader 从 io.Reader 读取源图片,生成 maxSize 边界内的缩略图,
// 返回缩略图字节数组(JPEG 格式)。供 S3/COS 等远程存储模式下生成缩略图后再上传。
//
// format 决定输出格式: "jpeg"(默认), "png", "gif", "tiff", "bmp"。
func GenerateThumbnailFromReader(r io.Reader, maxSize int, format string) ([]byte, error) {
	src, err := imaging.Decode(r, imaging.AutoOrientation(true))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}
	thumb := imaging.Fit(src, maxSize, maxSize, imaging.Lanczos)

	var f imaging.Format
	switch strings.ToLower(format) {
	case "png":
		f = imaging.PNG
	case "gif":
		f = imaging.GIF
	case "tiff":
		f = imaging.TIFF
	case "bmp":
		f = imaging.BMP
	default:
		f = imaging.JPEG
	}

	var buf bytes.Buffer
	if err := imaging.Encode(&buf, thumb, f); err != nil {
		return nil, fmt.Errorf("encode thumbnail: %w", err)
	}
	return buf.Bytes(), nil
}

// FormatFromMime 根据 MIME 类型返回 imaging 编码器需要的格式字符串(jpeg/png/gif/tiff/bmp)。
// 未识别的 MIME 类型回落到 "jpeg"。
func FormatFromMime(mime string) string {
	switch mime {
	case "image/png":
		return "png"
	case "image/gif":
		return "gif"
	case "image/tiff":
		return "tiff"
	case "image/bmp":
		return "bmp"
	default:
		return "jpeg"
	}
}
