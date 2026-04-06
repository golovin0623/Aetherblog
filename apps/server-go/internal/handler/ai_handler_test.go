package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	handlertest "github.com/golovin0623/aetherblog-server/internal/handler/testutil"
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
