package handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/service"
)

func TestKBHandlerHandleSvcErrMapsProfileBadConfigToBadRequest(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/kbs/1/profiles/2", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	h := &KBHandler{}

	err := h.handleSvcErr(
		c,
		fmt.Errorf("%w: chunk_overlap_tokens (512) 必须小于 chunk_size_tokens (512)", service.ErrKBProfileBadConfig),
	)
	if err != nil {
		t.Fatalf("handleSvcErr returned error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "chunk_overlap_tokens") {
		t.Fatalf("response should include validation detail, body=%s", rec.Body.String())
	}
}
