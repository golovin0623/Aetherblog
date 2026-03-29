package middleware

import (
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

const (
	AccessTokenCookie  = "ab_access_token"
	RefreshTokenCookie = "ab_refresh_token"

	// ContextKeyLoginUser is the echo.Context key where *jwtutil.LoginUser is stored.
	ContextKeyLoginUser = "loginUser"
)

// JWTAuth returns a middleware that validates JWT from Authorization header OR ab_access_token cookie.
// On success it stores *jwtutil.LoginUser under ContextKeyLoginUser.
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

// JWTOptional tries to extract the JWT but does NOT block the request on failure.
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

// GetLoginUser retrieves the authenticated user from the context. Returns nil if not authenticated.
func GetLoginUser(c echo.Context) *jwtutil.LoginUser {
	u, _ := c.Get(ContextKeyLoginUser).(*jwtutil.LoginUser)
	return u
}

func extractToken(c echo.Context) string {
	// 1. Authorization: Bearer <token>
	auth := c.Request().Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	// 2. HttpOnly Cookie
	if cookie, err := c.Cookie(AccessTokenCookie); err == nil {
		return cookie.Value
	}
	return ""
}

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
