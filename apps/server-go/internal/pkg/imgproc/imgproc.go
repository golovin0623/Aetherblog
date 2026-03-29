package imgproc

import (
	"image"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
)

// IsImage returns true if the mime type represents a processable image.
func IsImage(mimeType string) bool {
	return strings.HasPrefix(mimeType, "image/") &&
		mimeType != "image/svg+xml" &&
		mimeType != "image/gif"
}

// GetDimensions returns the width and height of an image file.
func GetDimensions(path string) (int, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, err
	}
	return cfg.Width, cfg.Height, nil
}

// GenerateThumbnail creates a thumbnail of maxSize×maxSize at thumbPath.
func GenerateThumbnail(srcPath, thumbPath string, maxSize int) error {
	if err := os.MkdirAll(filepath.Dir(thumbPath), 0755); err != nil {
		return err
	}
	src, err := imaging.Open(srcPath)
	if err != nil {
		return err
	}
	thumb := imaging.Fit(src, maxSize, maxSize, imaging.Lanczos)
	return imaging.Save(thumb, thumbPath)
}
