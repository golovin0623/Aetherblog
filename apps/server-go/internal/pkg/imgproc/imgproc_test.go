package imgproc

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// makeTestPNG 生成一张 200x100 的纯色 PNG,供 reader 入口测试使用。
func makeTestPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 200, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 200; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 50, B: 50, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buf.Bytes()
}

func makeTestJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 600, 400))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode test jpg: %v", err)
	}
	return buf.Bytes()
}

func TestGetDimensionsFromReader_PNG(t *testing.T) {
	src := makeTestPNG(t)
	w, h, err := GetDimensionsFromReader(bytes.NewReader(src))
	if err != nil {
		t.Fatalf("dims from reader: %v", err)
	}
	if w != 200 || h != 100 {
		t.Errorf("expected 200x100 got %dx%d", w, h)
	}
}

func TestGetDimensionsFromReader_JPEG(t *testing.T) {
	src := makeTestJPEG(t)
	w, h, err := GetDimensionsFromReader(bytes.NewReader(src))
	if err != nil {
		t.Fatalf("dims from reader: %v", err)
	}
	if w != 600 || h != 400 {
		t.Errorf("expected 600x400 got %dx%d", w, h)
	}
}

func TestGenerateThumbnailFromReader_FitsWithinBounds(t *testing.T) {
	src := makeTestJPEG(t)
	thumbBytes, err := GenerateThumbnailFromReader(bytes.NewReader(src), 150, "jpeg")
	if err != nil {
		t.Fatalf("thumb gen: %v", err)
	}
	if len(thumbBytes) == 0 {
		t.Fatal("empty thumbnail bytes")
	}
	w, h, err := GetDimensionsFromReader(bytes.NewReader(thumbBytes))
	if err != nil {
		t.Fatalf("decode thumb: %v", err)
	}
	if w > 150 || h > 150 {
		t.Errorf("thumbnail %dx%d exceeds 150 bounds", w, h)
	}
	if w == 0 || h == 0 {
		t.Errorf("thumbnail must have positive dims got %dx%d", w, h)
	}
}

func TestFormatFromMime(t *testing.T) {
	cases := []struct {
		mime, want string
	}{
		{"image/jpeg", "jpeg"},
		{"image/png", "png"},
		{"image/gif", "gif"},
		{"image/tiff", "tiff"},
		{"image/bmp", "bmp"},
		{"image/webp", "jpeg"}, // 不支持的格式回落 jpeg
		{"", "jpeg"},
	}
	for _, c := range cases {
		if got := FormatFromMime(c.mime); got != c.want {
			t.Errorf("FormatFromMime(%q) = %q, want %q", c.mime, got, c.want)
		}
	}
}

func TestIsImage_BoundaryTypes(t *testing.T) {
	cases := []struct {
		mime string
		want bool
	}{
		{"image/jpeg", true},
		{"image/png", true},
		{"image/svg+xml", false}, // SVG 排除
		{"image/gif", false},     // GIF 排除
		{"video/mp4", false},
		{"text/plain", false},
		{"", false},
	}
	for _, c := range cases {
		if got := IsImage(c.mime); got != c.want {
			t.Errorf("IsImage(%q) = %v, want %v", c.mime, got, c.want)
		}
	}
}
