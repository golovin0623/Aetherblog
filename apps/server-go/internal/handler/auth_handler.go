package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// AuthHandler handles all /api/v1/auth/* endpoints.
type AuthHandler struct {
	auth    *service.AuthService
	session *service.SessionService
	cfg     *config.Config
}

func NewAuthHandler(auth *service.AuthService, session *service.SessionService, cfg *config.Config) *AuthHandler {
	return &AuthHandler{auth: auth, session: session, cfg: cfg}
}

// Mount mounts all auth routes onto the given echo.Group.
func (h *AuthHandler) Mount(g *echo.Group) {
	g.POST("/login", h.Login)
	g.POST("/register", h.RegisterUser)
	g.POST("/refresh", h.Refresh)
	g.POST("/logout", h.Logout)
	g.GET("/me", h.Me, middleware.JWTAuth(h.cfg.JWT.Secret))
	g.POST("/change-password", h.ChangePassword, middleware.JWTAuth(h.cfg.JWT.Secret))
	g.PUT("/profile", h.UpdateProfile, middleware.JWTAuth(h.cfg.JWT.Secret))
	g.PUT("/avatar", h.UpdateAvatar, middleware.JWTAuth(h.cfg.JWT.Secret))
}

// POST /api/v1/auth/login
func (h *AuthHandler) Login(c echo.Context) error {
	var req dto.LoginRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}

	ctx := c.Request().Context()
	ip := c.RealIP()

	if err := h.auth.AssertLoginAllowed(ctx, req.Username, ip); err != nil {
		return response.FailWith(c, response.TooManyRequests, err.Error())
	}

	user, err := h.auth.FindByUsernameOrEmail(ctx, req.Username)
	if err != nil {
		return response.Error(c, err)
	}
	if user == nil || !h.auth.ValidatePassword(user, req.Password) {
		h.auth.RecordFailedAttempt(ctx, req.Username, ip)
		return response.FailWith(c, response.BadRequest, "用户名或密码错误")
	}

	if err := h.auth.CheckUserCanLogin(user); err != nil {
		return response.FailWith(c, response.Forbidden, err.Error())
	}

	h.auth.ClearFailedAttempts(ctx, req.Username, ip)
	h.auth.UpdateLoginInfo(ctx, user.ID, ip)

	accessToken, err := h.generateAccessToken(user)
	if err != nil {
		return response.Error(c, err)
	}
	refreshToken, err := h.session.IssueRefreshToken(ctx, user.ID)
	if err != nil {
		return response.Error(c, err)
	}

	h.writeAuthCookies(c, accessToken, refreshToken)
	return response.OK(c, h.buildLoginResponse(user, accessToken))
}

// POST /api/v1/auth/register
func (h *AuthHandler) RegisterUser(c echo.Context) error {
	var req dto.RegisterRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}

	user, err := h.auth.Register(c.Request().Context(), req.Username, req.Email, req.Password, req.Nickname)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, userInfoVO(user))
}

// POST /api/v1/auth/refresh
func (h *AuthHandler) Refresh(c echo.Context) error {
	refreshToken := getCookieValue(c, middleware.RefreshTokenCookie)
	ctx := c.Request().Context()

	userID, newRefreshToken, err := h.session.RotateRefreshToken(ctx, refreshToken)
	if err != nil {
		return response.Error(c, err)
	}
	if userID == 0 {
		h.clearAuthCookies(c)
		return response.FailWith(c, response.Unauthorized, "登录状态已过期，请重新登录")
	}

	user, err := h.auth.FindByID(ctx, userID)
	if err != nil {
		return response.Error(c, err)
	}
	if user == nil {
		h.clearAuthCookies(c)
		return response.FailWith(c, response.Unauthorized, "用户不存在")
	}
	if err := h.auth.CheckUserCanLogin(user); err != nil {
		return response.FailWith(c, response.Forbidden, err.Error())
	}

	accessToken, err := h.generateAccessToken(user)
	if err != nil {
		return response.Error(c, err)
	}

	h.writeAuthCookies(c, accessToken, newRefreshToken)
	return response.OK(c, h.buildLoginResponse(user, accessToken))
}

// GET /api/v1/auth/me
func (h *AuthHandler) Me(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	user, err := h.auth.FindByID(c.Request().Context(), lu.UserID)
	if err != nil {
		return response.Error(c, err)
	}
	if user == nil {
		return response.FailWith(c, response.NotFound, "用户不存在")
	}
	return response.OK(c, userInfoVO(user))
}

// POST /api/v1/auth/logout
func (h *AuthHandler) Logout(c echo.Context) error {
	refreshToken := getCookieValue(c, middleware.RefreshTokenCookie)
	h.session.RevokeRefreshToken(c.Request().Context(), refreshToken)
	h.clearAuthCookies(c)
	return response.OKEmpty(c)
}

