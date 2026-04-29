package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	handlertest "github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

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
// 上游 AI 服务直接回 504/408 时，业务码也必须是 504，不能再被吞成 500。
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
}
