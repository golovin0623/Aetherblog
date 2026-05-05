package service

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"testing"
)

// TestSVGExtensionMapping 防回归: guessMimeType 必须把 .svg / .svgz 映射到
// image/svg+xml,该 MIME 不能进入 allowedMimeTypes。这是 SVG 三层防线中的第 2、3 层。
func TestSVGExtensionMapping(t *testing.T) {
	for _, name := range []string{"evil.svg", "EVIL.SVG", "payload.svgz", "x.SvGz"} {
		if got := guessMimeType(name); got != "image/svg+xml" {
			t.Errorf("guessMimeType(%q) = %q, want %q (regression: SVG mapping removed)", name, got, "image/svg+xml")
		}
	}
	if allowedMimeTypes["image/svg+xml"] {
		t.Fatalf("image/svg+xml must NOT be in allowedMimeTypes (regression: stored XSS allowlisted)")
	}
}

// TestOctetStreamFallbackForSVG 覆盖 PR #597 review 指出的绕过路径:
// detectedMime 退化为 application/octet-stream 时,扩展名兜底必须把 .svg 抬高为
// image/svg+xml,从而被白名单拒绝。
func TestOctetStreamFallbackForSVG(t *testing.T) {
	for _, name := range []string{"payload.svg", "payload.svgz"} {
		mimeType := "application/octet-stream"
		if guessed := guessMimeType(name); guessed != "application/octet-stream" {
			mimeType = guessed
		}
		if allowedMimeTypes[mimeType] {
			t.Errorf("%s fallback resolved to %q which is in allowedMimeTypes — bypass present", name, mimeType)
		}
		if mimeType != "image/svg+xml" {
			t.Errorf("expected fallback mime %q for %s, got %q", "image/svg+xml", name, mimeType)
		}
	}
}

// TestXMLSniffedSVGStillBlocked 文档化并锁死 text/xml 嗅探绕过:
// 带 <?xml ?> 头的 SVG 会被 http.DetectContentType 嗅探为 "text/xml; charset=utf-8",
// 而 text/xml 在 allowedMimeTypes 中(OOXML / 订阅源等需要它),不能整体下白名单。
// 因此 Upload() 必须按文件名 .svg/.svgz 在嗅探前硬拒,这是 SVG 三层防线中的第 1 层。
//
// 任何修改使 Upload() 不再调用 guessMimeType(fh.Filename) 进行入口判定,都会让此攻击复活。
func TestXMLSniffedSVGStillBlocked(t *testing.T) {
	svgPayload := []byte(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`)
	sniffed := http.DetectContentType(svgPayload)
	if !strings.HasPrefix(sniffed, "text/xml") {
		t.Logf("注意: http.DetectContentType 行为变化, 当前嗅探结果 = %q", sniffed)
	}
	// 即便嗅探落入白名单, 文件名层入口必须仍然拒收。
	if guessMimeType("evil.svg") != "image/svg+xml" {
		t.Fatalf("entry-guard predicate broken: .svg no longer maps to image/svg+xml")
	}
}

// TestUploadRejectsSVGByFilename 集成校验入口护栏: 直接驱动 Upload() 拿到 fh,
// 不需要 DB / 存储后端 —— Upload 第一步就应根据文件名拒收 .svg / .svgz。
func TestUploadRejectsSVGByFilename(t *testing.T) {
	cases := []struct {
		filename string
		body     []byte
	}{
		{"evil.svg", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`)},
		{"evil.SVG", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)},
		{"evil.svgz", []byte{0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0}}, // gzip magic
	}
	for _, tc := range cases {
		fh := newFileHeader(t, tc.filename, tc.body)
		svc := &MediaService{}
		_, err := svc.Upload(nil, fh, nil, nil)
		if err == nil {
			t.Errorf("Upload(%q) returned nil error — SVG entry guard bypassed", tc.filename)
			continue
		}
		if !strings.Contains(err.Error(), "image/svg+xml") {
			t.Errorf("Upload(%q) error = %v, want substring %q", tc.filename, err, "image/svg+xml")
		}
	}
}

// newFileHeader 构造一个真正的 *multipart.FileHeader,用于在不依赖 HTTP server / DB
// 的前提下驱动 MediaService.Upload。
func newFileHeader(t *testing.T, filename string, body []byte) *multipart.FileHeader {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	hdr := make(textproto.MIMEHeader)
	hdr.Set("Content-Disposition", `form-data; name="file"; filename="`+filename+`"`)
	hdr.Set("Content-Type", "application/octet-stream")
	part, err := w.CreatePart(hdr)
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	reader := multipart.NewReader(&buf, w.Boundary())
	form, err := reader.ReadForm(int64(len(body)) + 1024)
	if err != nil {
		t.Fatalf("read form: %v", err)
	}
	files := form.File["file"]
	if len(files) == 0 {
		t.Fatalf("no file parsed")
	}
	return files[0]
}
