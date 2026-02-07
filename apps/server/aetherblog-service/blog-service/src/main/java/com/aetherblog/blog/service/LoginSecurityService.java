package com.aetherblog.blog.service;

import com.aetherblog.common.core.exception.BusinessException;
import com.aetherblog.common.redis.service.RedisService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * 登录安全策略（失败次数统计与短期锁定）
 */
@Service
@RequiredArgsConstructor
public class LoginSecurityService {

    private static final String LOGIN_FAIL_KEY_PREFIX = "auth:login:fail:";
    private static final String LOGIN_LOCK_KEY_PREFIX = "auth:login:lock:";

    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final Duration WINDOW_DURATION = Duration.ofMinutes(15);
    private static final Duration LOCK_DURATION = Duration.ofMinutes(15);

    private final RedisService redisService;

    /**
     * 登录前检查是否被锁定
     */
    public void assertLoginAllowed(String identifier, String ip) {
        String keySuffix = buildKeySuffix(identifier, ip);
        Boolean isLocked = redisService.hasKey(LOGIN_LOCK_KEY_PREFIX + keySuffix);
        if (Boolean.TRUE.equals(isLocked)) {
            throw new BusinessException(429, "登录尝试过于频繁，请15分钟后重试");
        }
    }

    /**
     * 记录登录失败，达到阈值后锁定
     */
    public void recordFailedAttempt(String identifier, String ip) {
        String keySuffix = buildKeySuffix(identifier, ip);
        String failKey = LOGIN_FAIL_KEY_PREFIX + keySuffix;
        long failCount = redisService.increment(failKey, 1);

        if (failCount == 1) {
            redisService.expire(failKey, WINDOW_DURATION.toSeconds(), TimeUnit.SECONDS);
        }

        if (failCount >= MAX_FAILED_ATTEMPTS) {
            redisService.set(LOGIN_LOCK_KEY_PREFIX + keySuffix, "1", LOCK_DURATION.toSeconds(), TimeUnit.SECONDS);
        }
    }

    /**
     * 登录成功后清除失败记录
     */
    public void clearFailedAttempts(String identifier, String ip) {
        String keySuffix = buildKeySuffix(identifier, ip);
        redisService.delete(LOGIN_FAIL_KEY_PREFIX + keySuffix);
        redisService.delete(LOGIN_LOCK_KEY_PREFIX + keySuffix);
    }

    private String buildKeySuffix(String identifier, String ip) {
        String safeIdentifier = StringUtils.hasText(identifier)
                ? identifier.trim().toLowerCase(Locale.ROOT)
                : "unknown";
        String safeIp = StringUtils.hasText(ip)
                ? ip.trim().toLowerCase(Locale.ROOT)
                : "unknown";
        return safeIdentifier + ":" + safeIp;
    }
}
