package handler

import (
	"context"
	"errors"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

const atlasScopeCanAdminKey = "atlas.canAdmin"

type atlasHandlerError struct {
	code    response.ResultCode
	message string
}

func (e *atlasHandlerError) Error() string {
	return e.message
}

func atlasError(code response.ResultCode, message string) error {
	return &atlasHandlerError{code: code, message: message}
}

func writeAtlasError(c echo.Context, err error) error {
	if err == nil {
		return nil
	}
	var atlasErr *atlasHandlerError
	if errors.As(err, &atlasErr) {
		return response.FailWith(c, atlasErr.code, atlasErr.message)
	}
	return response.Error(c, err)
}

type atlasPermissionChecker interface {
	UserHasPermission(ctx context.Context, userID int64, legacyRole string, permissionCode string) (bool, error)
}

// AtlasScopeMiddleware annotates requests with whether the user may inspect all
// Atlas data. Normal read/write permissions still come from the route middleware.
func AtlasScopeMiddleware(checker atlasPermissionChecker) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			lu := middleware.GetLoginUser(c)
			if lu == nil {
				return response.FailWith(c, response.Unauthorized, "未登录")
			}
			ok, err := checker.UserHasPermission(c.Request().Context(), lu.UserID, lu.Role, "content.atlas.admin")
			if err != nil {
				log.Error().Err(err).Int64("user_id", lu.UserID).Msg("atlas admin-scope check failed")
				return response.Error(c, err)
			}
			c.Set(atlasScopeCanAdminKey, ok)
			return next(c)
		}
	}
}

type atlasScope struct {
	UserID   int64
	CanAdmin bool
}

func currentAtlasScope(c echo.Context) (*atlasScope, error) {
	lu := middleware.GetLoginUser(c)
	if lu == nil || lu.UserID <= 0 {
		return nil, atlasError(response.Unauthorized, "未登录")
	}
	canAdmin, _ := c.Get(atlasScopeCanAdminKey).(bool)
	return &atlasScope{UserID: lu.UserID, CanAdmin: canAdmin}, nil
}

func (s *atlasScope) canAccessOwner(ownerID *int64) bool {
	if s != nil && s.CanAdmin {
		return true
	}
	return ownerID != nil && s != nil && *ownerID == s.UserID
}

func (s *atlasScope) canAccessAuthor(authorID *int64) bool {
	if s != nil && s.CanAdmin {
		return true
	}
	return authorID != nil && s != nil && *authorID == s.UserID
}

func (s *atlasScope) authorFilter(c echo.Context) (*int64, error) {
	if s == nil {
		return nil, atlasError(response.Unauthorized, "未登录")
	}
	if !s.CanAdmin {
		if v := c.QueryParam("authorId"); v != "" {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				return nil, atlasError(response.BadRequest, "无效的 authorId")
			}
			if n != s.UserID {
				return nil, atlasError(response.Forbidden, "无权切换到其他用户的 Atlas 数据")
			}
		}
		return &s.UserID, nil
	}

	if c.QueryParam("scope") == "mine" {
		return &s.UserID, nil
	}
	if v := c.QueryParam("authorId"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return nil, atlasError(response.BadRequest, "无效的 authorId")
		}
		return &n, nil
	}
	return nil, nil
}
