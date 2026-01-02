package com.aetherblog.common.security.service;

import com.aetherblog.common.redis.service.RedisService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Token 服务
 */
@Service
@RequiredArgsConstructor
public class TokenService {

    private static final String LOGIN_TOKEN_KEY = "login_token:";
    private static final long TOKEN_EXPIRE_TIME = 24 * 60 * 60; // 24小时

    private final RedisService redisService;

    /**
     * 创建Token
     */
    public String createToken(Long userId) {
        String token = UUID.randomUUID().toString().replace("-", "");
        redisService.set(LOGIN_TOKEN_KEY + token, userId, TOKEN_EXPIRE_TIME, TimeUnit.SECONDS);
        return token;
    }

    /**
     * 验证Token
     */
    public Long validateToken(String token) {
        Object userId = redisService.get(LOGIN_TOKEN_KEY + token);
        return userId != null ? Long.valueOf(userId.toString()) : null;
    }

    /**
     * 刷新Token
     */
    public void refreshToken(String token) {
        redisService.expire(LOGIN_TOKEN_KEY + token, TOKEN_EXPIRE_TIME, TimeUnit.SECONDS);
    }

    /**
     * 删除Token
     */
    public void removeToken(String token) {
        redisService.delete(LOGIN_TOKEN_KEY + token);
    }
}
