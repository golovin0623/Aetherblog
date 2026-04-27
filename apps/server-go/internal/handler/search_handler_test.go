package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
)

// TestSearchConfigPATCH 验证 PATCH /api/v1/admin/search/config
// 路由正确注册并能够响应（不返回 404）。
func TestSearchConfigPATCH(t *testing.T) {
	e := testutil.NewEcho()

	// 按 server.go 中完全相同的方式注册路由
	api := e.Group("/api")
	admin := api.Group("/v1/admin", middleware.JWTAuth(testutil.TestJWTSecret))

	// 使用最小化的 Echo handler 仅测试路由是否生效。
	searchAdmin := admin.Group("/search")
	searchAdmin.GET("/config", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})
	searchAdmin.PATCH("/config", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "patched"})
	})

	// 测试 1：GET /config 应能正常响应
	t.Run("GET /api/v1/admin/search/config", func(t *testing.T) {
		rec := testutil.DoAuthRequest(e, http.MethodGet, "/api/v1/admin/search/config", "", 1)
		if rec.Code != http.StatusOK {
			t.Errorf("GET config: expected 200, got %d, body: %s", rec.Code, rec.Body.String())
		}
	})

	// 测试 2：PATCH /config 应能正常响应
	t.Run("PATCH /api/v1/admin/search/config", func(t *testing.T) {
		body := `{"search.keyword_enabled":"true","search.semantic_enabled":"false"}`
		rec := testutil.DoAuthRequest(e, http.MethodPatch, "/api/v1/admin/search/config", body, 1)
		if rec.Code != http.StatusOK {
			t.Errorf("PATCH config: expected 200, got %d, body: %s", rec.Code, rec.Body.String())
		}
	})

	// 测试 3：未认证的 PATCH 应返回 401
	t.Run("PATCH /api/v1/admin/search/config no auth", func(t *testing.T) {
		body := `{"search.keyword_enabled":"true"}`
		rec := testutil.DoRequest(e, http.MethodPatch, "/api/v1/admin/search/config", body)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("PATCH without auth: expected 401, got %d, body: %s", rec.Code, rec.Body.String())
		}
	})
}

// TestSettingsBatchEndpoint 验证 PATCH /api/v1/admin/settings/batch
// 能正确绑定 map[string]string 并返回 200 —— 该端点是搜索配置保存的
// 降级回退入口。
func TestSettingsBatchEndpoint(t *testing.T) {
	e := testutil.NewEcho()

	api := e.Group("/api")
	admin := api.Group("/v1/admin", middleware.JWTAuth(testutil.TestJWTSecret))

	// 使用 c.Bind 模拟 SiteSettingHandler.BatchUpdate 的行为
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

	// 验证解析后的 map 与预期一致
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
