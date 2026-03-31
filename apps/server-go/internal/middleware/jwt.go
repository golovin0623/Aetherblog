package middleware

import (
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

const (
	// AccessTokenCookie 是存储访问令牌的 HttpOnly Cookie 名称。
	AccessTokenCookie = "ab_access_token"
	// RefreshTokenCookie 是存储刷新令牌的 HttpOnly Cookie 名称。
	RefreshTokenCookie = "ab_refresh_token"

	// ContextKeyLoginUser 是 echo.Context 中存储 *jwtutil.LoginUser 的键名。
	ContextKeyLoginUser = "loginUser"
)

// JWTAuth 返回一个中间件，从 Authorization 请求头或 ab_access_token Cookie 中验证 JWT。
// 验证成功后将 *jwtutil.LoginUser 存入 ContextKeyLoginUser 对应的上下文键。
func JWTAuth(secret string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			token := extractToken(c)
			if token == "" {
				return response.FailWith(c, response.Unauthorized, "未登录或Token已过期")
			}

			claims, err := jwtutil.ParseToken(token, secret)
			if err != nil {
				return response.FailWith(c, response.Unauthorized, "Token无效")
			}

			userID := mustParseID(claims.Subject)
			if userID == 0 {
				return response.FailWith(c, response.Unauthorized, "Token无效")
			}

			c.Set(ContextKeyLoginUser, &jwtutil.LoginUser{
				UserID:   userID,
				Username: claims.Username,
				Role:     claims.Role,
			})
			return next(c)
		}
	}
}

// JWTOptional 尝试提取并解析 JWT，但不会因解析失败而拦截请求。
// 若令牌有效，则将用户信息写入上下文；否则直接放行。
func JWTOptional(secret string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if token := extractToken(c); token != "" {
				if claims, err := jwtutil.ParseToken(token, secret); err == nil {
					c.Set(ContextKeyLoginUser, &jwtutil.LoginUser{
						UserID:   mustParseID(claims.Subject),
						Username: claims.Username,
						Role:     claims.Role,
					})
				}
			}
			return next(c)
		}
	}
}

// GetLoginUser 从 Echo 上下文中获取已认证的用户信息。若未认证则返回 nil。
func GetLoginUser(c echo.Context) *jwtutil.LoginUser {
	u, _ := c.Get(ContextKeyLoginUser).(*jwtutil.LoginUser)
	return u
}

// extractToken 按优先级从请求中提取 JWT 字符串：
// 1. Authorization 请求头（Bearer 格式）
// 2. HttpOnly Cookie
func extractToken(c echo.Context) string {
	// 优先从 Authorization: Bearer <token> 头中提取
	auth := c.Request().Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	// 其次从 HttpOnly Cookie 中提取
	if cookie, err := c.Cookie(AccessTokenCookie); err == nil {
		return cookie.Value
	}
	return ""
}

// mustParseID 将字符串安全解析为 int64 用户 ID。
// 若包含非数字字符则返回 0，表示无效 ID。
func mustParseID(s string) int64 {
	var id int64
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0
		}
		id = id*10 + int64(ch-'0')
	}
	return id
}
