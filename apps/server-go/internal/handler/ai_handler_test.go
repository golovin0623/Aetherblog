package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/config"
	handlertest "github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// fakeRecorder 实现 activityRecorder 接口,用于 PR3 审计日志测试。
type fakeRecorder struct {
	mu     sync.Mutex
	events []*model.ActivityEvent
}

func (f *fakeRecorder) Create(_ context.Context, e *model.ActivityEvent) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	// 复制一份避免后续被调用方修改
	cp := *e
	f.events = append(f.events, &cp)
	return nil
}

func TestAiHandler_ProxyProvidersPreservesEncodedReservedPath(t *testing.T) {
	received := make(chan string, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case received <- r.RequestURI:
		default:
		}
		w.Header().Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		_, _ = w.Write([]byte(`{"success":true,"data":{"ok":true}}`))
	}))
	defer upstream.Close()

	h := NewAiHandler(&config.Config{
		AI: config.AIConfig{
			BaseURL:           upstream.URL,
			ConnectTimeout:    time.Second,
			ReadTimeout:       time.Second,
			StreamReadTimeout: time.Second,
		},
	}, nil)
	e := handlertest.NewEcho()
	g := e.Group("/api/v1/admin/providers")
	h.MountProviders(g)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/providers/models/%3Fstatus%3Dactive%23frag?client=web", nil)
	resp := httptest.NewRecorder()

	e.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected proxy response 200, got %d: %s", resp.Code, resp.Body.String())
	}

	select {
	case got := <-received:
		want := "/api/v1/admin/providers/models/%3Fstatus%3Dactive%23frag?client=web"
		if got != want {
			t.Fatalf("upstream RequestURI = %q, want %q", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("upstream server did not receive proxied request")
	}
}

func TestAiHandler_MapStatusToErrorPreservesBadGatewayMessage(t *testing.T) {
	h := &AiHandler{}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ai/summary", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.mapStatusToError(c, http.StatusBadGateway, "AI generation failed: invalid api key"); err != nil {
		t.Fatalf("mapStatusToError returned error: %v", err)
	}

	resp, err := handlertest.ParseResponse(rec)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected http status: %d", rec.Code)
	}
	if resp.Code != 500 {
		t.Fatalf("unexpected business code: %d", resp.Code)
	}
	if resp.Message != "AI generation failed: invalid api key" {
		t.Fatalf("unexpected message: %q", resp.Message)
	}
}

func TestAiHandler_MapStatusToErrorKeepsGenericInternalErrorForOpaque500(t *testing.T) {
	h := &AiHandler{}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ai/summary", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetPath("/api/v1/admin/ai/summary")
	c.Request().Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)

	if err := h.mapStatusToError(c, http.StatusInternalServerError, "Internal server error"); err != nil {
		t.Fatalf("mapStatusToError returned error: %v", err)
	}

	resp, err := handlertest.ParseResponse(rec)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}
	if resp.Message != "AI 服务内部错误" {
		t.Fatalf("unexpected message: %q", resp.Message)
	}
}

// TestAiHandler_HandleClientError504ReturnsGatewayTimeoutNot429 锁死回归：
// 本地 HTTP 客户端超时（被 ai_client 包成 AIClientError{StatusCode: 504}）
// 必须映射成业务码 504，而不是 429。否则前端会误显示"请求过于频繁"，
// 让用户以为被限流，实际是上游 AI 服务超时（典型场景：30s 内未拿到 LLM 完成响应）。
func TestAiHandler_HandleClientError504ReturnsGatewayTimeoutNot429(t *testing.T) {
	h := &AiHandler{}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ai/summary", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	clientErr := &service.AIClientError{StatusCode: http.StatusGatewayTimeout, Message: "AI 服务请求超时"}
	if err := h.handleClientError(c, clientErr); err != nil {
		t.Fatalf("handleClientError returned error: %v", err)
	}

	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected HTTP 504, got %d", rec.Code)
	}

	resp, err := handlertest.ParseResponse(rec)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}
	if resp.Code != 504 {
		t.Fatalf("expected business code 504 (GatewayTimeout), got %d", resp.Code)
	}
	if resp.Code == 429 {
		t.Fatalf("regression: client-side timeout still misreported as TooManyRequests (429)")
	}
	if resp.Message != "AI 服务请求超时" {
		t.Fatalf("unexpected message: %q", resp.Message)
	}
	if resp.ErrorCategory != "upstream_timeout" {
		t.Fatalf("expected errorCategory=upstream_timeout, got %q", resp.ErrorCategory)
	}
}

