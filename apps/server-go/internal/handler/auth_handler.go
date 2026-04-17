// Package handler 包含所有 API 端点的 Echo HTTP 处理器（控制器层）。
// 每个 Handler 结构体持有注入的 Service 依赖，并通过 Mount* 方法将路由注册至 echo.Group。
// 包级辅助函数 bindAndValidate、bindIDs、parseIntDefault 等在各 Handler 间共享复用。
package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/config"
	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/jwtutil"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// AuthHandler 负责处理所有 /api/v1/auth/* 端点。
type AuthHandler struct {
	auth        *service.AuthService
	session     *service.SessionService
	cfg         *config.Config
	activitySvc *service.ActivityService
}

// NewAuthHandler 创建一个 AuthHandler，注入所需的 Service 和配置依赖。
func NewAuthHandler(auth *service.AuthService, session *service.SessionService, cfg *config.Config, activitySvc *service.ActivityService) *AuthHandler {
	return &AuthHandler{auth: auth, session: session, cfg: cfg, activitySvc: activitySvc}
}

// Mount 将所有认证相关路由挂载到指定的 echo.Group。
func (h *AuthHandler) Mount(g *echo.Group) {
	g.POST("/login", h.Login)
	g.POST("/register", h.RegisterUser, middleware.JWTAuth(h.cfg.JWT.Secret), middleware.RequireRole("admin"))
	g.POST("/refresh", h.Refresh)
	g.POST("/logout", h.Logout)
	g.GET("/me", h.Me, middleware.JWTAuth(h.cfg.JWT.Secret))
	g.POST("/change-password", h.ChangePassword, middleware.JWTAuth(h.cfg.JWT.Secret))
	g.PUT("/profile", h.UpdateProfile, middleware.JWTAuth(h.cfg.JWT.Secret))
	g.PUT("/avatar", h.UpdateAvatar, middleware.JWTAuth(h.cfg.JWT.Secret))
}

// Login 处理 POST /api/v1/auth/login 请求。
// 校验用户凭证，通过 Redis 执行登录频率限制，
// 成功后签发 Access Token 和 Refresh Token，并以 HttpOnly Cookie 写入响应。
func (h *AuthHandler) Login(c echo.Context) error {
	var req dto.LoginRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}

	ctx := c.Request().Context()
	ip := c.RealIP()

	// 检查是否允许继续登录（频率限制）
	if err := h.auth.AssertLoginAllowed(ctx, req.Username, ip); err != nil {
		return response.FailWith(c, response.TooManyRequests, err.Error())
	}

	// 查找用户并校验密码
	user, err := h.auth.FindByUsernameOrEmail(ctx, req.Username)
	if err != nil {
		return response.Error(c, err)
	}
	if user == nil || !h.auth.ValidatePassword(user, req.Password) {
		// 记录失败次数以触发频率限制
		h.auth.RecordFailedAttempt(ctx, req.Username, ip)
		log.Warn().
			Str("username", truncateForLog(req.Username)).
			Str("ip", ip).
			Str("user_agent", c.Request().UserAgent()).
			Msg("login failed")
		return response.FailWith(c, response.BadRequest, "用户名或密码错误")
	}

	// 检查用户是否允许登录（如账号未被禁用）
	if err := h.auth.CheckUserCanLogin(user); err != nil {
		return response.FailWith(c, response.Forbidden, err.Error())
	}

	// 登录成功：清除失败记录并更新登录信息
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

	// 记录登录活动
	if h.activitySvc != nil {
		evtCat := "user"
		evtStatus := "SUCCESS"
		if err := h.activitySvc.Create(ctx, &model.ActivityEvent{
			EventType:     "user.login",
			EventCategory: &evtCat,
			Title:         "用户登录: " + user.Username,
			UserID:        &user.ID,
			IP:            &ip,
			Status:        &evtStatus,
		}); err != nil {
			log.Warn().Err(err).Msg("record activity failed")
		}
	}

	return response.OK(c, h.buildLoginResponse(user, accessToken))
}

