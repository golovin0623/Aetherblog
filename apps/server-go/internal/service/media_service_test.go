package service

import "testing"

// TestSVGRejectionPath 防回归: 确认 SVG 在"内容嗅探退化为 application/octet-stream"
// 的兜底路径下仍会被拒绝 (PR #597 review 指出的绕过)。
//
// 链路:
//  1. http.DetectContentType 返回 "application/octet-stream"
//  2. Upload() 触发扩展名兜底 -> guessMimeType("evil.svg")
//  3. 必须返回 "image/svg+xml"，且该 MIME 不能在 allowedMimeTypes 白名单中。
//
// 任何一步被改动 (e.g. 移除 ".svg" case，或把 image/svg+xml 加回白名单) 都会让
// 攻击者通过构造首字节使嗅探退化的 SVG 文件成功上传，进而触发存储型 XSS。
func TestSVGRejectionPath(t *testing.T) {
	got := guessMimeType("evil.svg")
	if got != "image/svg+xml" {
		t.Fatalf("guessMimeType(\"evil.svg\") = %q, want %q (regression: SVG fallback bypass)", got, "image/svg+xml")
	}
	if allowedMimeTypes["image/svg+xml"] {
		t.Fatalf("image/svg+xml must NOT be in allowedMimeTypes (regression: stored XSS path re-opened)")
	}
}

// TestOctetStreamFallbackForSVG 直接覆盖审阅评论中的攻击路径:
// 即便 detectedMime 退化为 application/octet-stream，扩展名兜底必须把 .svg 抬高为
// image/svg+xml，使后续白名单校验拒绝它。
func TestOctetStreamFallbackForSVG(t *testing.T) {
	const detectedMime = "application/octet-stream"

	mimeType := detectedMime
	if mimeType == "application/octet-stream" {
		if guessed := guessMimeType("payload.svg"); guessed != "application/octet-stream" {
			mimeType = guessed
		}
	}

	if allowedMimeTypes[mimeType] {
		t.Fatalf("SVG fallback resolved to %q which is in allowedMimeTypes — bypass present", mimeType)
	}
	if mimeType != "image/svg+xml" {
		t.Fatalf("expected fallback mime %q, got %q", "image/svg+xml", mimeType)
	}
}
