package com.aetherblog.blog.controller;

import com.aetherblog.api.dto.auth.LoginRequest;
import com.aetherblog.api.dto.auth.LoginResponse;
import com.aetherblog.api.dto.auth.RegisterRequest;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.service.UserService;
import com.aetherblog.common.core.domain.R;
import com.aetherblog.common.core.exception.BusinessException;
import com.aetherblog.common.security.domain.LoginUser;
import com.aetherblog.common.security.service.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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

    private final UserService userService;
    private final JwtService jwtService;

    private static final long TOKEN_EXPIRATION_SECONDS = 86400; // 24 hours

    /**
     * 用户登录
     */
    @PostMapping("/login")
    public R<LoginResponse> login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
        log.info("用户登录请求: username={}, encrypted={}", request.getUsername(), request.getEncrypted());

        // 查找用户
        User user = userService.findByUsernameOrEmail(request.getUsername())
                .orElseThrow(() -> new BusinessException("用户名或密码错误"));

        // 检查用户状态
        userService.checkUserCanLogin(user);

        // 获取密码（如果加密则解密）
        String password = request.getPassword();
        if (Boolean.TRUE.equals(request.getEncrypted())) {
            try {
                password = com.aetherblog.common.core.util.CryptoUtils.decryptPassword(password);
                log.debug("密码解密成功");
            } catch (Exception e) {
                log.error("密码解密失败", e);
                throw new BusinessException("登录失败，请重试");
            }
        }

        // 验证密码
        if (!userService.validatePassword(user, password)) {
            throw new BusinessException("用户名或密码错误");
        }

        // 生成 Token
        Map<String, Object> claims = new HashMap<>();
        claims.put("username", user.getUsername());
        claims.put("role", user.getRole().name());
        String token = jwtService.generateToken(String.valueOf(user.getId()), claims);

        // 更新登录信息
        String clientIp = getClientIp(httpRequest);
        userService.updateLoginInfo(user.getId(), clientIp);

        // 构建响应
        LoginResponse response = LoginResponse.builder()
                .accessToken(token)
                .tokenType("Bearer")
                .expiresIn(TOKEN_EXPIRATION_SECONDS)
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

        log.info("用户登录成功: userId={}, username={}, mustChangePassword={}", 
                user.getId(), user.getUsername(), user.getMustChangePassword());
        return R.ok(response);
    }

    /**
     * 用户注册
     */
    @PostMapping("/register")
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
    public R<Void> logout(@AuthenticationPrincipal LoginUser loginUser) {
        if (loginUser != null) {
            log.info("用户登出: userId={}", loginUser.getUserId());
        }
        // JWT 是无状态的，前端删除 Token 即可
        // 如需实现 Token 黑名单，可在此添加 Redis 逻辑
        return R.ok();
    }

    /**
     * 修改密码
     */
    @PostMapping("/change-password")
    public R<Void> changePassword(
            @AuthenticationPrincipal LoginUser loginUser,
            @Valid @RequestBody com.aetherblog.api.dto.auth.ChangePasswordRequest request) {
        
        if (loginUser == null) {
            throw new BusinessException("未登录");
        }
        
        log.info("用户修改密码: userId={}, encrypted={}", loginUser.getUserId(), request.getEncrypted());
        
        // 查找用户
        User user = userService.findById(loginUser.getUserId())
                .orElseThrow(() -> new BusinessException("用户不存在"));
        
        // 获取密码（如果加密则解密）
        String currentPassword = request.getCurrentPassword();
        String newPassword = request.getNewPassword();
        
        if (Boolean.TRUE.equals(request.getEncrypted())) {
            try {
                currentPassword = com.aetherblog.common.core.util.CryptoUtils.decryptPassword(currentPassword);
                newPassword = com.aetherblog.common.core.util.CryptoUtils.decryptPassword(newPassword);
                log.debug("密码解密成功");
            } catch (Exception e) {
                log.error("密码解密失败", e);
                throw new BusinessException("操作失败，请重试");
            }
        }
        
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
        
        log.info("用户密码修改成功: userId={}", loginUser.getUserId());
        return R.ok();
    }

    /**
     * 获取客户端 IP
     */
    private String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        // 多个代理时取第一个
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }
        return ip;
    }
}
