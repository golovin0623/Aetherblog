package middleware

import (
	"context"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// PermissionChecker 是 RBAC 中间件依赖的最小接口。
// 由 service.AccessService 实现，避免 middleware 包直接依赖 service 包形成循环。
type PermissionChecker interface {
	UserHasPermission(ctx context.Context, userID int64, legacyRole string, permissionCode string) (bool, error)
}

// RequirePermission 要求当前登录用户拥有指定权限代码。
// 必须挂在 JWTAuth* 之后，因为它依赖 LoginUser 已存入 Echo Context。
func RequirePermission(checker PermissionChecker, permissionCode string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			lu := GetLoginUser(c)
			if lu == nil {
				return response.FailWith(c, response.Unauthorized, "未登录")
			}
			ok, err := checker.UserHasPermission(c.Request().Context(), lu.UserID, lu.Role, permissionCode)
			if err != nil {
				log.Error().Err(err).Int64("user_id", lu.UserID).Str("permission", permissionCode).Msg("rbac permission check failed")
				return response.Error(c, err)
			}
			if !ok {
				return response.FailWith(c, response.Forbidden, "权限不足: "+permissionCode)
			}
			return next(c)
		}
	}
}
