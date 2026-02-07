package com.aetherblog.blog.controller;

import com.aetherblog.api.dto.auth.RegisterRequest;
import com.aetherblog.common.security.annotation.RateLimit;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Method;
import static org.junit.jupiter.api.Assertions.*;

public class RateLimitVerificationTest {

    @Test
    public void registerMethodShouldHaveRateLimitAnnotation() throws NoSuchMethodException {
        Method registerMethod = AuthController.class.getMethod("register", RegisterRequest.class);

        RateLimit rateLimit = registerMethod.getAnnotation(RateLimit.class);
        assertNotNull(rateLimit, "Register method must have @RateLimit annotation");

        assertEquals("auth:register", rateLimit.key(), "Rate limit key mismatch");
        assertEquals(5, rateLimit.count(), "Rate limit count mismatch");
        assertEquals(600, rateLimit.time(), "Rate limit time mismatch");
        assertEquals(RateLimit.LimitType.IP, rateLimit.limitType(), "Rate limit type mismatch");
    }
}
