package service

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// fakeFolderLookup / fakePermLookup 实现 service.folderLookup / service.permLookup
// 接口,允许 assertFolderWritable 在不接 sql.DB 的情况下做表驱动测试。
type fakeFolderLookup struct {
	folders map[int64]*model.MediaFolder
	err     error
}

func (f *fakeFolderLookup) FindByID(_ context.Context, id int64) (*model.MediaFolder, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.folders[id], nil
}

type fakePermLookup struct {
	allow map[[2]int64]bool // (folderID, userID) → granted
	err   error
}

func (p *fakePermLookup) HasWriteAccess(_ context.Context, folderID, userID int64) (bool, error) {
	if p.err != nil {
		return false, p.err
	}
	return p.allow[[2]int64{folderID, userID}], nil
}

func ptrInt64(v int64) *int64 { return &v }

// 批次 2:assertFolderWritable 的覆盖矩阵。
//
// 维度:folderID(nil/有/不存在/system/owner mismatch + 显式授权 + 显式无授权 + repo error + nil uploader)。
func TestAssertFolderWritable(t *testing.T) {
	owner := int64(7)
	other := int64(99)

	cases := []struct {
		name       string
		folderID   *int64
		uploader   *int64
		folders    map[int64]*model.MediaFolder
		permGrant  map[[2]int64]bool
		folderErr  error
		permErr    error
		wantErrSub string // "" 表示无错;非空表示 err.Error() 包含此子串
	}{
		{
			name:     "folderID nil → 放行",
			folderID: nil,
			uploader: &owner,
		},
		{
			name:       "folder 不存在 → 拒绝",
			folderID:   ptrInt64(42),
			uploader:   &owner,
			folders:    map[int64]*model.MediaFolder{},
			wantErrSub: "目标文件夹不存在",
		},
		{
			name:     "folder.OwnerID nil(系统) → 放行",
			folderID: ptrInt64(1),
			uploader: &owner,
			folders:  map[int64]*model.MediaFolder{1: {ID: 1, OwnerID: nil}},
		},
		{
			name:     "uploader == owner → 放行",
			folderID: ptrInt64(1),
			uploader: &owner,
			folders:  map[int64]*model.MediaFolder{1: {ID: 1, OwnerID: &owner}},
		},
		{
			name:       "uploader != owner 且无授权 → 拒绝",
			folderID:   ptrInt64(1),
			uploader:   &other,
			folders:    map[int64]*model.MediaFolder{1: {ID: 1, OwnerID: &owner}},
			wantErrSub: "无权写入",
		},
		{
			name:      "uploader != owner 但有 write 授权 → 放行",
			folderID:  ptrInt64(1),
			uploader:  &other,
			folders:   map[int64]*model.MediaFolder{1: {ID: 1, OwnerID: &owner}},
			permGrant: map[[2]int64]bool{{1, other}: true},
		},
		{
			name:       "uploader 为 nil 且 folder 有 owner → 拒绝",
			folderID:   ptrInt64(1),
			uploader:   nil,
			folders:    map[int64]*model.MediaFolder{1: {ID: 1, OwnerID: &owner}},
			wantErrSub: "无权写入",
		},
		{
			name:     "uploader 为 nil 且 folder 是系统 → 放行",
			folderID: ptrInt64(1),
			uploader: nil,
			folders:  map[int64]*model.MediaFolder{1: {ID: 1, OwnerID: nil}},
		},
		{
			name:       "folderRepo 报错 → 包装错误",
			folderID:   ptrInt64(1),
			uploader:   &owner,
			folderErr:  errors.New("db down"),
			wantErrSub: "folder lookup failed",
		},
		{
			name:       "permRepo 报错 → 包装错误",
			folderID:   ptrInt64(1),
			uploader:   &other,
			folders:    map[int64]*model.MediaFolder{1: {ID: 1, OwnerID: &owner}},
			permErr:    errors.New("db down"),
			wantErrSub: "permission lookup failed",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &MediaService{}
			svc.SetFolderAccess(
				&fakeFolderLookup{folders: tc.folders, err: tc.folderErr},
				&fakePermLookup{allow: tc.permGrant, err: tc.permErr},
			)
			err := svc.assertFolderWritable(context.Background(), tc.folderID, tc.uploader)
			if tc.wantErrSub == "" {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErrSub)
			}
			if !strings.Contains(err.Error(), tc.wantErrSub) {
				t.Fatalf("expected error containing %q, got %q", tc.wantErrSub, err.Error())
			}
		})
	}
}

