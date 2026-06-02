package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
)

type fakeAtlasAISyncClient struct {
	gotHeaders map[string]string
	gotPath    string
	gotBody    string
	body       string
	status     int
}

func (f *fakeAtlasAISyncClient) DoSync(
	_ context.Context,
	_ string,
	path string,
	body io.Reader,
	headers map[string]string,
) (io.ReadCloser, int, error) {
	f.gotPath = path
	f.gotHeaders = headers
	if body != nil {
		raw, _ := io.ReadAll(body)
		f.gotBody = string(raw)
	}
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
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 42, Role: "AUTHOR"})
	ai := &fakeAtlasAISyncClient{body: `{"model_id":"atlas-test","candidates":[]}`}
	h := &SuggestionHandler{ai: ai, internalToken: "internal-token"}

	var out atlasExtractClaimsResponse
	if err := h.callAtlasAI(c, "/api/v1/atlas/claims/extract", map[string]any{"text": "hello"}, &out); err != nil {
		t.Fatalf("callAtlasAI returned error: %v", err)
	}
	if ai.gotPath != "/api/v1/atlas/claims/extract" {
		t.Fatalf("path = %q, want /api/v1/atlas/claims/extract", ai.gotPath)
	}
	if ai.gotHeaders["X-Internal-Service"] != "internal-token" {
		t.Fatalf("internal token header missing")
	}
	if ai.gotHeaders["X-Forwarded-User-ID"] != "42" {
		t.Fatalf("forwarded user header = %q, want 42", ai.gotHeaders["X-Forwarded-User-ID"])
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

func TestSuggestionHandlerMountsCarrierSuggestionRoute(t *testing.T) {
	e := echo.New()
	h := &SuggestionHandler{}
	h.Mount(e.Group("/atlas"), func(next echo.HandlerFunc) echo.HandlerFunc { return next })

	for _, route := range e.Routes() {
		if route.Method == http.MethodPost && route.Path == "/atlas/carriers/:id/suggestions" {
			return
		}
	}
	t.Fatalf("POST /atlas/carriers/:id/suggestions route was not mounted")
}

func TestSuggestionHandlerMountsCarrierSuggestionPreviewRoute(t *testing.T) {
	e := echo.New()
	h := &SuggestionHandler{}
	h.Mount(e.Group("/atlas"), func(next echo.HandlerFunc) echo.HandlerFunc { return next })

	for _, route := range e.Routes() {
		if route.Method == http.MethodPost && route.Path == "/atlas/carriers/:id/suggestions/preview" {
			return
		}
	}
	t.Fatalf("POST /atlas/carriers/:id/suggestions/preview route was not mounted")
}

func TestCarrierSuggestionAIPayloadIncludesCostBudget(t *testing.T) {
	budget := 0.05
	modelID := "atlas-model"
	userID := int64(42)
	payload := carrierSuggestionAIPayload(7, "Atlas root text", 8, &userID, &atlasdto.GenerateCarrierSuggestionsRequest{
		ModelID:    &modelID,
		MaxCostUSD: &budget,
	})

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	encoded := string(raw)
	if !strings.Contains(encoded, `"max_cost_usd":0.05`) {
		t.Fatalf("payload missing max_cost_usd: %s", encoded)
	}
	if !strings.Contains(encoded, `"model_id":"atlas-model"`) {
		t.Fatalf("payload missing model_id: %s", encoded)
	}
	if !strings.Contains(encoded, `"user_id":42`) {
		t.Fatalf("payload missing user_id: %s", encoded)
	}
}

func TestCarrierSuggestionAuthorIDPreservesCarrierOwner(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/atlas/carriers/7/suggestions", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 1, Role: "ADMIN"})

	ownerID := int64(99)
	got, err := carrierSuggestionAuthorID(c, &atlasmodel.Carrier{ID: 7, OwnerID: &ownerID})
	if err != nil {
		t.Fatalf("carrierSuggestionAuthorID returned error: %v", err)
	}
	if got == nil || *got != ownerID {
		t.Fatalf("authorID = %v, want carrier owner %d", got, ownerID)
	}
}

func TestCarrierSuggestionAuthorIDRejectsOwnerlessCarrier(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/atlas/carriers/7/suggestions", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 1, Role: "ADMIN"})

	got, err := carrierSuggestionAuthorID(c, &atlasmodel.Carrier{ID: 7})
	if err == nil {
		t.Fatal("expected ownerless carrier to be rejected")
	}
	if got != nil {
		t.Fatalf("authorID = %v, want nil on rejected ownerless carrier", got)
	}
}

func TestRelationSuggestionAuthorIDPreservesCommonKPOwner(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/atlas/knowledge-points/7/relation-suggestions", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(middleware.ContextKeyLoginUser, &jwtutil.LoginUser{UserID: 1, Role: "ADMIN"})

	ownerID := int64(99)
	got, err := relationSuggestionAuthorID(
		c,
		&atlasmodel.KnowledgePoint{ID: 7, AuthorID: &ownerID},
		&atlasmodel.KnowledgePoint{ID: 8, AuthorID: &ownerID},
	)
	if err != nil {
		t.Fatalf("relationSuggestionAuthorID returned error: %v", err)
	}
	if got == nil || *got != ownerID {
		t.Fatalf("authorID = %v, want common KP owner %d", got, ownerID)
	}
}

func TestNormalizeCarrierSuggestionRequestDefaultsAndCaps(t *testing.T) {
	maxCandidates, maxChars := normalizeCarrierSuggestionRequest(&atlasdto.GenerateCarrierSuggestionsRequest{})
	if maxCandidates != 8 {
		t.Fatalf("default maxCandidates = %d, want 8", maxCandidates)
	}
	if maxChars != 12000 {
		t.Fatalf("default maxChars = %d, want 12000", maxChars)
	}

	maxCandidates, maxChars = normalizeCarrierSuggestionRequest(&atlasdto.GenerateCarrierSuggestionsRequest{
		MaxCandidates: 99,
		MaxChars:      999999,
	})
	if maxCandidates != 20 {
		t.Fatalf("capped maxCandidates = %d, want 20", maxCandidates)
	}
	if maxChars != 40000 {
		t.Fatalf("capped maxChars = %d, want 40000", maxChars)
	}
}

func TestMarkdownNoteIDFromCarrierSource(t *testing.T) {
	id, ok := markdownNoteIDFromCarrierSource("notes://42")
	if !ok || id != 42 {
		t.Fatalf("parsed note source = (%d,%t), want (42,true)", id, ok)
	}

	for _, source := range []string{"notes://", "notes://abc", "media://42", "https://example.test/42"} {
		id, ok := markdownNoteIDFromCarrierSource(source)
		if ok || id != 0 {
			t.Fatalf("source %q parsed as (%d,%t), want (0,false)", source, id, ok)
		}
	}
}

func TestBlogPostIDFromCarrierSource(t *testing.T) {
	id, ok := blogPostIDFromCarrierSource("posts://42")
	if !ok || id != 42 {
		t.Fatalf("parsed post source = (%d,%t), want (42,true)", id, ok)
	}

	for _, source := range []string{"posts://", "posts://abc", "notes://42", "https://example.test/42"} {
		id, ok := blogPostIDFromCarrierSource(source)
		if ok || id != 0 {
			t.Fatalf("source %q parsed as (%d,%t), want (0,false)", source, id, ok)
		}
	}
}
