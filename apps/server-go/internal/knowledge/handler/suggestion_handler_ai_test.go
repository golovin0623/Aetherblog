package handler

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
)

type fakeAtlasAISyncClient struct {
	gotHeaders map[string]string
	gotPath    string
	body       string
	status     int
}

func (f *fakeAtlasAISyncClient) DoSync(
	_ context.Context,
	_ string,
	path string,
	_ io.Reader,
	headers map[string]string,
) (io.ReadCloser, int, error) {
	f.gotPath = path
	f.gotHeaders = headers
	if f.status == 0 {
		f.status = http.StatusOK
	}
	return io.NopCloser(strings.NewReader(f.body)), f.status, nil
}

func TestSuggestionHandlerCallAtlasAIUsesInternalTokenAndDecodes(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/atlas/annotations/1/suggestions", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	ai := &fakeAtlasAISyncClient{body: `{"model_id":"atlas-test","candidates":[]}`}
	h := &SuggestionHandler{ai: ai, internalToken: "internal-token"}

	var out atlasExtractClaimsResponse
	if err := h.callAtlasAI(c, "/v1/atlas/claims/extract", map[string]any{"text": "hello"}, &out); err != nil {
		t.Fatalf("callAtlasAI returned error: %v", err)
	}
	if ai.gotPath != "/v1/atlas/claims/extract" {
		t.Fatalf("path = %q, want /v1/atlas/claims/extract", ai.gotPath)
	}
	if ai.gotHeaders["X-Internal-Service"] != "internal-token" {
		t.Fatalf("internal token header missing")
	}
	if out.ModelID != "atlas-test" {
		t.Fatalf("model id = %q, want atlas-test", out.ModelID)
	}
}

func TestAnnotationTextForSuggestionFallsBackToTextQuoteSelector(t *testing.T) {
	annotation := &atlasmodel.Annotation{
		Selectors: []byte(`[
			{"type":"TextPositionSelector","start":0,"end":8},
			{"type":"TextQuoteSelector","exact":"Atlas evidence quote"}
		]`),
	}
	if got := annotationTextForSuggestion(annotation); got != "Atlas evidence quote" {
		t.Fatalf("text = %q, want quote selector exact", got)
	}
}
