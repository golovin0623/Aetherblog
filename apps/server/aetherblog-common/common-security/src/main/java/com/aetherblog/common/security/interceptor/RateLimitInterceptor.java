package com.aetherblog.common.security.interceptor;

import com.aetherblog.common.core.domain.R;
import com.aetherblog.common.core.utils.IpUtils;
import com.aetherblog.common.core.utils.JsonUtils;
import com.aetherblog.common.core.utils.ServletUtils;
import com.aetherblog.common.security.annotation.RateLimit;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Collections;
import java.util.concurrent.TimeUnit;

/**
 * Limit Request Interceptor
 * Replaces the previous Filter implementation to ensure reliable handler resolution.
 */
@Slf4j
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private final RedisTemplate<String, Object> redisTemplate;
    private final RedisScript<Long> rateLimitScript;

    private static final String LUA_SCRIPT_TEXT =
        "local count = redis.call('incr', KEYS[1]) " +
        "if tonumber(count) == 1 then " +
        "  redis.call('expire', KEYS[1], ARGV[1]) " +
        "end " +
        "return count";

    private static final String RATE_LIMIT_KEY = "rate_limit:";

    public RateLimitInterceptor(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.rateLimitScript = new DefaultRedisScript<>(LUA_SCRIPT_TEXT, Long.class);
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if (handler instanceof HandlerMethod handlerMethod) {
            RateLimit rateLimit = handlerMethod.getMethodAnnotation(RateLimit.class);
            if (rateLimit != null) {
                if (!checkRateLimit(request, rateLimit)) {
                    response.setStatus(429);
                    ServletUtils.renderJson(response, JsonUtils.toJson(R.fail(429, "请求过于频繁，请稍后重试")));
                    return false;
                }
            }
        }
        return true;
    }

    private boolean checkRateLimit(HttpServletRequest request, RateLimit rateLimit) {
        String key = buildKey(request, rateLimit);
        long expireTime = rateLimit.timeUnit().toSeconds(rateLimit.time());

        try {
            Long count = redisTemplate.execute(
                rateLimitScript,
                Collections.singletonList(key),
                String.valueOf(expireTime)
            );
            return count != null && count <= rateLimit.count();
        } catch (Exception e) {
            log.warn("Rate limit check failed for key: {}", key, e);
            // Fail open: allow request if rate limit check fails (e.g., Redis down)
            return true;
        }
    }

    private String buildKey(HttpServletRequest request, RateLimit rateLimit) {
        StringBuilder key = new StringBuilder(RATE_LIMIT_KEY);
        
        if (!rateLimit.key().isEmpty()) {
            key.append(rateLimit.key());
        } else {
            key.append(request.getRequestURI());
        }
        
        if (rateLimit.limitType() == RateLimit.LimitType.IP) {
            key.append(":").append(IpUtils.getIpAddr(request));
        }
        
        return key.toString();
    }
}