// 批次 2:依赖未注入时 assertFolderWritable 必须保持向后兼容 — 不拒任何上传。
func TestAssertFolderWritable_BackwardCompat(t *testing.T) {
	svc := &MediaService{} // 不调 SetFolderAccess
	if err := svc.assertFolderWritable(context.Background(), ptrInt64(1), ptrInt64(99)); err != nil {
		t.Errorf("依赖未注入时不应拒绝上传,got: %v", err)
	}
}

// PR #647 fix:assertFolderWritable 用 sentinel error,handler 层 errors.Is 才能区分
// "权限拒绝(403)" vs "folder 不存在(400)" vs "其它服务器错误(500)"。这个测试锁住
// 语义,防止有人把 sentinel 改回字符串 errors.New(...) 时 PR review 不被拦截。
func TestAssertFolderWritable_SentinelErrors(t *testing.T) {
	owner := int64(7)
	other := int64(99)

	svcForbidden := &MediaService{}
	svcForbidden.SetFolderAccess(
		&fakeFolderLookup{folders: map[int64]*model.MediaFolder{1: {ID: 1, OwnerID: &owner}}},
		&fakePermLookup{},
	)
	if err := svcForbidden.assertFolderWritable(context.Background(), ptrInt64(1), &other); !errors.Is(err, ErrFolderForbidden) {
		t.Errorf("非 owner 无授权应返回 ErrFolderForbidden,got: %v", err)
	}

	svcMissing := &MediaService{}
	svcMissing.SetFolderAccess(
		&fakeFolderLookup{folders: map[int64]*model.MediaFolder{}},
		&fakePermLookup{},
	)
	if err := svcMissing.assertFolderWritable(context.Background(), ptrInt64(42), &owner); !errors.Is(err, ErrFolderNotFound) {
		t.Errorf("folder 不存在应返回 ErrFolderNotFound,got: %v", err)
	}
}

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
// image/svg+xml,从而被白名单拒绝。直接驱动 resolveMimeWithFallback 而非重写其逻辑,
// 这样回退条件被改成精确匹配 / 缺失 octet-stream 分支等回归都能被捕获。
func TestOctetStreamFallbackForSVG(t *testing.T) {
	for _, name := range []string{"payload.svg", "payload.svgz"} {
		got := resolveMimeWithFallback("application/octet-stream", name)
		if allowedMimeTypes[got] {
			t.Errorf("%s fallback resolved to %q which is in allowedMimeTypes — bypass present", name, got)
		}
		if got != "image/svg+xml" {
			t.Errorf("expected fallback mime %q for %s, got %q", "image/svg+xml", name, got)
		}
	}
}


