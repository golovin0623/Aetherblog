package com.aetherblog.common.security.filter;

import com.aetherblog.common.core.domain.R;
import com.aetherblog.common.core.utils.IpUtils;
import com.aetherblog.common.core.utils.JsonUtils;
import com.aetherblog.common.core.utils.ServletUtils;
import com.aetherblog.common.security.annotation.RateLimit;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerExecutionChain;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.io.IOException;
import java.util.Collections;
import java.util.concurrent.TimeUnit;

/**
 * 限流过滤器
 */
@Slf4j
@Component
@SuppressWarnings("null")
public class RateLimitFilter implements Filter {

    // Removed RedisService dependency in favor of direct RedisTemplate for Lua script execution
    private final RedisTemplate<String, Object> redisTemplate;
    private final RequestMappingHandlerMapping handlerMapping;

    private static final String LUA_SCRIPT_TEXT =
        "local count = redis.call('incr', KEYS[1]) " +
        "if tonumber(count) == 1 then " +
        "  redis.call('expire', KEYS[1], ARGV[1]) " +
        "end " +
        "return count";

    private final RedisScript<Long> rateLimitScript;

    public RateLimitFilter(
            RedisTemplate<String, Object> redisTemplate,
            @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping handlerMapping) {
        this.redisTemplate = redisTemplate;
        this.handlerMapping = handlerMapping;
        this.rateLimitScript = new DefaultRedisScript<>(LUA_SCRIPT_TEXT, Long.class);
    }

    private static final String RATE_LIMIT_KEY = "rate_limit:";

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        try {
            HandlerExecutionChain handlerChain = handlerMapping.getHandler(httpRequest);
            if (handlerChain != null && handlerChain.getHandler() instanceof HandlerMethod handlerMethod) {
                RateLimit rateLimit = handlerMethod.getMethodAnnotation(RateLimit.class);
                if (rateLimit != null && !checkRateLimit(httpRequest, rateLimit)) {
                    httpResponse.setStatus(429);
                    ServletUtils.renderJson(httpResponse, JsonUtils.toJson(R.fail(429, "请求过于频繁，请稍后重试")));
                    return;
                }
            }
        } catch (Exception e) {
            log.warn("限流检查失败", e);
        }

        chain.doFilter(request, response);
    }

    private boolean checkRateLimit(HttpServletRequest request, RateLimit rateLimit) {
        String key = buildKey(request, rateLimit);
        
        // Use Lua script for atomic increment and expire
        long expireTime = rateLimit.timeUnit().toSeconds(rateLimit.time());

        Long count = redisTemplate.execute(
            rateLimitScript,
            Collections.singletonList(key),
            String.valueOf(expireTime)
        );
        
        return count != null && count <= rateLimit.count();
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
