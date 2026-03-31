// Package imgproc 提供图片处理相关的工具函数，包括类型判断、尺寸获取和缩略图生成。
package imgproc

import (
	"image"
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
