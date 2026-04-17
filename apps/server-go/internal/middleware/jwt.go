package middleware

import (
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtkeys"
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
//
// 保留此单密钥签名以兼容测试 fixture —— 内部委托给 JWTAuthWithKeys。
// 生产路径走 JWTAuthWithStore (server.go 在启动时构造 jwtkeys.Store)。
func JWTAuth(secret string) echo.MiddlewareFunc {
	return JWTAuthWithKeys(func() []string { return []string{secret} })
}

// JWTAuthWithStore 是生产路径：从 jwtkeys.Store 的内存快照读取 current +
// previous 两把 key 作为验签候选，热轮换期间旧 token 不会失效。
func JWTAuthWithStore(store *jwtkeys.Store) echo.MiddlewareFunc {
	return JWTAuthWithKeys(store.Verifiers)
}

// JWTAuthWithKeys 通用形式：用一个回调提供 key 列表。调用方通常走
// JWTAuth / JWTAuthWithStore 两个薄封装，不应直接引用此函数。
func JWTAuthWithKeys(keys func() []string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			token := extractToken(c)
			if token == "" {
				return response.FailWith(c, response.Unauthorized, "未登录或Token已过期")
			}

			claims, err := jwtutil.ParseTokenWithKeys(token, keys())
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
	return JWTOptionalWithKeys(func() []string { return []string{secret} })
}

// JWTOptionalWithStore 生产路径的 optional 版本。
func JWTOptionalWithStore(store *jwtkeys.Store) echo.MiddlewareFunc {
	return JWTOptionalWithKeys(store.Verifiers)
}

// JWTOptionalWithKeys 通用形式。
func JWTOptionalWithKeys(keys func() []string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if token := extractToken(c); token != "" {
				if claims, err := jwtutil.ParseTokenWithKeys(token, keys()); err == nil {
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

// AssertOwnership 返回 403 错误当调用者既非 admin 也非资源持有者。
// 在 handler 层读取目标资源后调用；admin 角色直接放行。
//
// SECURITY (VULN-IDOR-cluster, 2026-04-17): 深度防御，与 RequireRole 在 group
// 层互补，不可互相替代。用法：
//
//	existing, _ := h.svc.GetByID(ctx, id)
//	if err := middleware.AssertOwnership(c, existing.AuthorID); err != nil {
//	    return err // helper 已写入响应
//	}
func AssertOwnership(c echo.Context, ownerID *int64) error {
	lu := GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	if strings.ToLower(lu.Role) == "admin" {
		return nil
	}
	if ownerID == nil || *ownerID != lu.UserID {
		return response.FailWith(c, response.Forbidden, "无权操作他人资源")
	}
	return nil
}

// RequireRole 返回一个中间件，检查已认证用户是否具有指定角色之一。
// 必须在 JWTAuth 之后使用，确保 LoginUser 已存入上下文。
func RequireRole(roles ...string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			lu := GetLoginUser(c)
			if lu == nil {
				return response.FailWith(c, response.Unauthorized, "未登录")
			}
			userRole := strings.ToLower(lu.Role)
			for _, r := range roles {
				if strings.ToLower(r) == userRole {
					return next(c)
				}
			}
			return response.FailWith(c, response.Forbidden, "权限不足")
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
// 若包含非数字字符或溢出则返回 0，表示无效 ID。
func mustParseID(s string) int64 {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return id
}
