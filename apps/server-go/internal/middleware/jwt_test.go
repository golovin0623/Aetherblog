package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
)

// TestRequirePasswordRotated 验证三态：
//  1. 未登录（context 没有 LoginUser） → 401
//  2. 已登录且 mcp=false → 放行调用下游 handler
//  3. 已登录且 mcp=true → 403，下游 handler 不被调用
//
// 这是方案 B 的安全核心：只有装上这个中间件，默认密码账号才会被关在
// "改密 + 登出 + 查自身" 的小笼子里，而不是带着完整 JWT 满地跑。
func TestRequirePasswordRotated(t *testing.T) {
	mw := RequirePasswordRotated()

	makeNext := func(called *bool) echo.HandlerFunc {
		return func(c echo.Context) error {
			*called = true
			return c.NoContent(http.StatusOK)
		}
	}

	t.Run("unauthenticated_context_returns_401", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		called := false
		_ = mw(makeNext(&called))(c)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, 期望 401", rec.Code)
		}
		if called {
			t.Error("下游 handler 不应被调用")
		}
	})

	t.Run("rotated_user_passes_through", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.Set(ContextKeyLoginUser, &jwtutil.LoginUser{
			UserID:             1,
			Username:           "alice",
			Role:               "USER",
			MustChangePassword: false,
		})

		called := false
		_ = mw(makeNext(&called))(c)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, 期望 200", rec.Code)
		}
		if !called {
			t.Error("下游 handler 应该被调用")
		}
	})

	t.Run("must_change_password_user_blocked", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.Set(ContextKeyLoginUser, &jwtutil.LoginUser{
			UserID:             1,
			Username:           "admin",
			Role:               "ADMIN",
			MustChangePassword: true,
		})

		called := false
		_ = mw(makeNext(&called))(c)

		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, 期望 403", rec.Code)
		}
		if called {
			t.Error("下游 handler 不应被调用 —— 默认密码账号必须先改密")
		}
	})
}
