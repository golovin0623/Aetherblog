package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/config"
	handlertest "github.com/golovin0623/aetherblog-server/internal/handler/testutil"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
)

// TestAuthHandler_GetJWTSecretMeta_ReturnsErrorWhenRepoMissing 验证：
// jwtRepo 未注入时端点必须显式失败,而不是 panic。这是兼容老调用方
// (NewAuthHandler 旧签名传 nil) 的最低保证 —— 端点宁可返回错误也不能裸崩。
func TestAuthHandler_GetJWTSecretMeta_ReturnsErrorWhenRepoMissing(t *testing.T) {
	h := &AuthHandler{}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/auth/jwt-secret-meta", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetJWTSecretMeta(c); err != nil {
		t.Fatalf("GetJWTSecretMeta returned error: %v", err)
	}
	resp, err := handlertest.ParseResponse(rec)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}
	if resp.Code != 500 {
		t.Errorf("expected business code 500, got %d", resp.Code)
	}
	if resp.Message == "" {
		t.Errorf("expected non-empty message")
	}
}

func TestRotationIntervalDays_ReturnsZeroWhenDisabled(t *testing.T) {
	if got := rotationIntervalDays(0); got != 0 {
		t.Errorf("expected disabled interval to return 0, got %d", got)
	}
}

func TestRotationIntervalDays_ReturnsOneForSubDayInterval(t *testing.T) {
	if got := rotationIntervalDays(12 * time.Hour); got != 1 {
		t.Errorf("expected sub-day interval to return 1, got %d", got)
	}
}

func TestPreviousGraceHours_DefaultsToFortyEightWhenUnset(t *testing.T) {
	if got := previousGraceHours(0); got != 48 {
		t.Errorf("expected unset grace to default to 48, got %d", got)
	}
}

func TestClearAuthCookiesExpiresReaderScopedAccessCookie(t *testing.T) {
	h := &AuthHandler{
		cfg: &config.Config{
			Auth: config.AuthConfig{
				Cookie: config.CookieConfig{Secure: true, SameSite: "Lax"},
			},
		},
	}
	e := handlertest.NewEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h.clearAuthCookies(c)

	cookies := rec.Header().Values("Set-Cookie")
	assertSetCookie(t, cookies, middleware.AccessTokenCookie, "/api")
	assertSetCookie(t, cookies, middleware.AccessTokenCookie, readerAccessCookiePath)
	assertSetCookie(t, cookies, middleware.RefreshTokenCookie, "/api/v1/auth")
}

// TestFormatNullableTime_ReturnsNilForNilPtr 验证：
// nil 输入返回 nil 而不是空字符串。前端依赖 null 来隐藏对应行 —— 空字符串
// 会让 UI 看起来"有但没填"反而更糟。
func TestFormatNullableTime_ReturnsNilForNilPtr(t *testing.T) {
	if got := formatNullableTime(nil); got != nil {
		t.Errorf("expected nil for nil ptr, got %v", got)
	}
}

// TestFormatNullableTime_ReturnsRFC3339ForRealTime 验证：
// 非空指针返回 RFC3339 字符串,匹配前端 new Date(s) 的解析期望。
func TestFormatNullableTime_ReturnsRFC3339ForRealTime(t *testing.T) {
	tm := time.Date(2026, 5, 3, 12, 34, 56, 0, time.UTC)
	got := formatNullableTime(&tm)
	if s, ok := got.(string); !ok || s != "2026-05-03T12:34:56Z" {
		t.Errorf("expected RFC3339 string, got %v", got)
	}
}

func assertSetCookie(t *testing.T, cookies []string, name, path string) {
	t.Helper()
	for _, cookie := range cookies {
		if strings.HasPrefix(cookie, name+"=") &&
			strings.Contains(cookie, "Path="+path) &&
			strings.Contains(cookie, "Max-Age=0") {
			return
		}
	}
	t.Fatalf("missing expired cookie %s at path %s in %#v", name, path, cookies)
}