// RegisterUser 处理 POST /api/v1/auth/register 请求。
// 创建新用户账号；若用户名或邮箱已被占用，返回 400。
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

// Refresh 处理 POST /api/v1/auth/refresh 请求。
// 轮换 HttpOnly Cookie 中存储的 Refresh Token，并签发新的 Access Token。
// 若 Refresh Token 不存在、已过期或已被吊销，返回 401。
func (h *AuthHandler) Refresh(c echo.Context) error {
	refreshToken := getCookieValue(c, middleware.RefreshTokenCookie)
	ctx := c.Request().Context()

	// 轮换 Refresh Token（旧令牌失效，返回新令牌和对应用户 ID）
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

// Me 处理 GET /api/v1/auth/me 请求。
// 返回当前已认证用户的个人资料，需携带有效 JWT。
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

// Logout 处理 POST /api/v1/auth/logout 请求。
// 在 Redis 中吊销 Refresh Token，并清除两个认证 Cookie。
func (h *AuthHandler) Logout(c echo.Context) error {
	refreshToken := getCookieValue(c, middleware.RefreshTokenCookie)
	h.session.RevokeRefreshToken(c.Request().Context(), refreshToken)
	h.clearAuthCookies(c)
	return response.OKEmpty(c)
}

// ChangePassword 处理 POST /api/v1/auth/change-password 请求。
// 校验当前密码后对新密码进行哈希，并吊销当前会话，
// 用户须使用新凭证重新登录。
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
	// 校验当前密码是否正确
	if !h.auth.ValidatePassword(user, req.CurrentPassword) {
		return response.FailWith(c, response.BadRequest, "当前密码错误")
	}
	// 新旧密码不能相同
	if req.CurrentPassword == req.NewPassword {
		return response.FailWith(c, response.BadRequest, "新密码不能与当前密码相同")
	}
	if err := h.auth.ChangePassword(ctx, lu.UserID, req.NewPassword); err != nil {
		return response.Error(c, err)
	}

	// 修改密码后吊销所有会话并清除 Cookie
	h.session.RevokeAllUserSessions(ctx, lu.UserID)
	h.clearAuthCookies(c)
	return response.OKEmpty(c)
}

// UpdateProfile 处理 PUT /api/v1/auth/profile 请求。
// 更新已认证用户的昵称和邮箱地址。
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

// UpdateAvatar 处理 PUT /api/v1/auth/avatar 请求。
// 为已认证用户设置新的头像 URL。
func (h *AuthHandler) UpdateAvatar(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}

	var req dto.UpdateAvatarRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}

	// SECURITY (VULN-047): validator 的 `uri` 约束接受 ``javascript:...`` /
	// ``data:text/html,...`` 等危险 scheme —— 通过后续被 <img> 或头像卡片
	// 渲染时触发 XSS。显式拒绝非 http(s) 绝对 URL 与非 '/' 开头的相对 URI。
	lower := strings.ToLower(strings.TrimSpace(req.AvatarURL))
	switch {
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		// 允许：带 scheme 的绝对 URL
	case strings.HasPrefix(req.AvatarURL, "/") && !strings.HasPrefix(req.AvatarURL, "//"):
		// 允许：同源绝对路径（e.g. /uploads/avatars/x.jpg）
	default:
		return response.FailWith(c, response.BadRequest, "头像 URL 必须是 http(s) 或同源绝对路径")
	}

	if err := h.auth.UpdateAvatar(c.Request().Context(), lu.UserID, req.AvatarURL); err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, req.AvatarURL)
}

// truncateForLog 截断字符串用于日志记录，避免泄露完整的用户名等敏感信息。
func truncateForLog(s string) string {
	if len(s) <= 3 {
		return "***"
	}
	return s[:3] + "***"
}

