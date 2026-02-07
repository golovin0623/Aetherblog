package com.aetherblog.blog.service;

import com.aetherblog.common.security.config.JwtConfig;
import com.aetherblog.common.redis.service.RedisService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.concurrent.TimeUnit;

/**
 * 认证会话服务（刷新令牌签发、轮换与撤销）
 */
@Service
@RequiredArgsConstructor
public class AuthSessionService {

    private static final String REFRESH_TOKEN_KEY_PREFIX = "auth:refresh:";
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final RedisService redisService;
    private final JwtConfig jwtConfig;

    public record RefreshSession(Long userId, String refreshToken) {}

    /**
     * 签发刷新令牌
     */
    public String issueRefreshToken(Long userId) {
        String refreshToken = generateRefreshToken();
        String key = buildRefreshTokenKey(refreshToken);
        redisService.set(key, userId, getRefreshTokenTtlSeconds(), TimeUnit.SECONDS);
        return refreshToken;
    }

    /**
     * 轮换刷新令牌
     */
    public RefreshSession rotateRefreshToken(String refreshToken) {
        Long userId = validateRefreshToken(refreshToken);
        if (userId == null) {
            return null;
        }

        revokeRefreshToken(refreshToken);
        String newRefreshToken = issueRefreshToken(userId);
        return new RefreshSession(userId, newRefreshToken);
    }

    /**
     * 验证刷新令牌并返回 userId
     */
    public Long validateRefreshToken(String refreshToken) {
        if (!StringUtils.hasText(refreshToken)) {
            return null;
        }

        Object userIdObj = redisService.get(buildRefreshTokenKey(refreshToken));
        if (userIdObj == null) {
            return null;
        }

        return Long.valueOf(userIdObj.toString());
    }

    /**
     * 撤销刷新令牌
     */
    public void revokeRefreshToken(String refreshToken) {
        if (!StringUtils.hasText(refreshToken)) {
            return;
        }
        redisService.delete(buildRefreshTokenKey(refreshToken));
    }

    public long getRefreshTokenMaxAgeSeconds() {
        return getRefreshTokenTtlSeconds();
    }

    public long getAccessTokenMaxAgeSeconds() {
        long expirationMillis = jwtConfig.getExpiration();
        return Math.max(1, expirationMillis / 1000);
    }

    private long getRefreshTokenTtlSeconds() {
        long refreshExpirationMillis = jwtConfig.getRefreshExpiration();
        return Math.max(1, refreshExpirationMillis / 1000);
    }

    private String generateRefreshToken() {
        byte[] randomBytes = new byte[32];
        SECURE_RANDOM.nextBytes(randomBytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
    }

    private String buildRefreshTokenKey(String refreshToken) {
        return REFRESH_TOKEN_KEY_PREFIX + sha256Hex(refreshToken);
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 algorithm is not available", exception);
        }
    }
}