// TestAiHandler_MapStatusToError504ReturnsGatewayTimeout 锁死另一条路径：
// 上游 AI 服务直接回 504/408 时，业务码也必须是 504，不能再被吞成 500，
// 且上游携带的具体错误消息必须被保留（与 502/503 分支一致），不能被默认文案覆盖。
func TestAiHandler_MapStatusToError504ReturnsGatewayTimeout(t *testing.T) {
	h := &AiHandler{}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ai/summary", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.mapStatusToError(c, http.StatusGatewayTimeout, "upstream LLM timeout"); err != nil {
		t.Fatalf("mapStatusToError returned error: %v", err)
	}

	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected HTTP 504, got %d", rec.Code)
	}

	resp, err := handlertest.ParseResponse(rec)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}
	if resp.Code != 504 {
		t.Fatalf("expected business code 504, got %d", resp.Code)
	}
	if resp.Message != "upstream LLM timeout" {
		t.Fatalf("expected upstream message preserved, got %q", resp.Message)
	}
}

// TestAiHandler_MapStatusToError504FallsBackToDefaultWhenMessageEmpty 验证：
// 上游 504/408 不带 body 时，使用默认中文文案兜底，避免前端拿到空字符串。
func TestAiHandler_MapStatusToError504FallsBackToDefaultWhenMessageEmpty(t *testing.T) {
	h := &AiHandler{}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/ai/summary", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.mapStatusToError(c, http.StatusGatewayTimeout, ""); err != nil {
		t.Fatalf("mapStatusToError returned error: %v", err)
	}

	resp, err := handlertest.ParseResponse(rec)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}
	if resp.Message != "AI 服务请求超时" {
		t.Fatalf("expected default fallback message, got %q", resp.Message)
	}
}

// --- PR3 审计日志 + body limit 回归 ---

// TestAiHandler_RecordProviderProxyActivity_WritesAuditOnSuccess 验证：
// 写操作成功 (上游 ai-service 200) 时, recordProviderProxyActivity 写入一条带
// status=SUCCESS、event_type=ai.provider_proxy_write、Title 含 method+subPath
// 的 activity_events 记录。审计读的是 stash 进来的上游状态 (codex review P1
// 之后),所以测试用 stashUpstreamStatus 模拟 proxy 层已写入。
func TestAiHandler_RecordProviderProxyActivity_WritesAuditOnSuccess(t *testing.T) {
	rec := &fakeRecorder{}
	h := &AiHandler{activitySvc: rec}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/providers/credentials/42", nil)
	resp := httptest.NewRecorder()
	c := e.NewContext(req, resp)
	stashUpstreamStatus(c, http.StatusOK)

	h.recordProviderProxyActivity(c, http.MethodPut, "/credentials/42")

	if len(rec.events) != 1 {
		t.Fatalf("expected 1 event recorded, got %d", len(rec.events))
	}
	got := rec.events[0]
	if got.EventType != "ai.provider_proxy_write" {
		t.Errorf("unexpected EventType: %q", got.EventType)
	}
	if got.EventCategory == nil || *got.EventCategory != "ai" {
		t.Errorf("unexpected EventCategory: %v", got.EventCategory)
	}
	if got.Status == nil || *got.Status != "SUCCESS" {
		t.Errorf("expected Status=SUCCESS, got %v", got.Status)
	}
	if !strings.Contains(got.Title, "PUT") || !strings.Contains(got.Title, "/credentials/42") {
		t.Errorf("Title should mention method + subpath, got %q", got.Title)
	}
	if got.Description == nil || !strings.Contains(*got.Description, "HTTP 200") {
		t.Errorf("Description should contain HTTP status, got %v", got.Description)
	}
}

