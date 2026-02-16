package com.aetherblog.blog.controller;

import com.aetherblog.api.dto.auth.LoginRequest;
import com.aetherblog.api.dto.auth.LoginResponse;
import com.aetherblog.api.dto.auth.RegisterRequest;
import com.aetherblog.api.dto.auth.UpdateAvatarRequest;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.service.AuthSessionService;
import com.aetherblog.blog.service.LoginSecurityService;
import com.aetherblog.blog.service.UserService;
import com.aetherblog.common.core.domain.R;
import com.aetherblog.common.core.exception.BusinessException;
import com.aetherblog.common.core.utils.IpUtils;
import com.aetherblog.common.security.annotation.RateLimit;
import com.aetherblog.common.security.constant.AuthCookieConstants;
import com.aetherblog.common.security.domain.LoginUser;
import com.aetherblog.common.security.service.JwtService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * 认证控制器
 *
 * @ref §5.2 - 认证授权接口
 */
@Slf4j
@RestController
@RequestMapping("/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private static final String ACCESS_TOKEN_COOKIE_PATH = "/api";
    private static final String REFRESH_TOKEN_COOKIE_PATH = "/api/v1/auth";

    private final UserService userService;
    private final JwtService jwtService;
    private final AuthSessionService authSessionService;
    private final LoginSecurityService loginSecurityService;

    @Value("${auth.cookie.secure:false}")
    private boolean cookieSecure;

    @Value("${auth.cookie.same-site:Strict}")
    private String cookieSameSite;

    /**
     * 用户登录
     */
    @PostMapping("/login")
    @RateLimit(key = "auth:login", count = 10, time = 60, limitType = RateLimit.LimitType.IP)
    public R<LoginResponse> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse
    ) {
        log.info("用户登录请求: username={}", request.username());

        String identifier = request.username();
        // Security Fix: Use IpUtils to prevent IP spoofing via X-Forwarded-For
        String clientIp = IpUtils.getIpAddr(httpRequest);
        loginSecurityService.assertLoginAllowed(identifier, clientIp);

        User user = userService.findByUsernameOrEmail(identifier).orElse(null);
        if (user == null) {
            recordLoginFailure(identifier, clientIp);
            throw new BusinessException("用户名或密码错误");
        }

        userService.checkUserCanLogin(user);

        // 获取密码（通过 HTTPS 传输）
        String password = request.password();

        // 验证密码
        if (!userService.validatePassword(user, password)) {
            recordLoginFailure(identifier, clientIp);
            throw new BusinessException("用户名或密码错误");
        }

        loginSecurityService.clearFailedAttempts(identifier, clientIp);

        // 生成访问令牌与刷新令牌
        String accessToken = generateAccessToken(user);
        String refreshToken = authSessionService.issueRefreshToken(user.getId());
        writeAuthCookies(httpResponse, accessToken, refreshToken);

        // 更新登录信息
        userService.updateLoginInfo(user.getId(), clientIp);

        LoginResponse response = buildLoginResponse(user, accessToken);

        log.info("用户登录成功: userId={}, username={}, mustChangePassword={}",
                user.getId(), user.getUsername(), user.getMustChangePassword());
        return R.ok(response);
    }

    /**
     * 刷新访问令牌
     */
    @PostMapping("/refresh")
    @RateLimit(key = "auth:refresh", count = 30, time = 60, limitType = RateLimit.LimitType.IP)
    public R<LoginResponse> refresh(HttpServletRequest request, HttpServletResponse response) {
        String refreshToken = getCookieValue(request, AuthCookieConstants.REFRESH_TOKEN_COOKIE);
        AuthSessionService.RefreshSession refreshSession = authSessionService.rotateRefreshToken(refreshToken);

        if (refreshSession == null) {
            clearAuthCookies(response);
            throw new BusinessException(401, "登录状态已过期，请重新登录");
        }

        User user = userService.findById(refreshSession.userId())
                .orElseThrow(() -> new BusinessException(401, "用户不存在或登录状态无效"));

        userService.checkUserCanLogin(user);

        String accessToken = generateAccessToken(user);
        writeAuthCookies(response, accessToken, refreshSession.refreshToken());

        return R.ok(buildLoginResponse(user, accessToken));
    }

    /**
     * 用户注册
     */
    @PostMapping("/register")
    // Security: Rate limit to mitigate DoS/Spam registration (5 requests per 10 minutes per IP)
    @RateLimit(key = "auth:register", count = 5, time = 600, limitType = RateLimit.LimitType.IP)
    public R<LoginResponse.UserInfoVO> register(@Valid @RequestBody RegisterRequest request) {
        log.info("用户注册请求: username={}, email={}", request.getUsername(), request.getEmail());

        User user = userService.register(
                request.getUsername(),
                request.getEmail(),
                request.getPassword(),
                request.getNickname()
        );

        LoginResponse.UserInfoVO userInfo = LoginResponse.UserInfoVO.builder()
                .id(user.getId())
                .username(user.getUsername())
                .email(user.getEmail())
                .nickname(user.getNickname())
                .avatar(user.getAvatar())
                .role(user.getRole().name())
                .build();

        log.info("用户注册成功: userId={}", user.getId());
        return R.ok(userInfo);
    }

    /**
     * 获取当前用户信息
     */
    @GetMapping("/me")
    public R<LoginResponse.UserInfoVO> getCurrentUser(@AuthenticationPrincipal LoginUser loginUser) {
        if (loginUser == null) {
            throw new BusinessException("未登录");
        }

        User user = userService.findById(loginUser.getUserId())
                .orElseThrow(() -> new BusinessException("用户不存在"));

        LoginResponse.UserInfoVO userInfo = LoginResponse.UserInfoVO.builder()
                .id(user.getId())
                .username(user.getUsername())
                .email(user.getEmail())
                .nickname(user.getNickname())
                .avatar(user.getAvatar())
                .role(user.getRole().name())
                .build();

        return R.ok(userInfo);
    }

    /**
     * 用户登出
     */
    @PostMapping("/logout")
    public R<Void> logout(
            @AuthenticationPrincipal LoginUser loginUser,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String refreshToken = getCookieValue(request, AuthCookieConstants.REFRESH_TOKEN_COOKIE);
        authSessionService.revokeRefreshToken(refreshToken);
        clearAuthCookies(response);

        if (loginUser != null) {
            log.info("用户登出: userId={}", loginUser.getUserId());
        }
        return R.ok();
    }

    /**
     * 修改密码
     */
    @PostMapping("/change-password")
    public R<Void> changePassword(
            @AuthenticationPrincipal LoginUser loginUser,
            @Valid @RequestBody com.aetherblog.api.dto.auth.ChangePasswordRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse
    ) {

        if (loginUser == null) {
            throw new BusinessException("未登录");
        }

        log.info("用户修改密码: userId={}", loginUser.getUserId());

        // 查找用户
        User user = userService.findById(loginUser.getUserId())
                .orElseThrow(() -> new BusinessException("用户不存在"));

        // 获取密码（通过 HTTPS 传输）
        String currentPassword = request.getCurrentPassword();
        String newPassword = request.getNewPassword();

        // 验证当前密码
        if (!userService.validatePassword(user, currentPassword)) {
            throw new BusinessException("当前密码错误");
        }

        // 检查新密码不能与当前密码相同
        if (currentPassword.equals(newPassword)) {
            throw new BusinessException("新密码不能与当前密码相同");
        }

        // 检查新密码长度
        if (newPassword.length() < 8) {
            throw new BusinessException("新密码长度至少为8位");
        }

        // 更新密码
        userService.changePassword(user.getId(), newPassword);

        // 当前会话失效，强制重新登录
        String refreshToken = getCookieValue(httpRequest, AuthCookieConstants.REFRESH_TOKEN_COOKIE);
        authSessionService.revokeRefreshToken(refreshToken);
        clearAuthCookies(httpResponse);

        log.info("用户密码修改成功: userId={}", loginUser.getUserId());
        return R.ok();
    }

    /**
     * 更新个人信息
     */
    @PutMapping("/profile")
    public R<LoginResponse.UserInfoVO> updateProfile(
            @AuthenticationPrincipal LoginUser loginUser,
            @Valid @RequestBody com.aetherblog.api.dto.auth.UpdateProfileRequest request) {

        if (loginUser == null) {
            throw new BusinessException("未登录");
        }

        log.info("用户更新个人信息: userId={}", loginUser.getUserId());

        User user = userService.updateProfile(loginUser.getUserId(), request.getNickname(), request.getEmail());

        LoginResponse.UserInfoVO userInfo = LoginResponse.UserInfoVO.builder()
                .id(user.getId())
                .username(user.getUsername())
                .email(user.getEmail())
                .nickname(user.getNickname())
                .avatar(user.getAvatar())
                .role(user.getRole().name())
                .build();

        return R.ok(userInfo);
    }

    /**
     * 更新头像
     */
    @PutMapping("/avatar")
    public R<String> updateAvatar(
            @AuthenticationPrincipal LoginUser loginUser,
            @Valid @RequestBody UpdateAvatarRequest request) {

        if (loginUser == null) {
            throw new BusinessException("未登录");
        }

        String avatarUrl = request.getAvatarUrl();
        log.info("用户更新头像: userId={}, avatarUrl={}", loginUser.getUserId(), avatarUrl);

        userService.updateAvatar(loginUser.getUserId(), avatarUrl);

        return R.ok(avatarUrl);
    }

    private void recordLoginFailure(String identifier, String clientIp) {
        loginSecurityService.recordFailedAttempt(identifier, clientIp);
    }

    private String generateAccessToken(User user) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("username", user.getUsername());
        claims.put("role", user.getRole().name());
        return jwtService.generateToken(String.valueOf(user.getId()), claims);
    }

    private LoginResponse buildLoginResponse(User user, String accessToken) {
        return LoginResponse.builder()
                .accessToken(accessToken)
                .tokenType("Bearer")
                .expiresIn(authSessionService.getAccessTokenMaxAgeSeconds())
                .mustChangePassword(user.getMustChangePassword())
                .userInfo(LoginResponse.UserInfoVO.builder()
                        .id(user.getId())
                        .username(user.getUsername())
                        .email(user.getEmail())
                        .nickname(user.getNickname())
                        .avatar(user.getAvatar())
                        .role(user.getRole().name())
                        .build())
                .build();
    }

    private void writeAuthCookies(HttpServletResponse response, String accessToken, String refreshToken) {
        ResponseCookie accessCookie = buildCookie(
                AuthCookieConstants.ACCESS_TOKEN_COOKIE,
                accessToken,
                authSessionService.getAccessTokenMaxAgeSeconds(),
                ACCESS_TOKEN_COOKIE_PATH
        );
        ResponseCookie refreshCookie = buildCookie(
                AuthCookieConstants.REFRESH_TOKEN_COOKIE,
                refreshToken,
                authSessionService.getRefreshTokenMaxAgeSeconds(),
                REFRESH_TOKEN_COOKIE_PATH
        );

        response.addHeader(HttpHeaders.SET_COOKIE, accessCookie.toString());
        response.addHeader(HttpHeaders.SET_COOKIE, refreshCookie.toString());
    }

    private void clearAuthCookies(HttpServletResponse response) {
        ResponseCookie clearAccessCookie = buildCookie(
                AuthCookieConstants.ACCESS_TOKEN_COOKIE,
                "",
                0,
                ACCESS_TOKEN_COOKIE_PATH
        );
        ResponseCookie clearRefreshCookie = buildCookie(
                AuthCookieConstants.REFRESH_TOKEN_COOKIE,
                "",
                0,
                REFRESH_TOKEN_COOKIE_PATH
        );

        response.addHeader(HttpHeaders.SET_COOKIE, clearAccessCookie.toString());
        response.addHeader(HttpHeaders.SET_COOKIE, clearRefreshCookie.toString());
    }

    private ResponseCookie buildCookie(String name, String value, long maxAgeSeconds, String path) {
        ResponseCookie.ResponseCookieBuilder cookieBuilder = ResponseCookie.from(name, value)
                .httpOnly(true)
                .secure(cookieSecure)
                .sameSite(cookieSameSite)
                .path(path)
                .maxAge(maxAgeSeconds);
        return cookieBuilder.build();
    }

    private String getCookieValue(HttpServletRequest request, String cookieName) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null || cookies.length == 0) {
            return null;
        }

        for (Cookie cookie : cookies) {
            if (cookieName.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }
}
