package handler

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/handler/testutil"
)

// newMultipartUpload 构造一个 `file` 字段携带 size 字节内容的 multipart 请求。
func newMultipartUpload(t *testing.T, filename string, size int) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := part.Write(bytes.Repeat([]byte("A"), size)); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/media/upload", &buf)
	req.Header.Set(echo.HeaderContentType, w.FormDataContentType())
	req.ContentLength = int64(buf.Len())
	return req
}

// TestGuardUploadBody_RejectsOversizeBeforeParsing 验证:
// guardUploadBody 装的 MaxBytesReader 会在 multipart 解析阶段就把超限请求体打断,
// 而不是让 c.FormFile 把整个文件读进临时盘之后再由业务校验拒绝。
//
// 这是"上传 500MB 文件先写满磁盘再回 400"这一资源浪费路径的堵口测试。
func TestGuardUploadBody_RejectsOversizeBeforeParsing(t *testing.T) {
	e := testutil.NewEcho()
	// maxUploadSize=0 → 闸门 = 0 + multipartOverheadSlack(1MB)。
	// 传 3MB 必然越界。
	req := newMultipartUpload(t, "big.pptx", 3*1024*1024)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	guardUploadBody(c, 0)

	_, err := c.FormFile("file")
	if err == nil {
		t.Fatal("expected FormFile to fail once the body exceeds the guard, got nil error")
	}
	if !isBodyTooLarge(err) {
		t.Fatalf("expected a body-too-large error, got %v", err)
	}
}

// TestGuardUploadBody_AllowsFileAtLimit 验证闸门的 slack 不会误伤"刚好卡在上限"的
// 合法文件 —— multipart 封装本身会比纯文件字节多出 boundary / part header,
// 若闸门取值等于 maxUploadSize 就会把恰好等于上限的文件判成超限。
func TestGuardUploadBody_AllowsFileAtLimit(t *testing.T) {
	const limit = 2 * 1024 * 1024

	e := testutil.NewEcho()
	req := newMultipartUpload(t, "exact.pptx", limit)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	guardUploadBody(c, limit)

	fh, err := c.FormFile("file")
	if err != nil {
		t.Fatalf("a file exactly at the limit must pass the guard, got %v", err)
	}
	if fh.Size != limit {
		t.Fatalf("expected parsed size %d, got %d", limit, fh.Size)
	}
}

// TestIsBodyTooLarge 覆盖两条判定路径:
//   - net/http 直接返回的 *http.MaxBytesError(errors.As 命中);
//   - mime/multipart 把它重新包成纯文本后的字符串兜底。
func TestIsBodyTooLarge(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"typed", &http.MaxBytesError{Limit: 1024}, true},
		{"wrapped-text", errStringOnly("multipart: NextPart: http: request body too large"), true},
		{"unrelated", errStringOnly("unexpected EOF"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isBodyTooLarge(tc.err); got != tc.want {
				t.Fatalf("isBodyTooLarge(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// TestUploadSizeExceededMsg 锁定超限文案里必须同时出现"实际生效的 MB 数"与
// "去哪儿改" —— 只说"超过限制"会让管理员完全不知道 100 这个数字从哪来。
func TestUploadSizeExceededMsg(t *testing.T) {
	msg := uploadSizeExceededMsg(100 * 1024 * 1024)
	if !strings.Contains(msg, "100 MB") {
		t.Errorf("message must state the effective limit, got %q", msg)
	}
	if !strings.Contains(msg, "设置") {
		t.Errorf("message must point at the settings page, got %q", msg)
	}
}

// errStringOnly 是一个只有文本、不携带任何可 errors.As 的具体类型的错误,
// 用来模拟 mime/multipart 把底层错误重新包装后的形态。
type errStringOnly string

func (e errStringOnly) Error() string { return string(e) }