// TestAiHandler_RecordProviderProxyActivity_UsesUpstreamNotWrappedStatus 锁死
// codex review P1 修复:即使 c.Response().Status 是 200 (R{} 信封包装),
// 只要 proxy 层把上游真实状态 stash 到 ctx,审计就必须读上游状态。
// 没有这个保护,5xx/502 上游故障会被错误地记成 SUCCESS,Activities 页 AI 流
// 上看起来一片岁月静好,实际事故被掩盖。
func TestAiHandler_RecordProviderProxyActivity_UsesUpstreamNotWrappedStatus(t *testing.T) {
	rec := &fakeRecorder{}
	h := &AiHandler{activitySvc: rec}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/providers/credentials/1", nil)
	resp := httptest.NewRecorder()
	c := e.NewContext(req, resp)
	// 模拟生产路径:response.Fail(...) 已经把客户端响应写成 R{code:500, msg} HTTP 200,
	// 但上游 ai-service 真实返回的是 502 Bad Gateway。
	c.Response().Status = http.StatusOK
	stashUpstreamStatus(c, http.StatusBadGateway)

	h.recordProviderProxyActivity(c, http.MethodPut, "/credentials/1")

	if len(rec.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(rec.events))
	}
	got := rec.events[0]
	if got.Status == nil || *got.Status != "ERROR" {
		t.Errorf("expected Status=ERROR (5xx upstream), got %v —— audit must NOT trust wrapped HTTP 200", got.Status)
	}
	if got.Description == nil || !strings.Contains(*got.Description, "HTTP 502") {
		t.Errorf("Description should record upstream 502, got %v", got.Description)
	}
}

// TestReadUpstreamStatus_FallbackChain 验证 readUpstreamStatus 的多级回退：
// 优先 stash → c.Response().Status → 500 兜底,任何路径都不会返回 0。
func TestReadUpstreamStatus_FallbackChain(t *testing.T) {
	e := handlertest.NewEcho()

	// 1) stash 命中
	c1 := e.NewContext(httptest.NewRequest(http.MethodGet, "/x", nil), httptest.NewRecorder())
	stashUpstreamStatus(c1, http.StatusBadGateway)
	if got := readUpstreamStatus(c1); got != http.StatusBadGateway {
		t.Errorf("stash hit: want 502, got %d", got)
	}

	// 2) 未 stash,落 c.Response().Status
	c2 := e.NewContext(httptest.NewRequest(http.MethodGet, "/x", nil), httptest.NewRecorder())
	c2.Response().Status = http.StatusForbidden
	if got := readUpstreamStatus(c2); got != http.StatusForbidden {
		t.Errorf("response fallback: want 403, got %d", got)
	}

	// 3) 都没有 → 500 兜底,绝对不返回 0
	c3 := e.NewContext(httptest.NewRequest(http.MethodGet, "/x", nil), httptest.NewRecorder())
	c3.Response().Status = 0
	if got := readUpstreamStatus(c3); got != http.StatusInternalServerError {
		t.Errorf("zero fallback: want 500, got %d", got)
	}
}

// TestUpstreamStatusFromClientErr 验证 DoSync/DoStream 客户端层错误的状态映射:
// AIClientError 走 .StatusCode (允许 504 timeout 被准确归类成 ERROR);
// 其它错误一律 503 Service Unavailable。
func TestUpstreamStatusFromClientErr(t *testing.T) {
	if got := upstreamStatusFromClientErr(&service.AIClientError{StatusCode: http.StatusGatewayTimeout, Message: "timeout"}); got != http.StatusGatewayTimeout {
		t.Errorf("AIClientError 504: want 504, got %d", got)
	}
	if got := upstreamStatusFromClientErr(&service.AIClientError{StatusCode: 0, Message: "zero status"}); got != http.StatusServiceUnavailable {
		t.Errorf("AIClientError zero status: want 503 fallback, got %d", got)
	}
	if got := upstreamStatusFromClientErr(errors.New("plain net err")); got != http.StatusServiceUnavailable {
		t.Errorf("plain error: want 503, got %d", got)
	}
}