// --- 内部辅助函数 ---

// generateAccessToken 为指定用户签发 JWT Access Token。
func (h *AuthHandler) generateAccessToken(user *model.User) (string, error) {
	return jwtutil.GenerateToken(user.ID, user.Username, user.Role, h.cfg.JWT.Secret, h.cfg.JWT.Expiration)
}

// buildLoginResponse 从用户模型和 Access Token 构建 LoginResponse DTO。
func (h *AuthHandler) buildLoginResponse(user *model.User, accessToken string) dto.LoginResponse {
	return dto.LoginResponse{
		AccessToken:        accessToken,
		TokenType:          "Bearer",
		ExpiresIn:          h.session.AccessTokenMaxAge(),
		MustChangePassword: user.MustChangePassword,
		UserInfo:           userInfoVO(user),
	}
}

// userInfoVO 将用户模型转换为 UserInfoVO 数据传输对象。
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

// writeAuthCookies 将 Access Token 和 Refresh Token 以 HttpOnly Cookie 写入响应。
func (h *AuthHandler) writeAuthCookies(c echo.Context, accessToken, refreshToken string) {
	secure := h.cfg.Auth.Cookie.Secure
	sameSite := h.cfg.Auth.Cookie.SameSite
	setCookie(c, middleware.AccessTokenCookie, accessToken, "/api", int(h.session.AccessTokenMaxAge()), secure, sameSite)
	setCookie(c, middleware.RefreshTokenCookie, refreshToken, "/api/v1/auth", int(h.session.RefreshTokenMaxAge()), secure, sameSite)
}

// clearAuthCookies 将两个认证 Cookie 设为过期，以实现登出效果。
func (h *AuthHandler) clearAuthCookies(c echo.Context) {
	secure := h.cfg.Auth.Cookie.Secure
	sameSite := h.cfg.Auth.Cookie.SameSite
	setCookie(c, middleware.AccessTokenCookie, "", "/api", 0, secure, sameSite)
	setCookie(c, middleware.RefreshTokenCookie, "", "/api/v1/auth", 0, secure, sameSite)
}

// setCookie 向响应写入一个 HttpOnly Cookie，支持指定各项属性。
// sameSite 接受 "Strict"、"Lax" 或 "None"；其他值默认回退为 Strict 模式。
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

// getCookieValue 返回指定名称 Cookie 的值；若 Cookie 不存在则返回空字符串。
func getCookieValue(c echo.Context, name string) string {
	if cookie, err := c.Cookie(name); err == nil {
		return cookie.Value
	}
	return ""
}

// bindAndValidate 绑定 JSON 请求体并执行 validate 标签校验。
// 失败时写入 JSON 错误响应并返回非 nil 错误，调用方应终止后续处理。
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

// bindIDs 解析请求体中的 ID 列表，支持以下三种格式：
// 原始数组 [1,2,3]、包装对象 {"ids":[1,2,3]} 或 {"data":[1,2,3]}。
// 返回解析后的 int64 切片。
func bindIDs(c echo.Context) ([]int64, error) {
	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		response.FailWith(c, response.BadRequest, "请求格式错误")
		return nil, err
	}
	// 优先尝试解析原始数组格式
	var ids []int64
	if err := json.Unmarshal(body, &ids); err == nil && len(ids) > 0 {
		return ids, nil
	}
	// 再尝试解析带 "ids" 或 "data" 键的包装对象格式
	var wrapped struct {
		IDs  []int64 `json:"ids"`
		Data []int64 `json:"data"`
	}
	if err := json.Unmarshal(body, &wrapped); err == nil {
		if len(wrapped.IDs) > 0 {
			return wrapped.IDs, nil
		}
		if len(wrapped.Data) > 0 {
			return wrapped.Data, nil
		}
	}
	response.FailWith(c, response.BadRequest, "缺少ID列表")
	return nil, io.ErrUnexpectedEOF
}
