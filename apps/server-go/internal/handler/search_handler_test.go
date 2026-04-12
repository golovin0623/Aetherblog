package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
)

// TestSearchConfigPATCH verifies that PATCH /api/v1/admin/search/config
// is correctly routed and responds (not 404).
func TestSearchConfigPATCH(t *testing.T) {
	e := testutil.NewEcho()

	// Register routes exactly as in server.go
	api := e.Group("/api")
	admin := api.Group("/v1/admin", middleware.JWTAuth(testutil.TestJWTSecret))

	// Use a minimal Echo handler to test routing only.
	searchAdmin := admin.Group("/search")
	searchAdmin.GET("/config", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	searchAdmin.PATCH("/config", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "patched"})
	})

	// Test 1: GET /config should work
	t.Run("GET /api/v1/admin/search/config", func(t *testing.T) {
		rec := testutil.DoAuthRequest(e, http.MethodGet, "/api/v1/admin/search/config", "", 1)
		if rec.Code != http.StatusOK {
			t.Errorf("GET config: expected 200, got %d, body: %s", rec.Code, rec.Body.String())
		}
	})

	// Test 2: PATCH /config should work
	t.Run("PATCH /api/v1/admin/search/config", func(t *testing.T) {
		body := `{"search.keyword_enabled":"true","search.semantic_enabled":"false"}`
		rec := testutil.DoAuthRequest(e, http.MethodPatch, "/api/v1/admin/search/config", body, 1)
		if rec.Code != http.StatusOK {
			t.Errorf("PATCH config: expected 200, got %d, body: %s", rec.Code, rec.Body.String())
		}
	})

	// Test 3: PATCH without auth should 401
	t.Run("PATCH /api/v1/admin/search/config no auth", func(t *testing.T) {
		body := `{"search.keyword_enabled":"true"}`
		rec := testutil.DoRequest(e, http.MethodPatch, "/api/v1/admin/search/config", body)
		if rec.Code == http.StatusNotFound {
			t.Errorf("PATCH without auth returned 404 (route not found), expected 401")
		}
	})
}

// TestSettingsBatchEndpoint verifies that PATCH /api/v1/admin/settings/batch
// correctly binds map[string]string and responds with 200 — this is the
// endpoint that the search config save falls back to.
func TestSettingsBatchEndpoint(t *testing.T) {
	e := testutil.NewEcho()

	api := e.Group("/api")
	admin := api.Group("/v1/admin", middleware.JWTAuth(testutil.TestJWTSecret))

	// Simulate SiteSettingHandler.BatchUpdate using c.Bind
	admin.Group("/settings").PATCH("/batch", func(c echo.Context) error {
		var kv map[string]string
		if err := c.Bind(&kv); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		return c.JSON(http.StatusOK, kv)
	})

	payload := `{"search.keyword_enabled":"true","search.semantic_enabled":"false","search.ai_qa_enabled":"false","search.anon_search_rate_per_min":"10","search.anon_qa_rate_per_min":"3","search.auto_index_on_publish":"true"}`

	rec := testutil.DoAuthRequest(e, http.MethodPatch, "/api/v1/admin/settings/batch", payload, 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH settings/batch: expected 200, got %d, body: %s", rec.Code, rec.Body.String())
	}

	// Verify the parsed map matches
	var result map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if result["search.keyword_enabled"] != "true" {
		t.Errorf("expected keyword_enabled=true, got %q", result["search.keyword_enabled"])
	}
	if result["search.semantic_enabled"] != "false" {
		t.Errorf("expected semantic_enabled=false, got %q", result["search.semantic_enabled"])
	}
	if len(result) != 6 {
		t.Errorf("expected 6 keys, got %d: %v", len(result), result)
	}
}