// TestAiHandler_RecordProviderProxyActivity_MarksWarningOn4xx 验证：
// 上游 4xx 时,审计记录的 Status=WARNING (符合 chk_activity_event_status
// 白名单 INFO/SUCCESS/WARNING/ERROR; 早期版本曾误用 "FAILED" 直接被 CHECK 拒绝),
// Description 仍记下真实状态码,不被默认值掩盖。
func TestAiHandler_RecordProviderProxyActivity_MarksWarningOn4xx(t *testing.T) {
	rec := &fakeRecorder{}
	h := &AiHandler{activitySvc: rec}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/providers/credentials/99", nil)
	resp := httptest.NewRecorder()
	c := e.NewContext(req, resp)
	stashUpstreamStatus(c, http.StatusUnauthorized)

	h.recordProviderProxyActivity(c, http.MethodDelete, "/credentials/99")

	if len(rec.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(rec.events))
	}
	got := rec.events[0]
	if got.Status == nil || *got.Status != "WARNING" {
		t.Errorf("expected Status=WARNING, got %v", got.Status)
	}
	if got.Description == nil || !strings.Contains(*got.Description, "HTTP 401") {
		t.Errorf("Description should contain HTTP 401, got %v", got.Description)
	}
}

// TestStatusFromHTTP 锁定 HTTP→activity status 的映射,任何后续改动都必须
// 同步更新此处与 chk_activity_event_status 白名单。
func TestStatusFromHTTP(t *testing.T) {
	cases := []struct {
		http int
		want string
	}{
		{http.StatusOK, "SUCCESS"},
		{http.StatusCreated, "SUCCESS"},
		{http.StatusBadRequest, "WARNING"},
		{http.StatusUnauthorized, "WARNING"},
		{http.StatusInternalServerError, "ERROR"},
		{http.StatusBadGateway, "ERROR"},
	}
	for _, tc := range cases {
		if got := statusFromHTTP(tc.http); got != tc.want {
			t.Errorf("statusFromHTTP(%d) = %q, want %q", tc.http, got, tc.want)
		}
	}
}

// TestAiHandler_RecordProviderProxyActivity_NilSvcDoesNotPanic 验证：
// activitySvc 为 nil 时 (兼容老调用方 / 关闭审计场景), 调用不 panic。
func TestAiHandler_RecordProviderProxyActivity_NilSvcDoesNotPanic(t *testing.T) {
	h := &AiHandler{activitySvc: nil}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/providers/", nil)
	resp := httptest.NewRecorder()
	c := e.NewContext(req, resp)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("nil activitySvc caused panic: %v", r)
		}
	}()
	h.recordProviderProxyActivity(c, http.MethodPost, "/")
}

// TestAiHandler_MountProviders_BodyLimitRejectsOversize 验证：
// MountProviders 路由组上 5MB body limit 生效, 6MB POST 必须被中间件拦下,
// 不会进入 ProxyProviders 处理函数 (从而避免 OOM-DoS / 大流量浪费 ai-service 算力)。
func TestAiHandler_MountProviders_BodyLimitRejectsOversize(t *testing.T) {
	rec := &fakeRecorder{}
	h := &AiHandler{activitySvc: rec}
	e := handlertest.NewEcho()
	g := e.Group("/api/v1/admin/providers")
	h.MountProviders(g)

	// 构造 6MB payload, 远超 5MB 限制。
	oversize := strings.Repeat("a", 6*1024*1024)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/providers/credentials", strings.NewReader(oversize))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.ContentLength = int64(len(oversize))
	resp := httptest.NewRecorder()

	e.ServeHTTP(resp, req)

	if resp.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for oversize POST, got %d", resp.Code)
	}
	// body limit 在中间件层拦下, ProxyProviders 不应被命中, 因此不会有审计记录。
	if len(rec.events) != 0 {
		t.Errorf("body-limit-rejected request should not produce audit, got %d events", len(rec.events))
	}
}