// TestTextPlainFallbackForSVG 直接驱动生产的 resolveMimeWithFallback 而非复制其逻辑,
// 因此能真正捕获以下回归(PR #615 Codex review 指出的盲区):
//   - 把 strings.HasPrefix(mime, "text/plain") 改成精确匹配 "text/plain"
//     → "text/plain; charset=utf-8" 不再触发兜底,SVG 载荷以 text/plain 直通白名单。
//   - 整段 if 被删 / 条件被反转 / guessed 判空逻辑被改坏。
// 仅靠 guessMimeType 单边验证(老实现)不会捕获以上任何一条。
//
// 覆盖矩阵:
//  1. text/plain (无 charset) + .svg
//  2. text/plain; charset=utf-8 + .svg / .SVGZ —— 现实嗅探主路径
//  3. text/plain; charset=us-ascii + .svgz —— charset 别名场景
func TestTextPlainFallbackForSVG(t *testing.T) {
	cases := []struct {
		detected string
		filename string
	}{
		{"text/plain", "payload.svg"},
		{"text/plain; charset=utf-8", "payload.svg"},
		{"text/plain; charset=utf-8", "payload.SVGZ"},
		{"text/plain; charset=us-ascii", "payload.svgz"},
	}
	for _, tc := range cases {
		got := resolveMimeWithFallback(tc.detected, tc.filename)
		if got != "image/svg+xml" {
			t.Errorf("resolveMimeWithFallback(%q, %q) = %q, want %q (text/plain fallback regression)",
				tc.detected, tc.filename, got, "image/svg+xml")
		}
		if allowedMimeTypes[got] {
			t.Errorf("resolveMimeWithFallback(%q, %q) → %q is in allowedMimeTypes — XSS bypass",
				tc.detected, tc.filename, got)
		}
	}
}

// TestResolveMimeWithFallbackPreservesAllowedDetected 锁死回退条件最小覆盖面 —
// 嗅探已经返回具体白名单类型时不要被扩展名覆盖,否则会破坏跨 MIME 上传场景。
func TestResolveMimeWithFallbackPreservesAllowedDetected(t *testing.T) {
	cases := []struct {
		detected string
		filename string
		want     string
	}{
		{"image/jpeg", "photo.jpg", "image/jpeg"},
		{"image/png", "photo.png", "image/png"},
		{"application/pdf", "doc.pdf", "application/pdf"},
		// text/xml 嗅探(.xml 真实文件)必须原样保留,不能落入回退。
		{"text/xml; charset=utf-8", "feed.xml", "text/xml; charset=utf-8"},
		// 嗅探退化为 zip 时, 必须按扩展名抬升为具体 OOXML 类型。
		{"application/zip", "doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
	}
	for _, tc := range cases {
		if got := resolveMimeWithFallback(tc.detected, tc.filename); got != tc.want {
			t.Errorf("resolveMimeWithFallback(%q, %q) = %q, want %q",
				tc.detected, tc.filename, got, tc.want)
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

// TestUpdateContentRejectsSVGByFilename 覆盖 PR #615 Gemini review 指出的 UpdateContent
// 防御缝隙: UpdateContent 之前缺少 .svg/.svgz 文件名硬拒,且 MIME 回退不含 text/plain 前缀。
// 修复后应在 repo.FindByID 之前就按扩展名拒收 — 因此本测试即便不注入 repo / store 也能驱动。
//
// 任何让 UpdateContent 把 .svg/.svgz 写入存储的回归(例如把 rejectSVGByFilename 调用挪后
// 到嗅探之后,或干脆删掉)都会导致此测试失败。
func TestUpdateContentRejectsSVGByFilename(t *testing.T) {
	cases := []struct {
		filename string
		body     []byte
	}{
		{"evil.svg", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`)},
		{"evil.SVG", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)},
		{"evil.svgz", []byte{0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0}}, // gzip magic
	}
	for _, tc := range cases {
		svc := &MediaService{}
		_, err := svc.UpdateContent(context.Background(), UpdateContentParams{
			MediaID:  1,
			NewBody:  bytes.NewReader(tc.body),
			NewSize:  int64(len(tc.body)),
			Filename: tc.filename,
		})
		if err == nil {
			t.Errorf("UpdateContent(%q) returned nil error — SVG entry guard bypassed", tc.filename)
			continue
		}
		if !strings.Contains(err.Error(), "image/svg+xml") {
			t.Errorf("UpdateContent(%q) error = %v, want substring %q", tc.filename, err, "image/svg+xml")
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