// POST /api/v1/auth/change-password
func (h *AuthHandler) ChangePassword(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}

	var req dto.ChangePasswordRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}

	ctx := c.Request().Context()
	user, err := h.auth.FindByID(ctx, lu.UserID)
	if err != nil {
		return response.Error(c, err)
	}
	if user == nil {
		return response.FailWith(c, response.NotFound, "用户不存在")
	}
	if !h.auth.ValidatePassword(user, req.CurrentPassword) {
		return response.FailWith(c, response.BadRequest, "当前密码错误")
	}
	if req.CurrentPassword == req.NewPassword {
		return response.FailWith(c, response.BadRequest, "新密码不能与当前密码相同")
	}
	if err := h.auth.ChangePassword(ctx, lu.UserID, req.NewPassword); err != nil {
		return response.Error(c, err)
	}

	refreshToken := getCookieValue(c, middleware.RefreshTokenCookie)
	h.session.RevokeRefreshToken(ctx, refreshToken)
	h.clearAuthCookies(c)
	return response.OKEmpty(c)
}

// PUT /api/v1/auth/profile
func (h *AuthHandler) UpdateProfile(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}

	var req dto.UpdateProfileRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}

	user, err := h.auth.UpdateProfile(c.Request().Context(), lu.UserID, req.Nickname, req.Email)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, userInfoVO(user))
}

// PUT /api/v1/auth/avatar
func (h *AuthHandler) UpdateAvatar(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}

	var req dto.UpdateAvatarRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}

	if err := h.auth.UpdateAvatar(c.Request().Context(), lu.UserID, req.AvatarURL); err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, req.AvatarURL)
}

// --- helpers ---

func (h *AuthHandler) generateAccessToken(user *model.User) (string, error) {
	return jwtutil.GenerateToken(user.ID, user.Username, user.Role, h.cfg.JWT.Secret, h.cfg.JWT.Expiration)
}

func (h *AuthHandler) buildLoginResponse(user *model.User, accessToken string) dto.LoginResponse {
	return dto.LoginResponse{
		AccessToken:        accessToken,
		TokenType:          "Bearer",
		ExpiresIn:          h.session.AccessTokenMaxAge(),
		MustChangePassword: user.MustChangePassword,
		UserInfo:           userInfoVO(user),
	}
}

func userInfoVO(user *model.User) dto.UserInfoVO {
	return dto.UserInfoVO{
		ID:       user.ID,
		Username: user.Username,
		Email:    user.Email,
		Nickname: user.Nickname,
		Avatar:   user.Avatar,
		Role:     user.Role,
	}
}

func (h *AuthHandler) writeAuthCookies(c echo.Context, accessToken, refreshToken string) {
	secure := h.cfg.Auth.Cookie.Secure
	sameSite := h.cfg.Auth.Cookie.SameSite
	setCookie(c, middleware.AccessTokenCookie, accessToken, "/api", int(h.session.AccessTokenMaxAge()), secure, sameSite)
	setCookie(c, middleware.RefreshTokenCookie, refreshToken, "/api/v1/auth", int(h.session.RefreshTokenMaxAge()), secure, sameSite)
}

func (h *AuthHandler) clearAuthCookies(c echo.Context) {
	secure := h.cfg.Auth.Cookie.Secure
	sameSite := h.cfg.Auth.Cookie.SameSite
	setCookie(c, middleware.AccessTokenCookie, "", "/api", 0, secure, sameSite)
	setCookie(c, middleware.RefreshTokenCookie, "", "/api/v1/auth", 0, secure, sameSite)
}

func setCookie(c echo.Context, name, value, path string, maxAge int, secure bool, sameSite string) {
	cookie := new(http.Cookie)
	cookie.Name = name
	cookie.Value = value
	cookie.Path = path
	cookie.MaxAge = maxAge
	cookie.HttpOnly = true
	cookie.Secure = secure
	switch sameSite {
	case "Strict":
		cookie.SameSite = http.SameSiteStrictMode
	case "Lax":
		cookie.SameSite = http.SameSiteLaxMode
	case "None":
		cookie.SameSite = http.SameSiteNoneMode
	default:
		cookie.SameSite = http.SameSiteStrictMode
	}
	c.Response().Header().Add("Set-Cookie", cookie.String())
}

func getCookieValue(c echo.Context, name string) string {
	if cookie, err := c.Cookie(name); err == nil {
		return cookie.Value
	}
	return ""
}

// bindAndValidate binds JSON and runs validate tags. Returns a JSON error response on failure.
// It returns a non-nil error to signal the caller to stop processing.
func bindAndValidate(c echo.Context, req any) error {
	if err := c.Bind(req); err != nil {
		response.FailWith(c, response.BadRequest, "请求参数格式错误")
		return err
	}
	if err := c.Validate(req); err != nil {
		response.FailWith(c, response.BadRequest, err.Error())
		return err
	}
	return nil
}

// bindIDs parses a JSON body that is either a raw array [1,2,3] (Java format)
// or a wrapped object {"ids":[1,2,3]} (Go format). Returns the ID slice.
func bindIDs(c echo.Context) ([]int64, error) {
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		response.FailWith(c, response.BadRequest, "请求格式错误")
		return nil, err
	}
	// Try raw array first
	var ids []int64
	if err := json.Unmarshal(body, &ids); err == nil && len(ids) > 0 {
		return ids, nil
	}
	// Try wrapped object
	var wrapped struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.Unmarshal(body, &wrapped); err == nil && len(wrapped.IDs) > 0 {
		return wrapped.IDs, nil
	}
	response.FailWith(c, response.BadRequest, "缺少ID列表")
	return nil, io.ErrUnexpectedEOF
}
