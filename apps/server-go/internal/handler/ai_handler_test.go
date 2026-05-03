package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/labstack/echo/v4"

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
// 写操作成功 (HTTP 2xx) 时, recordProviderProxyActivity 写入一条带
// status=SUCCESS、event_type=ai.provider_proxy_write、Title 含 method+subPath
// 的 activity_events 记录。
func TestAiHandler_RecordProviderProxyActivity_WritesAuditOnSuccess(t *testing.T) {
	rec := &fakeRecorder{}
	h := &AiHandler{activitySvc: rec}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/providers/credentials/42", nil)
	resp := httptest.NewRecorder()
	c := e.NewContext(req, resp)
	c.Response().Status = http.StatusOK

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

// TestAiHandler_RecordProviderProxyActivity_MarksFailedOn4xx 验证：
// 写操作返回 4xx 时,审计记录的 Status=FAILED, 但 Description 仍记下真实
// 状态码,不被默认值掩盖。
func TestAiHandler_RecordProviderProxyActivity_MarksFailedOn4xx(t *testing.T) {
	rec := &fakeRecorder{}
	h := &AiHandler{activitySvc: rec}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/providers/credentials/99", nil)
	resp := httptest.NewRecorder()
	c := e.NewContext(req, resp)
	c.Response().Status = http.StatusUnauthorized

	h.recordProviderProxyActivity(c, http.MethodDelete, "/credentials/99")

	if len(rec.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(rec.events))
	}
	got := rec.events[0]
	if got.Status == nil || *got.Status != "FAILED" {
		t.Errorf("expected Status=FAILED, got %v", got.Status)
	}
	if got.Description == nil || !strings.Contains(*got.Description, "HTTP 401") {
		t.Errorf("Description should contain HTTP 401, got %v", got.Description)
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
